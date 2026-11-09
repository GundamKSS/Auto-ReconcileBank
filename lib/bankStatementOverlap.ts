import sql from 'mssql';
import { NormalizedStatementLine } from './bankParsers/types';

// เช็คไฟล์ซ้ำด้วย hash ของไฟล์อย่างเดียวไม่พอ — statement เดียวกันที่ดาวน์โหลดจากธนาคารใหม่อีกรอบ
// หรือเปิดใน Excel แล้ว save ใหม่ (หรือ export เป็น .csv แทน .xlsx) ได้ไฟล์คนละ byte กัน hash จึงไม่ตรง
// แล้วรายการก็เข้าซ้ำได้ ที่นี่จึงเทียบระดับ "รายการ" กับบรรทัดของไฟล์ที่นำเข้าไว้แล้ว (Status = 'SUCCESS')

export type LineToUpdate = {
  lineId: number;
  importId: number;
  line: NormalizedStatementLine;
};

export type StatementOverlap = {
  overlapCount: number;
  updateCount: number;
  imports: { importId: number; fileName: string; importedAt: string; lineCount: number }[];
  // รายการที่มีอยู่ในระบบแล้วแต่ข้อมูล Debit/Credit ยังว่าง (เช่น เคยนำเข้าเฉพาะฝั่งเดียวแล้วอีกฝั่งเป็น NULL) — ต้อง UPDATE
  linesToUpdate: LineToUpdate[];
  // รายการในไฟล์ที่ยังไม่มีในระบบ เรียงตามลำดับเดิมในไฟล์ — ต้อง INSERT
  newLines: NormalizedStatementLine[];
};

// 0 กับช่องว่างถือว่าเท่ากัน — export คนละรูปแบบบางทีใส่ 0 บางทีเว้นว่างในช่องที่ไม่มียอด
function amountKey(n: number | null): string {
  return n ? Number(n).toFixed(2) : '';
}

function dateKey(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value ?? '').slice(0, 10);
}

function normalizeDescription(description: string | null): string {
  return String(description ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
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
  if (balance !== null && balance !== undefined) return `${base}|${Number(balance).toFixed(2)}`;
  return `${base}||${normalizeDescription(description)}`;
}

// คีย์ระบุตัวตนของรายการจาก (วันที่ + ยอดคงเหลือ + คำอธิบาย) สำหรับจับคู่แถวเดิมในฐานข้อมูลที่ Debit/Credit ยังเป็น NULL
function identityKey(
  tranDate: string,
  balance: number | null,
  description: string | null
): string {
  const bal = balance !== null && balance !== undefined ? Number(balance).toFixed(2) : '';
  return `${tranDate}|${bal}|${normalizeDescription(description)}`;
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
  if (!periodStart || !periodEnd || lines.length === 0) {
    return { overlapCount: 0, updateCount: 0, imports: [], linesToUpdate: [], newLines: lines };
  }

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
      SELECT l.LineId, l.ImportId, l.TranDate, l.Description, l.Debit, l.Credit, l.Balance, i.FileName, i.ImportedAt
      FROM BankStatementLine l
      JOIN BankStatementImport i ON i.ImportId = l.ImportId
      WHERE ${accountScope}
        AND l.TranDate BETWEEN @periodStart AND @periodEnd
        AND i.Status = 'SUCCESS'
        AND l.MatchStatus <> 'DELETED'
      ORDER BY l.LineId ASC
    `);

  const existingByKey = new Map<string, { lineId: number; importId: number; fileName: string; importedAt: string }[]>();
  const incompleteByKey = new Map<string, { lineId: number; importId: number; fileName: string; importedAt: string }[]>();

  for (const r of existing.recordset) {
    const dKey = dateKey(r.TranDate);
    const hasAmount = (r.Debit !== null && r.Debit !== undefined && Number(r.Debit) !== 0) ||
                      (r.Credit !== null && r.Credit !== undefined && Number(r.Credit) !== 0);
    const item = {
      lineId: Number(r.LineId),
      importId: Number(r.ImportId),
      fileName: r.FileName,
      importedAt: r.ImportedAt,
    };

    if (!hasAmount) {
      // แถวที่เคยนำเข้าไว้แต่ยังไม่มีค่า Debit/Credit (เป็น NULL) — จับคู่ด้วย (วันที่ + ยอดคงเหลือ + คำอธิบาย) เพื่อนำไป UPDATE
      const idKey = identityKey(dKey, r.Balance, r.Description);
      const list = incompleteByKey.get(idKey) ?? [];
      list.push(item);
      incompleteByKey.set(idKey, list);
    } else {
      const key = lineKey(dKey, r.Debit, r.Credit, r.Balance, r.Description);
      const list = existingByKey.get(key) ?? [];
      list.push(item);
      existingByKey.set(key, list);
    }
  }

  let overlapCount = 0;
  const imports = new Map<number, StatementOverlap['imports'][number]>();
  const linesToUpdate: LineToUpdate[] = [];
  const newLines: NormalizedStatementLine[] = [];

  for (const l of lines) {
    const hasFileAmount = (l.debit !== null && l.debit !== 0) || (l.credit !== null && l.credit !== 0);
    if (hasFileAmount) {
      const incSource = incompleteByKey.get(identityKey(l.tranDate, l.balance, l.description))?.shift();
      if (incSource) {
        linesToUpdate.push({
          lineId: incSource.lineId,
          importId: incSource.importId,
          line: l,
        });
        const entry = imports.get(incSource.importId) ?? {
          importId: incSource.importId,
          fileName: incSource.fileName,
          importedAt: incSource.importedAt,
          lineCount: 0,
        };
        entry.lineCount++;
        imports.set(incSource.importId, entry);
        continue;
      }
    }

    const source = existingByKey.get(lineKey(l.tranDate, l.debit, l.credit, l.balance, l.description))?.shift();
    if (!source) {
      newLines.push(l);
      continue;
    }
    overlapCount++;
    const entry = imports.get(source.importId) ?? {
      importId: source.importId,
      fileName: source.fileName,
      importedAt: source.importedAt,
      lineCount: 0,
    };
    entry.lineCount++;
    imports.set(source.importId, entry);
  }

  return {
    overlapCount,
    updateCount: linesToUpdate.length,
    imports: [...imports.values()].sort((a, b) => b.lineCount - a.lineCount),
    linesToUpdate,
    newLines,
  };
}
