import { NextRequest, NextResponse } from 'next/server';
import sql from 'mssql';
import crypto from 'crypto';
import { getPool } from '../../../../lib/db';
import { parseBankStatement, BankCode, NormalizedStatementLine } from '../../../../lib/bankParsers/index';
import { readStatementRows, MAX_FILE_BYTES, MAX_IMPORT_ROWS } from '../../../../lib/bankParsers/workbook';
import { requireRole } from '../../../../lib/session';
import { RECONCILE_ROLES } from '../../../../lib/roles';
import { findOverlapWithImportedLines } from '../../../../lib/bankStatementOverlap';
import { bankAccountColumnsReady, resolveBankAccount } from '../../../../lib/bankAccountDb';

const VALID_BANKS: BankCode[] = ['BBL', 'KBANK', 'SCB'];

// เงื่อนไขที่ไม่ยอมให้นำเข้า (ไฟล์/รายการซ้ำ) — แยกจาก error ของระบบ เพื่อตอบ 4xx พร้อมข้อความตรงๆ หลัง rollback
class ImportBlockedError extends Error {
  body: Record<string, unknown>;
  status: number;
  constructor(body: { error: string } & Record<string, unknown>, status: number) {
    super(body.error);
    this.body = body;
    this.status = status;
  }
}

function formatImportedAt(value: string | Date): string {
  return new Date(value).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
}

// จำนวนแถวต่อ 1 คำสั่ง INSERT — เดิมแทรกทีละแถวจึงต้องวิ่งไป-กลับ SQL Server เท่าจำนวนแถว
// (วัดได้ราว 38 ms ต่อครั้ง = ไฟล์ 424 แถวใช้เวลาราว 16 วินาที โดยเปิด transaction ค้างไว้ตลอด)
// รวมเป็นชุดละ 200 แถวทำให้เหลือไม่กี่รอบ ยังอยู่ใต้เพดานของ SQL Server ทั้งสองข้อ:
// 1,000 แถวต่อ VALUES clause และ 2,100 พารามิเตอร์ต่อคำสั่ง (ที่นี่ใช้ 8 ตัว/แถว = 1,600)
const INSERT_BATCH_SIZE = 200;

async function insertLinesInBatches(
  transaction: sql.Transaction,
  importId: number,
  bankCode: string,
  lines: NormalizedStatementLine[],
  // บัญชีของไฟล์นี้ — null เมื่อยังไม่ได้รัน sql/006 (คอลัมน์ BankAccountNo ยังไม่มี)
  bankAccountNo: string | null
) {
  for (let start = 0; start < lines.length; start += INSERT_BATCH_SIZE) {
    const batch = lines.slice(start, start + INSERT_BATCH_SIZE);
    const request = new sql.Request(transaction);

    request.input('importId', sql.Int, importId);
    request.input('bankCode', sql.NVarChar, bankCode);
    if (bankAccountNo) request.input('bankAccountNo', sql.NVarChar, bankAccountNo);

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
      valueRows.push(
        `(@importId, @bankCode, ${bankAccountNo ? '@bankAccountNo, ' : ''}@d${i}, @de${i}, @db${i}, @cr${i}, @ba${i}, @ch${i}, @cn${i}, @rd${i})`
      );
    });

    await request.query(`
      INSERT INTO BankStatementLine
        (ImportId, BankCode, ${bankAccountNo ? 'BankAccountNo, ' : ''}TranDate, Description, Debit, Credit, Balance, ChequeNo, Channel, RawDescription)
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
  // บัญชีที่ไฟล์นี้เป็นของ — null เมื่อยังไม่ได้รัน sql/006 (ระบบยังทำงานระดับธนาคารแบบเดิม)
  let bankAccountNo: string | null = null;

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'อ่านข้อมูลที่ส่งมาไม่สำเร็จ' }, { status: 400 });
  }

  // ขั้นระบุบัญชี — ต้องทำก่อนแตะไฟล์ เพราะ BankCode ที่ใช้บันทึกจริงต้องมาจาก BankAccountMapping
  // ไม่ใช่ค่าที่ client ส่งมา ไม่งั้นบัญชีกับธนาคารในฐานข้อมูลขัดกันเองได้
  // (เช่นเลือกบัญชี SCB แต่ส่ง bankCode = 'BBL' มา แล้วไฟล์ไปโผล่ผิดธนาคารทั้งใบ)
  try {
    const accountReady = await bankAccountColumnsReady();
    const rawAccount = ((formData.get('bankAccountNo') as string | null) ?? '').trim();
    const rawBankInput = ((formData.get('bankCode') as string | null) ?? '').trim();

    if (accountReady) {
      if (!rawAccount) {
        return NextResponse.json({ error: 'กรุณาเลือกบัญชีธนาคารของไฟล์นี้' }, { status: 400 });
      }
      const account = await resolveBankAccount(rawAccount);
      if (!account?.bankCode) {
        return NextResponse.json({ error: 'ไม่รู้จักบัญชีที่เลือก กรุณาเลือกใหม่' }, { status: 400 });
      }
      if (!VALID_BANKS.includes(account.bankCode as BankCode)) {
        return NextResponse.json(
          { error: `ยังไม่รองรับการอ่านไฟล์ statement ของ ${account.bankCode}` },
          { status: 400 }
        );
      }
      // client ส่ง bankCode มาด้วยเพื่อให้ฝั่ง server จับความไม่ตรงกันได้ ไม่ใช่เพื่อเอาไปใช้
      if (rawBankInput && rawBankInput !== account.bankCode) {
        return NextResponse.json(
          { error: `บัญชีที่เลือกเป็นของ ${account.bankCode} ไม่ใช่ ${rawBankInput}` },
          { status: 400 }
        );
      }
      bankAccountNo = account.bankAccountNo;
      bankCode = account.bankCode;
    } else {
      if (!rawBankInput || !VALID_BANKS.includes(rawBankInput as BankCode)) {
        return NextResponse.json({ error: 'กรุณาเลือกธนาคารให้ถูกต้อง' }, { status: 400 });
      }
      bankCode = rawBankInput;
    }
  } catch (err) {
    console.error('Resolve bank account error:', err);
    return NextResponse.json({ error: 'ตรวจสอบบัญชีธนาคารไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' }, { status: 500 });
  }

  // ขั้นอ่าน/แกะไฟล์ — ผิดพลาดที่นี่คือ input ไม่ถูกต้อง ตอบ 4xx
  try {
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'กรุณาแนบไฟล์' }, { status: 400 });
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

    // บันทึกลง SQL Server ทั้งหมดในทรานแซกชันเดียว
    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      // ให้นำเข้า statement ได้ทีละไฟล์จนจบ transaction — ไม่งั้นสองคนกดนำเข้าไฟล์ที่ข้อมูลซ้ำกันพร้อมกัน
      // ทั้งคู่จะเช็คซ้ำผ่านก่อนที่อีกฝั่งจะ commit แล้วเข้าไปทั้งสองไฟล์
      const lock = await new sql.Request(transaction).query(`
        DECLARE @result INT;
        EXEC @result = sp_getapplock @Resource = 'BankStatementImport', @LockMode = 'Exclusive',
                                     @LockOwner = 'Transaction', @LockTimeout = 30000;
        SELECT @result AS Result;
      `);
      if (Number(lock.recordset[0]?.Result) < 0) {
        throw new ImportBlockedError({ error: 'มีการนำเข้าไฟล์อื่นอยู่ กรุณาลองใหม่อีกครั้ง' }, 409);
      }

      // กันซ้ำด้วยการเทียบระดับรายการ ไม่ใช่ hash ของไฟล์ — ไฟล์ที่ดาวน์โหลดใหม่ / save ใหม่ / เปลี่ยนชื่อ ได้ hash ใหม่
      // ทั้งที่รายการข้างในซ้ำเดิม และบัญชีนำเข้าทับช่วงกันได้ (เช่นทำ 1–15 แล้วรอบหน้าอัปไฟล์ทั้งเดือน)
      // จึงนำเข้าเฉพาะรายการที่ยังไม่มีในระบบ รายการที่มีอยู่แล้ว (รวมที่จับคู่ไปแล้ว) ไม่แตะ
      // FileHash ยังบันทึกไว้เป็นหลักฐาน แต่ไม่ใช้บล็อก: ถ้าลบไฟล์ 1–15 ทิ้งแล้วอัปไฟล์ทั้งเดือนเดิมอีกรอบ
      // hash จะตรงกับรอบ 16–31 ที่ยังอยู่ ทั้งที่รายการ 1–15 ไม่มีในระบบแล้ว
      const overlap = await findOverlapWithImportedLines(
        transaction,
        bankCode,
        lines,
        periodStart,
        periodEnd,
        bankAccountNo
      );
      if (overlap.newLines.length === 0) {
        const sources = overlap.imports
          .map((i) => `${i.fileName} เมื่อ ${formatImportedAt(i.importedAt)}`)
          .join(', ');
        throw new ImportBlockedError(
          {
            error: `ทุกรายการในไฟล์นี้นำเข้าไปแล้ว (${sources}) ไม่มีรายการใหม่ให้นำเข้า`,
            duplicate: true,
            existingImportId: overlap.imports[0]?.importId ?? null,
          },
          409
        );
      }

      // ช่วงวันที่และจำนวนของหัวไฟล์นับตามรายการที่นำเข้าจริง ไม่ใช่ทั้งไฟล์ —
      // หน้า Reconcile ใช้ PeriodStart/PeriodEnd นี้เติมช่วงวันที่ให้ตอนเริ่ม session
      const newLines = overlap.newLines;
      const newDates = newLines.map((l) => l.tranDate).sort();
      const newPeriodStart = newDates[0];
      const newPeriodEnd = newDates[newDates.length - 1];

      const importRequest = new sql.Request(transaction);
      importRequest
        .input('bankCode', sql.NVarChar, bankCode)
        .input('fileName', sql.NVarChar, fileName)
        .input('periodStart', sql.Date, newPeriodStart)
        .input('periodEnd', sql.Date, newPeriodEnd)
        .input('rowCount', sql.Int, newLines.length)
        .input('fileHash', sql.Char(64), fileHash);
      if (bankAccountNo) importRequest.input('bankAccountNo', sql.NVarChar, bankAccountNo);

      const importResult = await importRequest.query(`
          INSERT INTO BankStatementImport
            (BankCode, ${bankAccountNo ? 'BankAccountNo, ' : ''}FileName, PeriodStart, PeriodEnd, ImportedRowCount, FileHash, Status)
          OUTPUT INSERTED.ImportId
          VALUES (@bankCode, ${bankAccountNo ? '@bankAccountNo, ' : ''}@fileName, @periodStart, @periodEnd, @rowCount, @fileHash, 'SUCCESS')
        `);

      const importId = importResult.recordset[0].ImportId;

      await insertLinesInBatches(transaction, importId, bankCode, newLines, bankAccountNo);

      await transaction.commit();

      return NextResponse.json({
        importId,
        bankCode,
        bankAccountNo,
        rowCount: newLines.length,
        skippedCount: overlap.overlapCount,
        periodStart: newPeriodStart,
        periodEnd: newPeriodEnd,
      });
    } catch (err) {
      await transaction.rollback();
      if (err instanceof ImportBlockedError) {
        return NextResponse.json(err.body, { status: err.status });
      }
      throw err;
    }
  } catch (err) {
    console.error('Bank statement import error:', err);
    return NextResponse.json({ error: 'บันทึกข้อมูลลงระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' }, { status: 500 });
  }
}
