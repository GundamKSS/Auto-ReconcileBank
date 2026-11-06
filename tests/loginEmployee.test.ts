import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const h = vi.hoisted(() => ({ perms: vi.fn() }));
vi.mock('../lib/workRolesDb', () => ({ readWorkPermissions: h.perms }));
import { POST } from '../app/api/login/route';
import { TRW_PROGRAM_CODE } from '../lib/trwApi';
import { SESSION_COOKIE, verifySessionToken } from '../lib/session';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('login binds trusted EMP code', () => {
  it('ignores employee codes sent by the browser and signs only the upstream identity', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      employee_no: '0007', display_name: 'Alice', programs: [{ program_code: TRW_PROGRAM_CODE, can_use: true, is_active: true, role_prog: 'Admin' }],
    }), { status: 200 })));
    const response = await POST(new NextRequest('http://localhost/api/login', { method: 'POST',
      body: JSON.stringify({ username: 'alice', password: 'test-only', employeeNo: 'ADMIN', employee_no: 'ADMIN' }) }));
    expect(response.status).toBe(200);
    const signed = response.cookies.get(SESSION_COOKIE)?.value;
    expect(verifySessionToken(signed)?.employeeNo).toBe('0007');
    expect((await response.json()).employeeNo).toBe('0007');
  });
  it.each([
    [['AP', 'AR', 'MASTER'], 'User', 'Admin'],
    [['AP'], 'User', 'Staff'],
    [[], 'User', 'User'],
    [[], 'Dev', 'Dev'],
    [[], 'Admin', 'Admin'],
  ])('returns the menu role adjusted by work roles %j (%s → %s)', async (roles, roleProg, expected) => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    h.perms.mockResolvedValue({ ready: true, employeeCode: '0007', roles });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      employee_no: '0007', display_name: 'Alice', programs: [{ program_code: TRW_PROGRAM_CODE, can_use: true, is_active: true, role_prog: roleProg }],
    }), { status: 200 })));
    const response = await POST(new NextRequest('http://localhost/api/login', { method: 'POST',
      body: JSON.stringify({ username: 'alice', password: 'test-only' }) }));
    const body = await response.json();
    expect(body.effectiveRole).toBe(expected);
    expect(body.roleProg).toBe(roleProg);
  });
  it('still logs in when the work-role lookup fails (server re-checks every request)', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    h.perms.mockRejectedValue(new Error('database unavailable'));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      employee_no: '0007', display_name: 'Alice', programs: [{ program_code: TRW_PROGRAM_CODE, can_use: true, is_active: true, role_prog: 'Admin' }],
    }), { status: 200 })));
    const response = await POST(new NextRequest('http://localhost/api/login', { method: 'POST',
      body: JSON.stringify({ username: 'alice', password: 'test-only' }) }));
    expect(response.status).toBe(200);
    expect((await response.json()).effectiveRole).toBeUndefined();
  });
});
