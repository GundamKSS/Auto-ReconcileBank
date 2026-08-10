import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import sql from 'mssql';
import crypto from 'crypto';
import { getPool } from '../../../../lib/db';
import { parseBankStatement, BankCode } from '../../../../lib/bankParsers/index';

const VALID_BANKS: BankCode[] = ['BBL', 'KBANK', 'SCB'];

// เลือก sheet ที่น่าจะมีข้อมูลจริง:
// - อันดับ 1: ชื่อ sheet มีชื่อธนาคารอยู่ในนั้นแต่ไม่ใช่ sheet สรุป/pivot (ไฟล์จริงมักมีหลาย sheet ปนกัน)
// - อันดับ 2: ถ้าไฟล์ถูก export จาก Apple Numbers จะมี sheet ชื่อลงท้ายด้วย 'Table 1-1'
// - อันดับ 3: เลือก sheet ที่มีจำนวนแถวมากที่สุด (fallback สุดท้าย)
// - ถ้ามี sheet เดียว ใช้ sheet นั้นตรงๆ
function pickDataSheetName(workbook: XLSX.WorkBook, bankCode?: string): string {
  if (workbook.SheetNames.length === 1) {
    return workbook.SheetNames[0];
  }

  if (bankCode) {
    const bankMatch = workbook.SheetNames.find(
      (name) => name.toLowerCase().includes(bankCode.toLowerCase()) && !name.toLowerCase().includes('pivot')
    );
    if (bankMatch) return bankMatch;
  }

  const tableSheet = workbook.SheetNames.find((name) => /table 1-1$/i.test(name));
  if (tableSheet) return tableSheet;

  let bestName = workbook.SheetNames[0];
  let bestRowCount = -1;
  for (const name of workbook.SheetNames) {
    const ref = workbook.Sheets[name]['!ref'];
    if (!ref) continue;
    const range = XLSX.utils.decode_range(ref);
    const rowCount = range.e.r - range.s.r + 1;
    if (rowCount > bestRowCount) {
      bestRowCount = rowCount;
      bestName = name;
    }
  }
  return bestName;
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
      return NextResponse.json({ error: 'กรุณาเลือกธนาคารให้ถูกต้อง' }, { status: 400 });
    }

    // อ่านไฟล์ Excel เป็น buffer แล้วแปลงเป็น array of rows
    const arrayBuffer = await file.arrayBuffer();
    const fileBuffer = Buffer.from(arrayBuffer);
    const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    // เช็คไฟล์ซ้ำก่อนทำอะไรทั้งหมด: ถ้าเนื้อหาไฟล์นี้เคย import สำเร็จไปแล้ว ไม่ยอมให้บันทึกซ้ำ
    const poolForCheck = await getPool();
    const dupCheck = await poolForCheck
      .request()
      .input('fileHash', sql.Char(64), fileHash)
      .query(`
        SELECT TOP 1 ImportId, FileName, ImportedAt
        FROM BankStatementImport
        WHERE FileHash = @fileHash AND Status = 'SUCCESS'
      `);

    if (dupCheck.recordset.length > 0) {
      const existing = dupCheck.recordset[0];
      return NextResponse.json(
        {
          error: `ไฟล์นี้เคยนำเข้าไปแล้ว (${existing.FileName} เมื่อ ${new Date(
            existing.ImportedAt
          ).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })}) ไม่นำเข้าซ้ำ`,
          duplicate: true,
          existingImportId: existing.ImportId,
        },
        { status: 409 }
      );
    }

    const workbook = XLSX.read(arrayBuffer, { type: 'buffer', cellDates: true });
    const sheetName = pickDataSheetName(workbook, bankCode as string);
    const sheet = workbook.Sheets[sheetName];
    const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: null,
      raw: true,
    });

    // แกะไฟล์ด้วย parser เฉพาะธนาคาร
    const result = parseBankStatement(bankCode as BankCode, rows);

    if (result.lines.length === 0) {
      return NextResponse.json(
        { error: 'ไม่พบรายการในไฟล์ อาจเป็นไฟล์ผิดรูปแบบหรือธนาคารที่เลือกไม่ตรงกับไฟล์' },
        { status: 400 }
      );
    }

    // บันทึกลง SQL Server ทั้งหมดในทรานแซกชันเดียว
    const pool = await getPool();
    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      const importRequest = new sql.Request(transaction);
      const importResult = await importRequest
        .input('bankCode', sql.NVarChar, bankCode)
        .input('fileName', sql.NVarChar, file.name)
        .input('periodStart', sql.Date, result.periodStart)
        .input('periodEnd', sql.Date, result.periodEnd)
        .input('rowCount', sql.Int, result.lines.length)
        .input('fileHash', sql.Char(64), fileHash)
        .query(`
          INSERT INTO BankStatementImport (BankCode, FileName, PeriodStart, PeriodEnd, ImportedRowCount, FileHash, Status)
          OUTPUT INSERTED.ImportId
          VALUES (@bankCode, @fileName, @periodStart, @periodEnd, @rowCount, @fileHash, 'SUCCESS')
        `);

      const importId = importResult.recordset[0].ImportId;

      for (const line of result.lines) {
        const lineRequest = new sql.Request(transaction);
        await lineRequest
          .input('importId', sql.Int, importId)
          .input('bankCode', sql.NVarChar, bankCode)
          .input('tranDate', sql.Date, line.tranDate)
          .input('description', sql.NVarChar, line.description)
          .input('debit', sql.Decimal(18, 2), line.debit)
          .input('credit', sql.Decimal(18, 2), line.credit)
          .input('balance', sql.Decimal(18, 2), line.balance)
          .input('chequeNo', sql.NVarChar, line.chequeNo)
          .input('channel', sql.NVarChar, line.channel)
          .input('rawDescription', sql.NVarChar, line.rawDescription)
          .query(`
            INSERT INTO BankStatementLine
              (ImportId, BankCode, TranDate, Description, Debit, Credit, Balance, ChequeNo, Channel, RawDescription)
            VALUES
              (@importId, @bankCode, @tranDate, @description, @debit, @credit, @balance, @chequeNo, @channel, @rawDescription)
          `);
      }

      await transaction.commit();

      return NextResponse.json({
        importId,
        bankCode,
        rowCount: result.lines.length,
        periodStart: result.periodStart,
        periodEnd: result.periodEnd,
      });
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  } catch (err) {
    console.error(err);
    const message = err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการนำเข้าไฟล์';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}