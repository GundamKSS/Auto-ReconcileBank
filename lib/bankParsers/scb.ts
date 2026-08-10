import { NormalizedStatementLine, ParseResult, toISODate, toNumber, findColumnIndex } from './types';

// SCB: หัวตารางอยู่แถวแรก คอลัมน์: Date, Time, Tr Description, Channel, Cheque No.,
// Withdrawal, Deposit, Outstanding Balance (เก็บเป็น string มี comma เช่น "-3,562,505.84")
export function parseSCB(rows: unknown[][]): ParseResult {
  const headerRow = rows[0];

  const idx = {
    date: findColumnIndex(headerRow, 'Date'),
    description: findColumnIndex(headerRow, 'Tr Description'),
    chequeNo: findColumnIndex(headerRow, 'Cheque No.'),
    withdrawal: findColumnIndex(headerRow, 'Withdrawal'),
    deposit: findColumnIndex(headerRow, 'Deposit'),
    balance: findColumnIndex(headerRow, 'Outstanding Balance'),
    channel: findColumnIndex(headerRow, 'Channel'),
    detail: findColumnIndex(headerRow, 'Description'), // คอลัมน์ detail แยกต่างหาก อยู่ท้ายตาราง
  };

  const required = ['date', 'description', 'withdrawal', 'deposit', 'balance'] as const;
  const missing = required.filter((k) => idx[k] === -1);
  if (missing.length > 0) {
    throw new Error(`ไม่พบคอลัมน์ในไฟล์ SCB: ${missing.join(', ')} — โครงสร้างไฟล์อาจเปลี่ยนไป`);
  }

  const lines: NormalizedStatementLine[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const tranDate = toISODate(row[idx.date]);
    if (!tranDate) continue;

    // SCB: withdrawal = เงินออก (debit), deposit = เงินเข้า (credit)
    lines.push({
      tranDate,
      description: String(row[idx.description] ?? '').trim(),
      debit: toNumber(row[idx.withdrawal]),
      credit: toNumber(row[idx.deposit]),
      balance: toNumber(row[idx.balance]),
      chequeNo: row[idx.chequeNo] ? String(row[idx.chequeNo]).trim() || null : null,
      channel: row[idx.channel] ? String(row[idx.channel]).trim() : null,
      rawDescription: idx.detail !== -1 ? String(row[idx.detail] ?? '').trim() : null,
    });
  }

  const dates = lines.map((l) => l.tranDate).sort();

  return {
    bankCode: 'SCB',
    lines,
    periodStart: dates[0] ?? null,
    periodEnd: dates[dates.length - 1] ?? null,
  };
}