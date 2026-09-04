/*
  004_fix_swapped_csv_dates.sql
  ---------------------------------------------------------------------------
  ซ่อมวันที่ที่ถูกอ่านสลับวัน/เดือน ตอนนำเข้าไฟล์ Bank Statement รูปแบบ CSV

  สาเหตุ (แก้ที่โค้ดแล้วใน lib/bankParsers/workbook.ts):
    route นำเข้าเปิดไฟล์ด้วย XLSX.read(..., { cellDates: true }) ทำให้ SheetJS
    เดารูปแบบวันที่ในไฟล์ CSV เป็นแบบอเมริกัน MM/DD/YYYY
    '02/05/2026' (2 พ.ค.) จึงถูกอ่านเป็น 5 ก.พ. โดยไม่มี error ให้เห็น

  วิธีระบุแถวที่เสียหาย (พิสูจน์ได้แน่นอน ไม่ต้องเดา):
    ให้ค่าจริงในไฟล์คือ (วันที่ = D, เดือน = M)
      - ถ้า D <= 12  -> ถูกสลับ  จึงถูกบันทึกเป็น (เดือน = D, วันที่ = M)
                       เนื่องจาก M เป็นเดือนจริงเสมอ M <= 12  =>  DAY(ที่บันทึก) <= 12
      - ถ้า D >= 13  -> ไม่ถูกสลับ (SheetJS แปลงเป็นเดือน 13 ไม่ได้ เลยปล่อยเป็นข้อความ
                       ให้ regex DD/MM/YYYY ของ parser จัดการ ซึ่งถูกต้อง)
                       =>  DAY(ที่บันทึก) >= 13
    สรุป: แถวที่ DAY(TranDate) <= 12 คือแถวที่ถูกสลับ ต้องสลับเดือนกับวันกลับคืน
          แถวที่ DAY(TranDate) >= 13 ถูกต้องอยู่แล้ว ห้ามแตะ
    หมายเหตุ: แถวที่วันกับเดือนเท่ากันอยู่แล้ว (เช่น 05/05) สลับแล้วได้ค่าเดิม ไม่มีผลเสีย

  ใช้กับ: เฉพาะ import ที่มาจากไฟล์ .csv เท่านั้น
          ไฟล์ .xlsx/.xls ไม่ได้รับผลกระทบ เพราะ Excel เก็บวันที่เป็น serial number ที่ไม่กำกวม

  วิธีใช้:
    1. รันเฉพาะส่วน STEP 1 ก่อน เพื่อดูว่าจะกระทบแถวไหนบ้าง แล้วตรวจกับไฟล์ต้นฉบับ
    2. พอใจแล้วค่อยรัน STEP 2 (อยู่ใน transaction — ตรวจผลก่อน COMMIT ได้)
    3. รัน STEP 3 เพื่อยืนยันผลหลังแก้

  คำเตือน: สำรองฐานข้อมูลก่อนรัน STEP 2 เสมอ
*/

-- ===========================================================================
-- STEP 1 — ดูก่อนว่าจะแก้แถวไหนบ้าง (อ่านอย่างเดียว ยังไม่เปลี่ยนอะไร)
-- ===========================================================================

-- 1.1 สรุปภาพรวมรายไฟล์ที่นำเข้า
SELECT
    i.ImportId,
    i.BankCode,
    i.FileName,
    i.PeriodStart,
    i.PeriodEnd,
    COUNT(l.LineId)                                               AS แถวทั้งหมด,
    SUM(CASE WHEN DAY(l.TranDate) <= 12 THEN 1 ELSE 0 END)        AS แถวที่ต้องแก้,
    SUM(CASE WHEN DAY(l.TranDate) <= 12
             THEN ABS(ISNULL(l.Debit, 0)) + ABS(ISNULL(l.Credit, 0))
             ELSE 0 END)                                          AS มูลค่ารวมที่กระทบ
FROM BankStatementImport i
JOIN BankStatementLine  l ON l.ImportId = i.ImportId
WHERE i.FileName LIKE '%.csv'
  AND i.Status = 'SUCCESS'
GROUP BY i.ImportId, i.BankCode, i.FileName, i.PeriodStart, i.PeriodEnd
ORDER BY i.ImportId;

-- 1.2 ดูรายแถวว่าวันที่จะเปลี่ยนจากอะไรเป็นอะไร
SELECT TOP 200
    l.LineId,
    l.ImportId,
    l.TranDate                                                      AS วันที่ปัจจุบัน,
    DATEFROMPARTS(YEAR(l.TranDate), DAY(l.TranDate), MONTH(l.TranDate)) AS วันที่หลังแก้,
    l.Description,
    l.Debit,
    l.Credit,
    UPPER(l.MatchStatus)                                            AS สถานะ
FROM BankStatementLine l
JOIN BankStatementImport i ON i.ImportId = l.ImportId
WHERE i.FileName LIKE '%.csv'
  AND i.Status = 'SUCCESS'
  AND DAY(l.TranDate) <= 12
ORDER BY l.ImportId, l.LineId;


-- ===========================================================================
-- STEP 2 — แก้จริง (อยู่ใน transaction ตรวจผลก่อนแล้วค่อย COMMIT)
-- ===========================================================================
/*
BEGIN TRANSACTION;

    -- 2.1 แก้วันที่ในบรรทัดรายการ
    UPDATE l
    SET l.TranDate = DATEFROMPARTS(YEAR(l.TranDate), DAY(l.TranDate), MONTH(l.TranDate))
    FROM BankStatementLine l
    JOIN BankStatementImport i ON i.ImportId = l.ImportId
    WHERE i.FileName LIKE '%.csv'
      AND i.Status = 'SUCCESS'
      AND DAY(l.TranDate) <= 12;

    PRINT CONCAT('แก้วันที่ไป ', @@ROWCOUNT, ' แถว');

    -- 2.2 อัปเดตช่วงวันที่ที่หัวไฟล์ให้ตรงกับข้อมูลจริงหลังแก้
    UPDATE i
    SET i.PeriodStart = x.MinDate,
        i.PeriodEnd   = x.MaxDate
    FROM BankStatementImport i
    CROSS APPLY (
        SELECT MIN(l.TranDate) AS MinDate, MAX(l.TranDate) AS MaxDate
        FROM BankStatementLine l
        WHERE l.ImportId = i.ImportId
    ) x
    WHERE i.FileName LIKE '%.csv'
      AND i.Status = 'SUCCESS'
      AND x.MinDate IS NOT NULL;

    PRINT CONCAT('อัปเดตช่วงวันที่ของไฟล์ไป ', @@ROWCOUNT, ' ไฟล์');

-- ตรวจผลด้วย STEP 3 ก่อน แล้วค่อยเลือกอย่างใดอย่างหนึ่ง:
-- COMMIT TRANSACTION;
-- ROLLBACK TRANSACTION;
*/


-- ===========================================================================
-- STEP 3 — ตรวจผลหลังแก้
-- ===========================================================================
/*
-- statement หนึ่งไฟล์ควรอยู่ในเดือนเดียว (หรือคาบเกี่ยวไม่เกิน 2 เดือน)
-- ถ้ายังกระจายหลายเดือนอยู่ แปลว่ามีอย่างอื่นผิดด้วย ต้องตรวจกับไฟล์ต้นฉบับ
SELECT
    i.ImportId,
    i.FileName,
    i.PeriodStart,
    i.PeriodEnd,
    COUNT(DISTINCT FORMAT(l.TranDate, 'yyyy-MM')) AS จำนวนเดือนที่พบ,
    MIN(l.TranDate)                               AS วันแรก,
    MAX(l.TranDate)                               AS วันสุดท้าย
FROM BankStatementImport i
JOIN BankStatementLine  l ON l.ImportId = i.ImportId
WHERE i.FileName LIKE '%.csv'
  AND i.Status = 'SUCCESS'
GROUP BY i.ImportId, i.FileName, i.PeriodStart, i.PeriodEnd
ORDER BY i.ImportId;
*/
