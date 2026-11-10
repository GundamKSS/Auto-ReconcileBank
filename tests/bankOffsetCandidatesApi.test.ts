import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({
  query: vi.fn(),
  auth: vi.fn(),
  workSides: vi.fn(),
  datesOpen: vi.fn(),
  periodReady: vi.fn(),
}));

vi.mock('mssql', () => {
  class Request {
    input() { return this; }
    query = h.query;
  }
  return { default: { Request, Int: 'int', Decimal: () => 'decimal', NVarChar: 'nvarchar' } };
});

vi.mock('../lib/db', () => ({
  getPool: vi.fn(async () => ({
    request: () => new (class {
      input() { return this; }
      query = h.query;
    })(),
  })),
}));

vi.mock('../lib/session', () => ({
  requireRole: h.auth,
  auditActor: () => 'tester (tester)',
}));

vi.mock('../lib/periodClose', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/periodClose')>()),
  assertDatesOpen: h.datesOpen,
  reconcilePeriodCloseReady: h.periodReady,
}));

vi.mock('../lib/workRolesDb', () => ({
  assertWorkSides: h.workSides,
  WorkPermissionError: class extends Error { status = 403; },
}));

import { GET } from '../app/api/reconcile/bank-offset-candidates/route';

describe('GET /api/reconcile/bank-offset-candidates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.auth.mockResolvedValue({ ok: true, session: { username: 'tester', role: 'Staff' } });
    h.periodReady.mockResolvedValue(true);
    h.workSides.mockResolvedValue(undefined);
    h.datesOpen.mockResolvedValue(undefined);
  });

  it('rejects without lineId param', async () => {
    const req = new NextRequest('http://localhost/api/reconcile/bank-offset-candidates');
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it('returns candidate lines matching amount on the opposite side', async () => {
    const sourceLine = {
      LineId: 101,
      BankCode: 'BBL',
      BankAccountNo: 'TW_BBL_C1',
      TranDate: new Date('2026-08-20T00:00:00Z'),
      Description: 'CHQ RETURNED',
      Debit: 200000,
      Credit: null,
      Balance: 500000,
      ChequeNo: '001234',
      Channel: 'TR',
      RawDescription: 'CHEQUE RETURNED',
      SenderBank: null,
      SenderAccountNo: null,
      SenderAccountName: null,
      MatchStatus: 'UNMATCHED',
    };

    const candidateLine = {
      LineId: 88,
      BankCode: 'BBL',
      BankAccountNo: 'TW_BBL_C1',
      TranDate: new Date('2026-08-15T00:00:00Z'),
      Description: 'DEPOSIT CHQ',
      Debit: null,
      Credit: 200000,
      Balance: 700000,
      ChequeNo: '001234',
      Channel: 'TR',
      RawDescription: 'DEPOSIT CHEQUE',
      SenderBank: 'BBL',
      SenderAccountNo: '111222',
      SenderAccountName: 'CUSTOMER A',
    };

    h.query
      .mockResolvedValueOnce({ recordset: [sourceLine] }) // source
      .mockResolvedValueOnce({ recordset: [candidateLine] }); // candidates

    const req = new NextRequest('http://localhost/api/reconcile/bank-offset-candidates?lineId=101');
    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.sourceLine.lineId).toBe(101);
    expect(body.sourceLine.direction).toBe('OUT');
    expect(body.sourceLine.amount).toBe(200000);
    expect(body.candidates).toHaveLength(1);
    expect(body.candidates[0].lineId).toBe(88);
    expect(body.candidates[0].direction).toBe('IN');
    expect(body.candidates[0].amount).toBe(200000);
    expect(body.candidates[0].isPeriodClosed).toBe(false);
  });

  it('includes already-offset candidates with offsetRemark and counterpart info', async () => {
    const sourceLine = {
      LineId: 102,
      BankCode: 'SCB',
      BankAccountNo: 'TW_SCB_C1',
      TranDate: new Date('2026-10-06T00:00:00Z'),
      Description: 'Clearing Cheque Deposit',
      Debit: null,
      Credit: 55404.6,
      Balance: 500000,
      ChequeNo: '00000000',
      Channel: 'CHQ',
      RawDescription: 'Clearing Cheque Deposit',
      SenderBank: null,
      SenderAccountNo: null,
      SenderAccountName: null,
      MatchStatus: 'UNMATCHED',
    };

    const offsetCandidateLine = {
      LineId: 99,
      BankCode: 'SCB',
      BankAccountNo: 'TW_SCB_C1',
      TranDate: new Date('2026-10-05T00:00:00Z'),
      Description: 'Correction for Clearing Cheque Deposit',
      Debit: 55404.6,
      Credit: null,
      Balance: 444595.4,
      ChequeNo: '00000000',
      Channel: 'CHQ',
      RawDescription: 'Correction for Clearing Cheque Deposit',
      SenderBank: null,
      SenderAccountNo: null,
      SenderAccountName: null,
      MatchStatus: 'OFFSET',
      OffsetMatchId: 405,
      OffsetNum: 1,
      OffsetRemark: 'อย่าลืมใส่',
      OffsetBy: 'ap_staff',
      CounterpartLineId: 101,
      CounterpartDate: new Date('2026-10-05T00:00:00Z'),
      CounterpartChequeNo: '00000000',
      CounterpartDescription: 'Clearing Cheque Deposit',
    };

    h.query
      .mockResolvedValueOnce({ recordset: [sourceLine] })
      .mockResolvedValueOnce({ recordset: [offsetCandidateLine] });

    const req = new NextRequest('http://localhost/api/reconcile/bank-offset-candidates?lineId=102');
    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.candidates).toHaveLength(1);
    expect(body.candidates[0]).toMatchObject({
      lineId: 99,
      isOffset: true,
      offsetMatchId: 405,
      offsetNum: 1,
      offsetRemark: 'อย่าลืมใส่',
      offsetBy: 'ap_staff',
      offsetCounterpartRef: 'Chq 00000000',
      offsetCounterpartDate: '2026-10-05',
    });
  });
});
