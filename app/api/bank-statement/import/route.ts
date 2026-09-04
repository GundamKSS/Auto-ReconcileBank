import { NextRequest, NextResponse } from 'next/server';
import sql from 'mssql';
import crypto from 'crypto';
import { getPool } from '../../../../lib/db';
import { parseBankStatement, BankCode, NormalizedStatementLine } from '../../../../lib/bankParsers/index';
import { readStatementRows, MAX_FILE_BYTES, MAX_IMPORT_ROWS } from '../../../../lib/bankParsers/workbook';
import { requireRole } from '../../../../lib/session';
import { RECONCILE_ROLES } from '../../../../lib/roles';

const VALID_BANKS: BankCode[] = ['BBL', 'KBANK', 'SCB'];

// จำนวนแถวต่อ 1 คำสั่ง INSERT — เดิมแทรกทีละแถวจึงต้องวิ่งไป-กลับ SQL Server เท่าจำนวนแถว
// (วัดได้ราว 38 ms ต่อครั้ง = ไฟล์ 424 แถวใช้เวลาราว 16 วินาที โดยเปิด transaction ค้างไว้ตลอด)
// รวมเป็นชุดละ 200 แถวทำให้เหลือไม่กี่รอบ ยังอยู่ใต้เพดานของ SQL Server ทั้งสองข้อ:
// 1,000 แถวต่อ VALUES clause และ 2,100 พารามิเตอร์ต่อคำสั่ง (ที่นี่ใช้ 8 ตัว/แถว = 1,600)
const INSERT_BATCH_SIZE = 200;

async function insertLinesInBatches(
  transaction: sql.Transaction,
  importId: number,
  bankCode: string,
  lines: NormalizedStatementLine[]
) {
  for (let start = 0; start < lines.length; start += INSERT_BATCH_SIZE) {
    const batch = lines.slice(start, start + INSERT_BATCH_SIZE);
    const request = new sql.Request(transaction);

    request.input('importId', sql.Int, importId);
    request.input('bankCode', sql.NVarChar, bankCode);

    const valueRows: string[] = [];
    batch.forEach((line, i) => {
      request.input(`d${i}`, sql.Date, line.tranDate);
      request.input(`de${i}`, sql.NVarChar, line.description);
      request.input(`db${i}`, sql.Decimal(18, 2), line.debit);
      request.input(`cr${i}`, sql.Decimal(18, 2), line.credit);
      request.input(`ba${i}`, sql.Decimal(18, 2), line.balance);
      request.input(`ch${i}`, sql.NVarChar, line.chequeNo);
      request.input(`cn${i}`, sql.NVarChar, line.channel);
      request.input(`rd${i}`, sql.NVarChar, line.rawDescription);
      // ชื่อพารามิเตอร์ทั้งหมดสร้างจาก index ของเราเอง ไม่ได้มาจาก input ของผู้ใช้
      valueRows.push(`(@importId, @bankCode, @d${i}, @de${i}, @db${i}, @cr${i}, @ba${i}, @ch${i}, @cn${i}, @rd${i})`);
    });

    await request.query(`
      INSERT INTO BankStatementLine
        (ImportId, BankCode, TranDate, Description, Debit, Credit, Balance, ChequeNo, Channel, RawDescription)
      VALUES ${valueRows.join(', ')}
    `);
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireRole(RECONCILE_ROLES);
  if (!auth.ok) return auth.response;

  let lines: NormalizedStatementLine[];
  let periodStart: string | null;
  let periodEnd: string | null;
  let fileHash: string;
  let fileName: string;
  let bankCode: string;

  // ขั้นอ่าน/แกะไฟล์ — ผิดพลาดที่นี่คือ input ไม่ถูกต้อง ตอบ 4xx
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const rawBank = formData.get('bankCode') as string | null;

    if (!file) {
      return NextResponse.json({ error: 'กรุณาแนบไฟล์' }, { status: 400 });
    }
    if (!rawBank || !VALID_BANKS.includes(rawBank as BankCode)) {
      return NextResponse.json({ error: 'กรุณาเลือกธนาคารให้ถูกต้อง' }, { status: 400 });
    }
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json(
        {
          error:
            `ไฟล์ใหญ่เกินไป (${Math.round(file.size / 1024 / 1024)} MB) ` +
            `ระบบรับได้ไม่เกิน ${MAX_FILE_BYTES / 1024 / 1024} MB ต่อไฟล์`,
        },
        { status: 413 }
      );
    }
    bankCode = rawBank;
    fileName = file.name;

    const fileBuffer = Buffer.from(await file.arrayBuffer());
    fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    const rows = readStatementRows(fileName, fileBuffer, bankCode);
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
    const message = err instanceof Error ? err.message : 'อ่านไฟล์ไม่สำเร็จ';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // ขั้นบันทึกลงฐานข้อมูล
  try {
    const pool = await getPool();

    // เช็คไฟล์ซ้ำก่อนทำอะไรทั้งหมด: ถ้าเนื้อหาไฟล์นี้เคย import สำเร็จไปแล้ว ไม่ยอมให้บันทึกซ้ำ
    const dupCheck = await pool
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

    // บันทึกลง SQL Server ทั้งหมดในทรานแซกชันเดียว
    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      const importRequest = new sql.Request(transaction);
      const importResult = await importRequest
        .input('bankCode', sql.NVarChar, bankCode)
        .input('fileName', sql.NVarChar, fileName)
        .input('periodStart', sql.Date, periodStart)
        .input('periodEnd', sql.Date, periodEnd)
        .input('rowCount', sql.Int, lines.length)
        .input('fileHash', sql.Char(64), fileHash)
        .query(`
          INSERT INTO BankStatementImport (BankCode, FileName, PeriodStart, PeriodEnd, ImportedRowCount, FileHash, Status)
          OUTPUT INSERTED.ImportId
          VALUES (@bankCode, @fileName, @periodStart, @periodEnd, @rowCount, @fileHash, 'SUCCESS')
        `);

      const importId = importResult.recordset[0].ImportId;

      await insertLinesInBatches(transaction, importId, bankCode, lines);

      await transaction.commit();

      return NextResponse.json({
        importId,
        bankCode,
        rowCount: lines.length,
        periodStart,
        periodEnd,
      });
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  } catch (err) {
    console.error('Bank statement import error:', err);
    return NextResponse.json({ error: 'บันทึกข้อมูลลงระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' }, { status: 500 });
  }
}
