import sql from 'mssql';
import { getPool } from './db';

/**
 * งวดล่าสุดที่มีข้อมูลให้ดูจริง
 *
 * ปัญหาที่แก้: หน้าภาพรวม หน้ารายงาน และหน้าประวัติการจับคู่ ตั้งค่าเริ่มต้นเป็นเดือนปัจจุบัน
 * (ประวัติการจับคู่ใช้เดือนก่อนหน้า) ซึ่งมักยังไม่มีข้อมูล ผู้ใช้จึงเปิดมาเจอจอว่างทุกครั้ง
 * แล้วต้องไล่เปลี่ยนวันที่เองก่อนจะเห็นอะไร ทั้งที่งานกระทบยอดคือการปิดงวดที่ผ่านมาแล้ว
 *
 * ยึดวันที่ฝั่งรายการเดินบัญชีธนาคารเป็นหลัก เพราะงานกระทบยอดเริ่มจากไฟล์ statement
 * ถ้ายังไม่มี statement เลยค่อยถอยไปดูวันที่ฝั่ง BC365
 */

export type LatestPeriod = {
  month: string; // 'YYYY-MM'
  from: string;  // วันแรกของเดือน
  to: string;    // วันสุดท้ายของเดือน
  source: 'BANK' | 'GL';
};

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

/** ครอบทั้งเดือนของวันที่ที่ให้มา — คิดแบบ UTC ให้ตรงกับที่ sql.Date ส่งกลับมา */
export function monthBounds(d: Date): { month: string; from: string; to: string } {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const last = new Date(Date.UTC(y, m + 1, 0));
  return {
    month: `${y}-${pad2(m + 1)}`,
    from: `${y}-${pad2(m + 1)}-01`,
    to: `${y}-${pad2(m + 1)}-${pad2(last.getUTCDate())}`,
  };
}

export async function loadLatestPeriod(bankAccountNo: string | null): Promise<LatestPeriod | null> {
  const pool = await getPool();
  const request = pool.request();
  if (bankAccountNo) request.input('bankAccountNo', sql.NVarChar, bankAccountNo);

  // ถามทีเดียวทั้งสองฝั่ง ไม่ต้องวิ่งไป-กลับ 2 รอบ
  const result = await request.query(`
    SELECT
      (SELECT MAX(TranDate) FROM BankStatementLine
        WHERE MatchStatus <> 'DELETED'
          ${bankAccountNo ? 'AND BankAccountNo = @bankAccountNo' : ''}) AS BankLatest,
      (SELECT MAX(e.Posting_Date) FROM BankAccountLedgerEntries e
        JOIN BankAccountMapping m ON m.BankAccountNo = e.Bank_Account_No
        WHERE m.BankCode IS NOT NULL
          ${bankAccountNo ? 'AND e.Bank_Account_No = @bankAccountNo' : ''}) AS GlLatest
  `);

  const row = result.recordset[0];
  const bankLatest = row?.BankLatest ? new Date(row.BankLatest) : null;
  const glLatest = row?.GlLatest ? new Date(row.GlLatest) : null;

  if (bankLatest && !Number.isNaN(bankLatest.getTime())) {
    return { ...monthBounds(bankLatest), source: 'BANK' };
  }
  if (glLatest && !Number.isNaN(glLatest.getTime())) {
    return { ...monthBounds(glLatest), source: 'GL' };
  }
  return null;
}
