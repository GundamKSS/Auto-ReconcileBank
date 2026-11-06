/* =====================================================================
   013 — ข้อมูลบัญชีผู้โอนในรายการเดินบัญชีธนาคาร (BankStatementLine)
   เก็บชื่อธนาคารต้นทาง (SenderBank), เลขบัญชีผู้โอน (SenderAccountNo),
   และชื่อบัญชีผู้โอน (SenderAccountName) แยกคอลัมน์จากไฟล์ statement (เช่น BBL)
   เพื่อใช้แสดงผลและช่วยคาดเดาผู้โอนตอนกระทบยอด

   รันได้ซ้ำ — ทุกคอลัมน์มี guard COL_LENGTH IS NULL
   ก่อนรัน: ระบบยังนำเข้าไฟล์ได้ตามปกติ โดยรวมข้อมูลผู้โอนไว้ใน RawDescription
   หลังรัน: ระบบจะบันทึกแยกลงคอลัมน์ SenderBank / SenderAccountNo / SenderAccountName เพิ่มให้อัตโนมัติ
   ===================================================================== */
SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF OBJECT_ID('dbo.BankStatementLine', 'U') IS NULL
  THROW 50000, 'ไม่พบตาราง dbo.BankStatementLine', 1;

IF COL_LENGTH('dbo.BankStatementLine', 'SenderBank') IS NULL
  ALTER TABLE dbo.BankStatementLine ADD SenderBank NVARCHAR(50) NULL;

IF COL_LENGTH('dbo.BankStatementLine', 'SenderAccountNo') IS NULL
  ALTER TABLE dbo.BankStatementLine ADD SenderAccountNo NVARCHAR(50) NULL;

IF COL_LENGTH('dbo.BankStatementLine', 'SenderAccountName') IS NULL
  ALTER TABLE dbo.BankStatementLine ADD SenderAccountName NVARCHAR(255) NULL;

COMMIT TRANSACTION;
