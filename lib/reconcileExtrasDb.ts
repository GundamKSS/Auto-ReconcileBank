import { getPool } from './db';

// รัน sql/007_match_remark_opening_balance.sql ไปแล้วหรือยัง — แพทเทิร์นเดียวกับ bankAccountColumnsReady
// true จำไว้ถาวร ส่วน false เช็คซ้ำทุก 30 วินาที หลังรันสคริปต์จึงใช้งานได้ทันทีโดยไม่ต้องรีสตาร์ต

const READY_RECHECK_MS = 30_000;

let ready = false;
let lastCheckedAt = 0;

export async function reconcileExtrasReady(): Promise<boolean> {
  if (ready) return true;
  if (Date.now() - lastCheckedAt < READY_RECHECK_MS) return false;

  lastCheckedAt = Date.now();
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT CASE WHEN COL_LENGTH('dbo.ReconciliationMatch', 'Remark') IS NOT NULL
                   AND OBJECT_ID('dbo.ReconciliationOpeningBalance', 'U') IS NOT NULL
                  THEN 1 ELSE 0 END AS Ready
    `);
    ready = Number(result.recordset[0]?.Ready) === 1;
    return ready;
  } catch {
    return false;
  }
}

export const EXTRAS_MIGRATION_HINT =
  'ต้องรัน sql/007_match_remark_opening_balance.sql กับฐานข้อมูลก่อน จึงจะใช้ฟีเจอร์นี้ได้';

