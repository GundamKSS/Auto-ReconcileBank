import { describe, expect, it, vi } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { cancelledGlEntryNos } from '../lib/cancelledGl';

describe('cancelledGlEntryNos', () => {
  it('hides the four confirmed cancellation pairs, preserving replacement payments', async () => {
    const amounts = [240536, 4368, 29158.88, 25299.25];
    const originals = [895325, 895328, 895331, 904148];
    const reversals = [899179, 899181, 899184, 931974];
    const docs = ['AVPยี้2609-0013', 'AVPยี้2609-0014', 'AVPยี้2609-0015', 'PVDยี้2609-0138'];
    const rows = amounts.flatMap((amount, i) => [
      { Entry_No: originals[i], Bank_Account_No: 'TW_BBL_C1', Document_No: docs[i],
        Source_Code: 'PAYMENTJNL', Debit_Amount_LCY: 0, Credit_Amount_LCY: amount },
      { Entry_No: reversals[i], Bank_Account_No: 'TW_BBL_C1', Document_No: docs[i],
        Source_Code: 'REVERSAL', Debit_Amount_LCY: 0, Credit_Amount_LCY: -amount },
    ]);
    rows.push({ Entry_No: 904119, Bank_Account_No: 'TW_BBL_C1', Document_No: 'PVDยี้2609-0125',
      Source_Code: 'PAYMENTJNL', Debit_Amount_LCY: 0, Credit_Amount_LCY: 240536 });
    const query = vi.fn().mockResolvedValue({ recordset: rows });
    const pool = { request: () => ({ query }) } as unknown as ConnectionPool;
    const hidden = await cancelledGlEntryNos(pool);
    expect([...hidden].sort()).toEqual([...originals, ...reversals].sort());
    expect(hidden.has(904119)).toBe(false);
    // Global lookup must see a counterpart outside the visible dates or local match state.
    const sql = query.mock.calls[0][0] as string;
    expect(sql).not.toMatch(/Posting_Date|ReconciliationMatch/);
  });

  it('keeps unrelated equal amounts and reversals without a matching original', async () => {
    const query = vi.fn().mockResolvedValue({ recordset: [
      { Entry_No: 1, Bank_Account_No: 'BBL', Document_No: 'A', Source_Code: 'PAYMENTJNL', Debit_Amount_LCY: 0, Credit_Amount_LCY: 100 },
      { Entry_No: 2, Bank_Account_No: 'BBL', Document_No: 'B', Source_Code: 'REVERSAL', Debit_Amount_LCY: 0, Credit_Amount_LCY: -100 },
      { Entry_No: 3, Bank_Account_No: 'SCB', Document_No: 'A', Source_Code: 'REVERSAL', Debit_Amount_LCY: 0, Credit_Amount_LCY: -100 },
    ] });
    const pool = { request: () => ({ query }) } as unknown as ConnectionPool;
    expect(await cancelledGlEntryNos(pool)).toEqual(new Set());
  });
});
