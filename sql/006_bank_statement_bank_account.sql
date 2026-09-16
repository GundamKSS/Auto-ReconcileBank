/* =====================================================================
   รันสคริปต์นี้กับ database [Reconcile_Bank] ก่อนใช้งานฟีเจอร์
   "กระทบยอดแยกตามเลขบัญชี ไม่ใช่แค่แยกตามธนาคาร"
   =====================================================================
   ปัญหาเดิม: ฝั่ง GL (BankAccountLedgerEntries.Bank_Account_No) ละเอียดถึงระดับ "บัญชี"
   แต่ฝั่ง Bank Statement เก็บแค่ BankCode (BBL/KBANK/SCB) ซึ่งละเอียดแค่ระดับ "ธนาคาร"
   บริษัทมีหลายบัญชีต่อธนาคาร (SCB 6 บัญชี, BBL 3, KBANK 3) หน้า Reconcile จึงเอา statement
   ของบัญชีเดียวไปเทียบกับ GL ของทุกบัญชีในธนาคารนั้นรวมกัน

   ผลที่เกิดขึ้นจริง:
     - ส.ค. 2026 ไฟล์ '9725 8.26.XLSX' คือบัญชี TW_SCB_C1 (#037-3-029725) แต่หน้าจอดึง GL มา 635 รายการ
       โดย 57 รายการเป็นของอีก 5 บัญชี SCB ที่ไม่เกี่ยวกับ statement ใบนั้นเลย
     - MatchId 242 และ 261 จับคู่ GL ข้ามบัญชี (TW_BBL_C1 ปนกับ PV_BBL_S1) สำเร็จไปแล้ว
       (ทั้งคู่เป็นรายการทดสอบและถูก reverse ไปแล้ว แต่พิสูจน์ว่าระบบไม่มีอะไรกันไว้)

   สคริปต์นี้เพิ่มมิติ "เลขบัญชี" ให้ฝั่ง statement และฝั่งบันทึกการจับคู่
     1. BankStatementImport.BankAccountNo  — ไฟล์ statement 1 ใบ = บัญชี 1 บัญชี (ต้นทางของความจริง)
     2. BankStatementLine.BankAccountNo    — คัดลอกลงทุกบรรทัดเหมือนที่ทำกับ BankCode อยู่แล้ว
                                              เพื่อให้ query หน้า Reconcile ไม่ต้อง join กลับไปหาหัวไฟล์
     3. ReconciliationMatch.BankAccountNo  — บันทึกว่าการจับคู่ครั้งนั้นทำในบัญชีไหน

   ยังเป็น NULL ได้ เพราะไฟล์ที่นำเข้าไว้ก่อนหน้านี้ไม่มีข้อมูลนี้ — โค้ดฝั่งเว็บถอยไปทำงาน
   แบบเดิม (ทั้งธนาคาร) ให้อัตโนมัติเมื่อเจอ NULL และขึ้นป้ายเตือนว่าไฟล์นั้นยังไม่ได้ระบุบัญชี

   สำคัญ: รันไฟล์นี้ "ก่อน" deploy โค้ดเวอร์ชันที่มีฟีเจอร์นี้ — ถ้ายังไม่รัน ระบบจะทำงานแบบเดิม
   ทุกอย่าง (กระทบยอดรวมทั้งธนาคาร) และขึ้นข้อความบอกให้รันสคริปต์นี้ ไม่มีข้อมูลใดเสียหาย

   ทุก STEP รันซ้ำได้ (idempotent): DDL มี IF NOT EXISTS คุมไว้ ส่วน UPDATE มีเงื่อนไข IS NULL
   จึงไม่ทับค่าที่แก้ไว้ทีหลัง — รันซ้ำแล้วไม่มีอะไรเปลี่ยนและไม่มี error
   ===================================================================== */

/* ---------------------------------------------------------------------
   STEP 1 — เพิ่มคอลัมน์
   ความยาว 50 ตัวอักษรให้ตรงกับ BankAccountMapping.BankAccountNo ซึ่งเป็น PK ที่อ้างถึง
   (ค่าจริงเป็นรหัสของ BC365 เช่น 'TW_SCB_C1' ไม่ใช่เลขบัญชีธนาคาร — เลขบัญชีจริงอยู่ในชื่อบัญชี)
   --------------------------------------------------------------------- */

IF COL_LENGTH('dbo.BankStatementImport', 'BankAccountNo') IS NULL
  ALTER TABLE dbo.BankStatementImport ADD BankAccountNo NVARCHAR(50) NULL;
GO
IF COL_LENGTH('dbo.BankStatementLine', 'BankAccountNo') IS NULL
  ALTER TABLE dbo.BankStatementLine ADD BankAccountNo NVARCHAR(50) NULL;
GO
IF COL_LENGTH('dbo.ReconciliationMatch', 'BankAccountNo') IS NULL
  ALTER TABLE dbo.ReconciliationMatch ADD BankAccountNo NVARCHAR(50) NULL;
GO

/* ---------------------------------------------------------------------
   STEP 2 — ผูก FK เฉพาะฝั่ง statement
   ReconciliationMatch ไม่ผูก FK เพราะเป็นบันทึกประวัติ ต้องอ่านย้อนหลังได้แม้บัญชีถูกถอดออกจาก mapping
   ภายหลัง (เหตุผลเดียวกับที่ ReconciliationMatchLine ไม่ผูก FK กับ BankStatementLine — ดู 005)
   --------------------------------------------------------------------- */

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_BankStatementImport_BankAccount')
  ALTER TABLE dbo.BankStatementImport
    ADD CONSTRAINT FK_BankStatementImport_BankAccount
    FOREIGN KEY (BankAccountNo) REFERENCES dbo.BankAccountMapping(BankAccountNo);
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_BankStatementLine_BankAccount')
  ALTER TABLE dbo.BankStatementLine
    ADD CONSTRAINT FK_BankStatementLine_BankAccount
    FOREIGN KEY (BankAccountNo) REFERENCES dbo.BankAccountMapping(BankAccountNo);
GO

/* ---------------------------------------------------------------------
   STEP 3 — เติมชื่อบัญชีใน BankAccountMapping จากฝั่ง GL
   BankAccountMapping.BankAccountName เป็น NULL ทั้ง 14 แถวมาตั้งแต่ต้น ทั้งที่ BC365 ส่งชื่อเต็ม
   (มีเลขบัญชีจริงต่อท้าย เช่น 'TRW กระแสรายวัน SCB เฉลิมนคร #037-3-029725') มาให้อยู่แล้วใน
   BankAccountLedgerEntries.Bank_Account_Name — หน้าเว็บจึงเคยขึ้นคำว่า "null" แทนชื่อบัญชี
   เติมครั้งเดียวตรงนี้ เพื่อให้ dropdown เลือกบัญชีมีชื่อให้คนอ่านรู้เรื่องทันทีหลังรันสคริปต์
   (คอลัมน์รับ 255 ตัวอักษร ส่วนต้นทางยาวสุด 100 จึงไม่มีทางถูกตัด)
   --------------------------------------------------------------------- */

UPDATE m
SET    m.BankAccountName = src.Bank_Account_Name
FROM   dbo.BankAccountMapping m
JOIN (
        -- 1 บัญชีอาจมีชื่อไม่ตรงกันข้ามแถวได้ถ้า BC365 เคยแก้ชื่อ — เอาชื่อจากรายการล่าสุดเป็นหลัก
        SELECT Bank_Account_No, Bank_Account_Name,
               ROW_NUMBER() OVER (PARTITION BY Bank_Account_No ORDER BY Entry_No DESC) AS rn
        FROM   dbo.BankAccountLedgerEntries
        WHERE  Bank_Account_Name IS NOT NULL AND LTRIM(RTRIM(Bank_Account_Name)) <> N''
     ) src ON src.Bank_Account_No = m.BankAccountNo AND src.rn = 1
WHERE  m.BankAccountName IS NULL OR LTRIM(RTRIM(m.BankAccountName)) = N'';
GO

/* ---------------------------------------------------------------------
   STEP 4 — เติมบัญชีให้ไฟล์ที่นำเข้าไว้แล้ว
   ระบุด้วยมือเพราะมีแค่ 3 ไฟล์ และชื่อไฟล์บอกบัญชีได้ชัดเจน (ผู้ใช้ตั้งชื่อไฟล์ด้วยเลข 4 ตัวท้าย):
     ImportId 9  '9725 8.26.XLSX'      -> TW_SCB_C1 (TRW กระแสรายวัน SCB เฉลิมนคร #037-3-029725)
     ImportId 12 'BBL4633 (8) IT.xlsx' -> TW_BBL_C1 (TRW กระแสรายวัน BBL สามยอด #150-3074633)
     ImportId 8  'BBL-Table 1.csv'     -> ข้ามไป ไฟล์นี้ถูกลบไปแล้วเมื่อ 15 ก.ย. 2026 (Status = 'DELETED')

   เงื่อนไข BankAccountNo IS NULL ทำให้รันซ้ำได้โดยไม่ทับค่าที่ผู้ใช้แก้ไว้ทีหลัง
   --------------------------------------------------------------------- */

UPDATE dbo.BankStatementImport SET BankAccountNo = N'TW_SCB_C1'
WHERE  ImportId = 9  AND BankCode = N'SCB' AND BankAccountNo IS NULL;
GO
UPDATE dbo.BankStatementImport SET BankAccountNo = N'TW_BBL_C1'
WHERE  ImportId = 12 AND BankCode = N'BBL' AND BankAccountNo IS NULL;
GO

-- คัดลอกลงทุกบรรทัดของไฟล์นั้น (ทั้งที่จับคู่แล้วและยังไม่จับคู่)
UPDATE l
SET    l.BankAccountNo = i.BankAccountNo
FROM   dbo.BankStatementLine l
JOIN   dbo.BankStatementImport i ON i.ImportId = l.ImportId
WHERE  l.BankAccountNo IS NULL AND i.BankAccountNo IS NOT NULL;
GO

/* ---------------------------------------------------------------------
   STEP 5 — เติมบัญชีให้ประวัติการจับคู่เดิม
   เติมได้เฉพาะ match ที่ฝั่ง GL อยู่บัญชีเดียวล้วน — match ที่ปนหลายบัญชี (242, 261) ปล่อยเป็น NULL ไว้
   เพื่อไม่ให้ประวัติบอกบัญชีที่ไม่ตรงความจริง หน้า Match History แสดง NULL เป็น "ไม่ระบุบัญชี"
   --------------------------------------------------------------------- */

UPDATE rm
SET    rm.BankAccountNo = src.BankAccountNo
FROM   dbo.ReconciliationMatch rm
JOIN (
        SELECT rml.MatchId, MIN(e.Bank_Account_No) AS BankAccountNo
        FROM   dbo.ReconciliationMatchLine rml
        JOIN   dbo.BankAccountLedgerEntries e ON e.Entry_No = rml.GLEntryNo
        WHERE  rml.SourceType = 'GL'
        GROUP  BY rml.MatchId
        HAVING COUNT(DISTINCT e.Bank_Account_No) = 1
     ) src ON src.MatchId = rm.MatchId
WHERE  rm.BankAccountNo IS NULL;
GO

/* ---------------------------------------------------------------------
   STEP 6 — Index
   BankStatementLine เดิมมีแต่ clustered PK บน LineId เท่านั้น ทุก query ของหน้า Reconcile
   จึงต้องสแกนทั้งตาราง ตอนนี้เงื่อนไขหลักคือ "บัญชีนี้ + ยังไม่จับคู่ + ช่วงวันที่นี้" พอดี
   --------------------------------------------------------------------- */

IF NOT EXISTS (
      SELECT 1 FROM sys.indexes
      WHERE name = 'IX_BankStatementLine_Account_Status_Date'
        AND object_id = OBJECT_ID('dbo.BankStatementLine')
   )
  CREATE NONCLUSTERED INDEX IX_BankStatementLine_Account_Status_Date
    ON dbo.BankStatementLine (BankAccountNo, MatchStatus, TranDate)
    INCLUDE (ImportId, BankCode, Description, Debit, Credit, ChequeNo);
GO
