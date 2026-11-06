import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({
  query: vi.fn(), begin: vi.fn(), commit: vi.fn(), rollback: vi.fn(),
  auth: vi.fn(), workSides: vi.fn(), datesOpen: vi.fn(),
}));
vi.mock('mssql', () => {
  class Request {
    input() { return this; }
    query = h.query;
  }
  class Transaction { begin = h.begin; commit = h.commit; rollback = h.rollback; }
  return { default: { Request, Transaction, Int: 'int', BigInt: 'bigint', NVarChar: Object.assign(() => 'nvarchar', { type: 'nvarchar' }) } };
});
vi.mock('../lib/db', () => ({ getPool: vi.fn(async () => ({})) }));
vi.mock('../lib/session', () => ({ requireRole: h.auth, auditActor: () => 'tester (tester)' }));
vi.mock('../lib/bankAccountDb', () => ({ bankAccountColumnsReady: vi.fn(async () => true) }));
vi.mock('../lib/reconcileExtrasDb', () => ({ reconcileExtrasReady: vi.fn(async () => true), EXTRAS_MIGRATION_HINT: '007' }));
vi.mock('../lib/periodClose', () => ({
  assertDatesOpen: h.datesOpen,
  reconcilePeriodCloseReady: vi.fn(async () => true),
  isoDate: (value: Date | string) => new Date(value).toISOString().slice(0, 10),
}));
vi.mock('../lib/workRolesDb', () => ({ assertWorkSides: h.workSides, WorkPermissionError: class extends Error { status = 403; } }));

import { POST } from '../app/api/reconcile/match/route';

const ACC = 'TW_BBL_C1';

// ตอบตามข้อความ SQL แทนลำดับการเรียก — route ยิงหลาย query ตามจำนวนบรรทัด
function mockDb(bankIds: number[], updatedRows: number) {
  h.query.mockImplementation(async (text: string) => {
    const q = String(text);
    if (q.includes('UPPER(MatchStatus) AS MatchStatus')) return { recordset: bankIds.map((id) => ({ LineId: id, MatchStatus: 'UNMATCHED' })) };
    if (q.includes('COUNT(DISTINCT Entry_No)')) return { recordset: [{ N: 1 }] };
    if (q.includes('SELECT DISTINCT rml.GLEntryNo')) return { recordset: [] };
    if (q.includes('SELECT DISTINCT Bank_Account_No')) return { recordset: [{ Bank_Account_No: ACC }] };
    if (q.includes('SELECT DISTINCT BankAccountNo FROM BankStatementLine')) return { recordset: [] };
    if (q.includes('SELECT TranDate')) return { recordset: bankIds.map(() => ({ TranDate: new Date('2026-10-05T00:00:00Z'), Direction: 'OUT' })) };
    if (q.includes('SELECT Posting_Date')) return { recordset: [{ Posting_Date: new Date('2026-10-05T00:00:00Z'), Direction: 'OUT' }] };
    if (q.includes('SUM(') && q.includes('FROM BankStatementLine')) return { recordset: [{ Total: -31030 }] };
    if (q.includes('SUM(') && q.includes('FROM BankAccountLedgerEntries')) return { recordset: [{ Total: -31030 }] };
    if (q.includes('INSERT INTO ReconciliationMatch (')) return { recordset: [{ MatchId: 100 }] };
    if (q.includes('INSERT INTO ReconciliationMatchLine')) return { rowsAffected: [1] };
    if (q.includes('UPDATE BankStatementLine')) return { rowsAffected: [updatedRows] };
    throw new Error(`unexpected SQL in test: ${q}`);
  });
}

const request = (bankLineIds: number[]) => new NextRequest('http://localhost/api/reconcile/match', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ bankCode: 'BBL', bankAccountNo: ACC, matchType: 'MATCHED', groups: [{ bankLineIds, glEntryNos: [1] }] }),
});

beforeEach(() => {
  vi.clearAllMocks();
  h.query.mockReset();
  h.auth.mockResolvedValue({ ok: true, session: { username: 'tester', role: 'Admin' } });
  h.datesOpen.mockResolvedValue(undefined);
  h.workSides.mockResolvedValue(undefined);
});

describe('POST /api/reconcile/match กันจับคู่ statement ซ้ำ (mocked DB; no financial data writes)', () => {
  it('เปลี่ยนสถานะเฉพาะ statement ที่ยังไม่จับคู่ แล้วบันทึกตามปกติ', async () => {
    mockDb([50], 1);
    const response = await POST(request([50]));

    expect(response.status).toBe(200);
    expect((await response.json()).matchId).toBe(100);
    const update = h.query.mock.calls.map((c) => String(c[0])).find((q) => q.includes('UPDATE BankStatementLine'));
    expect(update).toContain("AND MatchStatus = 'UNMATCHED'");
    expect(h.commit).toHaveBeenCalledOnce();
    expect(h.rollback).not.toHaveBeenCalled();
  });

  it('ล็อกรายการ BC365 ตอนเช็คว่ายังว่าง คำขอที่จับ BC365 ตัวเดียวกันพร้อมกันต้องรอแล้วเห็นว่าถูกใช้ไปแล้ว', async () => {
    mockDb([50], 1);
    await POST(request([50]));
    const check = h.query.mock.calls.map((c) => String(c[0])).find((q) => q.includes('SELECT DISTINCT rml.GLEntryNo'));
    expect(check).toContain('ReconciliationMatchLine rml WITH (UPDLOCK, HOLDLOCK)');
  });

  it('BC365 ถูกจับคู่ไปแล้วตอนเช็ค ปฏิเสธโดยไม่บันทึกอะไร', async () => {
    mockDb([50], 1);
    const base = h.query.getMockImplementation()!;
    h.query.mockImplementation(async (text: string) =>
      String(text).includes('SELECT DISTINCT rml.GLEntryNo') ? { recordset: [{ GLEntryNo: 1 }] } : base(text));

    const response = await POST(request([50]));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain('ถูกจับคู่ไปแล้ว');
    expect(h.query.mock.calls.some((c) => String(c[0]).includes('INSERT INTO'))).toBe(false);
    expect(h.rollback).toHaveBeenCalledOnce();
  });

  it('statement ถูกอีกคนจับคู่ตัดหน้าระหว่างบันทึก ยกเลิกทั้งหมดและบอกให้รีเฟรช', async () => {
    mockDb([50], 0);
    const response = await POST(request([50]));

    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain('เพิ่งถูกจับคู่ไประหว่างบันทึก');
    expect(h.rollback).toHaveBeenCalledOnce();
    expect(h.commit).not.toHaveBeenCalled();
  });

  it('statement หลายบรรทัด ถูกตัดหน้าไปบรรทัดเดียวก็ยกเลิกทั้งคู่', async () => {
    h.query.mockReset();
    mockDb([50, 51], 1);
    // ยอดสองฝั่งต้องดุลกัน: statement 2 บรรทัดรวม 31,030 เท่ากับ BC365 1 รายการ
    const response = await POST(request([50, 51]));

    expect(response.status).toBe(409);
    expect(h.rollback).toHaveBeenCalledOnce();
    expect(h.commit).not.toHaveBeenCalled();
  });
});
