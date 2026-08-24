'use client';

import { bankLabel, formatAmount, formatCount, sumBuckets, type DashboardData } from './shared';

/** ยุบ bucket ทั้งหมดให้เหลือแถวละธนาคาร แล้วเรียงจากที่มีบรรทัดเยอะสุด */
function byBank(data: DashboardData) {
  const codes = Array.from(new Set(data.summary.buckets.map((b) => b.bankCode)));

  return codes
    .map((code) => {
      const rows = data.summary.buckets.filter((b) => b.bankCode === code);
      const all = sumBuckets(rows);
      const matched = sumBuckets(rows.filter((b) => b.status === 'MATCHED'));
      return {
        code,
        lines: all.lines,
        bankLines: all.bankLines,
        glLines: all.glLines,
        rate: all.lines ? (matched.lines / all.lines) * 100 : null,
        bankNet: all.bankNet,
        glNet: all.glNet,
        diff: all.diff,
      };
    })
    .sort((a, b) => b.lines - a.lines);
}

export default function BankBreakdown({ data }: { data: DashboardData }) {
  const rows = byBank(data);

  if (rows.length === 0) {
    return <p className="py-6 text-center text-sm text-slate-400">ไม่มีข้อมูลในเดือนนี้</p>;
  }

  return (
    <div className="-mx-2 overflow-x-auto">
      <table className="w-full min-w-[620px] text-sm">
        <thead>
          <tr className="border-b border-slate-100 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
            <th className="px-2 py-2">ธนาคาร</th>
            <th className="px-2 py-2 text-right">บรรทัด</th>
            <th className="px-2 py-2">อัตรากระทบยอด</th>
            <th className="px-2 py-2 text-right">Bank สุทธิ</th>
            <th className="px-2 py-2 text-right">GL สุทธิ</th>
            <th className="px-2 py-2 text-right">ผลต่าง</th>
          </tr>
        </thead>

        <tbody>
          {rows.map((r) => {
            const hasDiff = Math.abs(r.diff) >= 0.005;
            return (
              <tr key={r.code} className="border-b border-slate-50 hover:bg-slate-50/70">
                <td className="px-2 py-2.5">
                  <span className="font-medium text-slate-800">{bankLabel(r.code)}</span>
                </td>

                <td className="px-2 py-2.5 text-right tabular-nums text-slate-700">
                  {formatCount(r.lines)}
                  {/* แยกให้เห็นว่าบรรทัดมาจากฝั่งไหน — ธนาคารที่มีแต่ฝั่ง GL จะได้ยอด Bank สุทธิ 0 ซึ่งไม่ใช่ความผิดพลาด */}
                  <span className="block text-[11px] text-slate-400">
                    B {formatCount(r.bankLines)} · G {formatCount(r.glLines)}
                  </span>
                </td>

                <td className="px-2 py-2.5">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-full min-w-[70px] overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-emerald-500"
                        style={{ width: `${r.rate ?? 0}%` }}
                      />
                    </div>
                    <span className="w-12 shrink-0 text-right text-xs tabular-nums text-slate-500">
                      {r.rate === null ? '—' : `${r.rate.toFixed(0)}%`}
                    </span>
                  </div>
                </td>

                <td className="px-2 py-2.5 text-right tabular-nums text-slate-600">{formatAmount(r.bankNet)}</td>
                <td className="px-2 py-2.5 text-right tabular-nums text-slate-600">{formatAmount(r.glNet)}</td>

                <td
                  className={`px-2 py-2.5 text-right tabular-nums ${
                    hasDiff ? 'font-medium text-rose-600' : 'text-slate-300'
                  }`}
                >
                  {formatAmount(r.diff)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
