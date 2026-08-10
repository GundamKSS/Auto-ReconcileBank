'use client';

import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
} from 'recharts';

const data = [
  {
    name: 'Matched',
    value: 4592,
    color: '#20b486',
  },
  {
    name: 'Pending',
    value: 187,
    color: '#f2a900',
  },
  {
    name: 'Exception',
    value: 44,
    color: '#e84570',
  },
];

export default function StatusBreakdown() {
  return (
    <div className="flex flex-col items-center">

      <div className="relative h-[230px] w-[230px]">

        <ResponsiveContainer
          width="100%"
          height="100%"
        >
          <PieChart>

            <Pie
              data={data}
              dataKey="value"
              innerRadius={70}
              outerRadius={95}
              paddingAngle={3}
              startAngle={90}
              endAngle={-270}
            >
              {data.map((item) => (
                <Cell
                  key={item.name}
                  fill={item.color}
                />
              ))}
            </Pie>

          </PieChart>
        </ResponsiveContainer>

        <div className="absolute inset-0 flex flex-col items-center justify-center">

          <span className="text-3xl font-bold text-slate-900">
            4,823
          </span>

          <span className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-500">
            Total
          </span>

        </div>

      </div>

      <div className="mt-4 w-full space-y-3">

        {data.map((item) => (
          <div
            key={item.name}
            className="flex items-center justify-between"
          >

            <div className="flex items-center gap-3">

              <span
                className="h-3 w-3 rounded-full"
                style={{
                  backgroundColor: item.color,
                }}
              />

              <span className="text-[16px] text-slate-600">
                {item.name}
              </span>

            </div>

            <span className="font-semibold text-slate-900">
              {item.value.toLocaleString()}
            </span>

          </div>
        ))}

      </div>

    </div>
  );
}