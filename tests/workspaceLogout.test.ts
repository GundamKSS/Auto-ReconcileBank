import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryStorage } from './helpers/memoryStorage';

// Run the hook's effect with fake time and a synthetic browser. No real login,
// server, cookies or accounting records are accessed by these tests.
const harness = vi.hoisted(() => ({
  pathname: '/reports',
  effects: [] as Array<() => void | (() => void)>,
  router: { replace: vi.fn() },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => harness.router,
  usePathname: () => harness.pathname,
}));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useEffect: (effect: () => void | (() => void)) => harness.effects.push(effect),
  useRef: <T>(current: T) => ({ current }),
}));

import { useInactivityLogout } from '../hooks/useInactivityLogout';
import { useApiSessionGuard } from '../hooks/useApiSessionGuard';
import { readTabValue, rememberWorkspacePath, resumeWorkspacePath, tabStorageKey, writeTabValue } from '../lib/tabWorkspace';

const user = { username: 'alice', roleProg: 'Admin' };
const MINUTE = 60_000;
let cleanups: Array<() => void> = [];
let fetchMock: ReturnType<typeof vi.fn>;
let filterKey: string | null;

function mount(effectHook: () => void) {
  harness.effects = [];
  effectHook();
  for (const effect of harness.effects) {
    const cleanup = effect();
    if (cleanup) cleanups.push(cleanup);
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-09T10:00:00+07:00'));
  vi.stubGlobal('localStorage', new MemoryStorage());
  vi.stubGlobal('sessionStorage', new MemoryStorage());
  localStorage.setItem('user', JSON.stringify(user));
  localStorage.setItem('lastActivity', String(Date.now()));
  fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
  vi.stubGlobal('window', Object.assign(new EventTarget(), { fetch: fetchMock }));
  vi.stubGlobal('fetch', fetchMock);
  harness.pathname = '/reports';
  harness.router.replace.mockReset();
  filterKey = tabStorageKey('reports:bankCode');
  writeTabValue(filterKey, 'SCB');
  rememberWorkspacePath('/reports');
});

afterEach(() => {
  cleanups.forEach((cleanup) => cleanup());
  cleanups = [];
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('30-minute auto logout keeps work but ends authentication', () => {
  it('expires auth at 30 minutes and restores filters only after login', async () => {
    mount(useInactivityLogout);
    await vi.advanceTimersByTimeAsync(29 * MINUTE);
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/logout', { method: 'POST' });
    expect(localStorage.getItem('user')).toBeNull();
    expect(localStorage.getItem('lastActivity')).toBeNull();
    expect(harness.router.replace).toHaveBeenCalledWith('/login');
    expect(readTabValue(filterKey)).toBe('SCB');
    expect(tabStorageKey('reports:bankCode')).toBeNull();
    localStorage.setItem('user', JSON.stringify(user));
    expect(resumeWorkspacePath(user)).toBe('/reports');
    expect(readTabValue(tabStorageKey('reports:bankCode'))).toBe('SCB');
  });

  it('resets the inactivity clock while working but does not revive it after logout', async () => {
    mount(useInactivityLogout);
    await vi.advanceTimersByTimeAsync(29 * MINUTE);
    window.dispatchEvent(new Event('keydown'));
    await vi.advanceTimersByTimeAsync(29 * MINUTE);
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(MINUTE);
    window.dispatchEvent(new Event('mousemove'));
    await vi.advanceTimersByTimeAsync(31 * MINUTE);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('lastActivity')).toBeNull();
  });

  it('does not start an inactivity timer on the login page', async () => {
    harness.pathname = '/login';
    localStorage.removeItem('user');
    localStorage.removeItem('lastActivity');
    mount(useInactivityLogout);
    window.dispatchEvent(new Event('keydown'));
    await vi.advanceTimersByTimeAsync(60 * MINUTE);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(localStorage.getItem('lastActivity')).toBeNull();
    expect(readTabValue(filterKey)).toBe('SCB');
  });

  it('expires an already idle session immediately without deleting work', () => {
    localStorage.setItem('lastActivity', String(Date.now() - 31 * MINUTE));
    mount(useInactivityLogout);
    expect(harness.router.replace).toHaveBeenCalledWith('/login');
    expect(readTabValue(filterKey)).toBe('SCB');
  });
});

describe('server-session expiry', () => {
  it('preserves the tab workspace when a protected API returns 401', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 401 }));
    mount(useApiSessionGuard);
    const response = await window.fetch('/api/reports/reconciliation');
    expect(response.status).toBe(401);
    expect(harness.router.replace).toHaveBeenCalledWith('/login');
    expect(localStorage.getItem('user')).toBeNull();
    expect(readTabValue(filterKey)).toBe('SCB');
    expect(resumeWorkspacePath(user)).toBe('/reports');
  });

  it('does not clear auth or filters for a failed login or a normal API error', async () => {
    mount(useApiSessionGuard);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));
    await window.fetch('/api/login');
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));
    await window.fetch('/api/reports/reconciliation');
    expect(harness.router.replace).not.toHaveBeenCalled();
    expect(localStorage.getItem('user')).toBe(JSON.stringify(user));
    expect(readTabValue(filterKey)).toBe('SCB');
  });
});
