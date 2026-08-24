'use client';

import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { STATUS_COLOR, STATUS_LABEL, formatCount, type DashboardData } from './shared';

/** ไล่วันตั้งแต่ from ถึง end (รวมปลายทาง) เป็นสตริง YYYY-MM-DD */
function dayRange(from: string, end: string) {
  const days: string[] = [];
  const cursor = new Date(`${from}T00:00:00`);
  const stop = new Date(`${end}T00:00:00`);
  while (cursor <= stop) {
    days.push(
      `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`
    );
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

const KEY_LABEL: Record<string, string> = {
  matched: STATUS_LABEL.MATCHED,
  suspense: STATUS_LABEL.SUSPENSE,
  unmatched: STATUS_LABEL.UNMATCHED,
};

// recharts พิมพ์ callback เหล่านี้แบบหลวมๆ (ReactNode / ValueType) จึงรับเป็น unknown แล้วค่อยแคบเอง
function tooltipFormatter(value: unknown, key: unknown): [string, string] {
  const name = KEY_LABEL[String(key)] ?? String(key);
  return [typeof value === 'number' ? formatCount(value) : '—', name];
}

function labelFormatter(label: unknown): string {
  return `วันที่ ${String(label)}`;
}

function legendFormatter(key: unknown): string {
  return KEY_LABEL[String(key)] ?? String(key);
}

export default function DailyChart({ data }: { data: DashboardData }) {
  // เดือนปัจจุบันหยุดกราฟไว้ที่วันนี้ ไม่ลากหางศูนย์ไปจนสิ้นเดือน (asOf คำนวณมาจาก API แล้ว)
  const end = data.asOf >= data.from ? data.asOf : data.from;

  const series = dayRange(data.from, end).map((date) => {
    const rows = data.daily.filter((d) => d.date === date);
    const pick = (status: string) => rows.filter((r) => r.status === status).reduce((a, r) => a + r.lines, 0);
    return {
      date,
      label: String(Number(date.slice(8, 10))),
      matched: pick('MATCHED'),
      suspense: pick('SUSPENSE'),
      unmatched: pick('UNMATCHED'),
    };
  });

  return (
    <div className="h-[300px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={series} margin={{ top: 5, right: 8, bottom: 0, left: -12 }}>
          <defs>
            <linearGradient id="dailyMatched" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={STATUS_COLOR.MATCHED} stopOpacity={0.35} />
              <stop offset="100%" stopColor={STATUS_COLOR.MATCHED} stopOpacity={0} />
            </linearGradient>
          </defs>

          <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="#e2e8f0" />

          <XAxis
            dataKey="label"
            axisLine={false}
            tickLine={false}
            tick={{ fill: '#64748b', fontSize: 12 }}
            interval="preserveStartEnd"
            minTickGap={12}
          />

          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fill: '#64748b', fontSize: 12 }}
            tickFormatter={(v: number) => formatCount(v)}
          />

          <Tooltip labelFormatter={labelFormatter} formatter={tooltipFormatter} />

          <Legend formatter={legendFormatter} iconType="circle" wrapperStyle={{ fontSize: 12 }} />

          <Area
            type="monotone"
            dataKey="matched"
            stroke={STATUS_COLOR.MATCHED}
            strokeWidth={3}
            fill="url(#dailyMatched)"
          />
          <Area type="monotone" dataKey="suspense" stroke={STATUS_COLOR.SUSPENSE} strokeWidth={2} fill="transparent" />
          <Area
            type="monotone"
            dataKey="unmatched"
            stroke={STATUS_COLOR.UNMATCHED}
            strokeWidth={2}
            fill="transparent"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
