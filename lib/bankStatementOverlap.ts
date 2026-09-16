import sql from 'mssql';
import { NormalizedStatementLine } from './bankParsers/types';

// เช็คไฟล์ซ้ำด้วย hash ของไฟล์อย่างเดียวไม่พอ — statement เดียวกันที่ดาวน์โหลดจากธนาคารใหม่อีกรอบ
// หรือเปิดใน Excel แล้ว save ใหม่ (หรือ export เป็น .csv แทน .xlsx) ได้ไฟล์คนละ byte กัน hash จึงไม่ตรง
// แล้วรายการก็เข้าซ้ำได้ ที่นี่จึงเทียบระดับ "รายการ" กับบรรทัดของไฟล์ที่นำเข้าไว้แล้ว (Status = 'SUCCESS')

export type StatementOverlap = {
  overlapCount: number;
  imports: { importId: number; fileName: string; importedAt: string; lineCount: number }[];
  // รายการในไฟล์ที่ยังไม่มีในระบบ เรียงตามลำดับเดิมในไฟล์
  newLines: NormalizedStatementLine[];
};

// 0 กับช่องว่างถือว่าเท่ากัน — export คนละรูปแบบบางทีใส่ 0 บางทีเว้นว่างในช่องที่ไม่มียอด
function amountKey(n: number | null): string {
  return n ? n.toFixed(2) : '';
}

function dateKey(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value ?? '').slice(0, 10);
}

// วันที่ + ยอดเข้า/ออก + ยอดคงเหลือ แทบระบุรายการได้ไม่ซ้ำกันอยู่แล้ว เพราะยอดคงเหลือเปลี่ยนทุกรายการ
// ไม่ใช้คำอธิบายเป็นส่วนของ key เมื่อมียอดคงเหลือ เพราะไฟล์ .csv กับ .xlsx ของธนาคารเดียวกันเขียนคำอธิบายต่างกันได้
// ถ้าแถวไหนไม่มียอดคงเหลือค่อยใช้คำอธิบายช่วยแยก
function lineKey(
  tranDate: string,
  debit: number | null,
  credit: number | null,
  balance: number | null,
  description: string | null
): string {
  const base = `${tranDate}|${amountKey(debit)}|${amountKey(credit)}`;
  if (balance !== null) return `${base}|${balance.toFixed(2)}`;
  return `${base}||${String(description ?? '').replace(/\s+/g, ' ').trim().toLowerCase()}`;
}

/**
 * นับว่ารายการในไฟล์ซ้ำกับบรรทัดที่นำเข้าไว้แล้วกี่รายการ มาจากไฟล์ไหน และแยกรายการที่ยังไม่มีในระบบออกมา
 *
 * บัญชีนำเข้า statement ทับช่วงกันได้ตามปกติ (เช่นทำ 1–15 แล้วรอบหน้าอัปไฟล์ทั้งเดือน)
 * จึงไม่บล็อกทั้งไฟล์ แต่ให้ผู้เรียกนำเข้าเฉพาะ newLines
 *
 * เทียบเฉพาะภายใน "บัญชีเดียวกัน" เมื่อรู้บัญชีแล้ว (ดู accountScope ข้างล่าง)
 * นับแบบ multiset: ถ้าไฟล์มีรายการหน้าตาเหมือนกัน 2 แถว แต่ในระบบมีอยู่ 1 แถว จะนับซ้ำ 1 ไม่ใช่ 2
 * ส่ง Transaction มาได้ เพื่อให้การเช็คอยู่ใน transaction เดียวกับการบันทึก (ดู import/route.ts)
 */
export async function findOverlapWithImportedLines(
  scope: sql.ConnectionPool | sql.Transaction,
  bankCode: string,
  lines: NormalizedStatementLine[],
  periodStart: string | null,
  periodEnd: string | null,
  // บัญชีที่กำลังนำเข้า — null เมื่อยังไม่ได้รัน sql/006 (ตอนนั้นเทียบได้แค่ระดับธนาคารแบบเดิม)
  bankAccountNo: string | null = null
): Promise<StatementOverlap> {
  if (!periodStart || !periodEnd || lines.length === 0) return { overlapCount: 0, imports: [], newLines: lines };

  const request = scope instanceof sql.Transaction ? new sql.Request(scope) : new sql.Request(scope);
  request
    .input('bankCode', sql.NVarChar, bankCode)
    .input('periodStart', sql.Date, periodStart)
    .input('periodEnd', sql.Date, periodEnd);
  if (bankAccountNo) request.input('bankAccountNo', sql.NVarChar, bankAccountNo);

  // ขอบเขตการเทียบซ้ำต้องเป็น "บัญชีเดียวกัน" ไม่ใช่ "ธนาคารเดียวกัน" — สองบัญชีของธนาคารเดียวกัน
  // มีรายการวันเดียวกันยอดเท่ากันได้ตามปกติ (เช่นโอนระหว่างบัญชีตัวเอง) ถ้าเทียบระดับธนาคาร
  // ไฟล์ของบัญชีที่สองจะถูกมองว่าซ้ำแล้วไม่ถูกนำเข้าโดยไม่มีใครรู้
  //
  // แต่ยังต้องเทียบกับแถวเก่าที่ BankAccountNo เป็น NULL (นำเข้าไว้ก่อนรัน sql/006 และยังไม่ได้ระบุบัญชี)
  // ด้วย เพราะแถวพวกนั้นอาจเป็นบัญชีเดียวกันจริงๆ — เผลอนับซ้ำเกินไปยังดีกว่านำเข้าซ้ำจนยอดเบิ้ล
  const accountScope = bankAccountNo
    ? '(l.BankAccountNo = @bankAccountNo OR (l.BankAccountNo IS NULL AND l.BankCode = @bankCode))'
    : 'l.BankCode = @bankCode';

  const existing = await request.query(`
      SELECT l.ImportId, l.TranDate, l.Description, l.Debit, l.Credit, l.Balance, i.FileName, i.ImportedAt
      FROM BankStatementLine l
      JOIN BankStatementImport i ON i.ImportId = l.ImportId
      WHERE ${accountScope}
        AND l.TranDate BETWEEN @periodStart AND @periodEnd
        AND i.Status = 'SUCCESS'
    `);

  const existingByKey = new Map<string, { importId: number; fileName: string; importedAt: string }[]>();
  for (const r of existing.recordset) {
    const key = lineKey(dateKey(r.TranDate), r.Debit, r.Credit, r.Balance, r.Description);
    const list = existingByKey.get(key) ?? [];
    list.push({ importId: r.ImportId, fileName: r.FileName, importedAt: r.ImportedAt });
    existingByKey.set(key, list);
  }

  let overlapCount = 0;
  const imports = new Map<number, StatementOverlap['imports'][number]>();
  const newLines: NormalizedStatementLine[] = [];
  for (const l of lines) {
    const source = existingByKey.get(lineKey(l.tranDate, l.debit, l.credit, l.balance, l.description))?.shift();
    if (!source) {
      newLines.push(l);
      continue;
    }
    overlapCount++;
    const entry = imports.get(source.importId) ?? { ...source, lineCount: 0 };
    entry.lineCount++;
    imports.set(source.importId, entry);
  }

  return {
    overlapCount,
    imports: [...imports.values()].sort((a, b) => b.lineCount - a.lineCount),
    newLines,
  };
}
