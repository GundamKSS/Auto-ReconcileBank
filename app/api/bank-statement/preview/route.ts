import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '../../../../lib/db';
import { parseBankStatement, BankCode, NormalizedStatementLine } from '../../../../lib/bankParsers/index';
import { readStatementRows, MAX_FILE_BYTES, MAX_IMPORT_ROWS } from '../../../../lib/bankParsers/workbook';
import { requireRole } from '../../../../lib/session';
import { RECONCILE_ROLES } from '../../../../lib/roles';
import { findOverlapWithImportedLines } from '../../../../lib/bankStatementOverlap';
import { bankAccountColumnsReady, resolveBankAccount } from '../../../../lib/bankAccountDb';

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
  let file: File;
  let bankCode: string;
  // บัญชีที่ผู้ใช้เลือกไว้ใน dropdown — null เมื่อยังไม่ได้รัน sql/006
  let bankAccountNo: string | null = null;
  let accountName: string | null = null;

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'อ่านข้อมูลที่ส่งมาไม่สำเร็จ' }, { status: 400 });
  }

  // ขั้นระบุบัญชี — ตรวจให้ตรงกันแบบเดียวกับตอนนำเข้าจริง (ดู import/route.ts) เพื่อให้หน้า preview
  // ไม่แสดงผลที่คำนวณจากบัญชีหนึ่งแล้วตอนกดนำเข้าจริงกลับถูกปฏิเสธด้วยเหตุผลคนละอย่าง
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
      if (rawBankInput && rawBankInput !== account.bankCode) {
        return NextResponse.json(
          { error: `บัญชีที่เลือกเป็นของ ${account.bankCode} ไม่ใช่ ${rawBankInput}` },
          { status: 400 }
        );
      }
      bankAccountNo = account.bankAccountNo;
      accountName = account.accountName;
      bankCode = account.bankCode;
    } else {
      if (!rawBankInput || !VALID_BANKS.includes(rawBankInput as BankCode)) {
        return NextResponse.json({ error: 'ยังไม่รองรับธนาคารนี้' }, { status: 400 });
      }
      bankCode = rawBankInput;
    }
  } catch (err) {
    console.error('Resolve bank account error:', err);
    return NextResponse.json({ error: 'ตรวจสอบบัญชีธนาคารไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' }, { status: 500 });
  }

  // แยกขั้น "อ่าน/แกะไฟล์" ออกจากขั้น "คุยกับฐานข้อมูล" เพราะสองอย่างนี้ผิดพลาดคนละสาเหตุกัน
  // ไฟล์ผิดรูปแบบคือความผิดของ input (400) ส่วน DB ล่มคือความผิดของระบบ (500)
  try {
    const rawFile = formData.get('file') as File | null;

    if (!rawFile) {
      return NextResponse.json({ error: 'กรุณาแนบไฟล์' }, { status: 400 });
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

    const fileBuffer = Buffer.from(await file.arrayBuffer());

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
    const overlap = await findOverlapWithImportedLines(
      pool,
      bankCode,
      lines,
      periodStart,
      periodEnd,
      bankAccountNo
    );
    const newDates = overlap.newLines.map((l) => l.tranDate).sort();

    const periodDays = daysBetween(periodStart, periodEnd);

    return NextResponse.json({
      bankCode,
      bankAccountNo,
      accountName,
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
        // รายการที่นำเข้าไว้แล้ว (แม้ชื่อไฟล์หรือ hash ต่างกัน) — ตอนนำเข้าจะข้ามไป และบันทึกเฉพาะ newCount รายการ
        overlap:
          overlap.overlapCount > 0
            ? {
                overlapCount: overlap.overlapCount,
                newCount: overlap.newLines.length,
                newPeriodStart: newDates[0] ?? null,
                newPeriodEnd: newDates[newDates.length - 1] ?? null,
                imports: overlap.imports,
              }
            : null,
      },
    });
  } catch (err) {
    console.error('Bank statement preview error:', err);
    return NextResponse.json({ error: 'ตรวจสอบไฟล์กับฐานข้อมูลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' }, { status: 500 });
  }
}
