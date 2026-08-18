import { ReconcileSession } from '../app/reconcile/components/types';

// เก็บ session (ธนาคาร/ช่วงวันที่/ตัวเลือกที่กำลังกรอกอยู่) ของหน้า reconcile ไว้ใน localStorage
// เพื่อให้ผู้ใช้กลับมาทำงานต่อได้เมื่อสลับหน้า/รีเฟรช — เคลียร์เฉพาะตอน logout (เอง/auto)
// หรือกด "New reconciliation" เท่านั้น (ดู components/Sidebar.tsx, hooks/useInactivityLogout.ts,
// app/reconcile/components/ReconcileWorkspace.tsx)
const RECONCILE_SESSION_KEY = 'reconcileSession';

export function loadReconcileSession(): ReconcileSession | null {
  try {
    const raw = localStorage.getItem(RECONCILE_SESSION_KEY);
    return raw ? (JSON.parse(raw) as ReconcileSession) : null;
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
