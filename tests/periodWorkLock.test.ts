import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ query: vi.fn(), lock: vi.fn(), ready: vi.fn(), approvals: vi.fn() }));
vi.mock('mssql', () => {
  class Transaction {}
  class Request { input() { return this; } query = h.query; }
  return { default: { Transaction, Request, NVarChar: 'string' } };
});
vi.mock('../lib/db', () => ({ getPool: vi.fn() }));
vi.mock('../lib/periodWorkflowDb', () => ({
  lockReconciliationAccount: h.lock, workApprovalReady: h.ready, readWorkApprovals: h.approvals,
}));
import sql from 'mssql';
import { assertDatesOpen, PeriodClosedError } from '../lib/periodClose';

const ap = { direction: 'OUT', periodStart: '2026-09-01', periodEnd: '2026-09-30', confirmedBy: 'ap' };
beforeEach(() => {
  vi.clearAllMocks();
  h.query.mockResolvedValue({ recordset: [] });
  h.ready.mockResolvedValue(true);
  h.approvals.mockResolvedValue([ap]);
});

describe('server-side work lock used by match, unmatch, unsuspend and imports', () => {
  it('locks the account before checking and blocks AP edits', async () => {
    await expect(assertDatesOpen(new sql.Transaction(), 'ACC', [{ date: '2026-09-01', direction: 'OUT' }])).rejects.toThrow(PeriodClosedError);
    expect(h.lock).toHaveBeenCalledWith(expect.anything(), 'ACC');
  });
  it('allows AR edits while AP is confirmed', async () => {
    await expect(assertDatesOpen(new sql.Transaction(), 'ACC', [{ date: '2026-09-01', direction: 'IN' }])).resolves.toBeUndefined();
  });
  it('blocks changes to shared opening balance', async () => {
    await expect(assertDatesOpen(new sql.Transaction(), 'ACC', ['2026-09-01'])).rejects.toThrow('AP');
  });
  it('preserves existing final-period locks for both directions', async () => {
    h.query.mockResolvedValue({ recordset: [{ PeriodStart: '2026-09-01', PeriodEnd: '2026-09-30', ClosedBy: 'manager' }] });
    for (const direction of ['IN', 'OUT'] as const) {
      await expect(assertDatesOpen(new sql.Transaction(), 'ACC', [{ date: '2026-09-30', direction }])).rejects.toThrow('ปิดแล้ว');
    }
  });
  it('does not bypass locks on a database lookup failure', async () => {
    h.ready.mockRejectedValueOnce(new Error('connection failed'));
    await expect(assertDatesOpen(new sql.Transaction(), 'ACC', ['2026-09-01'])).rejects.toThrow('connection failed');
  });
});
