import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({
  query: vi.fn(),
  begin: vi.fn(),
  commit: vi.fn(),
  rollback: vi.fn(),
  auth: vi.fn(),
  workSides: vi.fn(),
  datesOpen: vi.fn(),
}));

vi.mock('mssql', () => {
  class Request {
    input() { return this; }
    query = h.query;
  }
  class Transaction {
    begin = h.begin;
    commit = h.commit;
    rollback = h.rollback;
  }
  return {
    default: {
      Request,
      Transaction,
      Int: 'int',
      BigInt: 'bigint',
      NVarChar: Object.assign(() => 'nvarchar', { type: 'nvarchar' }),
    },
  };
});

vi.mock('../lib/db', () => ({ getPool: vi.fn(async () => ({})) }));
vi.mock('../lib/session', () => ({ requireRole: h.auth, auditActor: () => 'tester (tester)' }));
vi.mock('../lib/bankAccountDb', () => ({ bankAccountColumnsReady: vi.fn(async () => true) }));
vi.mock('../lib/reconcileExtrasDb', () => ({ reconcileExtrasReady: vi.fn(async () => true), EXTRAS_MIGRATION_HINT: '007' }));
vi.mock('../lib/periodClose', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/periodClose')>()),
  assertDatesOpen: h.datesOpen,
  reconcilePeriodCloseReady: vi.fn(async () => true),
  isoDate: (value: Date | string) => new Date(value).toISOString().slice(0, 10),
}));
vi.mock('../lib/workRolesDb', () => ({
  assertWorkSides: h.workSides,
  WorkPermissionError: class extends Error { status = 403; },
}));

import { POST } from '../app/api/reconcile/match/route';
import { PeriodClosedError } from '../lib/periodClose';

const ACC = 'TW_BBL_C1';

describe('POST /api/reconcile/match with Bank Statement OFFSET (เช็คเด้ง)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.query.mockReset();
    h.auth.mockResolvedValue({ ok: true, session: { username: 'tester', role: 'Staff' } });
    h.datesOpen.mockResolvedValue(undefined);
    h.workSides.mockResolvedValue(undefined);
  });

  it('rejects bank offset when remark is missing', async () => {
    const req = new NextRequest('http://localhost/api/reconcile/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bankCode: 'BBL',
        bankAccountNo: ACC,
        matchType: 'OFFSET',
        remark: '   ',
        groups: [{ bankLineIds: [10, 11], glEntryNos: [] }],
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('ระบุเหตุผล');
  });

  it('rejects mixing Bank and GL lines in the same OFFSET group', async () => {
    const req = new NextRequest('http://localhost/api/reconcile/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bankCode: 'BBL',
        bankAccountNo: ACC,
        matchType: 'OFFSET',
        remark: 'ทดสอบ',
        groups: [{ bankLineIds: [10], glEntryNos: [20] }],
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('การจับชน (OFFSET) ต้องเป็นฝั่ง GL ทั้งหมด หรือฝั่ง Bank ทั้งหมด');
  });

  it('successfully offsets 1 IN and 1 OUT Bank lines with equal amount', async () => {
    h.query.mockImplementation(async (sqlText: string) => {
      const q = String(sqlText);
      if (q.includes('UPPER(MatchStatus) AS MatchStatus')) {
        return { recordset: [{ LineId: 10, MatchStatus: 'UNMATCHED' }, { LineId: 11, MatchStatus: 'UNMATCHED' }] };
      }
      if (q.includes('SELECT DISTINCT BankAccountNo FROM BankStatementLine')) {
        return { recordset: [{ BankAccountNo: ACC }] };
      }
      if (q.includes('SELECT TranDate')) {
        return {
          recordset: [
            { TranDate: new Date('2026-08-20T00:00:00Z'), Direction: 'OUT' },
            { TranDate: new Date('2026-08-15T00:00:00Z'), Direction: 'IN' },
          ],
        };
      }
      if (q.includes('FROM BankStatementLine WHERE LineId IN (10,11)')) {
        return {
          recordset: [
            { Net: 0, InCount: 1, OutCount: 1, ZeroCount: 0, AccountCount: 1 },
          ],
        };
      }
      if (q.includes('INSERT INTO ReconciliationMatch (')) {
        return { recordset: [{ MatchId: 200 }] };
      }
      if (q.includes('INSERT INTO ReconciliationMatchLine')) {
        return { rowsAffected: [1] };
      }
      if (q.includes('UPDATE BankStatementLine')) {
        return { rowsAffected: [2] };
      }
      throw new Error(`unexpected query: ${q}`);
    });

    const req = new NextRequest('http://localhost/api/reconcile/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bankCode: 'BBL',
        bankAccountNo: ACC,
        matchType: 'OFFSET',
        remark: 'เช็คเลขที่ 001234 เด้ง คืนยอดตัดเงิน',
        groups: [{ bankLineIds: [10, 11], glEntryNos: [] }],
      }),
    });

    const res = await POST(req);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.matchId).toBe(200);
    expect(h.commit).toHaveBeenCalled();
  });

  it('rejects bank offset when either line is in a closed period', async () => {
    h.query.mockImplementation(async (sqlText: string) => {
      const q = String(sqlText);
      if (q.includes('UPPER(MatchStatus) AS MatchStatus')) {
        return { recordset: [{ LineId: 10, MatchStatus: 'UNMATCHED' }, { LineId: 11, MatchStatus: 'UNMATCHED' }] };
      }
      if (q.includes('SELECT DISTINCT BankAccountNo FROM BankStatementLine')) {
        return { recordset: [{ BankAccountNo: ACC }] };
      }
      if (q.includes('SELECT TranDate')) {
        return {
          recordset: [
            { TranDate: new Date('2026-07-20T00:00:00Z'), Direction: 'OUT' },
            { TranDate: new Date('2026-08-15T00:00:00Z'), Direction: 'IN' },
          ],
        };
      }
      throw new Error(`unexpected query: ${q}`);
    });

    h.datesOpen.mockRejectedValueOnce(new PeriodClosedError('งวด 2026-07-01 ถึง 2026-07-31 ของบัญชีนี้ปิดแล้ว'));

    const req = new NextRequest('http://localhost/api/reconcile/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bankCode: 'BBL',
        bankAccountNo: ACC,
        matchType: 'OFFSET',
        remark: 'เช็คเด้ง',
        groups: [{ bankLineIds: [10, 11], glEntryNos: [] }],
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain('ปิดแล้ว');
    expect(h.rollback).toHaveBeenCalled();
  });
});
