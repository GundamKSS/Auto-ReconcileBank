'use client';

import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';
import {
  STATUS_COLOR,
  STATUS_LABEL,
  STATUS_ORDER,
  formatCount,
  sumBuckets,
  type DashboardData,
  type StatusKey,
} from './shared';

export default function StatusDonut({ data }: { data: DashboardData }) {
  const slices = STATUS_ORDER.map((status) => ({
    status,
    label: STATUS_LABEL[status],
    value: sumBuckets(data.summary.buckets.filter((b) => b.status === status)).lines,
  }));

  const total = slices.reduce((a, s) => a + s.value, 0);
  // recharts วาดโดนัทว่างไม่ได้ ต้องกันไว้ก่อนไม่งั้นได้วงกลมเปล่าที่ดูเหมือนกราฟเสีย
  const hasData = total > 0;

  return (
    <div className="flex flex-col items-center">
      <div className="relative h-[210px] w-[210px]">
        {hasData ? (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={slices}
                dataKey="value"
                innerRadius={66}
                outerRadius={92}
                paddingAngle={3}
                startAngle={90}
                endAngle={-270}
                isAnimationActive={false}
              >
                {slices.map((s) => (
                  <Cell key={s.status} fill={STATUS_COLOR[s.status as StatusKey]} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full w-full rounded-full border-[26px] border-slate-100" />
        )}

        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-bold tabular-nums text-slate-900">{formatCount(total)}</span>
          <span className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-500">บรรทัด</span>
        </div>
      </div>

      <div className="mt-5 w-full space-y-3">
        {slices.map((s) => (
          <div key={s.status} className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: STATUS_COLOR[s.status] }} />
              <span className="truncate text-[15px] text-slate-600">{s.label}</span>
            </div>

            <div className="shrink-0 text-right">
              <span className="font-semibold tabular-nums text-slate-900">{formatCount(s.value)}</span>
              <span className="ml-2 text-xs tabular-nums text-slate-400">
                {total ? `${((s.value / total) * 100).toFixed(1)}%` : '—'}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
