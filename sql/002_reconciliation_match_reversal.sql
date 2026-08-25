/* =====================================================================
   รันสคริปต์นี้กับ database [Reconcile_Bank] ก่อนใช้งานฟีเจอร์ "ยกเลิกการจับคู่ (Unmatch)"
   =====================================================================
   เพิ่มคอลัมน์เก็บร่องรอยการยกเลิกการจับคู่ไว้ที่ ReconciliationMatch แทนการลบทิ้ง
   (ReconciliationMatchLine ของรายการที่ถูกยกเลิกจะยังอยู่ครบ ไม่ลบ — เพื่อตรวจสอบย้อนหลังได้ว่า
   ครั้งนั้นเคยจับคู่อะไรกับอะไรไว้ ก่อนจะถูกยกเลิกภายหลัง)

   สำคัญ: ต้องรันไฟล์นี้ "ก่อน" deploy โค้ดเวอร์ชันที่มีฟีเจอร์ Unmatch เสมอ เพราะ
   /api/reconcile/data, /api/reconcile/suggest และ /api/reconcile/unmatch จะ query
   คอลัมน์ Status ที่เพิ่มใหม่นี้โดยตรง — ถ้ายังไม่รัน ฟีเจอร์ที่มีอยู่เดิม (โหลดข้อมูล Reconcile /
   Suggest matches) จะ error ทันทีเพราะหาคอลัมน์ไม่เจอ
   ===================================================================== */

ALTER TABLE dbo.ReconciliationMatch
  ADD Status NVARCHAR(20) NOT NULL CONSTRAINT DF_ReconciliationMatch_Status DEFAULT ('ACTIVE'),
      ReversedAt DATETIME2 NULL,
      ReversedBy NVARCHAR(100) NULL,
      ReversedReason NVARCHAR(500) NULL;
GO

ALTER TABLE dbo.ReconciliationMatch
  ADD CONSTRAINT CK_ReconciliationMatch_Status CHECK (Status IN ('ACTIVE', 'REVERSED'));
GO

-- แนะนำ (ไม่บังคับ): index ช่วย query ฝั่ง GL ที่ join กลับมาเช็ค Status ตอนหาว่ารายการไหน
-- ยังว่างพอจะจับคู่ใหม่ได้บ้าง (ใช้บ่อยใน /api/reconcile/data และ /api/reconcile/suggest)
CREATE INDEX IX_ReconciliationMatch_Status ON dbo.ReconciliationMatch (Status) INCLUDE (MatchType);
GO
