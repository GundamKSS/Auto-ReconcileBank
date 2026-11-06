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
});
