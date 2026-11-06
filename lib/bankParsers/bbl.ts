import { NormalizedStatementLine, ParseResult, toISODate, toNumber, findColumnIndex } from './types';
import { extractSenderFromText } from './senderExtractor';

// BBL: หัวตารางอยู่แถวแรกพอดี (row index 0)
// คอลัมน์หลัก: Tran Date, Value Date, Description, Tran Code, Cheque No., Debit, Credit, Balance, Channel
// คอลัมน์เสริมท้ายตาราง (มีในไฟล์จริง): Sender Bank, Sender Branch, Sender Account Number, Sender Account Name, Remarks
function cleanText(value: unknown): string | null {
  const s = String(value ?? '').replace(/\s+/g, ' ').trim();
  return s || null;
}

// BBL ใส่ '000' ใน Sender Bank และ '0000000000' ใน Sender Account Number สำหรับรายการรับชำระ (PAYMENT ON GOODS)
// ซึ่งไม่ใช่เลขบัญชีจริง — ถ้าเก็บไว้จะทำให้ลูกค้าคนละรายมีเลขบัญชีผู้โอนเป็น '0000000000' ซ้ำกันหมด
function cleanCodeOrAccount(value: unknown): string | null {
  const s = cleanText(value);
  if (!s || /^[0-]+$/.test(s)) return null;
  return s;
}

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
    senderBank: findColumnIndex(headerRow, 'Sender Bank'),
    senderAccountNo: findColumnIndex(headerRow, 'Sender Account Number'),
    senderAccountName: findColumnIndex(headerRow, 'Sender Account Name'),
    remarks: findColumnIndex(headerRow, 'Remarks'),
  };

  const required = ['tranDate', 'description', 'chequeNo', 'debit', 'credit', 'balance', 'channel'] as const;
  const missing = required.filter((k) => idx[k] === -1);
  if (missing.length > 0) {
    throw new Error(
      `ไม่พบคอลัมน์ในไฟล์ BBL: ${missing.join(', ')} — โครงสร้างไฟล์อาจเปลี่ยนไป`
    );
  }

  const lines: NormalizedStatementLine[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const tranDate = toISODate(row[idx.tranDate]);
    if (!tranDate) continue; // ข้ามแถวว่าง/แถวสรุปที่ไม่มีวันที่

    const description = String(row[idx.description] ?? '').trim();
    const colSenderBank = idx.senderBank !== -1 ? cleanCodeOrAccount(row[idx.senderBank]) : null;
    const colSenderAccountNo = idx.senderAccountNo !== -1 ? cleanCodeOrAccount(row[idx.senderAccountNo]) : null;
    const colSenderAccountName = idx.senderAccountName !== -1 ? cleanText(row[idx.senderAccountName]) : null;
    const remarks = idx.remarks !== -1 ? cleanText(row[idx.remarks]) : null;

    // ใช้ค่าจากคอลัมน์เฉพาะของ BBL เป็นหลัก ถ้าไม่มีค่อยลองแกะด้วย regex จากคอลัมน์ Remarks
    const fallback =
      !colSenderBank && !colSenderAccountNo && !colSenderAccountName
        ? extractSenderFromText(remarks)
        : null;
    const senderBank = colSenderBank ?? fallback?.senderBank ?? null;
    const senderAccountNo = colSenderAccountNo ?? fallback?.senderAccountNo ?? null;
    const senderAccountName = colSenderAccountName ?? fallback?.senderAccountName ?? null;

    const rawParts = [description, colSenderBank, colSenderAccountNo, colSenderAccountName, remarks].filter(Boolean);

    lines.push({
      tranDate,
      description,
      debit: toNumber(row[idx.debit]),
      credit: toNumber(row[idx.credit]),
      balance: toNumber(row[idx.balance]),
      chequeNo: row[idx.chequeNo] ? String(row[idx.chequeNo]).trim() : null,
      channel: row[idx.channel] ? String(row[idx.channel]).trim() : null,
      rawDescription: rawParts.join(' | '),
      senderBank,
      senderAccountNo,
      senderAccountName,
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