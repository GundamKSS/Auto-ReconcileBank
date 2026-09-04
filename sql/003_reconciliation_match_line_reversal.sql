/* =====================================================================
   รันสคริปต์นี้กับ database [Reconcile_Bank] ก่อนใช้งานฟีเจอร์
   "ยกเลิกการจับคู่ระดับกลุ่มย่อย (Unmatch รายกลุ่ม/รายการย่อย)"
   =====================================================================
   ต่อยอดจาก 002 ที่เก็บสถานะการยกเลิกไว้ที่ "หัว" ReconciliationMatch เท่านั้น
   ซึ่งยกเลิกได้ทีละทั้ง MatchId เท่านั้น — ไฟล์นี้ย้ายสถานะการยกเลิกลงมาถึงระดับ
   ReconciliationMatchLine ด้วย เพื่อให้ยกเลิกเฉพาะ "กลุ่มย่อย (Num)" ที่แมชผิด
   โดยกลุ่มย่อยอื่นใน MatchId เดียวกันยังจับคู่อยู่ตามเดิม

   เหมือนเดิมคือ "ไม่ลบ" แถวทิ้ง — mark Status = 'REVERSED' พร้อมเหตุผล/ผู้ยกเลิก/เวลา
   เพื่อให้ตรวจสอบย้อนหลังได้ว่าครั้งนั้นเคยจับคู่อะไรกับอะไรไว้

   สำคัญ: ต้องรันไฟล์นี้ "ก่อน" deploy โค้ดเวอร์ชันที่มีฟีเจอร์ Unmatch รายกลุ่มย่อย เพราะ
   /api/reconcile/data, /api/reconcile/suggest, /api/reconcile/unmatch และ /api/history
   จะ query คอลัมน์ Status ของ ReconciliationMatchLine โดยตรง
   ===================================================================== */

ALTER TABLE dbo.ReconciliationMatchLine
  ADD Status NVARCHAR(20) NOT NULL CONSTRAINT DF_ReconciliationMatchLine_Status DEFAULT ('ACTIVE'),
      ReversedAt DATETIME2 NULL,
      ReversedBy NVARCHAR(100) NULL,
      ReversedReason NVARCHAR(500) NULL;
GO

ALTER TABLE dbo.ReconciliationMatchLine
  ADD CONSTRAINT CK_ReconciliationMatchLine_Status CHECK (Status IN ('ACTIVE', 'REVERSED'));
GO

/* ย้ายข้อมูลของ Match ที่เคยถูกยกเลิกทั้งใบไว้ก่อนหน้านี้ (จาก 002) ลงมาที่ระดับบรรทัดด้วย
   ไม่งั้นบรรทัดของ Match เหล่านั้นจะยังเป็น ACTIVE ค้างอยู่ แล้ว query ที่เช็คสถานะระดับบรรทัด
   จะเข้าใจผิดว่ารายการ GL เหล่านั้นยังถูกจับคู่อยู่ */
UPDATE rml
SET rml.Status = 'REVERSED',
    rml.ReversedAt = rm.ReversedAt,
    rml.ReversedBy = rm.ReversedBy,
    rml.ReversedReason = rm.ReversedReason
FROM dbo.ReconciliationMatchLine rml
JOIN dbo.ReconciliationMatch rm ON rm.MatchId = rml.MatchId
WHERE rm.Status = 'REVERSED';
GO

-- แนะนำ (ไม่บังคับ): index ช่วย query ฝั่ง GL ที่เช็คว่ารายการไหนยังถูกจับคู่อยู่บ้าง
-- (ใช้บ่อยใน /api/reconcile/data และ /api/reconcile/suggest)
CREATE INDEX IX_ReconciliationMatchLine_Status_GL
  ON dbo.ReconciliationMatchLine (Status, SourceType, GLEntryNo);
GO
