'use client';

import StatCard from './StatCard';
import {
  formatAmount,
  formatCount,
  reconciliationRate,
  shiftMonth,
  sumBuckets,
  type DashboardData,
} from './shared';

/** ยุบข้อมูล trend ของเดือนหนึ่งให้เหลือตัวเลขที่ต้องใช้เทียบ */
function monthStats(data: DashboardData, month: string) {
  const rows = data.trend.filter((t) => t.month === month);
  if (rows.length === 0) return null;

  const lines = rows.reduce((a, r) => a + r.lines, 0);
  const matched = rows.filter((r) => r.status === 'MATCHED').reduce((a, r) => a + r.lines, 0);
  const outstanding = rows.filter((r) => r.status !== 'MATCHED').reduce((a, r) => a + r.lines, 0);

  return { lines, matched, outstanding, rate: lines ? (matched / lines) * 100 : null };
}

/** เปลี่ยนแปลงกี่ % เทียบเดือนก่อน — คืน null เมื่อเดือนก่อนไม่มีข้อมูลให้เทียบ */
function relDelta(current: number, previous: number | undefined) {
  if (previous === undefined || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

export default function KpiCards({ data }: { data: DashboardData }) {
  const { buckets } = data.summary;

  const all = sumBuckets(buckets);
  const matched = sumBuckets(buckets.filter((b) => b.status === 'MATCHED'));
  const suspense = sumBuckets(buckets.filter((b) => b.status === 'SUSPENSE'));
  const unmatched = sumBuckets(buckets.filter((b) => b.status === 'UNMATCHED'));
  const rate = reconciliationRate(buckets);

  const prev = monthStats(data, shiftMonth(data.month, -1));
  const outstandingLines = suspense.lines + unmatched.lines;

  const hasDiff = Math.abs(all.diff) >= 0.005;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="บรรทัดทั้งหมด"
          value={formatCount(all.lines)}
          sub={`Bank ${formatCount(all.bankLines)} · GL ${formatCount(all.glLines)}`}
          delta={relDelta(all.lines, prev?.lines)}
          higherIsBetter="neutral"
        />

        <StatCard
          title="จับคู่แล้ว"
          value={formatCount(matched.lines)}
          sub={`${formatCount(matched.matches)} คู่การจับคู่`}
          delta={relDelta(matched.lines, prev?.matched)}
        />

        <StatCard
          title="ค้างอยู่"
          value={formatCount(outstandingLines)}
          sub={`ยังไม่จับคู่ ${formatCount(unmatched.lines)} · พักไว้ ${formatCount(suspense.lines)}`}
          delta={relDelta(outstandingLines, prev?.outstanding)}
          higherIsBetter={false}
          tone={outstandingLines > 0 ? 'bad' : 'default'}
        />

        <StatCard
          title="อัตรากระทบยอด"
          value={rate === null ? '—' : `${rate.toFixed(1)}%`}
          delta={rate !== null && prev?.rate != null ? rate - prev.rate : null}
          deltaUnit="pct"
        />
      </div>

      {/* แถบยอดเงิน — เป็นข้อมูลประกอบ ไม่ใช่ตัวชี้วัดหลัก จึงทำให้เตี้ยกว่าการ์ดด้านบน */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
        <div className="rounded-[20px] border border-white/80 bg-white px-6 py-4 shadow-[0_10px_35px_rgba(30,64,175,0.06)]">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">เงินเข้า (Bank)</p>
          <p className="mt-1 text-xl font-bold tabular-nums text-emerald-600">{formatAmount(all.bankIn)}</p>
        </div>

        <div className="rounded-[20px] border border-white/80 bg-white px-6 py-4 shadow-[0_10px_35px_rgba(30,64,175,0.06)]">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">เงินออก (Bank)</p>
          <p className="mt-1 text-xl font-bold tabular-nums text-rose-600">{formatAmount(all.bankOut)}</p>
        </div>

        <div className="rounded-[20px] border border-white/80 bg-white px-6 py-4 shadow-[0_10px_35px_rgba(30,64,175,0.06)]">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">ผลต่างสุทธิ Bank − GL</p>
          <p className={`mt-1 text-xl font-bold tabular-nums ${hasDiff ? 'text-rose-600' : 'text-slate-900'}`}>
            {formatAmount(all.diff)}
          </p>
        </div>
      </div>
    </div>
  );
}
