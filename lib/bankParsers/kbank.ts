import { NormalizedStatementLine, ParseResult, toISODate, toNumber, findColumnIndex } from './types';

// KBank (ของจริง): หัวตารางอยู่แถวแรกพอดี เป็นภาษาไทย ไม่มี header info แทรกนำหน้าเหมือนที่เคยเข้าใจผิดไว้
// คอลัมน์: วันที่, เวลา/วันที่ ทำรายการ, รายการ, ถอนเงิน, ฝากเงิน, ยอดคงเหลือ, ช่องทาง, รายละเอียด
// แถวที่ 2 (index 1) มักเป็น "ยอดยกมา" (ยอดยกมาต้นงวด) ต้องข้าม ไม่ใช่ธุรกรรมจริง
//
// หาแถวหัวตารางแบบ dynamic (ไม่ fix ที่ index 0 เผื่อ export บางครั้งมีแถวว่างนำหน้า) โดยหาแถวที่มีคำว่า "วันที่" อยู่
function findHeaderRowIndex(rows: unknown[][]): number {
  const normalize = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cells = rows[i].map(normalize);
    if (cells.includes('วันที่') && cells.some((c) => c.includes('รายการ'))) {
      return i;
    }
  }
  return -1;
}

export function parseKBank(rows: unknown[][]): ParseResult {
  const headerRowIndex = findHeaderRowIndex(rows);
  if (headerRowIndex === -1) {
    throw new Error('ไม่พบหัวตารางในไฟล์ KBank — โครงสร้างไฟล์อาจเปลี่ยนไป');
  }
  const headerRow = rows[headerRowIndex];

  const idx = {
    date: findColumnIndex(headerRow, 'วันที่'),
    description: findColumnIndex(headerRow, 'รายการ'),
    withdrawal: findColumnIndex(headerRow, 'ถอนเงิน'),
    deposit: findColumnIndex(headerRow, 'ฝากเงิน'),
    balance: findColumnIndex(headerRow, 'ยอดคงเหลือ'),
    channel: findColumnIndex(headerRow, 'ช่องทาง'),
    details: findColumnIndex(headerRow, 'รายละเอียด'),
  };

  const required = ['date', 'description', 'withdrawal', 'deposit', 'balance'] as const;
  const missing = required.filter((k) => idx[k] === -1);
  if (missing.length > 0) {
    throw new Error(`ไม่พบคอลัมน์ในไฟล์ KBank: ${missing.join(', ')} — โครงสร้างไฟล์อาจเปลี่ยนไป`);
  }

  const lines: NormalizedStatementLine[] = [];

  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    const tranDate = toISODate(row[idx.date]);
    if (!tranDate) continue; // ข้ามแถวว่าง/แถวสรุปที่ไม่มีวันที่

    const description = String(row[idx.description] ?? '').trim();
    if (description === 'ยอดยกมา') continue; // ข้ามแถวยอดยกมาต้นงวด ไม่ใช่ธุรกรรมจริง

    lines.push({
      tranDate,
      description,
      debit: toNumber(row[idx.withdrawal]),
      credit: toNumber(row[idx.deposit]),
      balance: toNumber(row[idx.balance]),
      chequeNo: null,
      channel: idx.channel !== -1 && row[idx.channel] ? String(row[idx.channel]).trim() : null,
      rawDescription: idx.details !== -1 && row[idx.details] ? String(row[idx.details]).trim() : null,
    });
  }

  const dates = lines.map((l) => l.tranDate).sort();

  return {
    bankCode: 'KBANK',
    lines,
    periodStart: dates[0] ?? null,
    periodEnd: dates[dates.length - 1] ?? null,
  };
}