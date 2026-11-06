import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const h = vi.hoisted(() => ({ auth: vi.fn(), ready: vi.fn(), query: vi.fn(), input: vi.fn(), begin: vi.fn(), commit: vi.fn(), rollback: vi.fn() }));
vi.mock('mssql', () => {
  class Request { input(...args: unknown[]) { h.input(...args); return this; } query = h.query; }
  class Transaction { begin = h.begin; commit = h.commit; rollback = h.rollback; }
  return { default: { Request, Transaction, NVarChar: () => 'string', VarChar: () => 'string', Bit: 'bit' } };
});
vi.mock('../lib/db', () => ({ getPool: vi.fn().mockResolvedValue({ request: () => ({ input() { return this; }, query: h.query }) }) }));
vi.mock('../lib/session', () => ({ requireRole: h.auth, auditWorkActor: () => 'Admin (admin)' }));
vi.mock('../lib/workRolesDb', () => ({ workRolesReady: h.ready, WORK_ROLES_MIGRATION_HINT: '010 required' }));
import { GET, PUT } from '../app/api/master/work-roles/route';
const req = (extra = {}) => new NextRequest('http://localhost/api/master/work-roles', { method: 'PUT',
  body: JSON.stringify({ employeeCode: ' 0007 ', roleCode: 'AP', isActive: true, reason: 'มอบหมายงานเงินออก', ...extra }) });
beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue({ ok: true, session: {} }); h.ready.mockResolvedValue(true);
  h.query.mockReset().mockImplementation(async (query: string) => ({
    recordset: query.includes('1 AS Found') ? [{ Found: 1 }] : [],
  }));
});
describe('employee-role administration API (no live DB writes)', () => {
  it('denies non-admin users before reading or granting permissions', async () => {
    h.auth.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });
    expect((await GET(req())).status).toBe(403);
    expect((await PUT(req())).status).toBe(403);
    expect(h.auth).toHaveBeenCalledWith(['Admin', 'Dev']);
    expect(h.query).not.toHaveBeenCalled();
  });
  it('adds directory names to assignments and history without changing permissions', async () => {
    h.query.mockResolvedValueOnce({ recordset: [{ employeeCode: '0007', roleCode: 'AP', isActive: true }] })
      .mockResolvedValueOnce({ recordset: [{ employeeCode: '0007', eventId: 1 }] })
      .mockResolvedValueOnce({ recordset: [{ employeeCode: '0007', employeeName: 'ชื่อ ทดสอบ' }] });
    const data = await (await GET(req())).json();
    expect(data.roles[0]).toMatchObject({ employeeName: 'ชื่อ ทดสอบ', roleCode: 'AP', isActive: true });
    expect(data.history[0].employeeName).toBe('ชื่อ ทดสอบ');
    expect(h.begin).not.toHaveBeenCalled();
  });
  it('keeps existing assignments available when the directory is unavailable', async () => {
    h.query.mockResolvedValueOnce({ recordset: [{ employeeCode: '0007', roleCode: 'AP', isActive: true }] })
      .mockResolvedValueOnce({ recordset: [] }).mockRejectedValueOnce(new Error('directory offline'));
    const response = await GET(req());
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.roles[0].employeeCode).toBe('0007');
    expect(data.roles[0].employeeName).toBeNull();
    expect(data.directoryWarning).toContain('DATA_CENTER');
  });
  it.each([{ employeeCode: '' }, { employeeCode: "001'; DROP TABLE X" }, { employeeCode: 7 }, { roleCode: 'Admin' }, { roleCode: 'OWNER' }, { isActive: 'true' }, { reason: '' }])(
    'rejects malformed grants: %j', async (extra) => {
      expect((await PUT(req(extra))).status).toBe(400);
      expect(h.query).not.toHaveBeenCalled();
    },
  );
  it('parameterizes the exact employee and role, with atomic audit history', async () => {
    expect((await PUT(req())).status).toBe(200);
    expect(h.input).toHaveBeenCalledWith('emp', 'string', '0007');
    expect(h.input).toHaveBeenCalledWith('role', 'string', 'AP');
    expect(h.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO ReconciliationEmployeeRoleEvent'));
    expect(h.commit).toHaveBeenCalledOnce();
    expect(h.query.mock.calls[0][0]).toContain('[DATA_CENTER].[dbo].[Employee] WITH (HOLDLOCK)');
    expect(h.query.mock.calls[0][0]).toContain('WHERE [No]=@emp');
    expect(h.query.mock.calls[0][0]).not.toMatch(/PasswordHash|First_Name|\[Role\]/);
  });
  it.each(['AP', 'AR', 'MASTER'])('rejects opening %s for a missing employee, including direct API calls', async (roleCode) => {
    h.query.mockResolvedValueOnce({ recordset: [] });
    const response = await PUT(req({ roleCode, employeeCode: 'MISSING001', employeeExists: true }));
    expect(response.status).toBe(422);
    expect((await response.json()).error).toContain('ไม่พบ EMP code MISSING001');
    expect(h.query).toHaveBeenCalledTimes(1);
    expect(h.rollback).toHaveBeenCalledOnce();
    expect(h.commit).not.toHaveBeenCalled();
  });
  it('fails closed when the employee directory cannot be read, without writing grants or audit events', async () => {
    h.query.mockRejectedValueOnce(new Error('private database connection details'));
    const response = await PUT(req());
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(text).toContain('ตรวจสอบทะเบียนพนักงานไม่ได้');
    expect(text).not.toContain('private');
    expect(h.query).toHaveBeenCalledTimes(1);
    expect(h.rollback).toHaveBeenCalledOnce();
    expect(h.commit).not.toHaveBeenCalled();
  });
  it('rechecks the employee for every activation instead of trusting a previous lookup', async () => {
    expect((await PUT(req())).status).toBe(200);
    h.query.mockResolvedValueOnce({ recordset: [] });
    expect((await PUT(req())).status).toBe(422);
    expect(h.commit).toHaveBeenCalledTimes(1);
    expect(h.rollback).toHaveBeenCalledTimes(1);
  });
  it.each(['missing', 'offline'])('allows revocation when the directory is %s', async (state) => {
    h.query.mockImplementation(async (query: string) => {
      if (query.includes('[DATA_CENTER]')) {
        if (state === 'offline') throw new Error('directory offline');
        return { recordset: [] };
      }
      return { recordset: [] };
    });
    expect((await PUT(req({ isActive: false }))).status).toBe(200);
    expect(h.query).toHaveBeenCalledTimes(1);
    expect(h.query.mock.calls[0][0]).not.toContain('[DATA_CENTER]');
    expect(h.query.mock.calls[0][0]).toContain('INSERT INTO ReconciliationEmployeeRoleEvent');
    expect(h.commit).toHaveBeenCalledOnce();
  });
  it('revokes by disabling the assignment rather than deleting audit data', async () => {
    expect((await PUT(req({ isActive: false }))).status).toBe(200);
    expect(h.input).toHaveBeenCalledWith('active', 'bit', false);
    expect(h.query.mock.calls[0][0]).not.toContain('DELETE');
  });
  it.each([true, false])('nobody changes their own MASTER (active=%s; would lock themselves out)', async (isActive) => {
    h.auth.mockResolvedValue({ ok: true, session: { employeeNo: '0007' } });
    const response = await PUT(req({ roleCode: 'MASTER', isActive }));
    expect(response.status).toBe(403);
    expect(h.begin).not.toHaveBeenCalled();
  });
  it('another admin may grant MASTER', async () => {
    h.auth.mockResolvedValue({ ok: true, session: { employeeNo: '0001' } });
    expect((await PUT(req({ roleCode: 'MASTER' }))).status).toBe(200);
  });
  it('does not write if the schema is missing', async () => {
    h.ready.mockResolvedValue(false);
    expect((await PUT(req())).status).toBe(409);
    expect(h.begin).not.toHaveBeenCalled();
  });
  it('rolls back grant and audit together if the database fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    h.query.mockResolvedValueOnce({ recordset: [{ Found: 1 }] }).mockRejectedValueOnce(new Error('failed'));
    expect((await PUT(req())).status).toBe(500);
    expect(h.rollback).toHaveBeenCalledOnce(); expect(h.commit).not.toHaveBeenCalled();
    log.mockRestore();
  });
});
