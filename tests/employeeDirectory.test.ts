import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const h = vi.hoisted(() => ({ auth: vi.fn(), query: vi.fn(), input: vi.fn(), pool: vi.fn() }));
vi.mock('mssql', () => ({ default: { NVarChar: (size: number) => size } }));
vi.mock('../lib/db', () => ({ getPool: h.pool }));
vi.mock('../lib/session', () => ({ requireRole: h.auth }));
import { GET } from '../app/api/master/employees/route';
import { employeeNames } from '../lib/employeeDirectoryDb';
import { employeeSearchPattern } from '../lib/employeeDirectory';

const pool = { request: () => ({ input(...args: unknown[]) { h.input(...args); return this; }, query: h.query }) };
const req = (params: Record<string, string>) => new NextRequest(`http://localhost/api/master/employees?${new URLSearchParams(params)}`);
beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue({ ok: true }); h.pool.mockResolvedValue(pool);
  h.query.mockReset().mockResolvedValue({ recordset: [] });
});

describe('employee directory lookup', () => {
  it('requires role administration access before accessing the directory', async () => {
    h.auth.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });
    expect((await GET(req({ q: 'สมชาย' }))).status).toBe(403);
    expect(h.auth).toHaveBeenCalledWith(['Admin', 'Dev']);
    expect(h.pool).not.toHaveBeenCalled();
  });
  it.each<Record<string, string>>([{}, { q: '' }, { q: 'ก' }, { q: 'ก'.repeat(101) }, { employeeCode: "';DROP TABLE X" }])('rejects invalid/empty searches: %j', async (params) => {
    expect((await GET(req(params))).status).toBe(400);
    expect(h.pool).not.toHaveBeenCalled();
  });
  it('searches Thai names and returns only a safe SQL projection without caching', async () => {
    h.query.mockResolvedValue({ recordset: [{ employeeCode: '0007', employeeName: 'สมชาย ใจดี', jobTitle: 'บัญชี' }] });
    const response = await GET(req({ q: ' สมชาย ใจดี ' }));
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect((await response.json()).employees[0].employeeName).toBe('สมชาย ใจดี');
    expect(h.input).toHaveBeenCalledWith('query', 100, 'สมชาย ใจดี');
    const sql = h.query.mock.calls[0][0];
    expect(sql).toContain('[DATA_CENTER].[dbo].[Employee]');
    expect(sql).toContain('First_Name'); expect(sql).toContain('Last_Name');
    expect(sql).not.toMatch(/PasswordHash|E_Mail|Mobile_Phone_No|\[Role\]|SELECT\s+\*/i);
  });
  it('keeps leading zeroes and resolves typed EMP code exactly', async () => {
    await GET(req({ employeeCode: ' 0007 ' }));
    expect(h.input).toHaveBeenCalledWith('query', 100, '0007');
    expect(h.query.mock.calls[0][0]).toContain('WHERE [No] = @query');
    expect(h.query.mock.calls[0][0]).not.toContain('LIKE');
  });
  it('parameterizes SQL injection characters and escapes LIKE wildcards', async () => {
    const search = "O'Neil_%[~";
    await GET(req({ q: search }));
    expect(employeeSearchPattern(search)).toBe("%O'Neil~_~%~[~~%");
    expect(h.input).toHaveBeenCalledWith('pattern', 202, employeeSearchPattern(search));
    expect(h.query.mock.calls[0][0]).not.toContain(search);
  });
  it('caps results with an explicit truncation flag', async () => {
    h.query.mockResolvedValue({ recordset: Array.from({ length: 21 }, (_, n) => ({ employeeCode: String(n) })) });
    const result = await (await GET(req({ q: '00' }))).json();
    expect(result.employees).toHaveLength(20); expect(result.truncated).toBe(true);
  });
  it('reports a directory outage without leaking database details', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    h.query.mockRejectedValue(new Error('secret database connection details'));
    const response = await GET(req({ q: '00' }));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('secret');
    log.mockRestore();
  });
  it('batch-resolves assignment names without interpolating employee codes', async () => {
    h.query.mockResolvedValue({ recordset: [{ employeeCode: ' ab01 ', employeeName: 'ชื่อ ทดสอบ' }] });
    const result = await employeeNames(pool as never, ['AB01', 'AB01', '0007']);
    expect(result.get('AB01')).toBe('ชื่อ ทดสอบ');
    expect(h.input).toHaveBeenCalledTimes(2);
    expect(h.query.mock.calls[0][0]).toContain('IN (@emp0,@emp1)');
    expect(h.query.mock.calls[0][0]).not.toContain('AB01');
  });
});
