import { firstAllowedPath, menuItems, normalizeRole } from './menu';

const PREFIX = 'autorecon:tab:v1:';
const LAST_PAGE = 'last-page';

// Workspace preferences are not an auth session. Keep them per tab AND per login
// identity; never use a display name, which can be shared by different users.
export function storedUsername(raw: string | null): string | null {
  try {
    const user = raw ? JSON.parse(raw) : null;
    return typeof user?.username === 'string' && user.username.trim()
      ? user.username.trim()
      : null;
  } catch {
    return null;
  }
}

export function currentWorkspaceUser(): string | null {
  try {
    return storedUsername(localStorage.getItem('user'));
  } catch {
    return null;
  }
}

export function tabStorageKey(key: string, username = currentWorkspaceUser()): string | null {
  const identity = username?.trim();
  return identity ? `${PREFIX}${encodeURIComponent(identity)}:${key}` : null;
}

export function readTabValue(key: string | null): unknown {
  try {
    const raw = key ? sessionStorage.getItem(key) : null;
    return raw === null ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export function writeTabValue(key: string | null, value: unknown): void {
  try {
    if (key) sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Disabled/full browser storage must not prevent normal app use.
  }
}

export function removeTabValue(key: string | null): void {
  try {
    if (key) sessionStorage.removeItem(key);
  } catch {
    // Storage is optional; the in-memory state can still be reset.
  }
}

export function rememberWorkspacePath(pathname: string, username?: string | null): void {
  // Only known app pages, never /login, APIs, or an arbitrary redirect URL.
  if (menuItems.some((item) => item.href === pathname)) {
    writeTabValue(tabStorageKey(LAST_PAGE, username), pathname);
  }
}

export function resumeWorkspacePath(user: { username: string; roleProg: string | null }): string {
  const role = normalizeRole(user.roleProg);
  const saved = readTabValue(tabStorageKey(LAST_PAGE, user.username));
  const page = menuItems.find((item) => item.href === saved && item.auth.includes(role));
  return page?.href ?? firstAllowedPath(role) ?? '/login';
}

// Do not migrate localStorage workspaces: doing so would restore a closed tab's
// filters (or another user's old filters). Only retire our two obsolete keys.
export function discardLegacyWorkspace(): void {
  try {
    localStorage.removeItem('reconcileSession');
    localStorage.removeItem('autorecon:dashboard:v1');
  } catch {
    // A storage failure does not affect the newly authenticated session.
  }
}

export const isNullableString = (value: unknown): value is string | null =>
  value === null || typeof value === 'string';

export function oneOf<T extends string>(...values: T[]) {
  return (value: unknown): value is T => typeof value === 'string' && values.includes(value as T);
}
