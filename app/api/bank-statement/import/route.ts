import { NextRequest, NextResponse } from 'next/server';
import sql from 'mssql';
import crypto from 'crypto';
import { getPool } from '../../../../lib/db';
import { parseBankStatement, BankCode, NormalizedStatementLine } from '../../../../lib/bankParsers/index';
import { readStatementRows, MAX_FILE_BYTES, MAX_IMPORT_ROWS } from '../../../../lib/bankParsers/workbook';
import { requireRole } from '../../../../lib/session';
import { RECONCILE_ROLES } from '../../../../lib/roles';
import { findOverlapWithImportedLines, type LineToUpdate } from '../../../../lib/bankStatementOverlap';
import { bankAccountColumnsReady, CLOSED_ACCOUNT_ERROR, resolveBankAccount, statementSenderColumnsReady } from '../../../../lib/bankAccountDb';
import { assertDatesOpen, isoDate, PeriodClosedError, reconcilePeriodCloseReady } from '../../../../lib/periodClose';
import { readWorkPermissions } from '../../../../lib/workRolesDb';
import { filterLinesBySide, IMPORT_SIDE_LABELS, resolveImportSide, type ImportSide } from '../../../../lib/importSide';

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
// รวมเป็นชุดละ 150 แถวทำให้เหลือไม่กี่รอบ ยังอยู่ใต้เพดานของ SQL Server ทั้งสองข้อ:
// 1,000 แถวต่อ VALUES clause และ 2,100 พารามิเตอร์ต่อคำสั่ง (สูงสุด 11 ตัว/แถว × 150 = 1,650)
const INSERT_BATCH_SIZE = 150;

async function insertLinesInBatches(
  transaction: sql.Transaction,
  importId: number,
  bankCode: string,
  lines: NormalizedStatementLine[],
  // บัญชีของไฟล์นี้ — null เมื่อยังไม่ได้รัน sql/006 (คอลัมน์ BankAccountNo ยังไม่มี)
  bankAccountNo: string | null,
  // รัน sql/013_bank_statement_sender_columns.sql แล้วหรือยัง
  hasSenderColumns: boolean
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
      if (hasSenderColumns) {
        request.input(`sb${i}`, sql.NVarChar(50), line.senderBank ?? null);
        request.input(`sa${i}`, sql.NVarChar(50), line.senderAccountNo ?? null);
        request.input(`sn${i}`, sql.NVarChar(255), line.senderAccountName ?? null);
      }
      // ชื่อพารามิเตอร์ทั้งหมดสร้างจาก index ของเราเอง ไม่ได้มาจาก input ของผู้ใช้
      valueRows.push(
        `(@importId, @bankCode, ${bankAccountNo ? '@bankAccountNo, ' : ''}@d${i}, @de${i}, @db${i}, @cr${i}, @ba${i}, @ch${i}, @cn${i}, @rd${i}${hasSenderColumns ? `, @sb${i}, @sa${i}, @sn${i}` : ''})`
      );
    });

    await request.query(`
      INSERT INTO BankStatementLine
        (ImportId, BankCode, ${bankAccountNo ? 'BankAccountNo, ' : ''}TranDate, Description, Debit, Credit, Balance, ChequeNo, Channel, RawDescription${hasSenderColumns ? ', SenderBank, SenderAccountNo, SenderAccountName' : ''})
      VALUES ${valueRows.join(', ')}
    `);
  }
}

// อัปเดตเฉพาะค่า Debit และ Credit ของแถวเดิมในฐานข้อมูลที่เคยถูกนำเข้าไว้เป็น NULL
// โดยใช้คีย์ (LineId + TranDate + Balance) เพื่อไม่ให้อัปเดตผิดแถว และไม่แตะต้อง MatchStatus เด็ดขาด
async function updateLinesInBatches(
  transaction: sql.Transaction,
  linesToUpdate: LineToUpdate[]
) {
  for (let start = 0; start < linesToUpdate.length; start += INSERT_BATCH_SIZE) {
    const batch = linesToUpdate.slice(start, start + INSERT_BATCH_SIZE);
    const request = new sql.Request(transaction);

    const valueRows: string[] = [];
    batch.forEach((item, i) => {
      request.input(`id${i}`, sql.Int, item.lineId);
      request.input(`d${i}`, sql.Date, item.line.tranDate);
      request.input(`db${i}`, sql.Decimal(18, 2), item.line.debit);
      request.input(`cr${i}`, sql.Decimal(18, 2), item.line.credit);
      request.input(`ba${i}`, sql.Decimal(18, 2), item.line.balance);
      valueRows.push(`(@id${i}, @d${i}, @db${i}, @cr${i}, @ba${i})`);
    });

    await request.query(`
      UPDATE l
      SET l.Debit = v.Debit,
          l.Credit = v.Credit
      FROM BankStatementLine l
      JOIN (VALUES ${valueRows.join(', ')}) AS v(LineId, TranDate, Debit, Credit, Balance)
        ON l.LineId = v.LineId
       AND l.TranDate = v.TranDate
       AND (l.Balance = v.Balance OR (l.Balance IS NULL AND v.Balance IS NULL))
      WHERE l.MatchStatus <> 'DELETED'
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

  // ฝั่งที่นำเข้าตามสิทธิ์ AP/AR (ดู lib/importSide.ts) — ตรวจก่อนอ่านไฟล์ คนไม่มีสิทธิ์ไม่ต้องรออัปโหลดก่อนโดนปฏิเสธ
  let importSide: ImportSide;
  try {
    const resolved = resolveImportSide(await readWorkPermissions(auth.session), formData.get('side'));
    if ('error' in resolved) return NextResponse.json({ error: resolved.error }, { status: resolved.status });
    importSide = resolved.side;
  } catch (err) {
    console.error('Resolve import side error:', err);
    return NextResponse.json({ error: 'ตรวจสอบสิทธิ์การนำเข้าไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' }, { status: 500 });
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
      if (account.isActive === false) {
        return NextResponse.json({ error: CLOSED_ACCOUNT_ERROR }, { status: 409 });
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

  // เก็บเฉพาะรายการของฝั่งที่นำเข้า — อีกฝั่งนำเข้าไฟล์เดียวกันซ้ำได้ภายหลัง กันซ้ำระดับรายการจะเข้าเฉพาะของเขา
  // periodStart/periodEnd ยังเป็นช่วงของทั้งไฟล์ ใช้กว้างพอสำหรับเทียบรายการซ้ำ
  const sideLines = filterLinesBySide(lines, importSide);
  const otherSideCount = lines.length - sideLines.length;
  if (sideLines.length === 0) {
    return NextResponse.json({ error: `ไฟล์นี้ไม่มีรายการ${IMPORT_SIDE_LABELS[importSide]}ให้นำเข้า` }, { status: 400 });
  }
  lines = sideLines;

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
      if (overlap.newLines.length === 0 && overlap.linesToUpdate.length === 0) {
        await transaction.rollback();
        const sources = overlap.imports
          .map((i) => `${i.fileName} เมื่อ ${formatImportedAt(i.importedAt)}`)
          .join(', ');
        return NextResponse.json({
          importId: overlap.imports[0]?.importId ?? null,
          bankCode,
          bankAccountNo,
          rowCount: 0,
          updatedCount: 0,
          skippedCount: overlap.overlapCount,
          side: importSide,
          otherSideCount: 0,
          periodStart,
          periodEnd,
          message: `ไม่มีรายการใหม่ให้นำเข้า ทุกรายการในไฟล์นี้มีอยู่ในระบบแล้ว (${sources})`,
        });
      }

      const newLines = overlap.newLines;
      const linesToUpdate = overlap.linesToUpdate;

      if (linesToUpdate.length > 0) {
        await updateLinesInBatches(transaction, linesToUpdate);
      }

      let importId: number | null = overlap.imports[0]?.importId ?? linesToUpdate[0]?.importId ?? null;
      let activePeriodStart = periodStart;
      let activePeriodEnd = periodEnd;

      if (newLines.length > 0) {
        if (bankAccountNo && await reconcilePeriodCloseReady()) {
          await assertDatesOpen(transaction, bankAccountNo, newLines.map((l) => ({
            date: isoDate(l.tranDate), direction: l.credit !== null ? 'IN' : 'OUT',
          })));
        }
        const newDates = newLines.map((l) => l.tranDate).sort();
        const newPeriodStart = newDates[0];
        const newPeriodEnd = newDates[newDates.length - 1];
        activePeriodStart = newPeriodStart;
        activePeriodEnd = newPeriodEnd;

        const hasSenderColumns = await statementSenderColumnsReady();
        const sameFileImport = overlap.imports.find(
          (i) => i.fileName.trim().toLowerCase() === fileName.trim().toLowerCase()
        );

        if (sameFileImport) {
          importId = sameFileImport.importId;
          await insertLinesInBatches(transaction, importId, bankCode, newLines, bankAccountNo, hasSenderColumns);

          const updateImportRequest = new sql.Request(transaction);
          updateImportRequest
            .input('importId', sql.Int, importId)
            .input('periodStart', sql.Date, newPeriodStart)
            .input('periodEnd', sql.Date, newPeriodEnd)
            .input('fileHash', sql.Char(64), fileHash);

          await updateImportRequest.query(`
            UPDATE BankStatementImport
            SET ImportedRowCount = (
                  SELECT COUNT(*) FROM BankStatementLine
                  WHERE ImportId = @importId AND MatchStatus <> 'DELETED'
                ),
                PeriodStart = CASE WHEN @periodStart < PeriodStart THEN @periodStart ELSE PeriodStart END,
                PeriodEnd = CASE WHEN @periodEnd > PeriodEnd THEN @periodEnd ELSE PeriodEnd END,
                FileHash = @fileHash
            WHERE ImportId = @importId
          `);
        } else {
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

          importId = importResult.recordset[0].ImportId as number;
          await insertLinesInBatches(transaction, importId, bankCode, newLines, bankAccountNo, hasSenderColumns);
        }
      }

      await transaction.commit();

      return NextResponse.json({
        importId,
        bankCode,
        bankAccountNo,
        rowCount: newLines.length,
        updatedCount: linesToUpdate.length,
        skippedCount: overlap.overlapCount,
        side: importSide,
        // รายการของอีกฝั่งที่ไม่ได้นำเข้ารอบนี้ (เป็นงานของอีกทีม)
        otherSideCount,
        periodStart: activePeriodStart,
        periodEnd: activePeriodEnd,
      });
    } catch (err) {
      await transaction.rollback();
      if (err instanceof PeriodClosedError) {
        return NextResponse.json({ error: err.message }, { status: 409 });
      }
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
