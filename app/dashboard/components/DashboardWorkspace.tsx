'use client';

import { ArrowDownLeft, ArrowUpRight, ChevronLeft, ChevronRight, Loader2, RotateCcw } from 'lucide-react';
import { SIDE_FILTER_ACTIVE_CLASS, SIDE_FILTER_INACTIVE_CLASS } from '../../../components/sideFilterStyles';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useState } from 'react';
import AgingPanel from './AgingPanel';
import BankBreakdown from './BankBreakdown';
import Card from './Card';
import DashboardHeader from './DashboardHeader';
import KpiCards from './KpiCards';
import OutstandingList from './OutstandingList';
import ViewPicker from './ViewPicker';
import useDashboardData from './useDashboardData';
import { useInitialPeriod } from '../../../hooks/useInitialPeriod';
import { useSessionState } from '../../../hooks/useSessionState';
import { isNullableString } from '../../../lib/tabWorkspace';
import {
  DEFAULT_WIDGETS,
  SIDES,
  WIDGETS,
  bankLabel,
  currentMonth,
  monthLabel,
  shiftMonth,
  sideLabel,
  type DateBasis,
  type Side,
  type WidgetId,
} from './shared';

const PREFS_KEY = 'autorecon:dashboard:v1';

// โหลดโค้ดกราฟเมื่อข้อมูลพร้อม ให้การ์ดสรุปด้านบนเริ่มแสดงได้ก่อน
const TrendChart = dynamic(() => import('./TrendChart'), { ssr: false, loading: () => <ChartLoading /> });
const DailyChart = dynamic(() => import('./DailyChart'), { ssr: false, loading: () => <ChartLoading height="h-[300px]" /> });
const StatusDonut = dynamic(() => import('./StatusDonut'), { ssr: false, loading: () => <ChartLoading height="h-[326px]" /> });

type Prefs = {
  widgets: WidgetId[];
  side: Side;
  basis: DateBasis;
  bankCode: string;
  trendMonths: number;
};

const DEFAULT_PREFS: Prefs = {
  widgets: DEFAULT_WIDGETS,
  side: 'AR',
  basis: 'BANK',
  bankCode: 'ALL',
  trendMonths: 6,
};

function isPrefs(value: unknown): value is Prefs {
  if (!value || typeof value !== 'object') return false;
  const saved = value as Partial<Prefs>;
  return Array.isArray(saved.widgets) && saved.widgets.every((id) => WIDGETS.some((w) => w.id === id)) &&
    (saved.side === 'AR' || saved.side === 'AP' || saved.side === 'ALL') &&
    (saved.basis === 'BANK' || saved.basis === 'GL') && typeof saved.bankCode === 'string' &&
    (saved.trendMonths === 6 || saved.trendMonths === 12);
}

/** ความกว้างของแต่ละส่วนในกริด 3 คอลัมน์ — ปิดส่วนไหนไป ส่วนที่เหลือไหลมาต่อกันเอง */
const SPAN: Record<WidgetId, string> = {
  kpi: 'xl:col-span-3',
  trend: 'xl:col-span-3',
  daily: 'xl:col-span-2',
  status: 'xl:col-span-1',
  bank: 'xl:col-span-3',
  aging: 'xl:col-span-1',
  outstanding: 'xl:col-span-2',
};

export default function DashboardWorkspace() {
  // เปิดมาที่งวดที่กำลังกระทบยอดอยู่ หรือเดือนล่าสุดที่มีข้อมูล แทนเดือนปัจจุบันที่มักยังว่าง
  const initialPeriod = useInitialPeriod('dashboard');
  // เก็บเฉพาะเดือนที่ผู้ใช้เลือกเอง ส่วนค่าเริ่มต้นคำนวณจากงวดที่ resolve ได้ระหว่าง render
  // (ไม่คัดลอกลง state ผ่าน effect เพราะทำให้เกิด render ซ้อนและยิง request ด้วยค่า default ทิ้งหนึ่งรอบ)
  const [monthOverride, setMonth] = useSessionState<string | null>('dashboard:month', null, isNullableString);
  const month = monthOverride ?? initialPeriod.range.from.slice(0, 7);
  const [prefs, setPrefs] = useSessionState<Prefs>(PREFS_KEY, DEFAULT_PREFS, isPrefs);

  const [reloadToken, setReloadToken] = useState(0);

  const updatePrefs = useCallback((patch: Partial<Prefs>) => {
    setPrefs((prev) => ({ ...prev, ...patch }));
  }, [setPrefs]);

  const params = useMemo(() => {
    const p = new URLSearchParams({
      month,
      side: prefs.side,
      basis: prefs.basis,
    });
    if (prefs.bankCode !== 'ALL') p.set('bankCode', prefs.bankCode);
    return p.toString();
  }, [month, prefs.side, prefs.basis, prefs.bankCode]);

  const historyMonths = prefs.widgets.includes('trend') ? (prefs.trendMonths === 12 ? 12 : 6)
    : prefs.widgets.includes('kpi') ? 2 : 0;
  const { data, loading, error, updatedAt, historyLoading, historyError, retryHistory } = useDashboardData({
    params, ready: initialPeriod.ready, revision: reloadToken, historyMonths,
  });
  const lockedSides = data?.lockedSides ?? [];
  const shownSide: Side = data && lockedSides.includes(prefs.side) ? data.side : prefs.side;

  useEffect(() => {
    const onGlSynced = () => setReloadToken((v) => v + 1);
    window.addEventListener('autorecon:gl-synced', onGlSynced);
    return () => window.removeEventListener('autorecon:gl-synced', onGlSynced);
  }, []);

  const show = (id: WidgetId) => prefs.widgets.includes(id);
  const isCurrentMonth = month === currentMonth();
  // ปุ่มกรองธนาคารมาจากข้อมูลจริง ระหว่างโหลดครั้งแรกยังไม่มี — โชว์ค่าที่เลือกไว้ไปก่อนไม่ให้ปุ่มหาย
  const bankCodes = data?.bankCodes ?? (prefs.bankCode === 'ALL' ? [] : [prefs.bankCode]);

  return (
    <main className="min-h-screen w-full min-w-0 px-3 py-4 sm:p-6 xl:p-8">
      <DashboardHeader
        onRefresh={() => setReloadToken((v) => v + 1)}
        refreshing={loading || historyLoading}
        updatedAt={updatedAt}
        subtitle={`${monthLabel(month)} · ${sideLabel(shownSide)} · เกณฑ์วันที่${prefs.basis === 'BANK' ? 'ฝั่งธนาคาร' : 'ฝั่ง BC365'}${prefs.bankCode !== 'ALL' ? ` · ${bankLabel(prefs.bankCode)}` : ''}`}
        action={<ViewPicker selected={prefs.widgets} onChange={(widgets) => updatePrefs({ widgets })} />}
      />

      <section aria-label="ตัวกรองภาพรวม" className="mb-6 min-w-0 rounded-[20px] border border-white/80 bg-white p-4 shadow-[0_10px_35px_rgba(30,64,175,0.06)] sm:p-6">
        {/* ---------- แท็บ AR / AP — ความหมายเดียวกับหน้า Reports ---------- */}
        <div className="mb-5 max-w-full overflow-x-auto pb-1">
          <div className="inline-flex items-center gap-1 rounded-2xl border border-slate-200 bg-white p-1 shadow-sm">
            {SIDES.map((sd) => {
              const active = shownSide === sd.value;
              const locked = lockedSides.includes(sd.value);
              const counts = data?.sideCounts;
              const count = counts ? (sd.value === 'ALL' ? counts.AR + counts.AP : counts[sd.value]) : null;
              return (
                <button
                  key={sd.value}
                  onClick={() => updatePrefs({ side: sd.value })}
                  disabled={locked}
                  title={locked ? 'เห็นได้เฉพาะฝั่งที่ได้รับสิทธิ์ AP / AR' : undefined}
                  aria-pressed={active}
                  className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                    active ? SIDE_FILTER_ACTIVE_CLASS[sd.value] : SIDE_FILTER_INACTIVE_CLASS
                  }`}
                >
                  {sd.value === 'AR' ? <ArrowDownLeft size={16} className="shrink-0" aria-hidden="true" /> : sd.value === 'AP' ? <ArrowUpRight size={16} className="shrink-0" aria-hidden="true" /> : null}
                  {sd.label}
                  <span className="text-xs font-normal">{sd.hint}</span>
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[11px] font-medium tabular-nums ${
                      active ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {locked ? '—' : count === null ? '…' : count.toLocaleString()}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* ---------- แถบเลือกเดือนและตัวกรอง ---------- */}
        <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-5">
          <div className="flex max-w-full flex-wrap items-center gap-1">
            <button
              onClick={() => setMonth(shiftMonth(month, -1))}
              className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 hover:text-blue-600"
              aria-label="เดือนก่อนหน้า"
            >
              <ChevronLeft size={17} />
            </button>

            <input
              type="month"
              value={month}
              onChange={(e) => e.target.value && setMonth(e.target.value)}
              aria-label="เดือนที่แสดง"
              className="min-h-10 min-w-0 rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2 text-sm text-slate-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />

            <button
              onClick={() => setMonth(shiftMonth(month, 1))}
              className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 hover:text-blue-600"
              aria-label="เดือนถัดไป"
            >
              <ChevronRight size={17} />
            </button>

            {!isCurrentMonth && (
              <button
                onClick={() => setMonth(currentMonth())}
                className="ml-1 inline-flex min-h-10 items-center gap-1 rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-blue-600"
              >
                <RotateCcw size={12} /> เดือนนี้
              </button>
            )}
          </div>

          <span className="hidden h-5 w-px bg-slate-200 sm:block" />

          <div className="flex min-h-10 rounded-xl border border-slate-200 bg-slate-50/50 p-1">
            {(['BANK', 'GL'] as const).map((b) => (
              <button
                key={b}
                onClick={() => updatePrefs({ basis: b })}
                aria-pressed={prefs.basis === b}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                  prefs.basis === b ? 'bg-blue-500 text-white shadow-md shadow-blue-200' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {b === 'BANK' ? 'วันที่รายการธนาคาร' : 'วันที่ BC'}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {['ALL', ...bankCodes].map((code) => (
              <button
                key={code}
                onClick={() => updatePrefs({ bankCode: code })}
                aria-pressed={prefs.bankCode === code}
                className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                  prefs.bankCode === code ? 'bg-blue-500 text-white shadow-md shadow-blue-200' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {code === 'ALL' ? 'ทุกธนาคาร' : bankLabel(code)}
              </button>
            ))}
          </div>

          {show('trend') && (
            <>
              <span className="hidden h-5 w-px bg-slate-200 sm:block" />
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-slate-400">แนวโน้ม</span>
                {[6, 12].map((n) => (
                  <button
                    key={n}
                    onClick={() => updatePrefs({ trendMonths: n })}
                    aria-pressed={prefs.trendMonths === n}
                    className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                      prefs.trendMonths === n ? 'bg-blue-500 text-white shadow-md shadow-blue-200' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {n} เดือน
                  </button>
                ))}
              </div>
            </>
          )}

          {loading && <Loader2 size={16} className="animate-spin text-slate-400" />}
        </div>
      </section>

      {error && (
        <p role="alert" className="mb-6 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}

      {prefs.widgets.length === 0 && (
        <p className="rounded-2xl border border-dashed border-slate-200 py-12 text-center text-sm text-slate-400">
          เลือกส่วนที่ต้องการใน &ldquo;ปรับมุมมอง&rdquo;
        </p>
      )}

      {!data && loading && (
        <div role="status" className="flex items-center justify-center gap-2 py-20 text-sm text-slate-400">
          <Loader2 size={18} className="animate-spin" /> กำลังโหลดข้อมูลสรุป...
        </div>
      )}

      {data && data.summary.total === 0 && prefs.widgets.length > 0 && (
        <p className="mb-6 rounded-2xl border border-dashed border-slate-200 py-10 text-center text-sm text-slate-400">
          ไม่มีข้อมูลใน {monthLabel(month)} ตามตัวกรองที่เลือก
        </p>
      )}

      {data && (
        // ระหว่างโหลดชุดใหม่ยังโชว์ข้อมูลเดิมไว้ แค่หรี่ลง เพื่อไม่ให้หน้ากระพริบทุกครั้งที่เปลี่ยนเดือน
        <div
          className={`grid min-w-0 grid-cols-1 gap-6 transition-opacity duration-200 ease-out motion-reduce:transition-none xl:grid-cols-3 ${
            loading ? 'opacity-60' : 'opacity-100'
          }`}
        >
          {show('kpi') && (
            <div className={`min-w-0 ${SPAN.kpi}`}>
              <KpiCards data={data} />
              <div className="min-h-8 pt-3">{historyLoading && <p role="status" className="text-xs text-slate-400">กำลังโหลดข้อมูลเทียบเดือนก่อน…</p>}</div>
              {historyError && !show('trend') && <HistoryError message={historyError} onRetry={retryHistory} />}
            </div>
          )}

          {show('trend') && (
            <Card
              className={SPAN.trend}
              title="แนวโน้มย้อนหลัง"
              subtitle={`${prefs.trendMonths} เดือนล่าสุด · แท่ง = จำนวนบรรทัด, เส้น = อัตรากระทบยอด`}
            >
              {loading || historyLoading ? <ChartLoading label="กำลังโหลดแนวโน้มย้อนหลัง…" />
                : historyError ? <HistoryError message={historyError} onRetry={retryHistory} /> : <TrendChart data={data} />}
            </Card>
          )}

          {show('daily') && (
            <Card
              className={SPAN.daily}
              title="ความเคลื่อนไหวรายวัน"
              subtitle={`จำนวนบรรทัดแต่ละวันใน ${monthLabel(month)}`}
            >
              <DailyChart data={data} />
            </Card>
          )}

          {show('status') && (
            <Card className={SPAN.status} title="สัดส่วนสถานะ" subtitle="นับเป็นบรรทัด ทั้งฝั่งธนาคารและ BC">
              <StatusDonut data={data} />
            </Card>
          )}

          {show('bank') && (
            <Card className={SPAN.bank} title="แยกตามธนาคาร" subtitle="ยอดเงินและผลต่างของแต่ละธนาคารในเดือนนี้">
              <BankBreakdown data={data} />
            </Card>
          )}

          {show('aging') && (
            <Card className={SPAN.aging} title="อายุรายการค้าง" subtitle="รอจับคู่ และพักไว้">
              <AgingPanel data={data} />
            </Card>
          )}

          {show('outstanding') && (
            <Card
              className={SPAN.outstanding}
              title="รายการค้างยอดสูง"
              subtitle="เรียงตามจำนวนเงินจากมากไปน้อย เพื่อช่วยจัดลำดับการตรวจสอบ"
            >
              <OutstandingList data={data} />
            </Card>
          )}
        </div>
      )}
    </main>
  );
}

function ChartLoading({ label = 'กำลังโหลดกราฟ…', height = 'h-[320px]' }: { label?: string; height?: string }) {
  return <div role="status" className={`flex items-center justify-center gap-2 text-sm text-slate-400 ${height}`}><Loader2 size={18} className="animate-spin" />{label}</div>;
}

function HistoryError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div role="alert" className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-100 bg-amber-50 p-4 text-sm text-amber-800">
    <span>โหลดข้อมูลย้อนหลังไม่สำเร็จ · {message}</span>
    <button type="button" onClick={onRetry} className="rounded-full border border-amber-200 bg-white px-4 py-2 text-xs font-semibold transition-colors hover:bg-amber-50">ลองโหลดอีกครั้ง</button>
  </div>;
}
