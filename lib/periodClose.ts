import sql from 'mssql';
import { getPool } from './db';

// รัน sql/008_period_close.sql ไปแล้วหรือยัง — แพทเทิร์นเดียวกับ reconcileExtrasReady
const READY_RECHECK_MS = 30_000;

let ready = false;
let lastCheckedAt = 0;

export async function reconcilePeriodCloseReady(): Promise<boolean> {
  if (ready) return true;
  if (Date.now() - lastCheckedAt < READY_RECHECK_MS) return false;

  lastCheckedAt = Date.now();
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT CASE WHEN OBJECT_ID('dbo.ReconciliationPeriodClose', 'U') IS NOT NULL
                  THEN 1 ELSE 0 END AS Ready
    `);
    ready = Number(result.recordset[0]?.Ready) === 1;
    return ready;
  } catch {
    return false;
  }
}

export const PERIOD_CLOSE_MIGRATION_HINT =
  'ต้องรัน sql/008_period_close.sql กับฐานข้อมูลก่อน จึงจะใช้ฟีเจอร์ปิดงวดได้';

export function isoDate(d: Date | string): string {
  return new Date(d).toISOString().slice(0, 10);
}

// รายการที่พยายามแก้ไขอยู่ในงวดที่ปิดแล้ว — โยนจาก assertDatesOpen แล้ว route รับไปตอบ 409 ด้วย err.message
// เหมือน Error ธรรมดาที่ route เหล่านี้ throw กันเองอยู่แล้วตอนเจอเงื่อนไขทางธุรกิจ (ดู DeleteBlockedError
// ใน imports/[importId]/route.ts)
export class PeriodClosedError extends Error {}

type ClosedPeriodRow = { PeriodStart: Date | string; PeriodEnd: Date | string; ClosedBy: string; ClosedAt: Date };
export type ClosedPeriodRange = { periodStart: string; periodEnd: string; closedBy: string };

/**
 * ตรรกะส่วนที่ตรวจจริง — แยกเป็นฟังก์ชัน pure ออกมาจาก assertDatesOpen เพื่อให้เทสได้โดยไม่ต้องต่อ DB
 * คืนงวดที่ปิดแล้วและบล็อก (แถวแรกที่ชน) หรือ null ถ้าไม่มีวันที่ไหนชนงวดที่ปิดเลย
 */
export function findBlockingClosedPeriod(dates: string[], closedPeriods: ClosedPeriodRange[]): ClosedPeriodRange | null {
  for (const period of closedPeriods) {
    if (dates.some((d) => d >= period.periodStart && d <= period.periodEnd)) return period;
  }
  return null;
}

/**
 * เช็คว่าวันที่ที่กำลังจะแก้ไข (TranDate ของ Bank / Posting_Date ของ GL) ตกอยู่ในงวดที่ปิดแล้วของบัญชีนี้
 * หรือไม่ — เรียกก่อนเขียนจริงทุกจุดที่แก้ข้อมูลกระทบยอด (Match/Unmatch/Un-suspend/ยอดยกมา/ลบไฟล์)
 *
 * ดึงทุกแถวที่ Status='CLOSED' ของบัญชีนั้นมาเช็คใน JS แทนสร้าง dynamic SQL/table-valued parameter
 * เพราะปกติมีไม่กี่สิบแถวต่อบัญชี (1 แถวต่อเดือนที่ปิด) เร็วกว่าและอ่านง่ายกว่า
 */
export async function assertDatesOpen(
  connection: sql.ConnectionPool | sql.Transaction,
  bankAccountNo: string,
  dates: string[]
): Promise<void> {
  if (dates.length === 0) return;
  const req = connection instanceof sql.Transaction ? new sql.Request(connection) : new sql.Request(connection);
  const result = await req.input('acc_pc', sql.NVarChar, bankAccountNo).query(`
    SELECT PeriodStart, PeriodEnd, ClosedBy, ClosedAt
    FROM ReconciliationPeriodClose
    WHERE BankAccountNo = @acc_pc AND Status = 'CLOSED'
  `);

  const closedPeriods = (result.recordset as ClosedPeriodRow[]).map((row) => ({
    periodStart: isoDate(row.PeriodStart),
    periodEnd: isoDate(row.PeriodEnd),
    closedBy: row.ClosedBy,
  }));
  const blocking = findBlockingClosedPeriod(dates, closedPeriods);
  if (blocking) {
    throw new PeriodClosedError(
      `งวด ${blocking.periodStart} ถึง ${blocking.periodEnd} ของบัญชีนี้ปิดแล้ว (ปิดโดย ${blocking.closedBy}) — ` +
        'ต้องเปิดงวดนี้ก่อนจึงจะแก้ไขได้'
    );
  }
}
