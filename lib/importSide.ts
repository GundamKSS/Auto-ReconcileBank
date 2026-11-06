import type { NormalizedStatementLine } from './bankParsers/types';
import { hasWorkRole, type WorkDirection, type WorkPermissions } from './workRoles';

// ฝั่งที่นำเข้าจาก statement — AP นำเข้าเงินออก, AR นำเข้าเงินเข้า, คนที่มีทั้งสองฝั่ง (หรือ MASTER) เลือกเองทุกครั้ง
// กันซ้ำระดับรายการ (lib/bankStatementOverlap.ts) ทำให้อีกฝั่งอัปไฟล์เดียวกันซ้ำได้โดยเข้าเฉพาะรายการของตัวเอง
export type ImportSide = WorkDirection | 'ALL';

export const IMPORT_SIDE_LABELS: Record<ImportSide, string> = {
  IN: 'เงินเข้า (AR)',
  OUT: 'เงินออก (AP)',
  ALL: 'ทั้งเงินเข้าและเงินออก',
};

// เงื่อนไขเดียวกับที่ทุกจุดใช้แยกทิศทางบรรทัด Bank (Credit มีค่า = เงินเข้า)
export function statementLineDirection(line: Pick<NormalizedStatementLine, 'credit'>): WorkDirection {
  return line.credit !== null ? 'IN' : 'OUT';
}

export function filterLinesBySide<T extends Pick<NormalizedStatementLine, 'credit'>>(lines: T[], side: ImportSide): T[] {
  return side === 'ALL' ? lines : lines.filter((l) => statementLineDirection(l) === side);
}

/** ฝั่งที่ผู้ใช้นำเข้าได้ — ว่าง = นำเข้าไม่ได้เลย (ไม่มี AP/AR) */
export function importableSides(permissions: WorkPermissions | undefined): ImportSide[] {
  // ยังไม่ได้ติดตั้งสิทธิ์ (sql/010) — นำเข้าทั้งไฟล์ตามเดิม
  if (!permissions?.ready) return ['ALL'];
  const ar = hasWorkRole(permissions, 'AR');
  const ap = hasWorkRole(permissions, 'AP');
  if (ar && ap) return ['OUT', 'IN', 'ALL'];
  if (ar) return ['IN'];
  if (ap) return ['OUT'];
  return [];
}

/**
 * ตัดสินว่าคำขอนำเข้านี้ใช้ฝั่งไหน — ใช้ทั้ง preview และ import ให้ผลตรงกัน
 * สิทธิ์ฝั่งเดียวไม่ต้องส่งมา (ใช้ฝั่งของตัวเอง) แต่ถ้าส่งฝั่งอื่นมาต้องปฏิเสธ ไม่ใช่เปลี่ยนให้เงียบๆ
 */
export function resolveImportSide(
  permissions: WorkPermissions | undefined,
  requested: unknown
): { side: ImportSide } | { error: string; status: number } {
  const allowed = importableSides(permissions);
  if (allowed.length === 0) {
    return { error: 'ต้องมีสิทธิ์ AP หรือ AR จึงจะนำเข้า statement ได้ กรุณาติดต่อผู้ดูแลระบบ', status: 403 };
  }
  const raw = typeof requested === 'string' ? requested.trim().toUpperCase() : '';
  if (!raw) {
    if (allowed.length === 1) return { side: allowed[0] };
    return { error: 'กรุณาเลือกฝั่งที่จะนำเข้า (เงินเข้า / เงินออก / ทั้งสองฝั่ง)', status: 400 };
  }
  if (raw !== 'IN' && raw !== 'OUT' && raw !== 'ALL') {
    return { error: 'ฝั่งที่นำเข้าต้องเป็น IN, OUT หรือ ALL', status: 400 };
  }
  if (!allowed.includes(raw)) {
    return { error: `ไม่มีสิทธิ์นำเข้า${IMPORT_SIDE_LABELS[raw]} — นำเข้าได้เฉพาะฝั่งที่ได้รับสิทธิ์`, status: 403 };
  }
  return { side: raw };
}
