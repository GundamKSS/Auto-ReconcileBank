import {
  LayoutDashboard,
  Upload,
  GitCompareArrows,
  Database,
  WalletCards,
  BarChart3,
  History,
  ShieldCheck,
  BookOpen,
  type LucideIcon,
} from 'lucide-react';

import type { UserSession } from './trwApi';
import { ADMIN_ROLES, RECONCILE_ROLES, VIEWER_ROLES, storedAppRole, type AppRole } from './roles';


// นิยาม Role/normalizeRole ย้ายไปอยู่ lib/roles.ts แล้ว เพราะฝั่ง server ต้องใช้ร่วมด้วย
// (ไฟล์นี้ import ไอคอนจาก lucide-react จึงลากเข้า route handler ไม่ได้)
// re-export ไว้เพื่อให้ที่เดิมที่ import จาก './menu' ยังใช้ได้เหมือนเดิม
export { ROLES, APP_ROLES, DEFAULT_ROLE, normalizeRole, type Role, type AppRole } from './roles';

export type MenuItem = {
  name: string;
  href: string;
  icon: LucideIcon;
  // role ที่เข้าเมนูนี้ได้ — ใช้ทั้งกรองเมนูใน Sidebar และกัน URL ตรงใน RouteGuard
  auth: readonly AppRole[];
  // path ที่ใช้ตอนเช็คสิทธิ์ ถ้าเมนูชี้ลึกกว่าโฟลเดอร์จริง (เช่น Master Data)
  guardPath?: string;
};

export const menuItems: MenuItem[] = [
  {
    name: 'ภาพรวม',
    href: '/dashboard',
    icon: LayoutDashboard,
    auth: VIEWER_ROLES,
  },
  {
    name: 'นำเข้าข้อมูล',
    href: '/import',
    icon: Upload,
    auth: RECONCILE_ROLES,
  },
  {
    name: 'กระทบยอด',
    href: '/reconcile',
    icon: GitCompareArrows,
    auth: RECONCILE_ROLES,
  },
  {
    name: 'ประวัติการจับคู่',
    href: '/reconcile/history',
    icon: History,
    auth: RECONCILE_ROLES,
  },
  {
    name: 'รายการพัก',
    href: '/suspense',
    icon: WalletCards,
    auth: RECONCILE_ROLES,
  },
  {
    name: 'จัดการข้อมูล',
    href: '/master-data/bank-statement',
    icon: Database,
    auth: RECONCILE_ROLES,
    guardPath: '/master-data',
  },
  {
    name: 'สิทธิ์ยืนยันงาน',
    href: '/master-data/work-roles',
    icon: ShieldCheck,
    auth: ADMIN_ROLES,
  },
  {
    name: 'รายงาน',
    href: '/reports',
    icon: BarChart3,
    auth: VIEWER_ROLES,
  },
  {
    name: 'คู่มือ',
    href: '/manual',
    icon: BookOpen,
    auth: VIEWER_ROLES,
  },
];

// อ่านสิทธิ์ปัจจุบันจาก localStorage คีย์ 'user' — ใช้ roleProg (สิทธิ์ในโปรแกรมนี้) ไม่ใช่ role ซึ่งเป็นตำแหน่งงาน
// คืน null ถ้ายังไม่ login หรือเรียกฝั่ง server
export function getCurrentRole(): AppRole | null {
  if (typeof window === 'undefined') return null;
  try {
    return roleFromStoredUser(localStorage.getItem('user'));
  } catch {
    return null;
  }
}

// แปลงค่าดิบของคีย์ 'user' ใน localStorage เป็นสิทธิ์ — แยกออกมาให้ RouteGuard คำนวณระหว่าง render ได้
export function roleFromStoredUser(raw: string | null): AppRole | null {
  if (!raw) return null;
  try {
    return storedAppRole(JSON.parse(raw) as UserSession);
  } catch {
    return null;
  }
}

export function menuItemsFor(role: AppRole): MenuItem[] {
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
export function canAccessPath(pathname: string, role: AppRole): boolean {
  const item = findMenuItem(pathname);
  return !item || item.auth.includes(role);
}

// ปลายทางสำรองตอนโดนเด้งออกจากหน้าที่ไม่มีสิทธิ์
export function firstAllowedPath(role: AppRole): string | null {
  return menuItemsFor(role)[0]?.href ?? null;
}
