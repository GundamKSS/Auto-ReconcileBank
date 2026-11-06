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

let statusReady = false;
let statusLastCheckedAt = 0;

/** รัน sql/012_bank_account_status.sql แล้วหรือยัง — cache แบบเดียวกับ bankAccountColumnsReady */
export async function bankAccountStatusReady(): Promise<boolean> {
  if (statusReady) return true;
  if (Date.now() - statusLastCheckedAt < READY_RECHECK_MS) return false;

  statusLastCheckedAt = Date.now();
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT CASE WHEN COL_LENGTH('dbo.BankAccountMapping', 'IsActive') IS NOT NULL
                   AND COL_LENGTH('dbo.BankAccountMapping', 'CreatedBy') IS NOT NULL
                   AND COL_LENGTH('dbo.BankAccountMapping', 'StatusChangedAt') IS NOT NULL
                   AND COL_LENGTH('dbo.BankAccountMapping', 'StatusChangedBy') IS NOT NULL
                  THEN 1 ELSE 0 END AS Ready
    `);
    statusReady = Number(result.recordset[0]?.Ready) === 1;
    return statusReady;
  } catch {
    return false;
  }
}

export const STATUS_MIGRATION_HINT =
  'ยังเปลี่ยนสถานะบัญชีไม่ได้ — ต้องรัน sql/012_bank_account_status.sql กับฐานข้อมูลก่อน';

export const CLOSED_ACCOUNT_ERROR = 'บัญชีนี้ปิดแล้ว นำเข้า statement ไม่ได้ — หากต้องใช้งานต่อ ให้ผู้ดูแลเปิดบัญชีในหน้าจัดการข้อมูล · บัญชีธนาคาร';

let senderColumnsReady = false;
let senderLastCheckedAt = 0;

/** รัน sql/013_bank_statement_sender_columns.sql แล้วหรือยัง — cache แบบเดียวกับ bankAccountColumnsReady */
export async function statementSenderColumnsReady(): Promise<boolean> {
  if (senderColumnsReady) return true;
  if (Date.now() - senderLastCheckedAt < READY_RECHECK_MS) return false;

  senderLastCheckedAt = Date.now();
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT CASE WHEN COL_LENGTH('dbo.BankStatementLine', 'SenderBank') IS NOT NULL
                   AND COL_LENGTH('dbo.BankStatementLine', 'SenderAccountNo') IS NOT NULL
                   AND COL_LENGTH('dbo.BankStatementLine', 'SenderAccountName') IS NOT NULL
                  THEN 1 ELSE 0 END AS Ready
    `);
    senderColumnsReady = Number(result.recordset[0]?.Ready) === 1;
    return senderColumnsReady;
  } catch {
    return false;
  }
}

/**
 * รายชื่อบัญชีทั้งหมดที่ mapping ไว้กับธนาคาร
 *
 * ชื่อบัญชีเอาจาก BankAccountMapping.BankAccountName ก่อน ถ้ายังว่าง (ยังไม่ได้รัน sql/006 STEP 3)
 * ค่อยถอยไปหยิบจากรายการ GL ล่าสุดของบัญชีนั้น — dropdown เลือกบัญชีจึงมีชื่อให้อ่านตั้งแต่ก่อนรันสคริปต์
 */
export async function loadBankAccounts(): Promise<BankAccountOption[]> {
  const pool = await getPool();
  const [ready, hasStatus] = await Promise.all([bankAccountColumnsReady(), bankAccountStatusReady()]);

  const result = await pool.request().query(`
    SELECT m.BankAccountNo, m.BankCode,
           COALESCE(NULLIF(LTRIM(RTRIM(m.BankAccountName)), N''), gl.Bank_Account_Name) AS AccountName
           ${ready ? ', COALESCE(imp.ImportCount, 0) AS ImportCount' : ', 0 AS ImportCount'}
           ${hasStatus ? ', m.IsActive' : ', CAST(1 AS BIT) AS IsActive'}
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
    isActive: Boolean(r.IsActive),
  }));
}

/**
 * ตรวจว่า bankAccountNo ที่ client ส่งมามีอยู่จริงและอยู่ธนาคารที่รองรับ
 * คืนค่าบัญชีนั้นพร้อม BankCode ที่เชื่อถือได้ — ทุก route ต้องใช้ BankCode จากตรงนี้
 * ไม่ใช่จาก body ของ client เพื่อไม่ให้ bank กับ account ขัดกันในฐานข้อมูล
 */
export async function resolveBankAccount(bankAccountNo: string): Promise<BankAccountOption | null> {
  const pool = await getPool();
  const hasStatus = await bankAccountStatusReady();
  const result = await pool
    .request()
    .input('bankAccountNo', sql.NVarChar, bankAccountNo)
    .query(`
      SELECT m.BankAccountNo, m.BankCode,
             COALESCE(NULLIF(LTRIM(RTRIM(m.BankAccountName)), N''), gl.Bank_Account_Name) AS AccountName,
             ${hasStatus ? 'm.IsActive' : 'CAST(1 AS BIT) AS IsActive'}
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
    isActive: Boolean(row.IsActive),
  };
}

export type AccountFilterResult =
  | { ok: true; bankAccountNo: string | null; bankCode: string | null; ignoredReason: string | null }
  | { ok: false; error: string };

/**
 * ตรวจค่า bankAccountNo ที่หน้า Reports/Dashboard ส่งมา ก่อนเอาไปใส่ในตัวกรองของรีพอร์ต
 *
 * - ไม่ได้ส่งมา = ไม่กรองตามบัญชี (ดูทั้งธนาคารเหมือนเดิม)
 * - ยังไม่ได้รัน sql/006 = ไม่กรอง แต่บอกเหตุผลกลับไป ให้หน้าจอแจ้งผู้ใช้ได้ว่าทำไมยังแคบไม่ได้
 *   (ดีกว่าปล่อยให้ query พังด้วย Invalid column name)
 * - ส่งเลขบัญชีที่ไม่มีอยู่จริง = ตอบ 400 ไม่ใช่เงียบๆ คืนรายงานของทั้งธนาคาร
 *   เพราะผู้ใช้จะเข้าใจว่านั่นคือยอดของบัญชีที่เลือก
 *
 * BankCode คืนมาจาก mapping เสมอ ไม่เชื่อค่าที่ client ส่ง — กันกรณีเลือกบัญชี BBL
 * แต่ปุ่มธนาคารค้างอยู่ที่ SCB แล้วได้รายงานว่างโดยไม่รู้สาเหตุ
 */
export async function resolveAccountFilter(bankAccountNo: string | null): Promise<AccountFilterResult> {
  if (!bankAccountNo) {
    return { ok: true, bankAccountNo: null, bankCode: null, ignoredReason: null };
  }

  if (!(await bankAccountColumnsReady())) {
    return { ok: true, bankAccountNo: null, bankCode: null, ignoredReason: MIGRATION_HINT };
  }

  const account = await resolveBankAccount(bankAccountNo);
  if (!account) {
    return { ok: false, error: `ไม่พบบัญชีธนาคาร ${bankAccountNo}` };
  }

  return { ok: true, bankAccountNo: account.bankAccountNo, bankCode: account.bankCode, ignoredReason: null };
}

export type BankAccountAdminRow = BankAccountOption & {
  createdAt: string | null;
  createdBy: string | null;
  statusChangedAt: string | null;
  statusChangedBy: string | null;
  glEntryCount: number;
};

/** รายชื่อบัญชีสำหรับหน้า /master-data/bank-accounts — มีข้อมูล audit ที่ dropdown ทั่วไปไม่ต้องใช้ */
export async function loadBankAccountAdminList(): Promise<BankAccountAdminRow[]> {
  const pool = await getPool();
  const [base, hasStatus] = await Promise.all([loadBankAccounts(), bankAccountStatusReady()]);

  const result = await pool.request().query(`
    SELECT m.BankAccountNo, m.CreatedAt,
           ${hasStatus ? 'm.CreatedBy, m.StatusChangedAt, m.StatusChangedBy' : 'NULL AS CreatedBy, NULL AS StatusChangedAt, NULL AS StatusChangedBy'},
           (SELECT COUNT(*) FROM BankAccountLedgerEntries e WHERE e.Bank_Account_No = m.BankAccountNo) AS GlEntryCount
    FROM BankAccountMapping m
    WHERE m.BankCode IS NOT NULL
  `);
  const extra = new Map(result.recordset.map((r) => [r.BankAccountNo as string, r]));

  return base.map((account) => {
    const r = extra.get(account.bankAccountNo);
    return {
      ...account,
      createdAt: r?.CreatedAt ? new Date(r.CreatedAt).toISOString() : null,
      createdBy: r?.CreatedBy ?? null,
      statusChangedAt: r?.StatusChangedAt ? new Date(r.StatusChangedAt).toISOString() : null,
      statusChangedBy: r?.StatusChangedBy ?? null,
      glEntryCount: Number(r?.GlEntryCount ?? 0),
    };
  });
}

export type UnmappedGlAccount = { bankAccountNo: string; accountName: string | null; displayNo: string | null; entryCount: number };

/**
 * รหัสบัญชีที่มีรายการใน GL (BC365) แต่ยังไม่ได้ผูกใน BankAccountMapping — ตัวเลือกตอนเพิ่มบัญชีใหม่
 *
 * เอาเฉพาะชื่อบัญชีที่มี '#เลขบัญชี' ต่อท้าย (บัญชีธนาคารจริงตั้งชื่อแบบนี้ทุกบัญชี)
 * เพื่อตัดบัญชีที่ไม่ใช่ธนาคารอย่าง 'PDC - R' (เช็ครับล่วงหน้า) และ 'TRANSFER' (บัญชีพักโอน) ออก
 */
export async function loadUnmappedGlAccounts(): Promise<UnmappedGlAccount[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT e.Bank_Account_No AS BankAccountNo, COUNT(*) AS EntryCount,
           (SELECT TOP 1 x.Bank_Account_Name FROM BankAccountLedgerEntries x
             WHERE x.Bank_Account_No = e.Bank_Account_No
               AND x.Bank_Account_Name IS NOT NULL AND LTRIM(RTRIM(x.Bank_Account_Name)) <> N''
             ORDER BY x.Entry_No DESC) AS AccountName
    FROM BankAccountLedgerEntries e
    WHERE e.Bank_Account_No IS NOT NULL AND LTRIM(RTRIM(e.Bank_Account_No)) <> N''
      AND NOT EXISTS (SELECT 1 FROM BankAccountMapping m WHERE m.BankAccountNo = e.Bank_Account_No)
    GROUP BY e.Bank_Account_No
    ORDER BY e.Bank_Account_No
  `);

  return result.recordset
    .map((r) => ({
      bankAccountNo: r.BankAccountNo as string,
      accountName: r.AccountName?.trim() ? r.AccountName.trim() : null,
      displayNo: extractDisplayNo(r.AccountName),
      entryCount: Number(r.EntryCount ?? 0),
    }))
    .filter((a) => a.displayNo !== null);
}

export class BankAccountInputError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

/**
 * ผูกรหัสบัญชีจาก GL เข้ากับธนาคาร — รับเฉพาะรหัสที่อยู่ในรายการ loadUnmappedGlAccounts
 * ชื่อบัญชีเอาจาก GL ไม่รับจาก client เพื่อให้เลขบัญชีที่แกะจาก '#' ตรงกับ BC365 เสมอ
 */
export async function createBankAccount(bankAccountNo: string, bankCode: string, actor: string): Promise<void> {
  const candidate = (await loadUnmappedGlAccounts()).find((a) => a.bankAccountNo === bankAccountNo);
  if (!candidate) {
    throw new BankAccountInputError('รหัสบัญชีนี้ผูกไว้แล้ว หรือไม่มีรายการใน BC365 กรุณาโหลดรายการใหม่', 409);
  }

  const pool = await getPool();
  const hasStatus = await bankAccountStatusReady();
  try {
    await pool
      .request()
      .input('no', sql.NVarChar(50), candidate.bankAccountNo)
      .input('bank', sql.NVarChar(50), bankCode)
      .input('name', sql.NVarChar(255), candidate.accountName)
      .input('actor', sql.NVarChar(100), actor)
      .query(`
        INSERT INTO BankAccountMapping (BankAccountNo, BankCode, BankAccountName${hasStatus ? ', IsActive, CreatedBy' : ''})
        VALUES (@no, @bank, @name${hasStatus ? ', 1, @actor' : ''})
      `);
  } catch (err) {
    // 2627 = PK ซ้ำ — มีคนเพิ่มบัญชีเดียวกันไปพร้อมกัน
    if ((err as { number?: number }).number === 2627) {
      throw new BankAccountInputError('รหัสบัญชีนี้ผูกไว้แล้ว', 409);
    }
    throw err;
  }
}

/** เปิด/ปิดบัญชี — ต้องรัน sql/012 แล้ว คืน false ถ้าไม่พบบัญชี */
export async function setBankAccountActive(bankAccountNo: string, isActive: boolean, actor: string): Promise<boolean> {
  if (!(await bankAccountStatusReady())) {
    throw new BankAccountInputError(STATUS_MIGRATION_HINT, 409);
  }
  const pool = await getPool();
  const result = await pool
    .request()
    .input('no', sql.NVarChar(50), bankAccountNo)
    .input('active', sql.Bit, isActive)
    .input('actor', sql.NVarChar(100), actor)
    .query(`
      UPDATE BankAccountMapping
      SET IsActive = @active, StatusChangedAt = GETDATE(), StatusChangedBy = @actor
      WHERE BankAccountNo = @no AND BankCode IS NOT NULL
    `);
  return (result.rowsAffected[0] ?? 0) > 0;
}
