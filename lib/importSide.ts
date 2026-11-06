import type { NormalizedStatementLine } from './bankParsers/types';
import { hasWorkRole, type WorkDirection, type WorkPermissions } from './workRoles';

// ฝั่งที่นำเข้าจาก statement
// นำเข้าทั้งไฟล์ (ทั้งเงินเข้าและเงินออก) โดยกันซ้ำระดับรายการ (lib/bankStatementOverlap.ts)
// ป้องกันการตกหล่นของอีกฝั่ง และรองรับกรณีหักล้างกันเอง (เช่น เช็คเด้ง)
export type ImportSide = WorkDirection | 'ALL';

export const IMPORT_SIDE_LABELS: Record<ImportSide, string> = {
  IN: 'เงินเข้า (AR)',
  OUT: 'เงินออก (AP)',
  ALL: 'ทั้งเงินเข้าและเงินออก (ทั้งไฟล์)',
};

// เงื่อนไขเดียวกับที่ทุกจุดใช้แยกทิศทางบรรทัด Bank (Credit มีค่า = เงินเข้า)
export function statementLineDirection(line: Pick<NormalizedStatementLine, 'credit'>): WorkDirection {
  return line.credit !== null ? 'IN' : 'OUT';
}

export function filterLinesBySide<T extends Pick<NormalizedStatementLine, 'credit'>>(lines: T[], side: ImportSide): T[] {
  return side === 'ALL' ? lines : lines.filter((l) => statementLineDirection(l) === side);
}

/**
 * ฝั่งที่ผู้ใช้นำเข้าได้ — ผู้มีสิทธิ์ AP หรือ AR หรือ MASTER นำเข้าทั้งไฟล์ (ALL)
 * ว่าง = นำเข้าไม่ได้เลย (ไม่มีทั้ง AP และ AR)
 */
export function importableSides(permissions: WorkPermissions | undefined): ImportSide[] {
  // ยังไม่ได้ติดตั้งสิทธิ์ (sql/010) — นำเข้าทั้งไฟล์ตามเดิม
  if (!permissions?.ready) return ['ALL'];
  const ar = hasWorkRole(permissions, 'AR');
  const ap = hasWorkRole(permissions, 'AP');
  const master = hasWorkRole(permissions, 'MASTER');
  if (ar || ap || master) return ['ALL'];
  return [];
}

/**
 * ตัดสินว่าคำขอนำเข้านี้ใช้ฝั่งไหน — นำเข้าทั้งไฟล์ (ALL) สำหรับผู้มีสิทธิ์
 */
export function resolveImportSide(
  permissions: WorkPermissions | undefined,
  _requested?: unknown
): { side: ImportSide } | { error: string; status: number } {
  void _requested;
  const allowed = importableSides(permissions);
  if (allowed.length === 0) {
    return { error: 'ต้องมีสิทธิ์ AP หรือ AR จึงจะนำเข้า statement ได้ กรุณาติดต่อผู้ดูแลระบบ', status: 403 };
  }
  return { side: 'ALL' };
}
