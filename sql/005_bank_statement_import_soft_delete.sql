/* =====================================================================
   รันสคริปต์นี้กับ database [Reconcile_Bank] ก่อนใช้งานฟีเจอร์
   "ลบไฟล์ Bank Statement ทีละทั้งไฟล์ พร้อมเก็บประวัติการลบ"
   =====================================================================
   หน้า Master Data · Bank Statement แก้ไข / เพิ่ม / ลบทีละรายการไม่ได้แล้ว — ลบได้ทีละทั้งไฟล์เท่านั้น
   และทุกครั้งที่ลบต้องบันทึกว่า ใครลบ ลบเมื่อไร (วันที่และเวลา) และเหตุผลที่ลบ

   ไม่ลบแถวทิ้งจริง (soft delete) แบบเดียวกับการยกเลิกการจับคู่ใน 002/003:
     - หัวไฟล์    BankStatementImport.Status = 'DELETED' + DeletedAt / DeletedBy / DeletedReason
     - ทุกบรรทัด  BankStatementLine.MatchStatus = 'DELETED'
   ที่ต้องเก็บบรรทัดไว้เพราะ ReconciliationMatchLine ของการจับคู่ที่ถูกยกเลิกไปแล้ว (REVERSED)
   ยังอ้าง LineId ของ statement อยู่โดยไม่มี FK กันไว้ — ถ้าลบแถวทิ้ง รายการฝั่ง Bank ของประวัติเหล่านั้น
   จะหายไปจากหน้า Match History เงียบๆ

   ไฟล์ที่ลบแล้วนำเข้าใหม่ได้ เพราะการเช็คไฟล์ซ้ำตอนนำเข้าดูเฉพาะ Status = 'SUCCESS'

   DeletedAt เป็น DATETIMEOFFSET ไม่ใช่ datetime/datetime2 แบบคอลัมน์เวลาเดิม — คอลัมน์เดิมเก็บเวลาไทย
   โดยไม่มี offset แต่ mssql อ่านเป็น UTC ทำให้หน้าเว็บแสดงเวลาเลื่อนไป 7 ชั่วโมง ส่วน DATETIMEOFFSET
   มี +07:00 ติดมาด้วย จึงแสดงถูกทั้งในหน้าเว็บและตอนเปิดดูใน SSMS

   สำคัญ: รันไฟล์นี้ "ก่อน" deploy โค้ดเวอร์ชันที่มีฟีเจอร์นี้ — ถ้ายังไม่รัน ปุ่มลบไฟล์และแท็บประวัติการลบ
   จะแจ้งให้รันสคริปต์นี้ก่อน (ระบบไม่ลบอะไรเลย ข้อมูลไม่เสียหาย) ส่วนหน้าอื่นใช้งานได้ตามปกติ
   ===================================================================== */

ALTER TABLE dbo.BankStatementImport
  ADD DeletedAt DATETIMEOFFSET NULL,
      DeletedBy NVARCHAR(100) NULL,
      DeletedReason NVARCHAR(500) NULL;
GO

-- ไฟล์ที่ถูก mark ลบต้องมีร่องรอยครบทั้ง 3 อย่างเสมอ — กันการลบโดยไม่มีประวัติ (เช่นแก้ Status ตรงๆ ใน SSMS)
-- (collation ของ DB ไม่สนช่องว่างท้ายข้อความ เหตุผลที่มีแต่ช่องว่างจึงเท่ากับ N'' และไม่ผ่านด้วย)
ALTER TABLE dbo.BankStatementImport
  ADD CONSTRAINT CK_BankStatementImport_DeleteAudit CHECK (
    Status <> 'DELETED'
    OR (DeletedAt IS NOT NULL AND DeletedBy IS NOT NULL AND DeletedReason IS NOT NULL AND DeletedReason <> N'')
  );
GO
