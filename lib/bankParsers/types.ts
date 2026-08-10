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

// แปลงวันที่จาก Excel: อาจมาเป็น string 'DD/MM/YYYY' หรือ Date object (เมื่อ cell format เป็น date จริง)
export function toISODate(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;

  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    const match = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); // DD/MM/YYYY
    if (match) {
      const [, d, m, y] = match;
      return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
    const parsed = new Date(trimmed);
    if (!isNaN(parsed.getTime())) return toISODate(parsed);
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