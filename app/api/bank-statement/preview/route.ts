import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import sql from 'mssql';
import crypto from 'crypto';
import { getPool } from '../../../../lib/db';
import { parseBankStatement, BankCode, NormalizedStatementLine } from  '../../../../lib/bankParsers/index';
const VALID_BANKS: BankCode[] = ['BBL', 'KBANK', 'SCB'];

function pickDataSheetName(workbook: XLSX.WorkBook, bankCode?: string): string {
  if (workbook.SheetNames.length === 1) return workbook.SheetNames[0];

  // อันดับ 1: ชื่อ sheet ที่มีชื่อธนาคารอยู่ในนั้น แต่ไม่ใช่ sheet สรุป/pivot
  // (ไฟล์จริงมักมีหลาย sheet ปนกัน เช่น "PIVOT KBANK", "KBANK 7.26", "GL 7.26" — ต้องเลือกให้ตรงธนาคารที่เลือกไว้)
  if (bankCode) {
    const bankMatch = workbook.SheetNames.find(
      (name) => name.toLowerCase().includes(bankCode.toLowerCase()) && !name.toLowerCase().includes('pivot')
    );
    if (bankMatch) return bankMatch;
  }

  // อันดับ 2: ไฟล์ที่ export จาก Apple Numbers จะมี sheet ลงท้ายด้วย "Table 1-1"
  const tableSheet = workbook.SheetNames.find((name) => /table 1-1$/i.test(name));
  if (tableSheet) return tableSheet;

  // อันดับ 3 (fallback สุดท้าย): เลือก sheet ที่มีจำนวนแถวมากที่สุด
  let bestName = workbook.SheetNames[0];
  let bestRowCount = -1;
  for (const name of workbook.SheetNames) {
    const ref = workbook.Sheets[name]['!ref'];
    if (!ref) continue;
    const range = XLSX.utils.decode_range(ref);
    const rowCount = range.e.r - range.s.r + 1;
    if (rowCount > bestRowCount) { bestRowCount = rowCount; bestName = name; }
  }
  return bestName;
}

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

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const bankCode = formData.get('bankCode') as string | null;

    if (!file) {
      return NextResponse.json({ error: 'กรุณาแนบไฟล์' }, { status: 400 });
    }
    if (!bankCode || !VALID_BANKS.includes(bankCode as BankCode)) {
      return NextResponse.json({ error: 'ยังไม่รองรับธนาคารนี้' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const fileBuffer = Buffer.from(arrayBuffer);
    const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

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

    const workbook = XLSX.read(arrayBuffer, { type: 'buffer', cellDates: true });
    const sheetName = pickDataSheetName(workbook, bankCode as string);
    const sheet = workbook.Sheets[sheetName];
    const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: null,
      raw: true,
    });

    const result = parseBankStatement(bankCode as BankCode, rows);

    if (result.lines.length === 0) {
      return NextResponse.json(
        { error: 'ไม่พบรายการในไฟล์ อาจเป็นไฟล์ผิดรูปแบบหรือธนาคารที่เลือกไม่ตรงกับไฟล์' },
        { status: 400 }
      );
    }

    const missingDate = result.lines.filter((l) => !l.tranDate).length; // จะเป็น 0 เสมอ เพราะแถวไม่มีวันที่ถูกข้ามไปแล้วตอน parse
    const possibleDuplicates = findPossibleDuplicates(result.lines);

    return NextResponse.json({
      bankCode,
      fileName: file.name,
      fileSizeKb: Math.round(file.size / 1024),
      totalRows: result.lines.length,
      periodStart: result.periodStart,
      periodEnd: result.periodEnd,
      previewRows: result.lines.slice(0, 5),
      warnings: {
        missingDate,
        possibleDuplicates,
        alreadyImported: alreadyImported
          ? { fileName: alreadyImported.FileName, importedAt: alreadyImported.ImportedAt }
          : null,
      },
    });
  } catch (err) {
    console.error(err);
    const message = err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการอ่านไฟล์';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}