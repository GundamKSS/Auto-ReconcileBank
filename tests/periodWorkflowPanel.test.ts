import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import PeriodWorkflowPanel from '../app/reconcile/components/PeriodWorkflowPanel';
import type { BalanceData } from '../app/reconcile/components/balanceTypes';
import type { WorkApproval } from '../lib/periodWorkflow';
import { WORK_ROLES, type WorkRole } from '../lib/workRoles';

const ap: WorkApproval = { direction: 'OUT', periodStart: '2026-09-01', periodEnd: '2026-09-30',
  confirmedBy: 'AP reviewer', confirmedAt: '2026-10-01T00:00:00Z', note: 'ตรวจสอบครบแล้ว' };
const ar: WorkApproval = { ...ap, direction: 'IN' };
function render(approvals: WorkApproval[], remaining: number | null = 0, ready = true, roles: readonly WorkRole[] = WORK_ROLES) {
  const data = { period: { from: ap.periodStart, to: ap.periodEnd }, periodClose: { status: 'OPEN' },
    adjustment: { remaining }, workApproval: { ready, approvals, permissions: { ready: true, employeeCode: '001', roles: [...roles] } } } as BalanceData;
  return renderToStaticMarkup(createElement(PeriodWorkflowPanel, {
    data, onWorkApproval: vi.fn(), onClosePeriod: vi.fn(), onReopenPeriod: vi.fn(),
  }));
}
describe('period workflow status UI', () => {
  it('shows independent AP/AR status; no separate close step while one side is pending', () => {
    const html = render([ap]);
    expect(html).toContain('AP (เงินออก) · ยืนยันแล้ว');
    expect(html).toContain('AR (เงินเข้า) · ยังไม่ยืนยัน');
    expect(html).toContain('AP reviewer');
    expect(html).toContain('ยืนยันครบแล้วงวดจะปิดอัตโนมัติ');
    expect(html).not.toContain('ปิดงวดรวม</button>');
  });
  it('warns before the last confirmation when the balance is not settled', () => {
    expect(render([ap], 1)).toContain('ต้องเป็นศูนย์ก่อนยืนยันฝั่งสุดท้าย');
  });
  it('keeps a Master-only close button for periods confirmed before auto-close existed', () => {
    expect(render([ap, ar])).not.toContain('disabled=""');
    expect(render([ap, ar], 1)).toContain('disabled=""');
    expect(render([ap, ar], 0, true, ['AP', 'AR'])).toContain('ต้องเป็น Master Admin');
  });
  it('disables actions and directs users to an administrator when not installed', () => {
    const html = render([], 0, false);
    expect(html).toContain('ระบบยืนยันงานยังไม่พร้อม กรุณาติดต่อผู้ดูแล');
    expect(html).not.toContain('009_period_work_approval.sql');
    expect(html.match(/disabled=""/g)).toHaveLength(2);
  });
  it('AP-only employees still see both sides but cannot confirm AR', () => {
    const html = render([], 0, true, ['AP']);
    expect(html).toContain('AP (เงินออก)');
    expect(html).toContain('AR (เงินเข้า)');
    expect(html.match(/disabled=""/g)).toHaveLength(1);
    expect(html).toContain('ต้องมีสิทธิ์ AR');
  });
  it('unassigned employees have no confirmation actions', () => {
    expect(render([], 0, true, []).match(/disabled=""/g)).toHaveLength(2);
  });
});
