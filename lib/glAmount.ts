/**
 * สูตรกลางสำหรับอ่านยอดเงินฝั่ง BC365 (BankAccountLedgerEntries)
 *
 * BC เก็บรายการกลับบัญชี (Source_Code = 'REVERSAL') เป็นยอด "ติดลบ" ในช่อง Debit หรือ Credit
 * เช่น กลับรายการรับเงิน 10,186.40 จะได้ Debit_Amount_LCY = -10,186.40
 *
 * สูตรเดิมที่ใช้กันหลายที่คือ `Debit > 0 ? Debit : Credit` ซึ่งพอ Debit ติดลบจะไปหยิบ Credit
 * ที่เป็น 0 มาแทน รายการเลยขึ้นเป็น 0 บาท ทำให้จับคู่ผ่านทั้งที่ยอดจริงไม่ตรง (เคสจริง: Match #268)
 *
 * ยอดสุทธิ = Debit - Credit ซึ่งตรงกับค่า Amount_LCY ที่ BC ส่งมาทุกแถว (ตรวจแล้วทั้งตาราง)
 * ทิศทางดูจากเครื่องหมาย ส่วนยอดที่แสดงใช้ค่าสัมบูรณ์
 */

type GlAmountRow = {
  Debit_Amount_LCY?: unknown;
  Credit_Amount_LCY?: unknown;
};

export type Direction = 'IN' | 'OUT';

/** ยอดสุทธิแบบมีเครื่องหมาย: บวก = เงินเข้า, ลบ = เงินออก */
export function glSignedAmount(row: GlAmountRow): number {
  return Number(row.Debit_Amount_LCY ?? 0) - Number(row.Credit_Amount_LCY ?? 0);
}

export function glDirection(row: GlAmountRow): Direction {
  return glSignedAmount(row) > 0 ? 'IN' : 'OUT';
}

/** ยอดสำหรับแสดงผล/จับคู่ (ไม่ติดลบ) */
export function glAmount(row: GlAmountRow): number {
  return Math.abs(glSignedAmount(row));
}

/** นิพจน์ SQL ของยอดสุทธิฝั่ง GL — ใส่ alias ของตารางได้ เช่น glSignedSql('e') */
export function glSignedSql(alias = ''): string {
  const p = alias ? `${alias}.` : '';
  return `(COALESCE(${p}Debit_Amount_LCY, 0) - COALESCE(${p}Credit_Amount_LCY, 0))`;
}

/** นิพจน์ SQL ของยอดสุทธิฝั่ง Bank Statement — บวก = เงินเข้า (Credit), ลบ = เงินออก (Debit) */
export function bankSignedSql(alias = ''): string {
  const p = alias ? `${alias}.` : '';
  return `(COALESCE(${p}Credit, 0) - COALESCE(${p}Debit, 0))`;
}
