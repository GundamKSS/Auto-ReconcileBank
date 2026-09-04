import {
  LayoutDashboard,
  Upload,
  GitCompareArrows,
  Database,
  WalletCards,
  BarChart3,
  History,
  type LucideIcon,
} from 'lucide-react';

import type { UserSession } from './trwApi';
import { RECONCILE_ROLES, VIEWER_ROLES, normalizeRole, type Role } from './roles';

// นิยาม Role/normalizeRole ย้ายไปอยู่ lib/roles.ts แล้ว เพราะฝั่ง server ต้องใช้ร่วมด้วย
// (ไฟล์นี้ import ไอคอนจาก lucide-react จึงลากเข้า route handler ไม่ได้)
// re-export ไว้เพื่อให้ที่เดิมที่ import จาก './menu' ยังใช้ได้เหมือนเดิม
export { ROLES, DEFAULT_ROLE, normalizeRole, type Role } from './roles';

export type MenuItem = {
  name: string;
  href: string;
  icon: LucideIcon;
  // role ที่เข้าเมนูนี้ได้ — ใช้ทั้งกรองเมนูใน Sidebar และกัน URL ตรงใน RouteGuard
  auth: readonly Role[];
  // path ที่ใช้ตอนเช็คสิทธิ์ ถ้าเมนูชี้ลึกกว่าโฟลเดอร์จริง (เช่น Master Data)
  guardPath?: string;
};

export const menuItems: MenuItem[] = [
  {
    name: 'Dashboard',
    href: '/dashboard',
    icon: LayoutDashboard,
    auth: VIEWER_ROLES,
  },
  {
    name: 'Import',
    href: '/import',
    icon: Upload,
    auth: RECONCILE_ROLES,
  },
  {
    name: 'Reconcile',
    href: '/reconcile',
    icon: GitCompareArrows,
    auth: RECONCILE_ROLES,
  },
  {
    name: 'Match History',
    href: '/reconcile/history',
    icon: History,
    auth: RECONCILE_ROLES,
  },
  {
    name: 'Suspense',
    href: '/suspense',
    icon: WalletCards,
    auth: RECONCILE_ROLES,
  },
  {
    name: 'Master Data',
    href: '/master-data/bank-statement',
    icon: Database,
    auth: RECONCILE_ROLES,
    guardPath: '/master-data',
  },
  {
    name: 'Reports',
    href: '/reports',
    icon: BarChart3,
    auth: VIEWER_ROLES,
  },
];

// อ่านสิทธิ์ปัจจุบันจาก localStorage คีย์ 'user' — ใช้ roleProg (สิทธิ์ในโปรแกรมนี้) ไม่ใช่ role ซึ่งเป็นตำแหน่งงาน
// คืน null ถ้ายังไม่ login หรือเรียกฝั่ง server
export function getCurrentRole(): Role | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem('user');
    if (!raw) return null;
    return normalizeRole((JSON.parse(raw) as UserSession).roleProg);
  } catch {
    return null;
  }
}

export function menuItemsFor(role: Role): MenuItem[] {
  return menuItems.filter((item) => item.auth.includes(role));
}

// หาเมนูที่คุม path นี้ — เลือกอันที่เจาะจงที่สุด เพราะ /reconcile/history ตรงกับ /reconcile ด้วย
export function findMenuItem(pathname: string): MenuItem | undefined {
  return menuItems
    .filter((item) => {
      const base = item.guardPath ?? item.href;
      return pathname === base || pathname.startsWith(`${base}/`);
    })
    .sort((a, b) => (b.guardPath ?? b.href).length - (a.guardPath ?? a.href).length)[0];
}

// path ที่ไม่มีเมนูคุมอยู่ (เช่น /login) ถือว่าเข้าได้ตามปกติ
export function canAccessPath(pathname: string, role: Role): boolean {
  const item = findMenuItem(pathname);
  return !item || item.auth.includes(role);
}

// ปลายทางสำรองตอนโดนเด้งออกจากหน้าที่ไม่มีสิทธิ์
export function firstAllowedPath(role: Role): string | null {
  return menuItemsFor(role)[0]?.href ?? null;
}
