/* =====================================================================
   รันสคริปต์นี้กับ database [Reconcile_Bank] ก่อนใช้งานฟีเจอร์จากการประชุมกับทีมบัญชี 17 ก.ย. 2026
   =====================================================================
   1. จับคู่ได้แม้ยอดสองฝั่งไม่เท่ากัน แต่ต้องใส่หมายเหตุ
      เคสจริง: BBL 12/08 ธนาคารรับ 6,009 (QR หลายรายการที่ธนาคารรวมยอดทั้งวันให้) แต่ BC รู้แค่ 5,009
      อีก 1,000 ไม่รู้ว่าใครโอน ทีมบัญชีให้จับคู่ไปเลย และพักโอนเฉพาะส่วนต่างไว้กับ Match พร้อมเหตุผล
      -> ReconciliationMatch.Remark

   2. "ไม่นำมาจับคู่" (MatchType = 'EXCLUDED') สำหรับรายการ GL ที่ไม่มีวันมีคู่ในธนาคาร
      เช่น JV ปรับปรุงยอดท้ายเดือน JVMUAY2609016 (261,685.82) — บังคับใส่หมายเหตุเหมือนกัน
      MatchType ไม่มี CHECK constraint (ดู sys.check_constraints) จึงไม่ต้องแก้ schema ส่วนนี้

   3. ยอดยกมาฝั่ง GL (BC365) ต่อบัญชีต่อวันเริ่มงวด
      ฝั่ง Bank ไม่ต้องเก็บ เพราะคำนวณได้จากคอลัมน์ Balance ของไฟล์ statement อยู่แล้ว
      ฝั่ง GL ต้องกรอกเอง เพราะข้อมูลในตาราง GL เริ่มราว มี.ค. 2026 ผลรวมจึงไม่ใช่ยอดคงเหลือจริงของ BC
      (ตรวจแล้ว: TW_BBL_C1 ผลรวมก่อน 1 ส.ค. = -1,514,462.32 แต่ยอดยกมาจริงตามกระดาษทีมบัญชี = 88,225.86)
      กรอกครั้งเดียวต่องวด เดือนถัดไประบบเสนอยอด = ยอดที่กรอกล่าสุด + การเคลื่อนไหว GL ระหว่างทาง

   รันซ้ำได้ (ทุก STEP เช็คก่อนสร้าง) และโค้ดฝั่งเว็บเช็คว่ารันแล้วหรือยังก่อนใช้งานทุกครั้ง
   ถ้ายังไม่รัน ปุ่มที่เกี่ยวข้องจะแจ้งให้รันสคริปต์นี้ ส่วนการจับคู่ปกติยังทำงานได้ตามเดิม
   ===================================================================== */

IF COL_LENGTH('dbo.ReconciliationMatch', 'Remark') IS NULL
  ALTER TABLE dbo.ReconciliationMatch ADD Remark NVARCHAR(500) NULL;
GO

IF OBJECT_ID('dbo.ReconciliationOpeningBalance', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.ReconciliationOpeningBalance (
    BankAccountNo     NVARCHAR(50)   NOT NULL,
    -- ยอด "ยกมา" = ยอดคงเหลือ ณ สิ้นวันก่อนหน้า PeriodStart
    PeriodStart       DATE           NOT NULL,
    GlOpeningBalance  DECIMAL(18, 2) NOT NULL,
    CreatedBy         NVARCHAR(100)  NOT NULL,
    CreatedAt         DATETIMEOFFSET NOT NULL CONSTRAINT DF_ReconciliationOpeningBalance_CreatedAt DEFAULT SYSDATETIMEOFFSET(),
    UpdatedBy         NVARCHAR(100)  NULL,
    UpdatedAt         DATETIMEOFFSET NULL,
    CONSTRAINT PK_ReconciliationOpeningBalance PRIMARY KEY (BankAccountNo, PeriodStart),
    CONSTRAINT FK_ReconciliationOpeningBalance_BankAccount
      FOREIGN KEY (BankAccountNo) REFERENCES dbo.BankAccountMapping(BankAccountNo)
  );
END
GO
