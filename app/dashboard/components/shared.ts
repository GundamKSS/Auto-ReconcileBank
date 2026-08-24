/** ชนิดข้อมูลและตัวช่วยที่ใช้ร่วมกันทุก widget ของหน้า Dashboard */

export type StatusKey = 'MATCHED' | 'SUSPENSE' | 'UNMATCHED';
export type DateBasis = 'BANK' | 'GL';
export type Direction = 'IN' | 'OUT';

export type SummaryBucket = {
  status: StatusKey;
  bankCode: string;
  rows: number;
  matches: number;
  bankLines: number;
  glLines: number;
  bankIn: number;
  bankOut: number;
  bankNet: number;
  glIn: number;
  glOut: number;
  glNet: number;
  diff: number;
};

export type DashboardData = {
  month: string;
  from: string;
  to: string;
  asOf: string;
  basis: DateBasis;
  bankCode: string;
  trendMonths: number;
  summary: {
    total: number;
    buckets: SummaryBucket[];
    totals: Omit<SummaryBucket, 'status' | 'bankCode'>;
  };
  daily: { date: string | null; status: StatusKey; lines: number; bankIn: number; bankOut: number }[];
  aging: { status: StatusKey; bucket: number; rows: number; amount: number }[];
  outstanding: {
    rowKey: string;
    status: StatusKey;
    bankCode: string | null;
    date: string | null;
    amount: number;
    direction: Direction | null;
    side: 'BANK' | 'GL';
    label: string | null;
  }[];
  trend: { month: string | null; status: StatusKey; lines: number; bankNet: number; glNet: number; diff: number }[];
  bankCodes: string[];
};

/** id ของแต่ละส่วนบนหน้า — ใช้เป็นคีย์ทั้งใน "ปรับมุมมอง" และตอนจำค่าลง localStorage */
export type WidgetId = 'kpi' | 'trend' | 'daily' | 'status' | 'bank' | 'aging' | 'outstanding';

export const WIDGETS: { id: WidgetId; label: string; hint: string }[] = [
  { id: 'kpi', label: 'การ์ดสรุปหลัก', hint: 'ยอดรวม อัตรากระทบยอด ผลต่าง' },
  { id: 'trend', label: 'แนวโน้มย้อนหลัง', hint: 'เทียบอัตรากระทบยอดหลายเดือน' },
  { id: 'daily', label: 'ความเคลื่อนไหวรายวัน', hint: 'จำนวนบรรทัดแต่ละวันในเดือน' },
  { id: 'status', label: 'สัดส่วนสถานะ', hint: 'จับคู่แล้ว / พักไว้ / ยังไม่จับคู่' },
  { id: 'bank', label: 'แยกตามธนาคาร', hint: 'ยอดและผลต่างรายธนาคาร' },
  { id: 'aging', label: 'อายุรายการค้าง', hint: 'ค้างมานานแค่ไหนแล้ว' },
  { id: 'outstanding', label: 'รายการค้างยอดสูง', hint: '12 รายการแรกเรียงตามจำนวนเงิน' },
];

export const DEFAULT_WIDGETS: WidgetId[] = ['kpi', 'trend', 'daily', 'status', 'bank', 'aging', 'outstanding'];

export const STATUS_LABEL: Record<StatusKey, string> = {
  MATCHED: 'จับคู่แล้ว',
  SUSPENSE: 'พักไว้',
  UNMATCHED: 'ยังไม่จับคู่',
};

export const STATUS_COLOR: Record<StatusKey, string> = {
  MATCHED: '#20b486',
  SUSPENSE: '#f2a900',
  UNMATCHED: '#e84570',
};

export const STATUS_BADGE: Record<StatusKey, string> = {
  MATCHED: 'bg-emerald-100 text-emerald-700',
  SUSPENSE: 'bg-amber-100 text-amber-700',
  UNMATCHED: 'bg-rose-100 text-rose-600',
};

export const STATUS_ORDER: StatusKey[] = ['MATCHED', 'SUSPENSE', 'UNMATCHED'];

/** ช่วงอายุต้องเรียงตรงกับ AGING_CASE ใน /api/dashboard/summary */
export const AGING_LABELS = ['0–7 วัน', '8–30 วัน', '31–60 วัน', '61–90 วัน', 'เกิน 90 วัน'];

// ชื่อเรียกสวยๆ ของรหัสที่รู้จัก ส่วนรหัสอื่นที่โผล่มาจาก DB จะแสดงเป็นรหัสดิบ
export const BANK_LABEL: Record<string, string> = {
  BBL: 'BBL',
  KBANK: 'KBank',
  SCB: 'SCB',
  KTB: 'KTB',
  NOT_BANK: 'ไม่ใช่บัญชีธนาคาร',
};

export function bankLabel(code: string) {
  return BANK_LABEL[code] ?? code;
}

export function formatAmount(n: number | null | undefined) {
  if (n === null || n === undefined) return '-';
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** ย่อจำนวนเงินให้อ่านง่ายบนแกนกราฟ/การ์ด (1.2M, 45.0K) */
export function compactAmount(n: number) {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
}

export function formatCount(n: number) {
  return n.toLocaleString('en-US');
}

export function formatDay(iso: string | null) {
  if (!iso) return '-';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export function monthLabel(month: string) {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('th-TH', { month: 'long', year: 'numeric' });
}

export function shortMonthLabel(month: string) {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('th-TH', { month: 'short', year: '2-digit' });
}

export function shiftMonth(month: string, offset: number) {
  const [y, m] = month.split('-').map(Number);
  const next = new Date(y, m - 1 + offset, 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
}

export function currentMonth(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** ยอดรวมของ bucket หลายอัน — ใช้ตอนยุบ bucket ตามสถานะหรือตามธนาคาร */
export function sumBuckets(buckets: SummaryBucket[]) {
  const acc = buckets.reduce(
    (a, b) => ({
      rows: a.rows + b.rows,
      matches: a.matches + b.matches,
      bankLines: a.bankLines + b.bankLines,
      glLines: a.glLines + b.glLines,
      bankIn: a.bankIn + b.bankIn,
      bankOut: a.bankOut + b.bankOut,
      bankNet: a.bankNet + b.bankNet,
      glIn: a.glIn + b.glIn,
      glOut: a.glOut + b.glOut,
      glNet: a.glNet + b.glNet,
    }),
    { rows: 0, matches: 0, bankLines: 0, glLines: 0, bankIn: 0, bankOut: 0, bankNet: 0, glIn: 0, glOut: 0, glNet: 0 }
  );
  return { ...acc, lines: acc.bankLines + acc.glLines, diff: Number((acc.bankNet - acc.glNet).toFixed(2)) };
}

/** สัดส่วนบรรทัดที่จับคู่แล้วเทียบกับบรรทัดทั้งหมดในชุดข้อมูล (นับทั้งฝั่ง Bank และ GL) */
export function reconciliationRate(buckets: SummaryBucket[]) {
  const all = sumBuckets(buckets).lines;
  if (!all) return null;
  const matched = sumBuckets(buckets.filter((b) => b.status === 'MATCHED')).lines;
  return (matched / all) * 100;
}
