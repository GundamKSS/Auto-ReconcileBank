'use client';

import { AGING_LABELS, STATUS_COLOR, STATUS_LABEL, compactAmount, formatCount, type DashboardData } from './shared';

export default function AgingPanel({ data }: { data: DashboardData }) {
  const rows = AGING_LABELS.map((label, bucket) => {
    const pick = (status: 'UNMATCHED' | 'SUSPENSE') =>
      data.aging.filter((a) => a.bucket === bucket && a.status === status);

    const unmatched = pick('UNMATCHED');
    const suspense = pick('SUSPENSE');

    return {
      label,
      unmatchedRows: unmatched.reduce((a, r) => a + r.rows, 0),
      suspenseRows: suspense.reduce((a, r) => a + r.rows, 0),
      amount: [...unmatched, ...suspense].reduce((a, r) => a + r.amount, 0),
    };
  });

  const max = Math.max(1, ...rows.map((r) => r.unmatchedRows + r.suspenseRows));
  const totalRows = rows.reduce((a, r) => a + r.unmatchedRows + r.suspenseRows, 0);

  if (totalRows === 0) {
    return <p className="py-6 text-center text-sm text-slate-400">ไม่มีรายการค้างในเดือนนี้ 🎉</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-4 text-xs text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: STATUS_COLOR.UNMATCHED }} />
          {STATUS_LABEL.UNMATCHED}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: STATUS_COLOR.SUSPENSE }} />
          {STATUS_LABEL.SUSPENSE}
        </span>
      </div>

      {rows.map((r) => {
        const total = r.unmatchedRows + r.suspenseRows;
        return (
          <div key={r.label}>
            <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
              <span className="text-slate-600">{r.label}</span>
              <span className="tabular-nums text-slate-500">
                <span className="font-semibold text-slate-900">{formatCount(total)}</span> รายการ ·{' '}
                {compactAmount(r.amount)}
              </span>
            </div>

            {/* แถบว่างเมื่อช่วงนั้นไม่มีรายการ — คงเส้นไว้ให้เห็นว่ามีช่วงอายุนี้อยู่ */}
            <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full"
                style={{ width: `${(r.unmatchedRows / max) * 100}%`, backgroundColor: STATUS_COLOR.UNMATCHED }}
              />
              <div
                className="h-full"
                style={{ width: `${(r.suspenseRows / max) * 100}%`, backgroundColor: STATUS_COLOR.SUSPENSE }}
              />
            </div>
          </div>
        );
      })}

      <p className="pt-1 text-xs text-slate-400">นับอายุถึงวันที่ {data.asOf.split('-').reverse().join('/')}</p>
    </div>
  );
}
