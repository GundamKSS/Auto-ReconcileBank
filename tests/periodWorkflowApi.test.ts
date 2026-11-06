import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({
  query: vi.fn(), begin: vi.fn(), commit: vi.fn(), rollback: vi.fn(),
  auth: vi.fn(), ready: vi.fn(), approvals: vi.fn(), fingerprint: vi.fn(), event: vi.fn(), lock: vi.fn(), proof: vi.fn(),
  workRole: vi.fn(),
}));
vi.mock('mssql', () => {
  class Request {
    input() { return this; }
    query = h.query;
  }
  class Transaction { begin = h.begin; commit = h.commit; rollback = h.rollback; }
  return { default: { Request, Transaction, RequestError: class extends Error {}, NVarChar: () => null,
    VarChar: () => null, Date: 'date', Decimal: () => null } };
});
vi.mock('../lib/db', () => ({ getPool: vi.fn().mockResolvedValue({}) }));
vi.mock('../lib/session', () => ({ requireRole: h.auth, auditActor: () => 'tester', auditWorkActor: () => 'tester' }));
vi.mock('../lib/bankAccountDb', () => ({ resolveBankAccount: vi.fn().mockResolvedValue({ bankAccountNo: 'ACC', bankCode: 'BBL' }) }));
vi.mock('../lib/periodClose', () => ({
  reconcilePeriodCloseReady: vi.fn().mockResolvedValue(true), PERIOD_CLOSE_MIGRATION_HINT: '008',
  isoDate: (value: Date) => value.toISOString().slice(0, 10),
}));
vi.mock('../lib/periodWorkflowDb', () => ({
  workApprovalReady: h.ready, readWorkApprovals: h.approvals, workFingerprint: h.fingerprint,
  recordPeriodEvent: h.event, lockReconciliationAccount: h.lock, WORK_APPROVAL_MIGRATION_HINT: '009',
}));
vi.mock('../lib/balanceProof', () => ({ computeBalanceProof: h.proof }));
vi.mock('../lib/workRolesDb', () => ({ assertWorkRole: h.workRole, WorkPermissionError: class extends Error { status = 403; } }));

import { POST as confirm, PATCH as reopenWork } from '../app/api/reconcile/work-approval/route';
import { POST as close, PATCH as reopenPeriod } from '../app/api/reconcile/period-close/route';
import { WorkPermissionError } from '../lib/workRolesDb';

const body = { bankAccountNo: 'ACC', periodStart: '2026-09-01', periodEnd: '2026-09-30',
  direction: 'OUT', note: 'ตรวจสอบรายการค้างแล้ว', acknowledged: true, reason: 'แก้ไขรายการที่ผิดพลาด' };
const ap = { direction: 'OUT', periodStart: body.periodStart, periodEnd: body.periodEnd,
  confirmedBy: 'ap', confirmedAt: '2026-10-01T00:00:00Z', note: 'ตรวจสอบแล้ว', fingerprint: 'same' };
const ar = { ...ap, direction: 'IN' };
const request = (overrides = {}) => new NextRequest('http://localhost/api/reconcile/work-approval', {
  method: 'POST', body: JSON.stringify({ ...body, ...overrides }), headers: { 'Content-Type': 'application/json' },
});

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue({ ok: true, session: {} });
  h.workRole.mockReset();
  h.ready.mockResolvedValue(true);
  h.approvals.mockResolvedValue([]);
  h.fingerprint.mockResolvedValue('same');
  h.query.mockResolvedValue({ recordset: [], rowsAffected: [1] });
  h.proof.mockResolvedValue({ adjustment: { remaining: 0 }, bank: { closing: 100 }, gl: { closing: 100 } });
});

describe('work approval API (mocked DB; no financial data writes)', () => {
  it('confirms AP and writes an audit event under the account lock', async () => {
    expect((await confirm(request())).status).toBe(200);
    expect(h.lock).toHaveBeenCalledOnce();
    expect(h.workRole).toHaveBeenCalledWith(expect.anything(), 'AP', expect.anything());
    expect(h.event).toHaveBeenCalledWith(expect.anything(), 'ACC', expect.any(Date), expect.any(Date), 'CONFIRM', 'OUT', 'tester', body.note);
    expect(h.commit).toHaveBeenCalledOnce();
  });
  it('allows AR confirmation after AP for the same period', async () => {
    h.approvals.mockResolvedValue([ap]);
    expect((await confirm(request({ direction: 'IN' }))).status).toBe(200);
    expect(h.workRole).toHaveBeenCalledWith(expect.anything(), 'AR', expect.anything());
  });
  it('closes the period immediately when the second side confirms (no separate close step)', async () => {
    // ก่อนบันทึกมีแค่ AP — หลังบันทึก AR แล้วครบทั้งสองฝั่ง
    h.approvals.mockResolvedValueOnce([ap]).mockResolvedValue([ap, ar]);
    const response = await confirm(request({ direction: 'IN' }));
    expect(response.status).toBe(200);
    expect((await response.json()).closed).toBe(true);
    expect(h.query).toHaveBeenCalledWith(expect.stringContaining('MERGE ReconciliationPeriodClose'));
    expect(h.event).toHaveBeenCalledWith(expect.anything(), 'ACC', expect.any(Date), expect.any(Date), 'CLOSE', null, 'tester', expect.stringContaining('ปิดอัตโนมัติ'));
    expect(h.commit).toHaveBeenCalledOnce();
  });
  it('rejects the second confirmation entirely when the period cannot close (unsettled balance)', async () => {
    h.approvals.mockResolvedValueOnce([ap]).mockResolvedValue([ap, ar]);
    h.proof.mockResolvedValue({ adjustment: { remaining: 12.5 } });
    const response = await confirm(request({ direction: 'IN' }));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain('ยอดคงเหลือยังไม่เท่ากัน');
    expect(h.commit).not.toHaveBeenCalled();
    expect(h.rollback).toHaveBeenCalledOnce();
  });
  it('the first confirmation does not try to close', async () => {
    expect((await (await confirm(request())).json()).closed).toBe(false);
    expect(h.proof).not.toHaveBeenCalled();
  });
  it.each([{ direction: 'OTHER' }, { acknowledged: false }, { note: '' }, { periodEnd: '2026-08-01' }])(
    'rejects invalid inputs without writes: %j', async (overrides) => {
      expect((await confirm(request(overrides))).status).toBe(400);
      expect(h.commit).not.toHaveBeenCalled();
    },
  );
  it('rejects missing migration without writes', async () => {
    h.ready.mockResolvedValue(false);
    expect((await confirm(request())).status).toBe(409);
    expect(h.query).not.toHaveBeenCalled();
  });
  it('does not allow a second confirmation or overlapping range to bypass the lock', async () => {
    h.approvals.mockResolvedValue([ap]);
    expect((await confirm(request())).status).toBe(409);
    expect((await confirm(request({ direction: 'IN', periodEnd: '2026-10-01' }))).status).toBe(409);
    expect(h.commit).not.toHaveBeenCalled();
  });
  it('rejects confirmation or work reopening when the whole period is closed', async () => {
    h.query.mockResolvedValue({ recordset: [{ PeriodStart: body.periodStart }] });
    expect((await confirm(request())).status).toBe(409);
    expect((await reopenWork(request())).status).toBe(409);
  });
  it('reopens only the selected side and retains an audit reason', async () => {
    h.approvals.mockResolvedValue([ap, ar]);
    expect((await reopenWork(request())).status).toBe(200);
    expect(h.query).toHaveBeenCalledWith(expect.stringContaining('AND Direction=@direction'));
    expect(h.event).toHaveBeenCalledWith(expect.anything(), 'ACC', expect.any(Date), expect.any(Date), 'REOPEN_WORK', 'OUT', 'tester', body.note);
  });
  it('does not silently reopen a different date range', async () => {
    h.approvals.mockResolvedValue([ap]);
    expect((await reopenWork(request({ periodEnd: '2026-10-01' }))).status).toBe(409);
  });
});

describe('final period close API', () => {
  it('rejects unauthorized workflow roles before any workflow writes', async () => {
    for (const action of [confirm, reopenWork, close, reopenPeriod]) {
      h.workRole.mockRejectedValueOnce(new WorkPermissionError('ไม่มีสิทธิ์'));
      expect((await action(request())).status).toBe(403);
    }
    expect(h.commit).not.toHaveBeenCalled();
    expect(h.event).not.toHaveBeenCalled();
  });
  it('rejects close until both sides have confirmed the exact range', async () => {
    for (const approvals of [[], [ap], [ar], [ap, { ...ar, periodEnd: '2026-10-01' }]]) {
      h.approvals.mockResolvedValue(approvals);
      expect((await close(request())).status).toBe(409);
    }
    expect(h.commit).not.toHaveBeenCalled();
  });
  it('requires the workflow migration (no legacy close bypass)', async () => {
    h.ready.mockResolvedValue(false);
    expect((await close(request())).status).toBe(409);
    expect(h.commit).not.toHaveBeenCalled();
  });
  it.each([null, 0.005, -0.005, 100, Number.NaN])('rejects unsettled balance %s', async (remaining) => {
    h.approvals.mockResolvedValue([ap, ar]);
    h.proof.mockResolvedValue({ adjustment: { remaining } });
    expect((await close(request())).status).toBe(409);
    expect(h.commit).not.toHaveBeenCalled();
  });
  it('rejects ERP data changes since approval', async () => {
    h.approvals.mockResolvedValue([ap, ar]);
    h.fingerprint.mockResolvedValue('changed-by-sync');
    const response = await close(request());
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain('เปลี่ยนหลังยืนยัน');
    expect(h.commit).not.toHaveBeenCalled();
  });
  it('closes only with both current confirmations and settled balance', async () => {
    h.approvals.mockResolvedValue([ap, ar]);
    expect((await close(request())).status).toBe(200);
    expect(h.workRole).toHaveBeenCalledWith(expect.anything(), 'MASTER', expect.anything());
    expect(h.commit).toHaveBeenCalledOnce();
    expect(h.event).toHaveBeenCalledWith(expect.anything(), 'ACC', expect.any(Date), expect.any(Date), 'CLOSE', null, 'tester', expect.any(String));
  });
  it('reopening the final close clears both confirmations atomically', async () => {
    h.query.mockResolvedValue({ recordset: [{ PeriodEnd: '2026-09-30' }], rowsAffected: [1] });
    expect((await reopenPeriod(request())).status).toBe(200);
    expect(h.workRole).toHaveBeenCalledWith(expect.anything(), 'MASTER', expect.anything());
    expect(h.query).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM ReconciliationWorkApproval'));
    expect(h.event).toHaveBeenCalledWith(expect.anything(), 'ACC', expect.any(Date), expect.any(Date), 'REOPEN_PERIOD', null, 'tester', body.reason);
    expect(h.commit).toHaveBeenCalledOnce();
  });
  it('requires a reason to reopen the period', async () => {
    expect((await reopenPeriod(request({ reason: '' }))).status).toBe(400);
    expect(h.commit).not.toHaveBeenCalled();
  });
  it('enforces authorization for every action', async () => {
    h.auth.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });
    for (const action of [confirm, reopenWork, close, reopenPeriod]) expect((await action(request())).status).toBe(403);
    expect(h.query).not.toHaveBeenCalled();
  });
});
