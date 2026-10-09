import type { ConnectionPool } from 'mssql';
import { glSignedAmount } from './glAmount';
import { findReversalPairs } from './glOffset';

// Search the complete ledger, before date and local match-status filters.
// A reversal can be posted outside the visible period or already locally matched.
export async function cancelledGlEntryNos(pool: ConnectionPool): Promise<Set<number>> {
  const result = await pool.request().query(`
    SELECT e.Entry_No, e.Bank_Account_No, e.Document_No, e.Source_Code,
           e.Debit_Amount_LCY, e.Credit_Amount_LCY
    FROM dbo.BankAccountLedgerEntries e
    WHERE EXISTS (
      SELECT 1 FROM dbo.BankAccountLedgerEntries r
      WHERE UPPER(LTRIM(RTRIM(r.Source_Code))) = 'REVERSAL'
        AND r.Bank_Account_No = e.Bank_Account_No
        AND r.Document_No = e.Document_No
    )
  `);
  const pairs = findReversalPairs(result.recordset.map((r) => ({
    entryNo: Number(r.Entry_No),
    accountNo: r.Bank_Account_No ?? '',
    documentNo: r.Document_No,
    sourceCode: r.Source_Code,
    signedAmount: glSignedAmount(r),
  })));
  return new Set(pairs.flatMap((p) => [p.originalEntryNo, p.reversalEntryNo]));
}
