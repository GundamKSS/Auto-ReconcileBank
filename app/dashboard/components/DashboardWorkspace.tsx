'use client';

import { ChevronLeft, ChevronRight, Loader2, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AgingPanel from './AgingPanel';
import BankBreakdown from './BankBreakdown';
import Card from './Card';
import DailyChart from './DailyChart';
import DashboardHeader from './DashboardHeader';
import KpiCards from './KpiCards';
import OutstandingList from './OutstandingList';
import StatusDonut from './StatusDonut';
import TrendChart from './TrendChart';
import ViewPicker from './ViewPicker';
import {
  DEFAULT_WIDGETS,
  WIDGETS,
  bankLabel,
  currentMonth,
  monthLabel,
  shiftMonth,
  type DashboardData,
  type DateBasis,
  type WidgetId,
} from './shared';

const PREFS_KEY = 'autorecon:dashboard:v1';

type Prefs = {
  widgets: WidgetId[];
  basis: DateBasis;
  bankCode: string;
  trendMonths: number;
};

const DEFAULT_PREFS: Prefs = {
  widgets: DEFAULT_WIDGETS,
  basis: 'BANK',
  bankCode: 'ALL',
  trendMonths: 6,
};

function readPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const saved = JSON.parse(raw) as Partial<Prefs>;
    const known = new Set(WIDGETS.map((w) => w.id));
    return {
      // กรองด้วย known ไว้เผื่อเคยบันทึก id ของ widget ที่ถูกลบไปแล้วในเวอร์ชันก่อน
      widgets: Array.isArray(saved.widgets)
        ? WIDGETS.map((w) => w.id).filter((id) => saved.widgets!.includes(id) && known.has(id))
        : DEFAULT_PREFS.widgets,
      basis: saved.basis === 'GL' ? 'GL' : 'BANK',
      bankCode: typeof saved.bankCode === 'string' ? saved.bankCode : 'ALL',
      trendMonths: saved.trendMonths === 12 ? 12 : 6,
    };
  } catch {
    return DEFAULT_PREFS;
  }
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
  const [month, setMonth] = useState(() => currentMonth());
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [prefsLoaded, setPrefsLoaded] = useState(false);

  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const requestIdRef = useRef(0);

  // อ่านค่าที่จำไว้จาก localStorage (external source) ตอน mount — derive ระหว่าง render ไม่ได้
  // และอ่านตอน render ตรงๆ ก็ไม่ได้เพราะ HTML ฝั่ง server ไม่มี localStorage จะทำให้ hydrate ไม่ตรง
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setPrefs(readPrefs());
    setPrefsLoaded(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const updatePrefs = useCallback((patch: Partial<Prefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      } catch {
        // โหมด private browsing เขียนไม่ได้ — ยอมให้ค่าอยู่แค่ใน session นี้ ดีกว่าหน้าพัง
      }
      return next;
    });
  }, []);

  const params = useMemo(() => {
    const p = new URLSearchParams({ month, basis: prefs.basis, trendMonths: String(prefs.trendMonths) });
    if (prefs.bankCode !== 'ALL') p.set('bankCode', prefs.bankCode);
    return p.toString();
  }, [month, prefs.basis, prefs.bankCode, prefs.trendMonths]);

  useEffect(() => {
    // รอให้อ่านค่าที่จำไว้เสร็จก่อน ไม่งั้นจะยิง request ด้วยค่า default ทิ้งไปเปล่าๆ หนึ่งรอบ
    if (!prefsLoaded) return;

    const reqId = ++requestIdRef.current;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError('');
      try {
        const res = await fetch(`/api/dashboard/summary?${params}`);
        const payload = await res.json();
        if (cancelled || reqId !== requestIdRef.current) return;

        if (!res.ok) {
          setError(payload.error || 'โหลดข้อมูลสรุปไม่สำเร็จ');
          setData(null);
          return;
        }

        setData(payload as DashboardData);
        setUpdatedAt(new Date());
      } catch {
        if (!cancelled && reqId === requestIdRef.current) {
          setError('เชื่อมต่อ server ไม่ได้');
          setData(null);
        }
      } finally {
        if (!cancelled && reqId === requestIdRef.current) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [params, prefsLoaded, reloadToken]);

  const show = (id: WidgetId) => prefs.widgets.includes(id);
  const isCurrentMonth = month === currentMonth();
  // ปุ่มกรองธนาคารมาจากข้อมูลจริง ระหว่างโหลดครั้งแรกยังไม่มี — โชว์ค่าที่เลือกไว้ไปก่อนไม่ให้ปุ่มหาย
  const bankCodes = data?.bankCodes ?? (prefs.bankCode === 'ALL' ? [] : [prefs.bankCode]);

  return (
    <div className="min-h-screen">
      <DashboardHeader
        onRefresh={() => setReloadToken((v) => v + 1)}
        refreshing={loading}
        updatedAt={updatedAt}
      />

      <main className="p-5 sm:p-8">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">สรุปประจำเดือน</h1>
            <p className="mt-1 text-[15px] text-slate-500">
              {monthLabel(month)} · เกณฑ์วันที่{prefs.basis === 'BANK' ? 'ฝั่ง Bank Statement' : 'ฝั่ง BC365'}
              {prefs.bankCode !== 'ALL' ? ` · ${bankLabel(prefs.bankCode)}` : ''}
            </p>
          </div>

          <ViewPicker selected={prefs.widgets} onChange={(widgets) => updatePrefs({ widgets })} />
        </div>

        {/* ---------- แถบเลือกเดือนและตัวกรอง ---------- */}
        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-slate-100 bg-white/70 p-3">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setMonth(shiftMonth(month, -1))}
              className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-100"
              aria-label="เดือนก่อนหน้า"
            >
              <ChevronLeft size={17} />
            </button>

            <input
              type="month"
              value={month}
              onChange={(e) => e.target.value && setMonth(e.target.value)}
              className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm text-slate-700 outline-none focus:border-blue-400"
            />

            <button
              onClick={() => setMonth(shiftMonth(month, 1))}
              className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-100"
              aria-label="เดือนถัดไป"
            >
              <ChevronRight size={17} />
            </button>

            {!isCurrentMonth && (
              <button
                onClick={() => setMonth(currentMonth())}
                className="ml-1 inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-100"
              >
                <RotateCcw size={12} /> เดือนนี้
              </button>
            )}
          </div>

          <span className="hidden h-5 w-px bg-slate-200 sm:block" />

          <div className="flex rounded-lg border border-slate-200 bg-white p-0.5">
            {(['BANK', 'GL'] as const).map((b) => (
              <button
                key={b}
                onClick={() => updatePrefs({ basis: b })}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  prefs.basis === b ? 'bg-slate-900 text-white' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {b === 'BANK' ? 'วันที่ Bank' : 'วันที่ BC'}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {['ALL', ...bankCodes].map((code) => (
              <button
                key={code}
                onClick={() => updatePrefs({ bankCode: code })}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                  prefs.bankCode === code ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
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
                    className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                      prefs.trendMonths === n ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
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

        {error && (
          <p className="mb-6 rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-600">{error}</p>
        )}

        {prefs.widgets.length === 0 && (
          <p className="rounded-2xl border border-dashed border-slate-200 py-12 text-center text-sm text-slate-400">
            ยังไม่ได้เลือกส่วนที่จะแสดง — กด &ldquo;ปรับมุมมอง&rdquo; ด้านบนเพื่อเลือก
          </p>
        )}

        {!data && loading && (
          <div className="flex items-center justify-center gap-2 py-20 text-sm text-slate-400">
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
            className={`grid grid-cols-1 gap-5 transition-opacity xl:grid-cols-3 ${
              loading ? 'opacity-60' : 'opacity-100'
            }`}
          >
            {show('kpi') && (
              <div className={SPAN.kpi}>
                <KpiCards data={data} />
              </div>
            )}

            {show('trend') && (
              <Card
                className={SPAN.trend}
                title="แนวโน้มย้อนหลัง"
                subtitle={`${prefs.trendMonths} เดือนล่าสุด · แท่ง = จำนวนบรรทัด, เส้น = อัตรากระทบยอด`}
              >
                <TrendChart data={data} />
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
              <Card className={SPAN.status} title="สัดส่วนสถานะ" subtitle="นับเป็นบรรทัด ทั้งฝั่ง Bank และ GL">
                <StatusDonut data={data} />
              </Card>
            )}

            {show('bank') && (
              <Card className={SPAN.bank} title="แยกตามธนาคาร" subtitle="ยอดเงินและผลต่างของแต่ละธนาคารในเดือนนี้">
                <BankBreakdown data={data} />
              </Card>
            )}

            {show('aging') && (
              <Card className={SPAN.aging} title="อายุรายการค้าง" subtitle="ยังไม่จับคู่ และพักไว้">
                <AgingPanel data={data} />
              </Card>
            )}

            {show('outstanding') && (
              <Card
                className={SPAN.outstanding}
                title="รายการค้างยอดสูง"
                subtitle="เรียงตามจำนวนเงิน — ไล่เคลียร์จากตัวที่กระทบมากที่สุดก่อน"
              >
                <OutstandingList data={data} />
              </Card>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
