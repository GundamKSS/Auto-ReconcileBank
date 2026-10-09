import type { ReconcileSession } from '../app/reconcile/components/types';
import { readTabValue, removeTabValue, tabStorageKey, writeTabValue } from './tabWorkspace';

// จำเงื่อนไขกระทบยอดในแท็บและบัญชีผู้ใช้นี้ แม้ออกจากระบบเองหรือหมดเวลา
// ปิดแท็บแล้ว sessionStorage หมดอายุ โดยไม่เก็บสิทธิ์หรือ token ไว้ที่นี่
const RECONCILE_SESSION_KEY = 'reconcileSession';

export function loadReconcileSession(): ReconcileSession | null {
  try {
    const parsed = readTabValue(tabStorageKey(RECONCILE_SESSION_KEY)) as Partial<ReconcileSession> | undefined;
    if (!parsed || typeof parsed.bankCode !== 'string' || !parsed.bankCode ||
      typeof parsed.periodStart !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(parsed.periodStart) ||
      typeof parsed.periodEnd !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(parsed.periodEnd) ||
      parsed.periodStart > parsed.periodEnd || typeof parsed.includeSuspenseBuffer !== 'boolean' ||
      (parsed.bankAccountNo != null && typeof parsed.bankAccountNo !== 'string') ||
      (parsed.accountName != null && typeof parsed.accountName !== 'string') ||
      (parsed.importId != null && (!Number.isInteger(parsed.importId) || parsed.importId <= 0)) ||
      (parsed.fileName != null && typeof parsed.fileName !== 'string')) return null;
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

export function saveReconcileSession(session: ReconcileSession, username?: string | null) {
  writeTabValue(tabStorageKey(RECONCILE_SESSION_KEY, username), session);
}

export function clearReconcileSession() {
  removeTabValue(tabStorageKey(RECONCILE_SESSION_KEY));
}
