/* =====================================================================
   014 — Indexes เพิ่มประสิทธิภาพ Dashboard และ Reconciliation Queries
   เพิ่ม Index สำหรับตาราง ReconciliationMatchLine, BankStatementLine,
   และ ReconciliationMatch เพื่อเร่งความเร็วการดึงข้อมูลภาพรวม (Dashboard),
   การตรวจหารายการค้าง (Unmatched NOT EXISTS), และการกรองช่วงวันที่

   รันได้ซ้ำ — ทุก Index มี guard IF NOT EXISTS (SELECT 1 FROM sys.indexes ...)
   ===================================================================== */
SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF OBJECT_ID('dbo.ReconciliationMatchLine', 'U') IS NULL
  THROW 50000, 'ไม่พบตาราง dbo.ReconciliationMatchLine', 1;

IF OBJECT_ID('dbo.BankStatementLine', 'U') IS NULL
  THROW 50000, 'ไม่พบตาราง dbo.BankStatementLine', 1;

IF OBJECT_ID('dbo.ReconciliationMatch', 'U') IS NULL
  THROW 50000, 'ไม่พบตาราง dbo.ReconciliationMatch', 1;

-- 1. Index ช่วยเช็ครายการที่ยังไม่ถูกจับคู่ฝั่ง Bank (คู่กับ IX_ReconciliationMatchLine_Status_GL จาก 003)
-- ใช้บ่อยมากใน Dashboard และ Reports: NOT EXISTS (... BankLineId = bsl.LineId AND Status = 'ACTIVE')
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_ReconciliationMatchLine_Status_Bank'
    AND object_id = OBJECT_ID('dbo.ReconciliationMatchLine')
)
  CREATE NONCLUSTERED INDEX IX_ReconciliationMatchLine_Status_Bank
    ON dbo.ReconciliationMatchLine (Status, SourceType, BankLineId)
    INCLUDE (MatchId, Num);

-- 2. Index ช่วย query ตรวจสอบกลุ่มย่อย (Num) ใน groupDateFilter
-- WHERE f_rml.MatchId = rm.MatchId AND f_rml.Num = rml.Num AND f_rml.SourceType = 'BANK'/'GL'
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_ReconciliationMatchLine_Match_Group'
    AND object_id = OBJECT_ID('dbo.ReconciliationMatchLine')
)
  CREATE NONCLUSTERED INDEX IX_ReconciliationMatchLine_Match_Group
    ON dbo.ReconciliationMatchLine (MatchId, Num, SourceType)
    INCLUDE (BankLineId, GLEntryNo, Status);

-- 3. Index ช่วยกรองช่วงวันที่ของ Statement เมื่อดูภาพรวมทุกบัญชี (BankCode/BankAccountNo = 'ALL')
-- เดิมมี IX_BankStatementLine_Account_Status_Date ที่ BankAccountNo เป็นคอลัมน์นำ ทำให้กรองช่วงวันที่โดยไม่ระบุบัญชีได้ช้า
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_BankStatementLine_Date_Status'
    AND object_id = OBJECT_ID('dbo.BankStatementLine')
)
  CREATE NONCLUSTERED INDEX IX_BankStatementLine_Date_Status
    ON dbo.BankStatementLine (TranDate, MatchStatus)
    INCLUDE (BankCode, BankAccountNo, LineId, Credit, Debit, Description, ChequeNo);

-- 4. Index ช่วยกรอง Match ตามสถานะและธนาคาร
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_ReconciliationMatch_Status_Bank'
    AND object_id = OBJECT_ID('dbo.ReconciliationMatch')
)
  CREATE NONCLUSTERED INDEX IX_ReconciliationMatch_Status_Bank
    ON dbo.ReconciliationMatch (Status, BankCode)
    INCLUDE (MatchType, BankAccountNo, CreatedBy, CreatedAt);

COMMIT TRANSACTION;
