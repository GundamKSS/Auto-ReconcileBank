import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ token: '' as string | undefined, perms: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => (h.token ? { value: h.token } : undefined) }) }));
vi.mock('../lib/workRolesDb', () => ({ readWorkPermissions: h.perms }));
import { createSessionToken, requireRole } from '../lib/session';
import { ADMIN_ROLES, RECONCILE_ROLES, VIEWER_ROLES } from '../lib/roles';

const login = (roleProg: string) => { h.token = createSessionToken({ username: 'alice', displayName: 'Alice', roleProg, employeeNo: '0012' }); };
const roles = (...list: string[]) => h.perms.mockResolvedValue({ ready: true, employeeCode: '0012', roles: list });
beforeEach(() => { vi.clearAllMocks(); process.env.SESSION_SECRET = 'test-secret-at-least-16'; roles(); });

describe('requireRole: Dev/Admin from the central system, User from in-program roles', () => {
  it.each(['Dev', 'Admin'])('central %s reaches everything without reading in-program roles', async (role) => {
    login(role);
    for (const allowed of [RECONCILE_ROLES, ADMIN_ROLES, VIEWER_ROLES]) expect((await requireRole(allowed)).ok).toBe(true);
    expect(h.perms).not.toHaveBeenCalled();
  });
  it('a central User with AP/AR becomes Staff: reconcile yes, role management no', async () => {
    login('User'); roles('AP');
    const auth = await requireRole(RECONCILE_ROLES);
    expect(auth.ok).toBe(true);
    if (auth.ok) expect(auth.session.role).toBe('Staff');
    expect((await requireRole(ADMIN_ROLES)).ok).toBe(false);
  });
  it('a central User with MASTER acts as Admin, including role management', async () => {
    login('User'); roles('AP', 'AR', 'MASTER');
    const auth = await requireRole(ADMIN_ROLES);
    expect(auth.ok).toBe(true);
    if (auth.ok) expect(auth.session.role).toBe('Admin');
  });
  it('a central User without in-program roles is a Viewer (dashboard/reports/export only)', async () => {
    login('User');
    expect((await requireRole(RECONCILE_ROLES)).ok).toBe(false);
    expect((await requireRole(VIEWER_ROLES)).ok).toBe(true);
  });
  it('a failed role lookup does not let a User through', async () => {
    login('User'); h.perms.mockRejectedValue(new Error('database unavailable'));
    await expect(requireRole(RECONCILE_ROLES)).rejects.toThrow('database unavailable');
  });
});
