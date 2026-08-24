'use client';

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { STATUS_COLOR, STATUS_LABEL, formatCount, shiftMonth, shortMonthLabel, type DashboardData } from './shared';

/**
 * แนวโน้มย้อนหลัง — แท่งซ้อนคือจำนวนบรรทัดแยกตามสถานะ, เส้นคืออัตรากระทบยอด
 * เดือนที่ไม่มีข้อมูลต้องแสดงเป็น 0 ไม่ใช่หายไปจากแกน ไม่งั้นระยะห่างระหว่างเดือนจะหลอกตา
 */
function buildSeries(data: DashboardData) {
  const months: string[] = [];
  for (let i = data.trendMonths - 1; i >= 0; i--) months.push(shiftMonth(data.month, -i));

  return months.map((month) => {
    const rows = data.trend.filter((t) => t.month === month);
    const matched = rows.filter((r) => r.status === 'MATCHED').reduce((a, r) => a + r.lines, 0);
    const suspense = rows.filter((r) => r.status === 'SUSPENSE').reduce((a, r) => a + r.lines, 0);
    const unmatched = rows.filter((r) => r.status === 'UNMATCHED').reduce((a, r) => a + r.lines, 0);
    const total = matched + suspense + unmatched;

    return {
      month,
      label: shortMonthLabel(month),
      matched,
      suspense,
      unmatched,
      // ไม่มีข้อมูลเลย = ไม่มีอัตราให้พูดถึง ปล่อย null เพื่อให้เส้นขาดตอนแทนที่จะดิ่งลง 0
      rate: total ? Number(((matched / total) * 100).toFixed(1)) : null,
    };
  });
}

const KEY_LABEL: Record<string, string> = {
  matched: STATUS_LABEL.MATCHED,
  suspense: STATUS_LABEL.SUSPENSE,
  unmatched: STATUS_LABEL.UNMATCHED,
  rate: 'อัตรากระทบยอด',
};

// recharts พิมพ์ callback เหล่านี้แบบหลวมๆ (ReactNode / ValueType) จึงรับเป็น unknown แล้วค่อยแคบเอง
function tooltipFormatter(value: unknown, key: unknown): [string, string] {
  const name = KEY_LABEL[String(key)] ?? String(key);
  if (typeof value !== 'number') return ['—', name];
  return [key === 'rate' ? `${value}%` : formatCount(value), name];
}

function legendFormatter(key: unknown): string {
  return KEY_LABEL[String(key)] ?? String(key);
}

export default function TrendChart({ data }: { data: DashboardData }) {
  const series = buildSeries(data);

  return (
    <div className="h-[320px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={series} margin={{ top: 5, right: 8, bottom: 0, left: -12 }}>
          <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="#e2e8f0" />

          <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} />

          <YAxis
            yAxisId="lines"
            axisLine={false}
            tickLine={false}
            tick={{ fill: '#64748b', fontSize: 12 }}
            tickFormatter={(v: number) => formatCount(v)}
          />

          <YAxis
            yAxisId="rate"
            orientation="right"
            domain={[0, 100]}
            axisLine={false}
            tickLine={false}
            tick={{ fill: '#64748b', fontSize: 12 }}
            tickFormatter={(v: number) => `${v}%`}
          />

          <Tooltip formatter={tooltipFormatter} />

          <Legend formatter={legendFormatter} iconType="circle" wrapperStyle={{ fontSize: 12 }} />

          <Bar yAxisId="lines" dataKey="matched" stackId="lines" fill={STATUS_COLOR.MATCHED} radius={[0, 0, 0, 0]} />
          <Bar yAxisId="lines" dataKey="suspense" stackId="lines" fill={STATUS_COLOR.SUSPENSE} />
          <Bar yAxisId="lines" dataKey="unmatched" stackId="lines" fill={STATUS_COLOR.UNMATCHED} radius={[6, 6, 0, 0]} />

          <Line
            yAxisId="rate"
            type="monotone"
            dataKey="rate"
            stroke="#2563eb"
            strokeWidth={3}
            dot={{ r: 3, fill: '#2563eb' }}
            connectNulls={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
