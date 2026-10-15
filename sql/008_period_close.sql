/* =====================================================================
   รันสคริปต์นี้กับ database [Reconcile_Bank] ก่อนใช้งานฟีเจอร์ "ปิดงวด"
   =====================================================================
   เก็บสถานะปิดงวดต่อบัญชีต่อ PeriodStart (คีย์เดียวกับ ReconciliationOpeningBalance) — ปิดได้เมื่อ
   ยอดคงเหลือ Bank เทียบ GL เท่ากันแล้ว (ยอดพักโอนคงเหลือ = 0) และต้องเปิดคืนก่อนจึงจะแก้ไขรายการของ
   งวดนั้นได้อีก (Match / Unmatch / Un-suspend / แก้ยอดยกมา / ลบไฟล์ Bank Statement)

   รันซ้ำได้ (เช็คก่อนสร้าง) และโค้ดฝั่งเว็บเช็คว่ารันแล้วหรือยังก่อนใช้งานทุกครั้ง — ถ้ายังไม่รัน
   ฟีเจอร์ปิดงวดจะแจ้งให้รันสคริปต์นี้ ส่วนการทำงานปกติ (จับคู่ ฯลฯ) ยังทำงานได้ตามเดิมโดยไม่ถูกล็อก
   ===================================================================== */

IF OBJECT_ID('dbo.ReconciliationPeriodClose', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.ReconciliationPeriodClose (
    BankAccountNo      NVARCHAR(50)   NOT NULL,
    -- คีย์เดียวกับ ReconciliationOpeningBalance.PeriodStart — หนึ่งวันเริ่มงวดต่อบัญชี
    PeriodStart         DATE           NOT NULL,
    PeriodEnd           DATE           NOT NULL,
    Status              NVARCHAR(20)   NOT NULL CONSTRAINT DF_ReconciliationPeriodClose_Status DEFAULT ('CLOSED'),
    -- snapshot ยอดคงเหลือตอนปิด ไว้ตรวจสอบย้อนหลังว่าปิดด้วยยอดเท่าไหร่
    BankClosingBalance  DECIMAL(18, 2) NULL,
    GlClosingBalance    DECIMAL(18, 2) NULL,
    ClosedBy            NVARCHAR(100)  NOT NULL,
    ClosedAt            DATETIMEOFFSET NOT NULL CONSTRAINT DF_ReconciliationPeriodClose_ClosedAt DEFAULT SYSDATETIMEOFFSET(),
    ReopenedBy          NVARCHAR(100)  NULL,
    ReopenedAt          DATETIMEOFFSET NULL,
    ReopenReason        NVARCHAR(500)  NULL,
    CONSTRAINT PK_ReconciliationPeriodClose PRIMARY KEY (BankAccountNo, PeriodStart),
    CONSTRAINT CK_ReconciliationPeriodClose_Status CHECK (Status IN ('CLOSED', 'REOPENED')),
    CONSTRAINT FK_ReconciliationPeriodClose_BankAccount
      FOREIGN KEY (BankAccountNo) REFERENCES dbo.BankAccountMapping(BankAccountNo)
  );
END
GO
