/* =====================================================================
   012 — สถานะบัญชีธนาคาร (ใช้งาน / ปิดบัญชี)
   ใช้กับหน้า /master-data/bank-accounts: บัญชีที่ปิดแล้วนำเข้า statement ใหม่ไม่ได้
   ส่วนข้อมูลเดิมของบัญชีนั้นยังกระทบยอด/ดูรายงานได้ตามปกติ และเปิดบัญชีกลับได้

   รันได้ซ้ำ — ทุกคอลัมน์มี guard COL_LENGTH IS NULL
   ก่อนรัน: หน้าบัญชีธนาคารเพิ่มบัญชีได้ แต่เปลี่ยนสถานะไม่ได้ (ตอบ 409 พร้อมบอกให้รันไฟล์นี้)
   ===================================================================== */
SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF OBJECT_ID('dbo.BankAccountMapping', 'U') IS NULL
  THROW 50000, 'ไม่พบตาราง dbo.BankAccountMapping', 1;

-- บัญชีเดิมทั้งหมดถือว่ายังใช้งานอยู่ (DEFAULT 1 เติมให้ทุกแถวตอนเพิ่มคอลัมน์ NOT NULL)
IF COL_LENGTH('dbo.BankAccountMapping', 'IsActive') IS NULL
  ALTER TABLE dbo.BankAccountMapping
    ADD IsActive BIT NOT NULL CONSTRAINT DF_BankAccountMapping_IsActive DEFAULT (1);

-- ผู้เพิ่มบัญชีผ่านหน้าเว็บ — แถวเดิม 14 แถวมาจากการตั้งค่าครั้งแรก จึงเป็น NULL
IF COL_LENGTH('dbo.BankAccountMapping', 'CreatedBy') IS NULL
  ALTER TABLE dbo.BankAccountMapping ADD CreatedBy NVARCHAR(100) NULL;

IF COL_LENGTH('dbo.BankAccountMapping', 'StatusChangedAt') IS NULL
  ALTER TABLE dbo.BankAccountMapping ADD StatusChangedAt DATETIME NULL;

IF COL_LENGTH('dbo.BankAccountMapping', 'StatusChangedBy') IS NULL
  ALTER TABLE dbo.BankAccountMapping ADD StatusChangedBy NVARCHAR(100) NULL;

COMMIT;
