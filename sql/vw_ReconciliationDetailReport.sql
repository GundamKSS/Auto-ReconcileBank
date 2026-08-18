/* =====================================================================
   vw_ReconciliationDetailReport
   1 แถว = 1 บรรทัดย่อย (SourceType = BANK หรือ GL) ของแต่ละ MatchId
   ใช้สำหรับออกรีพอร์ตแบบละเอียด (ดูได้ทั้งฝั่ง Bank / GL / Suspense)
   ===================================================================== */
CREATE OR ALTER VIEW dbo.vw_ReconciliationDetailReport AS
SELECT
    -- ---------- หัวรายการ Match ----------
    rm.MatchId,
    rm.BankCode                                            AS MatchBankCode,
    rm.MatchType,                                          -- 'MATCHED' | 'SUSPENSE'
    rm.CreatedBy,
    rm.CreatedAt,
    rml.Num                                                AS GroupNum,       -- เลขกลุ่มย่อยภายใน MatchId เดียวกัน
    rml.SourceType,                                        -- 'BANK' | 'GL'

    -- ---------- ฝั่ง Bank Statement ----------
    bsl.LineId                                             AS BankLineId,
    bsl.ImportId                                           AS BankImportId,
    bsi.FileName                                           AS BankImportFileName,
    bsi.PeriodStart                                        AS BankImportPeriodStart,
    bsi.PeriodEnd                                          AS BankImportPeriodEnd,
    bsl.BankCode                                           AS BankLineBankCode,
    bsl.TranDate                                           AS BankTranDate,
    bsl.Description                                        AS BankDescription,
    bsl.RawDescription                                     AS BankRawDescription,
    bsl.Debit                                              AS BankDebit,
    bsl.Credit                                             AS BankCredit,
    bsl.Balance                                            AS BankBalance,
    bsl.ChequeNo                                           AS BankChequeNo,
    bsl.Channel                                            AS BankChannel,
    bsl.MatchStatus                                        AS BankMatchStatus, -- สถานะปัจจุบันของบรรทัด (UNMATCHED/MATCHED/SUSPENSE)

    -- ---------- ฝั่ง GL (BC365) ----------
    e.Entry_No                                             AS GLEntryNo,
    e.Posting_Date                                         AS GLPostingDate,
    e.Document_No                                          AS GLDocumentNo,
    e.Bank_Account_No                                      AS GLBankAccountNo,
    m.BankCode                                             AS GLMappedBankCode,
    m.BankAccountName                                      AS GLBankAccountName,
    e.Debit_Amount_LCY                                     AS GLDebitAmountLCY,
    e.Credit_Amount_LCY                                    AS GLCreditAmountLCY,

    -- ---------- ค่ารวม (unified) ใช้ sort/filter/summary ได้ทันที ----------
    CASE
        WHEN rml.SourceType = 'BANK' THEN CASE WHEN bsl.Credit IS NOT NULL THEN 'IN' ELSE 'OUT' END
        WHEN rml.SourceType = 'GL'   THEN CASE WHEN e.Debit_Amount_LCY > 0 THEN 'IN' ELSE 'OUT' END
    END                                                     AS Direction,

    CASE
        WHEN rml.SourceType = 'BANK' THEN COALESCE(bsl.Credit, bsl.Debit)
        WHEN rml.SourceType = 'GL'   THEN CASE WHEN e.Debit_Amount_LCY > 0
                                                THEN e.Debit_Amount_LCY
                                                ELSE e.Credit_Amount_LCY END
    END                                                     AS Amount,

    CASE
        WHEN rml.SourceType = 'BANK' THEN bsl.TranDate
        WHEN rml.SourceType = 'GL'   THEN e.Posting_Date
    END                                                     AS TranDate,

    CASE
        WHEN rml.SourceType = 'BANK' THEN COALESCE(NULLIF(bsl.ChequeNo, '0'), CONCAT('L-', bsl.LineId))
        WHEN rml.SourceType = 'GL'   THEN e.Document_No
    END                                                     AS RefNo

FROM dbo.ReconciliationMatch rm
JOIN dbo.ReconciliationMatchLine rml
    ON rml.MatchId = rm.MatchId

LEFT JOIN dbo.BankStatementLine bsl
    ON rml.SourceType = 'BANK' AND bsl.LineId = rml.BankLineId
LEFT JOIN dbo.BankStatementImport bsi
    ON bsi.ImportId = bsl.ImportId

LEFT JOIN dbo.BankAccountLedgerEntries e
    ON rml.SourceType = 'GL' AND e.Entry_No = rml.GLEntryNo
LEFT JOIN dbo.BankAccountMapping m
    ON m.BankAccountNo = e.Bank_Account_No;
GO


/* =====================================================================
   vw_ReconciliationPairReport (ทางเลือก)
   1 แถว = 1 คู่ Bank-GL ภายในกลุ่มย่อยเดียวกัน (แบบตารางกว้าง เทียบข้างกัน)
   เหมาะกับรีพอร์ตสรุปเปรียบเทียบ ไม่เหมาะกับกลุ่มที่มีหลายรายการฝั่งเดียว (จะเกิด cross join ภายในกลุ่ม)
   ===================================================================== */
CREATE OR ALTER VIEW dbo.vw_ReconciliationPairReport AS
SELECT
    rm.MatchId,
    rm.BankCode,
    rm.MatchType,
    rm.CreatedBy,
    rm.CreatedAt,
    rmlBank.Num                    AS GroupNum,

    bsl.LineId                     AS BankLineId,
    bsl.TranDate                   AS BankTranDate,
    bsl.Description                AS BankDescription,
    COALESCE(bsl.Credit, bsl.Debit) AS BankAmount,
    CASE WHEN bsl.Credit IS NOT NULL THEN 'IN' ELSE 'OUT' END AS BankDirection,

    e.Entry_No                     AS GLEntryNo,
    e.Posting_Date                 AS GLPostingDate,
    e.Document_No                  AS GLDocumentNo,
    m.BankAccountName              AS GLBankAccountName,
    CASE WHEN e.Debit_Amount_LCY > 0 THEN e.Debit_Amount_LCY ELSE e.Credit_Amount_LCY END AS GLAmount,
    CASE WHEN e.Debit_Amount_LCY > 0 THEN 'IN' ELSE 'OUT' END AS GLDirection

FROM dbo.ReconciliationMatch rm
JOIN dbo.ReconciliationMatchLine rmlBank
    ON rmlBank.MatchId = rm.MatchId AND rmlBank.SourceType = 'BANK'
JOIN dbo.BankStatementLine bsl
    ON bsl.LineId = rmlBank.BankLineId
JOIN dbo.ReconciliationMatchLine rmlGL
    ON rmlGL.MatchId = rm.MatchId AND rmlGL.SourceType = 'GL' AND rmlGL.Num = rmlBank.Num
JOIN dbo.BankAccountLedgerEntries e
    ON e.Entry_No = rmlGL.GLEntryNo
LEFT JOIN dbo.BankAccountMapping m
    ON m.BankAccountNo = e.Bank_Account_No;
GO
