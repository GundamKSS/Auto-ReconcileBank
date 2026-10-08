import sql from 'mssql';
import { getPool } from './db';
import type { ReportSummary } from '../app/api/reports/reconciliation/query';

/**
 * แยก "ผลต่างที่ต้องตามจริง" ออกจาก "ยังไม่ได้นำเข้า statement"
 *
 * ปัญหาที่แก้: หน้าภาพรวมกับหน้ารายงานเอายอดฝั่ง BC365 ของธนาคารที่ยัง "ไม่ได้นำเข้า statement เลย"
 * ไปรวมกับผลต่างของธนาคารที่กระทบยอดอยู่จริง แล้วแสดงเป็นตัวเลขเดียวติดป้ายว่า "ยอดยังไม่ตรง"
 * ของจริงที่เจอตอนทดสอบคือ ผลต่างรวม -89.5 ล้าน แต่ 86.87 ล้าน (97%) เป็นแค่ KBank/SCB/KTB
 * ที่ยังไม่ได้นำเข้าไฟล์ ไม่ใช่ผลต่างที่ต้องไปตามหาสาเหตุ
 *
 * ธนาคารที่ยังไม่มี statement ไม่ได้แปลว่า "กระทบยอดแล้วไม่ตรง" แต่แปลว่า "ยังไม่ได้เริ่ม"
 * สองอย่างนี้ต้องอ่านแยกกันบนหน้าจอ ไม่งั้นฝั่งบัญชีจะเสียเวลาไล่หาสาเหตุที่ไม่มีอยู่จริง
 */

export type PendingImportBank = {
  bankCode: string;
  glLines: number;
  glNet: number;
};

export type CoverageSplit = {
  /** ผลต่างเฉพาะธนาคารที่นำเข้า statement ของงวดนี้แล้ว — ตัวเลขที่ควรขึ้นพาดหัว */
  reconcilableDiff: number;
  /** ธนาคารที่มีแต่ฝั่ง BC365 เพราะยังไม่ได้นำเข้า statement ของงวดนี้ */
  pendingImport: PendingImportBank[];
  /** ยอดรวมฝั่ง BC365 ของธนาคารข้างบน — แสดงแยกเป็นหมายเหตุ ไม่เอาไปรวมกับผลต่าง */
  pendingImportNet: number;
};

/**
 * ธนาคารที่มีรายการเดินบัญชีอยู่ในงวดนี้จริง
 *
 * ใช้ TranDate เป็นเกณฑ์เสมอแม้รีพอร์ตจะเลือกดูด้วยวันที่ฝั่ง BC365 เพราะคำถามคือ
 * "นำเข้า statement ที่ครอบคลุมงวดนี้แล้วหรือยัง" ซึ่งเป็นเรื่องของวันที่ในไฟล์ของธนาคาร
 * ส่วนไฟล์ที่ลบไปแล้วเก็บไว้เป็น MatchStatus = 'DELETED' จึงไม่นับว่ามี statement
 */
export async function loadBanksWithStatement(
  from: string,
  to: string,
  bankAccountNo: string | null
): Promise<Set<string>> {
  const pool = await getPool();
  const request = pool
    .request()
    .input('from', sql.Date, new Date(`${from}T00:00:00Z`))
    .input('to', sql.Date, new Date(`${to}T00:00:00Z`));
  if (bankAccountNo) request.input('bankAccountNo', sql.NVarChar, bankAccountNo);

  const result = await request.query(`
    SELECT DISTINCT BankCode
    FROM BankStatementLine
    WHERE TranDate >= @from AND TranDate <= @to
      AND MatchStatus <> 'DELETED'
      AND BankCode IS NOT NULL
      ${bankAccountNo ? 'AND BankAccountNo = @bankAccountNo' : ''}
  `);

  return new Set(result.recordset.map((r) => String(r.BankCode)));
}

/**
 * แบ่งยอดสรุปออกเป็น 2 ส่วนตามว่าธนาคารนั้นนำเข้า statement แล้วหรือยัง
 *
 * ธนาคารจะถูกนับเป็น "ยังไม่ได้นำเข้า" ก็ต่อเมื่อไม่มีบรรทัดฝั่งธนาคารเลยทั้งงวด
 * (เช็คจาก banksWithStatement ซึ่งดูทั้ง 2 ทิศทาง ไม่ใช่ดูแค่ฝั่งที่กำลังเปิดอยู่)
 * ถ้าดูเฉพาะแท็บเงินเข้าแล้วบังเอิญธนาคารนั้นมีแต่รายการเงินออก จะติดป้ายผิดทันที
 */
export function splitByCoverage(summary: ReportSummary, banksWithStatement: Set<string>): CoverageSplit {
  const round2 = (n: number) => Number(n.toFixed(2));

  const pendingByBank = new Map<string, PendingImportBank>();
  let reconcilableDiff = 0;

  for (const b of summary.buckets) {
    if (banksWithStatement.has(b.bankCode)) {
      reconcilableDiff += b.diff;
      continue;
    }
    const entry = pendingByBank.get(b.bankCode) ?? { bankCode: b.bankCode, glLines: 0, glNet: 0 };
    entry.glLines += b.glLines;
    entry.glNet += b.glNet;
    pendingByBank.set(b.bankCode, entry);
  }

  const pendingImport = [...pendingByBank.values()]
    .map((p) => ({ ...p, glNet: round2(p.glNet) }))
    .sort((a, b) => Math.abs(b.glNet) - Math.abs(a.glNet));

  return {
    reconcilableDiff: round2(reconcilableDiff),
    pendingImport,
    pendingImportNet: round2(pendingImport.reduce((s, p) => s + p.glNet, 0)),
  };
}
