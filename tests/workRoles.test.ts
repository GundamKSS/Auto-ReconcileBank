import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ ready: true, roles: ['AP'] as string[], fail: false, query: vi.fn(), input: vi.fn() }));
vi.mock('mssql', () => {
  class Transaction {}
  class Request {
    input(...args: unknown[]) { h.input(...args); return this; }
    async query(text: string) {
      h.query(text);
      if (h.fail) throw new Error('database unavailable');
      return { recordset: text.includes('OBJECT_ID') ? [{ Ready: Number(h.ready) }] : h.roles.map((RoleCode) => ({ RoleCode })) };
    }
  }
  return { default: { Transaction, Request, NVarChar: () => 'string' } };
});
vi.mock('../lib/db', () => ({ getPool: vi.fn().mockResolvedValue({}) }));
import sql from 'mssql';
import { assertWorkRole, assertWorkSides, readWorkPermissions } from '../lib/workRolesDb';
import { hasWorkRole, normalizeEmployeeCode, directionWorkRole, effectiveAppRole, effectiveWorkRoles, visibleWorkSides, type WorkPermissions } from '../lib/workRoles';
import type { Session } from '../lib/session';

// สิทธิ์ในโปรแกรมใช้กับ User ระบบกลาง — Admin/Dev ได้ทุกสิทธิ์จากระบบกลาง (มีเทสแยกด้านล่าง)
const session: Session = { username: 'alice', displayName: 'Alice', role: 'User', employeeNo: '0012' };
beforeEach(() => { vi.clearAllMocks(); h.ready = true; h.roles = ['AP']; h.fail = false; });

describe('employee identity and workflow roles', () => {
  it('preserves leading zeroes and rejects invalid identities', () => {
    expect(normalizeEmployeeCode(' 0012a ')).toBe('0012A');
    for (const value of [12, null, undefined, '', 'a b', "x';drop", 'a'.repeat(51)]) expect(normalizeEmployeeCode(value)).toBeNull();
  });
  it('maps directions to the correct responsibilities', () => {
    expect(directionWorkRole('OUT')).toBe('AP'); expect(directionWorkRole('IN')).toBe('AR');
  });
  it('only uses the signed employee code as the database key', async () => {
    expect((await readWorkPermissions(session)).roles).toEqual(['AP']);
    expect(h.input).toHaveBeenCalledWith('emp', 'string', '0012');
    expect(h.input).not.toHaveBeenCalledWith('emp', expect.anything(), 'alice');
  });
  it('does not fall back to username for legacy sessions', async () => {
    const permissions = await readWorkPermissions({ ...session, employeeNo: undefined });
    expect(permissions.roles).toEqual([]); expect(permissions.employeeCode).toBeNull();
    await expect(assertWorkRole({ ...session, employeeNo: undefined }, 'AP', new sql.Transaction())).rejects.toThrow('เข้าสู่ระบบใหม่');
  });
  it('AP does not imply AR or Master rights', async () => {
    const permissions = await readWorkPermissions(session);
    expect(hasWorkRole(permissions, 'AP')).toBe(true);
    expect(hasWorkRole(permissions, 'AR')).toBe(false);
    expect(hasWorkRole(permissions, 'MASTER')).toBe(false);
    await expect(assertWorkRole(session, 'AR', new sql.Transaction())).rejects.toMatchObject({ status: 403 });
  });
  it('ignores retired or unknown role codes (CLOSER rows stay only as history)', async () => {
    h.roles = ['AR', 'CLOSER', 'REPORT', 'UNKNOWN'];
    expect((await readWorkPermissions(session)).roles).toEqual(['AR']);
    await expect(assertWorkRole(session, 'MASTER', new sql.Transaction())).rejects.toMatchObject({ status: 403 });
  });
  it.each(['Admin', 'Dev'] as const)('central %s is Master Admin without any in-program row or EMP code', async (role) => {
    h.roles = [];
    const permissions = await readWorkPermissions({ ...session, role, employeeNo: undefined });
    for (const r of ['AP', 'AR', 'MASTER'] as const) expect(hasWorkRole(permissions, r)).toBe(true);
    await expect(assertWorkRole({ ...session, role, employeeNo: undefined }, 'MASTER', new sql.Transaction())).resolves.toBeUndefined();
    await expect(assertWorkSides({ ...session, role }, ['IN', 'OUT'], new sql.Transaction())).resolves.toBeUndefined();
    expect(h.query).not.toHaveBeenCalledWith(expect.stringContaining('ReconciliationEmployeeRole WITH'));
  });
  it('revocation is effective at the next request without logout', async () => {
    await expect(assertWorkRole(session, 'AP', new sql.Transaction())).resolves.toBeUndefined();
    h.roles = [];
    await expect(assertWorkRole(session, 'AP', new sql.Transaction())).rejects.toMatchObject({ status: 403 });
  });
  it('missing migration disables permissions, never falls back to Admin', async () => {
    h.ready = false;
    expect((await readWorkPermissions(session)).ready).toBe(false);
    await expect(assertWorkRole(session, 'AP', new sql.Transaction())).rejects.toMatchObject({ status: 409 });
  });
  it('database failure cannot bypass permissions', async () => {
    h.fail = true;
    await expect(assertWorkRole(session, 'AP', new sql.Transaction())).rejects.toThrow('database unavailable');
  });
  it('AR employees cannot change money-out (AP) lines, and vice versa', async () => {
    h.roles = ['AR'];
    await expect(assertWorkSides(session, ['IN'], new sql.Transaction())).resolves.toBeUndefined();
    await expect(assertWorkSides(session, ['IN', 'OUT'], new sql.Transaction())).rejects.toMatchObject({ status: 403 });
    h.roles = ['AP'];
    await expect(assertWorkSides(session, ['IN'], new sql.Transaction())).rejects.toThrow('AR');
  });
  it('GL offsets (IN+OUT in one pair) need only one side role', async () => {
    h.roles = ['AR'];
    await expect(assertWorkSides(session, ['IN', 'OUT'], new sql.Transaction(), 'any')).resolves.toBeUndefined();
    h.roles = ['AP'];
    await expect(assertWorkSides(session, ['IN', 'OUT'], new sql.Transaction(), 'any')).resolves.toBeUndefined();
    h.roles = [];
    await expect(assertWorkSides(session, ['IN', 'OUT'], new sql.Transaction(), 'any')).rejects.toMatchObject({ status: 403 });
  });
  it('side checks are skipped until roles are installed, and with no lines', async () => {
    h.ready = false; h.roles = [];
    await expect(assertWorkSides(session, ['OUT'], new sql.Transaction())).resolves.toBeUndefined();
    h.ready = true;
    await expect(assertWorkSides(session, [], new sql.Transaction())).resolves.toBeUndefined();
  });
  it('MASTER carries AP and AR', async () => {
    h.roles = ['MASTER'];
    const master = await readWorkPermissions(session);
    for (const role of ['AP', 'AR', 'MASTER'] as const) expect(hasWorkRole(master, role)).toBe(true);
    await expect(assertWorkSides(session, ['IN', 'OUT'], new sql.Transaction())).resolves.toBeUndefined();
  });
  it('central Dev/Admin stand; a central User becomes Admin (MASTER), Staff (AP/AR) or Viewer', () => {
    const perms = (roles: WorkPermissions['roles']): WorkPermissions => ({ ready: true, employeeCode: '0012', roles: effectiveWorkRoles(roles) });
    expect(effectiveAppRole('Dev', perms([]))).toBe('Dev');
    expect(effectiveAppRole('Admin', perms([]))).toBe('Admin');
    expect(effectiveAppRole('User', perms(['MASTER']))).toBe('Admin');
    expect(effectiveAppRole('User', perms(['AP']))).toBe('Staff');
    expect(effectiveAppRole('User', perms(['AR']))).toBe('Staff');
    expect(effectiveAppRole('User', perms([]))).toBe('User');
    expect(effectiveAppRole('User', { ready: false, employeeCode: '0012', roles: [] })).toBe('User');
  });
  it('one side role sees only that side; both, none or MASTER see both', () => {
    const perms = (roles: WorkPermissions['roles']): WorkPermissions => ({ ready: true, employeeCode: '0012', roles: effectiveWorkRoles(roles) });
    expect(visibleWorkSides(perms(['AR']))).toEqual(['IN']);
    expect(visibleWorkSides(perms(['AP']))).toEqual(['OUT']);
    expect(visibleWorkSides(perms(['AP', 'AR']))).toEqual(['IN', 'OUT']);
    expect(visibleWorkSides(perms([]))).toEqual(['IN', 'OUT']);
    expect(visibleWorkSides(perms(['MASTER']))).toEqual(['IN', 'OUT']);
    expect(visibleWorkSides(undefined)).toEqual(['IN', 'OUT']);
  });
});
