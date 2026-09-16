import sql from 'mssql';
import { getPool } from './db';
import { BankAccountOption, extractDisplayNo } from './bankAccounts';

// ส่วนที่ต้องคุยกับฐานข้อมูลของเรื่อง "บัญชีธนาคาร" — แยกจาก lib/bankAccounts.ts
// เพราะไฟล์นั้น component ฝั่ง client import ไปใช้ด้วย จึงห้ามมี mssql ติดไปกับ bundle

const READY_RECHECK_MS = 30_000;

let columnsReady = false;
let lastCheckedAt = 0;

/**
 * รัน sql/006_bank_statement_bank_account.sql ไปแล้วหรือยัง
 *
 * ทุกหน้าที่ใช้มิติ "บัญชี" ต้องเช็คก่อน แล้วถอยไปทำงานแบบเดิม (ทั้งธนาคาร) ถ้ายังไม่ได้รัน
 * ไม่ใช่ปล่อยให้ query พังด้วย error 207 (Invalid column name) แบบที่ 005 ทำ —
 * เพราะฟีเจอร์นี้อยู่บนเส้นทางหลักของการกระทบยอด ไม่ใช่ปุ่มเสริมที่ไม่กดก็ได้
 *
 * ผลลัพธ์ true จำไว้ถาวร (คอลัมน์ที่เพิ่มแล้วไม่หายไปเอง) ส่วน false เช็คซ้ำทุก 30 วินาที
 * เพื่อให้หลังรันสคริปต์แล้วระบบรู้ตัวเองโดยไม่ต้องรีสตาร์ต
 */
export async function bankAccountColumnsReady(): Promise<boolean> {
  if (columnsReady) return true;
  if (Date.now() - lastCheckedAt < READY_RECHECK_MS) return false;

  lastCheckedAt = Date.now();
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT CASE WHEN COL_LENGTH('dbo.BankStatementImport', 'BankAccountNo') IS NOT NULL
                   AND COL_LENGTH('dbo.BankStatementLine', 'BankAccountNo') IS NOT NULL
                   AND COL_LENGTH('dbo.ReconciliationMatch', 'BankAccountNo') IS NOT NULL
                  THEN 1 ELSE 0 END AS Ready
    `);
    columnsReady = Number(result.recordset[0]?.Ready) === 1;
    return columnsReady;
  } catch {
    return false;
  }
}

export const MIGRATION_HINT =
  'ระบบยังไม่ได้แยกตามเลขบัญชี — ต้องรัน sql/006_bank_statement_bank_account.sql กับฐานข้อมูลก่อน';

/**
 * รายชื่อบัญชีทั้งหมดที่ mapping ไว้กับธนาคาร
 *
 * ชื่อบัญชีเอาจาก BankAccountMapping.BankAccountName ก่อน ถ้ายังว่าง (ยังไม่ได้รัน sql/006 STEP 3)
 * ค่อยถอยไปหยิบจากรายการ GL ล่าสุดของบัญชีนั้น — dropdown เลือกบัญชีจึงมีชื่อให้อ่านตั้งแต่ก่อนรันสคริปต์
 */
export async function loadBankAccounts(): Promise<BankAccountOption[]> {
  const pool = await getPool();
  const ready = await bankAccountColumnsReady();

  const result = await pool.request().query(`
    SELECT m.BankAccountNo, m.BankCode,
           COALESCE(NULLIF(LTRIM(RTRIM(m.BankAccountName)), N''), gl.Bank_Account_Name) AS AccountName
           ${ready ? ', COALESCE(imp.ImportCount, 0) AS ImportCount' : ', 0 AS ImportCount'}
    FROM BankAccountMapping m
    OUTER APPLY (
      SELECT TOP 1 e.Bank_Account_Name
      FROM BankAccountLedgerEntries e
      WHERE e.Bank_Account_No = m.BankAccountNo
        AND e.Bank_Account_Name IS NOT NULL AND LTRIM(RTRIM(e.Bank_Account_Name)) <> N''
      ORDER BY e.Entry_No DESC
    ) gl
    ${
      ready
        ? `LEFT JOIN (
             SELECT BankAccountNo, COUNT(*) AS ImportCount
             FROM BankStatementImport
             WHERE Status = 'SUCCESS' AND BankAccountNo IS NOT NULL
             GROUP BY BankAccountNo
           ) imp ON imp.BankAccountNo = m.BankAccountNo`
        : ''
    }
    WHERE m.BankCode IS NOT NULL
    ORDER BY m.BankCode, m.BankAccountNo
  `);

  return result.recordset.map((r) => ({
    bankAccountNo: r.BankAccountNo,
    bankCode: r.BankCode,
    accountName: r.AccountName?.trim() ? r.AccountName.trim() : null,
    displayNo: extractDisplayNo(r.AccountName),
    importCount: Number(r.ImportCount ?? 0),
  }));
}

/**
 * ตรวจว่า bankAccountNo ที่ client ส่งมามีอยู่จริงและอยู่ธนาคารที่รองรับ
 * คืนค่าบัญชีนั้นพร้อม BankCode ที่เชื่อถือได้ — ทุก route ต้องใช้ BankCode จากตรงนี้
 * ไม่ใช่จาก body ของ client เพื่อไม่ให้ bank กับ account ขัดกันในฐานข้อมูล
 */
export async function resolveBankAccount(bankAccountNo: string): Promise<BankAccountOption | null> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('bankAccountNo', sql.NVarChar, bankAccountNo)
    .query(`
      SELECT m.BankAccountNo, m.BankCode,
             COALESCE(NULLIF(LTRIM(RTRIM(m.BankAccountName)), N''), gl.Bank_Account_Name) AS AccountName
      FROM BankAccountMapping m
      OUTER APPLY (
        SELECT TOP 1 e.Bank_Account_Name
        FROM BankAccountLedgerEntries e
        WHERE e.Bank_Account_No = m.BankAccountNo
          AND e.Bank_Account_Name IS NOT NULL AND LTRIM(RTRIM(e.Bank_Account_Name)) <> N''
        ORDER BY e.Entry_No DESC
      ) gl
      WHERE m.BankAccountNo = @bankAccountNo AND m.BankCode IS NOT NULL
    `);

  const row = result.recordset[0];
  if (!row) return null;
  return {
    bankAccountNo: row.BankAccountNo,
    bankCode: row.BankCode,
    accountName: row.AccountName?.trim() ? row.AccountName.trim() : null,
    displayNo: extractDisplayNo(row.AccountName),
  };
}
