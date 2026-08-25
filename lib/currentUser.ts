import type { UserSession } from './trwApi';

// อ่านชื่อผู้ใช้ปัจจุบันจาก localStorage (เก็บไว้ตอน login โดย Sidebar/AuthGuard)
// ใช้ประกอบ audit trail — CreatedBy ตอนจับคู่/พักไว้ และ ReversedBy ตอนยกเลิกการจับคู่
// คืนค่า null เสมอถ้าเรียกฝั่ง server หรือไม่มี session (กัน error ตอน SSR)
export function getCurrentUsername(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem('user');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as UserSession;
    return parsed.displayName || parsed.username || null;
  } catch {
    return null;
  }
}
