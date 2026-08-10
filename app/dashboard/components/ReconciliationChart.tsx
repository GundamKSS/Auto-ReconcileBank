'use client';

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

const data = [
  { day: '1', matched: 900, unmatched: 180 },
  { day: '3', matched: 980, unmatched: 170 },
  { day: '6', matched: 1100, unmatched: 120 },
  { day: '9', matched: 1030, unmatched: 140 },
  { day: '12', matched: 850, unmatched: 160 },
  { day: '15', matched: 790, unmatched: 170 },
  { day: '18', matched: 900, unmatched: 120 },
  { day: '21', matched: 1100, unmatched: 130 },
  { day: '24', matched: 1200, unmatched: 150 },
  { day: '27', matched: 1250, unmatched: 170 },
  { day: '30', matched: 1050, unmatched: 100 },
];

export default function ReconciliationChart() {
  return (
    <div className="h-[360px] w-full">

      <ResponsiveContainer
        width="100%"
        height="100%"
      >
        <AreaChart data={data}>

          <defs>

            <linearGradient
              id="matchedGradient"
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop
                offset="0%"
                stopColor="#38a9dc"
                stopOpacity={0.35}
              />

              <stop
                offset="100%"
                stopColor="#38a9dc"
                stopOpacity={0}
              />
            </linearGradient>

          </defs>

          <CartesianGrid
            strokeDasharray="4 4"
            vertical={false}
            stroke="#e2e8f0"
          />

          <XAxis
            dataKey="day"
            axisLine={false}
            tickLine={false}
            tick={{ fill: '#64748b', fontSize: 12 }}
          />

          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fill: '#64748b', fontSize: 12 }}
          />

          <Tooltip />

          <Area
            type="monotone"
            dataKey="matched"
            stroke="#36a6d8"
            strokeWidth={3}
            fill="url(#matchedGradient)"
          />

          <Area
            type="monotone"
            dataKey="unmatched"
            stroke="#e05278"
            strokeWidth={3}
            fill="transparent"
          />

        </AreaChart>
      </ResponsiveContainer>

    </div>
  );
}