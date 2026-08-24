'use client';

import { ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { STATUS_BADGE, STATUS_LABEL, bankLabel, formatAmount, formatDay, type DashboardData } from './shared';

export default function OutstandingList({ data }: { data: DashboardData }) {
  if (data.outstanding.length === 0) {
    return <p className="py-6 text-center text-sm text-slate-400">ไม่มีรายการค้างในเดือนนี้</p>;
  }

  return (
    <ul className="divide-y divide-slate-50">
      {data.outstanding.map((item) => (
        <li key={item.rowKey} className="flex items-center gap-3 py-2.5">
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_BADGE[item.status]}`}
          >
            {STATUS_LABEL[item.status]}
          </span>

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-slate-800">{item.label || '(ไม่มีคำอธิบาย)'}</p>
            <p className="mt-0.5 text-xs text-slate-400">
              {formatDay(item.date)} · {item.side === 'BANK' ? 'Bank Statement' : 'BC365'}
              {item.bankCode ? ` · ${bankLabel(item.bankCode)}` : ''}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {item.direction === 'IN' ? (
              <ArrowDownLeft size={13} className="text-teal-600" />
            ) : item.direction === 'OUT' ? (
              <ArrowUpRight size={13} className="text-rose-500" />
            ) : null}
            <span className="text-sm font-semibold tabular-nums text-slate-900">{formatAmount(item.amount)}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}
