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

// สิทธิ์ทั้งหมดที่ระบบรู้จัก — ค่า role ที่ /auth/login ส่งมาจะถูก map เข้าชุดนี้
export const ROLES = ['Admin', 'User', 'Dev'] as const;
export type Role = (typeof ROLES)[number];

// ใช้เมื่อ session ไม่มี role หรือส่งค่าที่ไม่รู้จักมา — ให้สิทธิ์ต่ำสุดไว้ก่อน
export const DEFAULT_ROLE: Role = 'User';

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
    auth: ['Admin', 'User', 'Dev'],
  },
  {
    name: 'Import',
    href: '/import',
    icon: Upload,
    auth: ['Admin', 'Dev'],
  },
  {
    name: 'Reconcile',
    href: '/reconcile',
    icon: GitCompareArrows,
    auth: ['Admin', 'User', 'Dev'],
  },
  {
    name: 'Match History',
    href: '/reconcile/history',
    icon: History,
    auth: ['Admin', 'User', 'Dev'],
  },
  {
    name: 'Suspense',
    href: '/suspense',
    icon: WalletCards,
    auth: ['Admin', 'User', 'Dev'],
  },
  {
    name: 'Master Data',
    href: '/master-data/bank-statement',
    icon: Database,
    auth: ['Admin', 'Dev'],
    guardPath: '/master-data',
  },
  {
    name: 'Reports',
    href: '/reports',
    icon: BarChart3,
    auth: ['Admin', 'User', 'Dev'],
  },
];

// role จาก API เป็น string อิสระ — เทียบแบบไม่สนตัวพิมพ์ ถ้าไม่ตรงชุดที่รู้จักถือเป็น DEFAULT_ROLE
export function normalizeRole(raw: string | null | undefined): Role {
  const key = (raw ?? '').trim().toLowerCase();
  return ROLES.find((r) => r.toLowerCase() === key) ?? DEFAULT_ROLE;
}

// อ่าน role ปัจจุบันจาก localStorage คีย์ 'user' — คืน null ถ้ายังไม่ login หรือเรียกฝั่ง server
export function getCurrentRole(): Role | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem('user');
    if (!raw) return null;
    return normalizeRole((JSON.parse(raw) as UserSession).role);
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
