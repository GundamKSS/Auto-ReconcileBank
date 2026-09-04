// สิทธิ์ทั้งหมดที่ระบบรู้จัก — ค่า role_prog ของโปรแกรมนี้ที่ /auth/auth_permission_prog ส่งมาจะถูก map เข้าชุดนี้
//
// แยกออกมาจาก lib/menu.ts เพราะฝั่ง server (route handlers / lib/session.ts) ต้องใช้ด้วย
// แต่ menu.ts import ไอคอนจาก lucide-react ซึ่งเป็นของฝั่ง client ล้วนๆ
export const ROLES = ['Admin', 'User', 'Dev'] as const;
export type Role = (typeof ROLES)[number];

// ใช้เมื่อ session ไม่มี role หรือส่งค่าที่ไม่รู้จักมา — ให้สิทธิ์ต่ำสุดไว้ก่อน
export const DEFAULT_ROLE: Role = 'User';

// role จาก API เป็น string อิสระ — เทียบแบบไม่สนตัวพิมพ์ ถ้าไม่ตรงชุดที่รู้จักถือเป็น DEFAULT_ROLE
export function normalizeRole(raw: string | null | undefined): Role {
  const key = (raw ?? '').trim().toLowerCase();
  return ROLES.find((r) => r.toLowerCase() === key) ?? DEFAULT_ROLE;
}

// สิทธิ์ที่ทำงานกับข้อมูลกระทบยอดได้ (จับคู่ นำเข้า แก้ master data) — ใช้ทั้งคุมเมนูและคุม API
export const RECONCILE_ROLES: readonly Role[] = ['Admin', 'Dev'];

// สิทธิ์ที่ดูรายงาน/แดชบอร์ดได้ = ทุก role ที่ล็อกอินผ่าน
export const VIEWER_ROLES: readonly Role[] = ['Admin', 'User', 'Dev'];
