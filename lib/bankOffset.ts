import type { WorkDirection } from './workRoles';

// หักล้างกันเองฝั่ง Bank Statement (เช่น กรณีเช็คเด้ง หรือธนาคารปรับปรุงยอดตัดคืน)
// รายการเงินเข้าและเงินออกใน Statement ที่ยอดเงินเท่ากันพอดี ล้างกันเองจนสุทธิเป็น 0
// บันทึกลง ReconciliationMatch ด้วย MatchType = 'OFFSET' พร้อมระบุเหตุผล (บังคับ)
// และอัปเดต BankStatementLine.MatchStatus = 'OFFSET' ทั้งสองบรรทัด

export const BANK_OFFSET_MATCH_TYPE = 'OFFSET';
export const AMOUNT_TOLERANCE = 0.005;

export type BankOffsetCandidate = {
  lineId: number;
  bankCode: string;
  bankAccountNo: string | null;
  date: string;
  description: string | null;
  debit: number | null;
  credit: number | null;
  amount: number;
  direction: WorkDirection;
  chequeNo: string | null;
  channel: string | null;
  rawDescription: string | null;
  senderBank: string | null;
  senderAccountNo: string | null;
  senderAccountName: string | null;
  isPeriodClosed?: boolean;
  closedReason?: string | null;
  isOffset?: boolean;
  offsetMatchId?: number | null;
  offsetNum?: number | null;
  offsetRemark?: string | null;
  offsetBy?: string | null;
  offsetCounterpartRef?: string | null;
  offsetCounterpartDate?: string | null;
  offsetCounterpartDescription?: string | null;
};

export type BankOffsetValidationInput = {
  amount: number;
  direction: WorkDirection;
  bankAccountNo?: string | null;
  isOffset?: boolean;
  offsetRemark?: string | null;
};

/**
 * ตรวจสอบความถูกต้องของคู่หักล้างฝั่ง Bank Statement
 * - ต้องเป็นคนละทิศทาง (เงินเข้า 1 รายการ และ เงินออก 1 รายการ)
 * - ยอดเงินต้องเท่ากันพอดี (ต่างไม่เกินครึ่งสตางค์)
 * - บัญชีธนาคารเดียวกัน
 * - ต้องระบุเหตุผลในการหักล้างเสมอ
 */
export function validateBankOffsetPair(
  source: BankOffsetValidationInput,
  target: BankOffsetValidationInput,
  remark?: string | null
): { ok: true } | { ok: false; error: string } {
  if (source.isOffset || target.isOffset) {
    const offsetLine = source.isOffset ? source : target;
    return {
      ok: false,
      error: offsetLine.offsetRemark
        ? `รายการนี้ถูกหักล้างไปแล้ว (หมายเหตุ: ${offsetLine.offsetRemark})`
        : 'รายการนี้ถูกหักล้างไปแล้ว ไม่สามารถเลือกซ้ำได้',
    };
  }
  if (source.direction === target.direction) {
    return { ok: false, error: 'รายการที่นำมาหักล้างต้องอยู่คนละฝั่ง (เงินเข้ากับเงินออก)' };
  }
  if (Math.abs(source.amount - target.amount) >= AMOUNT_TOLERANCE) {
    return {
      ok: false,
      error: `ยอดเงินสองฝั่งไม่เท่ากัน (ฝั่งตนเอง ${source.amount.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท / อีกฝั่ง ${target.amount.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท)`,
    };
  }
  if (source.bankAccountNo && target.bankAccountNo && source.bankAccountNo !== target.bankAccountNo) {
    return { ok: false, error: 'รายการที่นำมาหักล้างต้องอยู่ในบัญชีธนาคารเดียวกัน' };
  }
  const cleanRemark = (remark ?? '').trim();
  if (!cleanRemark) {
    return { ok: false, error: 'กรุณาระบุเหตุผลในการหักล้างรายการ' };
  }
  return { ok: true };
}
