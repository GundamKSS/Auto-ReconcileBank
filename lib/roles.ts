// สิทธิ์ทั้งหมดที่ระบบรู้จัก — ค่า role_prog ของโปรแกรมนี้ที่ /auth/auth_permission_prog ส่งมาจะถูก map เข้าชุดนี้
//
// แยกออกมาจาก lib/menu.ts เพราะฝั่ง server (route handlers / lib/session.ts) ต้องใช้ด้วย
// แต่ menu.ts import ไอคอนจาก lucide-react ซึ่งเป็นของฝั่ง client ล้วนๆ
export const ROLES = ['Admin', 'User', 'Dev'] as const;
export type Role = (typeof ROLES)[number];

// role ที่โปรแกรมใช้คุมเมนูและ API จริง = role ระบบกลาง + Staff
// Dev = สูงสุด ทำได้ทุกอย่าง, Admin = Master Admin (ทั้งสองเช็คจากระบบกลางอย่างเดียว)
// User ระบบกลางต้องดูสิทธิ์ในโปรแกรมต่อ (lib/workRoles.ts: effectiveAppRole) —
//   MASTER → Admin, AP/AR → Staff (ทำงานกระทบยอดฝั่งของตัวเอง), ไม่มี → User (Viewer: ภาพรวม/รายงาน)
// Staff ไม่เคยมาจากระบบกลาง: normalizeRole ไม่รู้จักค่านี้ ระบบกลางส่ง "Staff" มาก็กลายเป็น User
export const APP_ROLES = [...ROLES, 'Staff'] as const;
export type AppRole = (typeof APP_ROLES)[number];

// ใช้เมื่อ session ไม่มี role หรือส่งค่าที่ไม่รู้จักมา — ให้สิทธิ์ต่ำสุดไว้ก่อน
export const DEFAULT_ROLE: Role = 'User';

// role จาก API เป็น string อิสระ — เทียบแบบไม่สนตัวพิมพ์ ถ้าไม่ตรงชุดที่รู้จักถือเป็น DEFAULT_ROLE
export function normalizeRole(raw: string | null | undefined): Role {
  const key = (raw ?? '').trim().toLowerCase();
  return ROLES.find((r) => r.toLowerCase() === key) ?? DEFAULT_ROLE;
}

// สิทธิ์ที่คุมเมนูฝั่ง client — effectiveRole คือ role ที่ login คำนวณจากระบบกลาง + สิทธิ์ในโปรแกรมแล้ว
// (server คิดใหม่ทุก request อยู่แล้ว ค่านี้มีไว้ให้เมนูตรงกับที่ server ยอม) session เก่าไม่มีคีย์นี้ ใช้ roleProg แทน
export function storedAppRole(user: { roleProg: string | null; effectiveRole?: string | null }): AppRole {
  const key = (user.effectiveRole ?? '').trim().toLowerCase();
  return APP_ROLES.find((r) => r.toLowerCase() === key) ?? normalizeRole(user.roleProg);
}

// สิทธิ์ที่ทำงานกับข้อมูลกระทบยอดได้ (จับคู่ นำเข้า แก้ master data) — ใช้ทั้งคุมเมนูและคุม API
// ฝั่งที่ทำได้ (AP/AR) ตรวจแยกอีกชั้นใน lib/workRolesDb.ts
export const RECONCILE_ROLES: readonly AppRole[] = ['Admin', 'Dev', 'Staff'];

// สิทธิ์ที่จัดการสิทธิ์ในโปรแกรม (AP/AR/MASTER) ของพนักงานได้ — Dev, Admin และ User ที่ได้ MASTER
export const ADMIN_ROLES: readonly AppRole[] = ['Admin', 'Dev'];

// สิทธิ์ที่ดูรายงาน/แดชบอร์ดได้ = ทุก role ที่ล็อกอินผ่าน
export const VIEWER_ROLES: readonly AppRole[] = APP_ROLES;
