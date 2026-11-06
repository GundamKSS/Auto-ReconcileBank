export type WorkDirection = 'IN' | 'OUT';
export type WorkApproval = {
  direction: WorkDirection;
  periodStart: string;
  periodEnd: string;
  confirmedBy: string;
  confirmedAt: string;
  note: string;
};
export type PeriodWorkflow = {
  ready: boolean;
  approvals: WorkApproval[];
  permissions?: import('./workRoles').WorkPermissions;
};

export const workLabel = (direction: WorkDirection) => direction === 'OUT' ? 'AP (เงินออก)' : 'AR (เงินเข้า)';

export function approvalsComplete(approvals: WorkApproval[], from: string, to: string): boolean {
  return (['IN', 'OUT'] as const).every((direction) => approvals.some(
    (a) => a.direction === direction && a.periodStart === from && a.periodEnd === to,
  ));
}

// With no direction (e.g. opening balance), a change affects both teams.
export type WorkDate = { date: string; direction?: WorkDirection };
export function findBlockingApproval(dates: WorkDate[], approvals: WorkApproval[]): WorkApproval | undefined {
  return approvals.find((a) => dates.some((d) =>
    d.date >= a.periodStart && d.date <= a.periodEnd && (!d.direction || d.direction === a.direction),
  ));
}
