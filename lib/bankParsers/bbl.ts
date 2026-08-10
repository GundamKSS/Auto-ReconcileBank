import { NormalizedStatementLine, ParseResult, toISODate, toNumber, findColumnIndex } from './types';

// BBL: หัวตารางอยู่แถวแรกพอดี (row index 0)
// คอลัมน์: Tran Date, Value Date, Description, Tran Code, Cheque No., Debit, Credit, Balance, Channel, ...
export function parseBBL(rows: unknown[][]): ParseResult {
  const headerRow = rows[0];

  const idx = {
    tranDate: findColumnIndex(headerRow, 'Tran Date'),
    description: findColumnIndex(headerRow, 'Description'),
    chequeNo: findColumnIndex(headerRow, 'Cheque No.'),
    debit: findColumnIndex(headerRow, 'Debit'),
    credit: findColumnIndex(headerRow, 'Credit'),
    balance: findColumnIndex(headerRow, 'Balance'),
    channel: findColumnIndex(headerRow, 'Channel'),
  };

  const missing = Object.entries(idx).filter(([, v]) => v === -1);
  if (missing.length > 0) {
    throw new Error(
      `ไม่พบคอลัมน์ในไฟล์ BBL: ${missing.map(([k]) => k).join(', ')} — โครงสร้างไฟล์อาจเปลี่ยนไป`
    );
  }

  const lines: NormalizedStatementLine[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const tranDate = toISODate(row[idx.tranDate]);
    if (!tranDate) continue; // ข้ามแถวว่าง/แถวสรุปที่ไม่มีวันที่

    lines.push({
      tranDate,
      description: String(row[idx.description] ?? '').trim(),
      debit: toNumber(row[idx.debit]),
      credit: toNumber(row[idx.credit]),
      balance: toNumber(row[idx.balance]),
      chequeNo: row[idx.chequeNo] ? String(row[idx.chequeNo]).trim() : null,
      channel: row[idx.channel] ? String(row[idx.channel]).trim() : null,
      rawDescription: String(row[idx.description] ?? '').trim(),
    });
  }

  const dates = lines.map((l) => l.tranDate).sort();

  return {
    bankCode: 'BBL',
    lines,
    periodStart: dates[0] ?? null,
    periodEnd: dates[dates.length - 1] ?? null,
  };
}