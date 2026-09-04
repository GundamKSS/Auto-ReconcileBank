import { NextRequest, NextResponse } from 'next/server';
import sql from 'mssql';
import crypto from 'crypto';
import { getPool } from '../../../../lib/db';
import { parseBankStatement, BankCode, NormalizedStatementLine } from '../../../../lib/bankParsers/index';
import { readStatementRows, MAX_FILE_BYTES, MAX_IMPORT_ROWS } from '../../../../lib/bankParsers/workbook';
import { requireRole } from '../../../../lib/session';
import { RECONCILE_ROLES } from '../../../../lib/roles';

const VALID_BANKS: BankCode[] = ['BBL', 'KBANK', 'SCB'];

// เช็คแถวที่น่าจะซ้ำกัน (วันที่ + เดบิต + เครดิต + คำอธิบาย เหมือนกันเป๊ะ)
function findPossibleDuplicates(lines: NormalizedStatementLine[]): number {
  const seen = new Map<string, number>();
  for (const l of lines) {
    const key = `${l.tranDate}|${l.debit}|${l.credit}|${l.description}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  let dupCount = 0;
  for (const count of seen.values()) {
    if (count > 1) dupCount += count - 1;
  }
  return dupCount;
}

// ช่วงวันที่ของไฟล์ที่กว้างผิดปกติมักแปลว่าอ่านวันที่ผิด หรือหยิบไฟล์ผิด — เตือนไว้ให้ผู้ใช้ดูก่อนนำเข้า
const WIDE_PERIOD_DAYS = 62;

function daysBetween(from: string | null, to: string | null): number | null {
  if (!from || !to) return null;
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

export async function POST(req: NextRequest) {
  const auth = await requireRole(RECONCILE_ROLES);
  if (!auth.ok) return auth.response;

  let lines: NormalizedStatementLine[];
  let periodStart: string | null;
  let periodEnd: string | null;
  let fileHash: string;
  let file: File;
  let bankCode: string;

  // แยกขั้น "อ่าน/แกะไฟล์" ออกจากขั้น "คุยกับฐานข้อมูล" เพราะสองอย่างนี้ผิดพลาดคนละสาเหตุกัน
  // ไฟล์ผิดรูปแบบคือความผิดของ input (400) ส่วน DB ล่มคือความผิดของระบบ (500)
  try {
    const formData = await req.formData();
    const rawFile = formData.get('file') as File | null;
    const rawBank = formData.get('bankCode') as string | null;

    if (!rawFile) {
      return NextResponse.json({ error: 'กรุณาแนบไฟล์' }, { status: 400 });
    }
    if (!rawBank || !VALID_BANKS.includes(rawBank as BankCode)) {
      return NextResponse.json({ error: 'ยังไม่รองรับธนาคารนี้' }, { status: 400 });
    }
    if (rawFile.size > MAX_FILE_BYTES) {
      return NextResponse.json(
        {
          error:
            `ไฟล์ใหญ่เกินไป (${Math.round(rawFile.size / 1024 / 1024)} MB) ` +
            `ระบบรับได้ไม่เกิน ${MAX_FILE_BYTES / 1024 / 1024} MB ต่อไฟล์`,
        },
        { status: 413 }
      );
    }
    file = rawFile;
    bankCode = rawBank;

    const fileBuffer = Buffer.from(await file.arrayBuffer());
    fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    const rows = readStatementRows(file.name, fileBuffer, bankCode);
    const result = parseBankStatement(bankCode as BankCode, rows);
    lines = result.lines;
    periodStart = result.periodStart;
    periodEnd = result.periodEnd;

    if (lines.length === 0) {
      return NextResponse.json(
        { error: 'ไม่พบรายการในไฟล์ อาจเป็นไฟล์ผิดรูปแบบหรือธนาคารที่เลือกไม่ตรงกับไฟล์' },
        { status: 400 }
      );
    }
    if (lines.length > MAX_IMPORT_ROWS) {
      return NextResponse.json(
        {
          error:
            `ไฟล์นี้มี ${lines.length.toLocaleString('th-TH')} รายการ ` +
            `เกินขีดจำกัด ${MAX_IMPORT_ROWS.toLocaleString('th-TH')} รายการต่อไฟล์ — กรุณาแบ่งไฟล์ก่อนนำเข้า`,
        },
        { status: 413 }
      );
    }
  } catch (err) {
    // ข้อความจาก parser ("ไม่พบคอลัมน์ในไฟล์ BBL: ...") บอกผู้ใช้ได้ตรงจุด ส่งกลับไปได้
    const message = err instanceof Error ? err.message : 'อ่านไฟล์ไม่สำเร็จ';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    const pool = await getPool();
    const dupCheck = await pool
      .request()
      .input('fileHash', sql.Char(64), fileHash)
      .query(`
        SELECT TOP 1 FileName, ImportedAt
        FROM BankStatementImport
        WHERE FileHash = @fileHash AND Status = 'SUCCESS'
      `);
    const alreadyImported = dupCheck.recordset[0] ?? null;

    const periodDays = daysBetween(periodStart, periodEnd);

    return NextResponse.json({
      bankCode,
      fileName: file.name,
      fileSizeKb: Math.round(file.size / 1024),
      totalRows: lines.length,
      periodStart,
      periodEnd,
      previewRows: lines.slice(0, 5),
      warnings: {
        missingDate: 0, // แถวที่ไม่มีวันที่ถูกข้ามไปแล้วตอน parse จึงเป็น 0 เสมอ
        possibleDuplicates: findPossibleDuplicates(lines),
        // statement ปกติครอบคลุมราวหนึ่งเดือน ถ้ากว้างกว่านี้มากมักแปลว่าหยิบไฟล์ผิด
        widePeriodDays: periodDays !== null && periodDays > WIDE_PERIOD_DAYS ? periodDays : null,
        alreadyImported: alreadyImported
          ? { fileName: alreadyImported.FileName, importedAt: alreadyImported.ImportedAt }
          : null,
      },
    });
  } catch (err) {
    console.error('Bank statement preview error:', err);
    return NextResponse.json({ error: 'ตรวจสอบไฟล์กับฐานข้อมูลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' }, { status: 500 });
  }
}
