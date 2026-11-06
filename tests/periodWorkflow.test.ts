import { describe, expect, it } from 'vitest';
import { approvalsComplete, findBlockingApproval, type WorkApproval } from '../lib/periodWorkflow';

const ap: WorkApproval = { direction: 'OUT', periodStart: '2026-09-01', periodEnd: '2026-09-30',
  confirmedBy: 'ap-user', confirmedAt: '2026-10-01T00:00:00.000Z', note: 'ตรวจสอบแล้ว' };
const ar: WorkApproval = { ...ap, direction: 'IN', confirmedBy: 'ar-user' };

describe('AP/AR independent work locks', () => {
  it('AP confirmation blocks money out but leaves AR open', () => {
    expect(findBlockingApproval([{ date: '2026-09-15', direction: 'OUT' }], [ap])).toEqual(ap);
    expect(findBlockingApproval([{ date: '2026-09-15', direction: 'IN' }], [ap])).toBeUndefined();
  });
  it('AR confirmation blocks money in but leaves AP open', () => {
    expect(findBlockingApproval([{ date: '2026-09-15', direction: 'IN' }], [ar])).toEqual(ar);
    expect(findBlockingApproval([{ date: '2026-09-15', direction: 'OUT' }], [ar])).toBeUndefined();
  });
  it('includes both period boundaries but not adjacent periods', () => {
    for (const date of [ap.periodStart, ap.periodEnd]) expect(findBlockingApproval([{ date, direction: 'OUT' }], [ap])).toEqual(ap);
    for (const date of ['2026-08-31', '2026-10-01']) expect(findBlockingApproval([{ date, direction: 'OUT' }], [ap])).toBeUndefined();
  });
  it('blocks cross-direction offsets if either team has confirmed', () => {
    const dates = [{ date: '2026-09-15', direction: 'IN' as const }, { date: '2026-09-15', direction: 'OUT' as const }];
    expect(findBlockingApproval(dates, [ap])).toEqual(ap);
    expect(findBlockingApproval(dates, [ar])).toEqual(ar);
  });
  it('opening balance affects both teams', () => {
    expect(findBlockingApproval([{ date: ap.periodStart }], [ap])).toEqual(ap);
    expect(findBlockingApproval([{ date: ar.periodStart }], [ar])).toEqual(ar);
  });
  it('reopening one side leaves the other side locked', () => {
    expect(findBlockingApproval([{ date: ap.periodStart, direction: 'OUT' }], [ar])).toBeUndefined();
    expect(findBlockingApproval([{ date: ar.periodStart, direction: 'IN' }], [ar])).toEqual(ar);
  });
});

describe('final close requires both sides for the exact period', () => {
  it.each([[], [ap], [ar], [ap, ap], [ap, { ...ar, periodEnd: '2026-10-01' }], [ap, { ...ar, periodStart: '2026-08-01' }]])(
    'rejects missing, duplicated or differently scoped approvals: %j', (...items) => {
      // it.each spreads array rows; normalize them to the approval list.
      expect(approvalsComplete(items as WorkApproval[], ap.periodStart, ap.periodEnd)).toBe(false);
    },
  );
  it('allows either confirmation order', () => {
    expect(approvalsComplete([ap, ar], ap.periodStart, ap.periodEnd)).toBe(true);
    expect(approvalsComplete([ar, ap], ap.periodStart, ap.periodEnd)).toBe(true);
  });
});
