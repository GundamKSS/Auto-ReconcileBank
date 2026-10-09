import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { useSessionState } from '../hooks/useSessionState';
import {
  currentWorkspaceUser, discardLegacyWorkspace, isNullableString, oneOf, readTabValue,
  rememberWorkspacePath, removeTabValue, resumeWorkspacePath, storedUsername, tabStorageKey, writeTabValue,
} from '../lib/tabWorkspace';
import { clearReconcileSession, loadReconcileSession, saveReconcileSession } from '../lib/reconcileSession';
import type { ReconcileSession } from '../app/reconcile/components/types';
import { MemoryStorage } from './helpers/memoryStorage';

const alice = { username: 'alice', roleProg: 'Admin' };
const bob = { username: 'bob', roleProg: 'Admin' };
const session: ReconcileSession = {
  bankCode: 'BBL', bankAccountNo: 'test-account', accountName: 'Test account',
  importId: 42, fileName: 'test.xlsx', periodStart: '2026-09-01', periodEnd: '2026-09-30',
  includeSuspenseBuffer: true,
};

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage());
  vi.stubGlobal('sessionStorage', new MemoryStorage());
  localStorage.setItem('user', JSON.stringify(alice));
});
afterEach(() => vi.unstubAllGlobals());

describe('tab workspace lifetime and identity', () => {
  it('restores the page and reconcile filters after reauthentication in the same tab', () => {
    saveReconcileSession(session);
    rememberWorkspacePath('/reconcile');
    localStorage.removeItem('user'); // logout removes auth, not workspace state
    localStorage.removeItem('lastActivity');
    expect(loadReconcileSession()).toBeNull();
    localStorage.setItem('user', JSON.stringify(alice));
    expect(resumeWorkspacePath(alice)).toBe('/reconcile');
    expect(loadReconcileSession()).toEqual(session);
    expect(localStorage.getItem('reconcileSession')).toBeNull();
  });

  it('keeps independent state in separate tabs and starts fresh after a tab is closed', () => {
    const firstTab = sessionStorage;
    saveReconcileSession(session);
    rememberWorkspacePath('/reports');
    vi.stubGlobal('sessionStorage', new MemoryStorage());
    expect(loadReconcileSession()).toBeNull();
    expect(resumeWorkspacePath(alice)).toBe('/dashboard');
    saveReconcileSession({ ...session, bankCode: 'SCB' });
    vi.stubGlobal('sessionStorage', firstTab);
    expect(loadReconcileSession()?.bankCode).toBe('BBL');
    expect(resumeWorkspacePath(alice)).toBe('/reports');
    vi.stubGlobal('sessionStorage', new MemoryStorage());
    expect(loadReconcileSession()).toBeNull();
  });

  it('does not expose the previous account’s filters, draft selections or page', () => {
    saveReconcileSession(session);
    rememberWorkspacePath('/reconcile');
    const oldDraftKey = tabStorageKey('reconcile-workspace-v1:test');
    writeTabValue(oldDraftKey, { selectedBank: ['example-id'] });
    localStorage.setItem('user', JSON.stringify(bob));
    expect(loadReconcileSession()).toBeNull();
    expect(resumeWorkspacePath(bob)).toBe('/dashboard');
    expect(readTabValue(tabStorageKey('reconcile-workspace-v1:test'))).toBeUndefined();
    writeTabValue(oldDraftKey, { selectedBank: [] }); // late effect belongs to Alice
    saveReconcileSession(session, alice.username); // a late modal response does too
    expect(readTabValue(tabStorageKey('reconcile-workspace-v1:test'))).toBeUndefined();
    expect(loadReconcileSession()).toBeNull();
    localStorage.setItem('user', JSON.stringify(alice));
    expect(loadReconcileSession()).toEqual(session);
  });

  it('uses username, not display name, and tolerates invalid authentication metadata', () => {
    expect(storedUsername(JSON.stringify({ username: ' Alice ', displayName: 'Same name' }))).toBe('Alice');
    expect(tabStorageKey('test', ' Alice ')).toBe(tabStorageKey('test', 'Alice'));
    expect(tabStorageKey('test', 'Alice')).not.toBe(tabStorageKey('test', 'alice'));
    for (const raw of [null, '{', 'null', '{}', '{"username":42}', '{"displayName":"alice"}']) {
      expect(storedUsername(raw)).toBeNull();
    }
  });

  it('retires legacy persistent filters without clearing authentication or unrelated preferences', () => {
    localStorage.setItem('reconcileSession', JSON.stringify(session));
    localStorage.setItem('autorecon:dashboard:v1', '{}');
    localStorage.setItem('sidebar-collapsed', '1');
    expect(loadReconcileSession()).toBeNull(); // never revive a closed tab from localStorage
    saveReconcileSession(session);
    discardLegacyWorkspace();
    expect(localStorage.getItem('reconcileSession')).toBeNull();
    expect(localStorage.getItem('autorecon:dashboard:v1')).toBeNull();
    expect(localStorage.getItem('sidebar-collapsed')).toBe('1');
    expect(currentWorkspaceUser()).toBe('alice');
    expect(loadReconcileSession()).toEqual(session);
  });

  it('resets only the explicitly cleared reconcile state', () => {
    saveReconcileSession(session);
    writeTabValue(tabStorageKey('reports:bankCode'), 'SCB');
    clearReconcileSession();
    expect(loadReconcileSession()).toBeNull();
    expect(readTabValue(tabStorageKey('reports:bankCode'))).toBe('SCB');
  });
});

describe('safe restoration', () => {
  it('never returns public, unknown or external destinations', () => {
    rememberWorkspacePath('/reports');
    for (const path of ['/login', '/', '/api/reconcile/match', '//example.com', 'javascript:alert(1)', '/missing']) {
      rememberWorkspacePath(path);
      expect(resumeWorkspacePath(alice)).toBe('/reports');
      writeTabValue(tabStorageKey('last-page'), path);
      expect(resumeWorkspacePath(alice)).toBe('/dashboard');
      rememberWorkspacePath('/reports');
    }
  });

  it('rechecks the current role before resuming a page', () => {
    rememberWorkspacePath('/reconcile');
    expect(resumeWorkspacePath({ ...alice, roleProg: 'User' })).toBe('/dashboard');
    rememberWorkspacePath('/reports');
    expect(resumeWorkspacePath({ ...alice, roleProg: 'User' })).toBe('/reports');
  });

  it('rejects corrupted and incomplete reconcile state', () => {
    for (const invalid of [null, [], {}, { bankCode: 'BBL' }, { ...session, periodStart: 'oops' },
      { ...session, periodEnd: '2026-08-01' }, { ...session, bankAccountNo: {} }]) {
      writeTabValue(tabStorageKey('reconcileSession'), invalid);
      expect(loadReconcileSession()).toBeNull();
    }
    sessionStorage.setItem(tabStorageKey('reconcileSession')!, '{');
    expect(loadReconcileSession()).toBeNull();
  });

  it('falls back safely when browser storage is blocked', () => {
    const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('full'); }, removeItem() { throw new Error('blocked'); } };
    vi.stubGlobal('sessionStorage', blocked);
    expect(loadReconcileSession()).toBeNull();
    expect(() => saveReconcileSession(session)).not.toThrow();
    expect(() => removeTabValue('test')).not.toThrow();
    expect(resumeWorkspacePath(alice)).toBe('/dashboard');
    vi.stubGlobal('localStorage', blocked);
    expect(currentWorkspaceUser()).toBeNull();
    expect(() => discardLegacyWorkspace()).not.toThrow();
  });
});

describe('filter initialization without replacing restored values', () => {
  function renderFilter<T>(key: string, initial: T | (() => T), valid?: (value: unknown) => value is T) {
    let restored: T | undefined;
    function Probe() { [restored] = useSessionState(key, initial, valid); return null; }
    renderToString(createElement(Probe));
    return restored;
  }

  it('restores string, empty, false, zero and nullable filters on first render', () => {
    for (const [key, saved, initial] of [['bank', 'SCB', 'ALL'], ['search', '', 'default'], ['dates', false, true], ['page', 0, 1]] as const) {
      writeTabValue(tabStorageKey(key), saved);
      expect(renderFilter<string | boolean | number>(key, initial)).toBe(saved);
    }
    writeTabValue(tabStorageKey('from'), '2026-09-01');
    expect(renderFilter<string | null>('from', null, isNullableString)).toBe('2026-09-01');
    writeTabValue(tabStorageKey('from'), null);
    expect(renderFilter<string | null>('from', '2026-10-01', isNullableString)).toBeNull();
  });

  it('validates enums and can initialize resolved periods lazily', () => {
    writeTabValue(tabStorageKey('side'), 'unknown');
    expect(renderFilter('side', 'ALL', oneOf('ALL', 'IN', 'OUT'))).toBe('ALL');
    expect(renderFilter('period', () => ({ from: '2026-09-01', to: '2026-09-30' })))
      .toEqual({ from: '2026-09-01', to: '2026-09-30' });
    sessionStorage.setItem(tabStorageKey('side')!, '{');
    expect(renderFilter('side', 'ALL')).toBe('ALL');
  });
});
