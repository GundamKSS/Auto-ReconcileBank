import { ReconcileSession } from '../app/reconcile/components/types';

// เก็บ session (ธนาคาร/ช่วงวันที่/ตัวเลือกที่กำลังกรอกอยู่) ของหน้า reconcile ไว้ใน localStorage
// เพื่อให้ผู้ใช้กลับมาทำงานต่อได้เมื่อสลับหน้า/รีเฟรช — เคลียร์เฉพาะตอน logout (เอง/auto)
// หรือกด "New reconciliation" เท่านั้น (ดู components/Sidebar.tsx, hooks/useInactivityLogout.ts,
// app/reconcile/components/ReconcileWorkspace.tsx)
const RECONCILE_SESSION_KEY = 'reconcileSession';

export function loadReconcileSession(): ReconcileSession | null {
  try {
    const raw = localStorage.getItem(RECONCILE_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ReconcileSession>;
    if (!parsed.bankCode) return null;
    // session ที่บันทึกไว้ก่อนระบบแยกตามบัญชีไม่มี 2 ฟิลด์นี้ — เติมเป็น null ให้ชัดเจน
    // ไม่ปล่อยเป็น undefined เพราะโค้ดที่อ่านต่อจะแยกไม่ออกว่า "ไม่มีบัญชี" กับ "ฟิลด์หาย"
    return {
      ...(parsed as ReconcileSession),
      bankAccountNo: parsed.bankAccountNo ?? null,
      accountName: parsed.accountName ?? null,
    };
  } catch {
    return null;
  }
}

export function saveReconcileSession(session: ReconcileSession) {
  localStorage.setItem(RECONCILE_SESSION_KEY, JSON.stringify(session));
}

export function clearReconcileSession() {
  localStorage.removeItem(RECONCILE_SESSION_KEY);
}
