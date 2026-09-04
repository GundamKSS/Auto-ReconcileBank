export type BankCode = 'BBL' | 'KBANK' | 'SCB';

export type NormalizedStatementLine = {
  tranDate: string;       // 'YYYY-MM-DD'
  description: string;
  debit: number | null;   // เงินออก
  credit: number | null;  // เงินเข้า
  balance: number | null;
  chequeNo: string | null;
  channel: string | null;
  rawDescription: string | null;
};

export type ParseResult = {
  bankCode: BankCode;
  lines: NormalizedStatementLine[];
  periodStart: string | null;
  periodEnd: string | null;
};

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

// ประกอบเป็น 'YYYY-MM-DD' พร้อมตรวจว่าเป็นวันที่ที่มีอยู่จริง (กัน 31/02 หรือเดือน 13 หลุดเข้าไป)
// ปีพุทธศักราชถูกแปลงเป็น ค.ศ. ให้อัตโนมัติ — ไฟล์ statement ไทยบางฉบับส่งมาเป็น พ.ศ.
function buildISODate(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  const y = year >= 2400 ? year - 543 : year;
  if (y < 1900 || y > 2200) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  // ตรวจวันสิ้นเดือนจริง (รวมปีอธิกสุรทิน) ด้วยการสร้าง Date แบบ UTC แล้วเทียบกลับ
  const probe = new Date(Date.UTC(y, month - 1, day));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    return null;
  }
  return `${y}-${pad2(month)}-${pad2(day)}`;
}

/**
 * แปลงค่าวันที่จากไฟล์ statement เป็น 'YYYY-MM-DD'
 *
 * รองรับ 3 แบบที่เจอจริง:
 *   1. Date object      — มาจากไฟล์ .xlsx/.xls ที่เก็บวันที่เป็น serial (ไม่กำกวม)
 *   2. number           — Excel serial number ดิบ (เมื่ออ่านไฟล์แบบ raw)
 *   3. string           — 'DD/MM/YYYY' (รูปแบบมาตรฐานของ statement ธนาคารไทย),
 *                         'DD-MM-YYYY' และ ISO 'YYYY-MM-DD' / 'YYYY/MM/DD'
 *
 * สำคัญ: ห้ามใช้ `new Date(string)` เป็น fallback เด็ดขาด เพราะ JS ตีความ 'DD/MM/YYYY'
 * เป็นรูปแบบอเมริกัน 'MM/DD/YYYY' ทำให้วันที่ที่วันน้อยกว่าหรือเท่ากับ 12 ถูกสลับวัน/เดือน
 * โดยไม่มี error ให้เห็น (เคยทำให้ข้อมูลที่นำเข้าแล้วเสียหายมาก่อน — ดู lib/bankParsers/workbook.ts)
 * ค่าที่แกะไม่ได้ให้คืน null ไปเลย ดีกว่าได้วันที่ผิดแบบเงียบๆ
 */
export function toISODate(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return buildISODate(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }

  // Excel serial number — วันที่ 1 คือ 1900-01-01 โดยนับฐานที่ 1899-12-30
  // (เผื่อ Excel นับ 1900 เป็นปีอธิกสุรทินผิดพลาดตามประวัติศาสตร์ของ Lotus 1-2-3)
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value <= 0 || value > 100000) return null;
    const ms = Date.UTC(1899, 11, 30) + Math.round(value) * 86_400_000;
    const d = new Date(ms);
    return buildISODate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;

    // ISO ก่อน เพราะไม่กำกวม: YYYY-MM-DD หรือ YYYY/MM/DD
    const iso = trimmed.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s].*)?$/);
    if (iso) return buildISODate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

    // รูปแบบมาตรฐานของ statement ธนาคารไทย: DD/MM/YYYY หรือ DD-MM-YYYY
    const dmy = trimmed.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
    if (dmy) return buildISODate(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]));
  }

  return null;
}

// แปลงตัวเลขที่อาจมี comma คั่นหลักพัน หรือเป็น string เช่น "-3,562,505.84"
export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const cleaned = value.replace(/,/g, '').trim();
    if (cleaned === '') return null;
    const n = Number(cleaned);
    return isNaN(n) ? null : n;
  }
  return null;
}

// หา index ของคอลัมน์จากชื่อหัวตาราง (case-insensitive, ตัด \n และช่องว่างส่วนเกิน)
export function findColumnIndex(headerRow: unknown[], name: string): number {
  const normalize = (s: unknown) =>
    String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  const target = normalize(name);
  return headerRow.findIndex((cell) => normalize(cell) === target);
}
