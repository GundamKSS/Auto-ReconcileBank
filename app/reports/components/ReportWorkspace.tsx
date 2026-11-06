"use client";

import HelpTooltip from '../../../components/HelpTooltip';
import { SIDE_FILTER_ACTIVE_CLASS, SIDE_FILTER_INACTIVE_CLASS } from '../../../components/sideFilterStyles';
import { useSidebar } from '../../../components/SidebarContext';
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatAmountOrDash as formatAmount } from '../../../lib/formatAmount';
import { fullAccountLabel, type BankAccountOption } from '../../../lib/bankAccounts';
import { useInitialPeriod } from '../../../hooks/useInitialPeriod';
import { useSessionState } from '../../../hooks/useSessionState';
import { isNullableString, oneOf } from '../../../lib/tabWorkspace';
import {
  ArrowDownLeft,
  ArrowUpRight,
  BarChart3,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  Download,
  Loader2,
  Menu,
  RotateCcw,
  Search,
  SlidersHorizontal,
} from "lucide-react";

type PendingImportBank = { bankCode: string; glLines: number; glNet: number };
type Coverage = {
  reconcilableDiff: number;
  pendingImport: PendingImportBank[];
  pendingImportNet: number;
};

type Direction = "IN" | "OUT";
type StatusValue = "MATCHED" | "SUSPENSE" | "OFFSET" | "EXCLUDED" | "UNMATCHED";
type StatusFilter = StatusValue | "ALL";
type DateBasis = "BANK" | "GL";
type Side = "AR" | "AP";

type ReportRow = {
  rowKey: string;
  status: StatusValue;
  direction: Direction;
  matchId: number | null;
  groupNum: number | null;
  pairRn: number | null;
  groupRows: number;
  bankCode: string | null;
  createdBy: string | null;
  createdAt: string | null;
  effDate: string | null;
  bank: {
    lineId: number;
    date: string | null;
    description: string | null;
    ref: string | null;
    direction: Direction;
    amount: number;
  } | null;
  gl: {
    entryNo: number;
    date: string | null;
    documentNo: string | null;
    accountNo: string | null;
    accountName: string | null;
    direction: Direction;
    amount: number;
  } | null;
  /** ผลต่างของทั้งกลุ่ม มีค่าเฉพาะแถวสุดท้ายของกลุ่ม */
  diff: number | null;
};

type SummaryBucket = {
  status: StatusValue;
  bankCode: string;
  rows: number;
  matches: number;
  bankLines: number;
  glLines: number;
  bankIn: number;
  bankOut: number;
  bankNet: number;
  glIn: number;
  glOut: number;
  glNet: number;
  diff: number;
};

type ReportSummary = {
  total: number;
  buckets: SummaryBucket[];
  totals: Omit<SummaryBucket, "status" | "bankCode">;
};

// ชื่อเรียกสวยๆ ของรหัสที่รู้จัก ส่วนรหัสอื่นที่โผล่มาจาก DB จะแสดงเป็นรหัสดิบ
const BANK_LABEL: Record<string, string> = {
  BBL: "BBL",
  KBANK: "KBank",
  SCB: "SCB",
  KTB: "KTB",
  NOT_BANK: "ไม่ใช่บัญชีธนาคาร",
};

const SIDES: { value: Side; label: string; hint: string }[] = [
  { value: "AR", label: "AR", hint: "เงินเข้า" },
  { value: "AP", label: "AP", hint: "เงินออก" },
];

const STATUSES: { value: StatusFilter; label: string }[] = [
  { value: "MATCHED", label: "จับคู่แล้ว" },
  { value: "SUSPENSE", label: "พักรายการ" },
  { value: "EXCLUDED", label: "JV ปรับปรุง" },
  { value: "UNMATCHED", label: "รอจับคู่" },
  { value: "ALL", label: "ทั้งหมด" },
];

const STATUS_BADGE: Record<StatusValue, string> = {
  MATCHED: "bg-emerald-50 text-emerald-600",
  SUSPENSE: "bg-amber-100 text-amber-700",
  OFFSET: "bg-teal-100 text-teal-700",
  EXCLUDED: "bg-slate-200 text-slate-700",
  UNMATCHED: "bg-slate-200 text-slate-600",
};

const STATUS_LABEL: Record<StatusValue, string> = {
  MATCHED: "จับคู่แล้ว",
  SUSPENSE: "พักรายการ",
  OFFSET: "หักล้างรายการ BC365",
  EXCLUDED: "JV ปรับปรุง",
  UNMATCHED: "รอจับคู่",
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}
function toIsoDate(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
/** ค่าเริ่มต้น = วันที่ 1 ถึงวันสิ้นเดือนของเดือนที่กำหนด (ค่าปริยาย = เดือนปัจจุบัน) */
function monthRange(anchor: Date) {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  return { from: toIsoDate(first), to: toIsoDate(last) };
}
function formatDay(iso: string | null) {
  if (!iso) return "-";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
function monthLabel(iso: string) {
  const [y, m] = iso.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("th-TH", { month: "long", year: "numeric" });
}

function DirectionBadge({ direction }: { direction: Direction }) {
  const isIn = direction === "IN";
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded-full ${
        isIn ? "bg-purple-50 text-purple-700" : "bg-red-50 text-red-600"
      }`}
    >
      {isIn ? <ArrowDownLeft size={10} /> : <ArrowUpRight size={10} />}
      {direction}
    </span>
  );
}

function SummaryCard({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "good" | "bad";
}) {
  const valueColor = tone === "good" ? "text-emerald-600" : tone === "bad" ? "text-red-600" : "text-slate-900";
  return (
    <div className="min-w-0 rounded-[20px] border border-white/80 bg-white p-5 shadow-[0_10px_35px_rgba(30,64,175,0.06)]">
      <p className="text-xs font-semibold text-slate-400">{label}</p>
      <p className={`mt-2 break-words text-2xl font-bold tracking-tight tabular-nums ${valueColor}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-400">{sub}</p>}
    </div>
  );
}

function EmptyCell() {
  return <span className="text-slate-300">—</span>;
}

/**
 * ช่องว่างของฝั่งที่ไม่มีบรรทัดในแถวนี้ — ถ้าอยู่ในกลุ่มหลายแถว (1:N / N:1) ยอดของฝั่งนั้นอยู่ในแถวอื่นของกลุ่มแล้ว
 * บอกไว้ชัดๆ ไม่ให้ดูเหมือนรายการตกหล่น
 */
function MissingSide({ inGroup, first }: { inGroup: boolean; first?: boolean }) {
  if (!inGroup) return <EmptyCell />;
  return first ? <span className="text-[11px] text-slate-400 whitespace-nowrap">รวมในกลุ่มเดียวกัน</span> : null;
}

function ReportTableRow({ row, groupStart, shaded }: { row: ReportRow; groupStart: boolean; shaded: boolean }) {
  const inGroup = row.groupRows > 1;
  const hasDiff = row.diff !== null && Math.abs(row.diff) >= 0.005;
  // กลุ่มหักล้างกันเองไม่มีฝั่ง Bank โดยธรรมชาติ — บอกเหตุผลแทนคำว่า "รวมในกลุ่มเดียวกัน" ซึ่งทำให้เข้าใจผิดว่ามีคู่อยู่แถวอื่น
  const noBankSide = row.status === "OFFSET" || row.status === "EXCLUDED";

  return (
    <tr
      className={`transition-colors hover:bg-blue-50/40 ${shaded ? "bg-slate-50/70" : ""} ${
        groupStart ? "border-t border-slate-200" : "border-t border-transparent"
      }`}
    >
      <td className={`px-3 py-2 align-top whitespace-nowrap ${inGroup ? "border-l-2 border-violet-300" : "border-l-2 border-transparent"}`}>
        {groupStart ? (
          <>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_BADGE[row.status]}`}>
              {STATUS_LABEL[row.status]}
            </span>
            <p className="text-[10px] text-slate-400 mt-1">
              {row.matchId ? `#${row.matchId} · กลุ่ม ${row.groupNum}` : "—"}
              {row.bankCode ? ` · ${row.bankCode}` : ""}
              {inGroup ? ` · ${row.groupRows} แถว` : ""}
            </p>
          </>
        ) : (
          <p className="text-[10px] text-slate-400 pl-1">
            ↳ {row.pairRn}/{row.groupRows}
          </p>
        )}
      </td>

      {/* ฝั่ง Bank Statement */}
      <td className="px-3 py-2 align-top whitespace-nowrap text-slate-500">
        {row.bank ? formatDay(row.bank.date) : noBankSide ? <EmptyCell /> : <MissingSide inGroup={inGroup} first />}
      </td>
      <td className="px-3 py-2 align-top max-w-[280px]">
        {row.bank ? (
          <span className="text-slate-700 line-clamp-2">{row.bank.description || "-"}</span>
        ) : noBankSide ? (
          groupStart && (
            <span className="text-[11px] text-teal-700 whitespace-nowrap">ไม่มีเงินผ่านธนาคาร — BC ยกเลิกกันเอง</span>
          )
        ) : (
          <MissingSide inGroup={inGroup} />
        )}
      </td>
      <td className="px-3 py-2 align-top whitespace-nowrap text-slate-500">
        {row.bank ? row.bank.ref || "-" : <MissingSide inGroup={inGroup} />}
      </td>
      <td className="px-3 py-2 align-top whitespace-nowrap">
        {row.bank ? <DirectionBadge direction={row.bank.direction} /> : <MissingSide inGroup={inGroup} />}
      </td>
      <td className="px-3 py-2 align-top whitespace-nowrap text-right tabular-nums text-slate-900">
        {row.bank ? formatAmount(row.bank.amount) : <MissingSide inGroup={inGroup} />}
      </td>

      {/* ฝั่ง BC365 (GL) */}
      <td className="px-3 py-2 align-top whitespace-nowrap text-slate-500 border-l border-slate-100">
        {row.gl ? formatDay(row.gl.date) : <MissingSide inGroup={inGroup} first />}
      </td>
      <td className="px-3 py-2 align-top whitespace-nowrap text-slate-700">
        {row.gl ? row.gl.documentNo || "-" : <MissingSide inGroup={inGroup} />}
      </td>
      <td className="px-3 py-2 align-top max-w-[220px]">
        {row.gl ? (
          <span className="text-slate-500 line-clamp-2">{row.gl.accountName || row.gl.accountNo || "-"}</span>
        ) : (
          <MissingSide inGroup={inGroup} />
        )}
      </td>
      <td className="px-3 py-2 align-top whitespace-nowrap">
        {row.gl ? <DirectionBadge direction={row.gl.direction} /> : <MissingSide inGroup={inGroup} />}
      </td>
      <td className="px-3 py-2 align-top whitespace-nowrap text-right tabular-nums text-slate-900">
        {row.gl ? formatAmount(row.gl.amount) : <MissingSide inGroup={inGroup} />}
      </td>

      {/* ผลต่างคิดทั้งกลุ่ม แสดงครั้งเดียวที่แถวสุดท้ายของกลุ่ม */}
      <td
        className={`px-3 py-2 align-top whitespace-nowrap text-right tabular-nums border-l border-slate-100 ${
          hasDiff ? "text-red-600 font-medium" : "text-slate-300"
        }`}
      >
        {row.diff === null ? null : (
          <>
            {formatAmount(hasDiff ? row.diff : 0)}
            {inGroup && <span className="block text-[10px] font-normal text-slate-400">รวมทั้งกลุ่ม</span>}
          </>
        )}
      </td>
    </tr>
  );
}

export default function ReportWorkspace() {
  const { toggleMobileOpen, mobileOpen } = useSidebar();
  // เปิดมาที่งวดที่กำลังกระทบยอดอยู่ หรืองวดล่าสุดที่มีข้อมูล แทนเดือนปัจจุบันที่มักยังว่าง
  const initialPeriod = useInitialPeriod('reports');
  const initialRange = initialPeriod.range;

  const [pickedSide, setSide] = useSessionState<Side>("reports:side", "AR", oneOf('AR', 'AP'));
  // สิทธิ์ AP/AR ฝั่งเดียว: server ล็อกแท็บอีกฝั่ง (lockedSides) และตอบฝั่งของตัวเองเสมอ — ค่าที่จำไว้เป็นอีกฝั่งก็สลับให้
  const [lockedSides, setLockedSides] = useState<Side[]>([]);
  const side: Side = lockedSides.includes(pickedSide) ? (pickedSide === "AR" ? "AP" : "AR") : pickedSide;
  const [status, setStatus] = useSessionState<StatusFilter>("reports:status", "MATCHED", oneOf('MATCHED', 'UNMATCHED', 'SUSPENSE', 'OFFSET', 'EXCLUDED', 'ALL'));
  const [bankCode, setBankCode] = useSessionState("reports:bankCode", "ALL");
  // หน้ากระทบยอดทำงานทีละบัญชี รายงานจึงต้องแคบได้ถึงระดับบัญชีเหมือนกัน
  // ไม่งั้นรายงานของธนาคารหนึ่งจะมีบัญชีอื่นที่ยังไม่ได้กระทบยอดปนมาจนผลต่างไม่ใช่ของงานที่ทำ
  const [bankAccountNo, setBankAccountNo] = useSessionState("reports:account", "ALL");
  const [accounts, setAccounts] = useState<BankAccountOption[]>([]);
  const [basis, setBasis] = useSessionState<DateBasis>("reports:basis", "BANK", oneOf('BANK', 'GL'));
  // เก็บเฉพาะวันที่ที่ผู้ใช้เปลี่ยนเอง ส่วนค่าเริ่มต้นคำนวณจากงวดที่ resolve ได้ระหว่าง render
  // (ไม่คัดลอกลง state ผ่าน effect เพราะทำให้เกิด render ซ้อนและยิง request ด้วยค่า default ทิ้งหนึ่งรอบ)
  const [fromOverride, setFrom] = useSessionState<string | null>("reports:from", null, isNullableString);
  const [toOverride, setTo] = useSessionState<string | null>("reports:to", null, isNullableString);
  const from = fromOverride ?? initialRange.from;
  const to = toOverride ?? initialRange.to;
  const [searchInput, setSearchInput] = useSessionState("reports:search", "");
  const [q, setQ] = useState(() => searchInput.trim());

  const [rows, setRows] = useState<ReportRow[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [bankCodes, setBankCodes] = useState<string[]>([]);
  const [sideCounts, setSideCounts] = useState<Record<Side, number> | null>(null);
  // ธนาคารที่ยังไม่ได้นำเข้า statement ต้องอ่านแยกจากผลต่างจริง ไม่ใช่รวมเป็นก้อนเดียว
  const [coverage, setCoverage] = useState<Coverage | null>(null);

  // ผลต่างที่ควรขึ้นพาดหัว = เฉพาะธนาคารที่นำเข้า statement แล้ว
  // ถ้า API เวอร์ชันเก่ายังไม่ส่ง coverage มา ให้ถอยไปใช้ผลต่างรวมแบบเดิม
  const shownDiff = coverage ? coverage.reconcilableDiff : (summary?.totals.diff ?? null);
  const hasPendingImport = (coverage?.pendingImport.length ?? 0) > 0;

  const accountOptions = useMemo(
    () => (bankCode === "ALL" ? accounts : accounts.filter((a) => a.bankCode === bankCode)),
    [accounts, bankCode]
  );

  const requestIdRef = useRef(0);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // กันยิงซ้ำในเฟรมเดียวกัน — state loadingMore อัปเดตแบบ async เลยเช็คไม่ทันถ้ามีสองสัญญาณมาพร้อมกัน
  const inFlightRef = useRef(false);

  // รายชื่อบัญชีไม่ขึ้นกับตัวกรอง โหลดครั้งเดียวพอ
  useEffect(() => {
    let cancelled = false;
    fetch("/api/master/bank-accounts")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && Array.isArray(d?.accounts)) setAccounts(d.accounts);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // หน่วงคำค้นก่อนยิง API ไม่ให้โหลดใหม่ทุกตัวอักษร
  useEffect(() => {
    const t = setTimeout(() => setQ(searchInput.trim()), 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  const params = useMemo(() => {
    const p = new URLSearchParams({ side, from, to, basis, status });
    if (bankCode !== "ALL") p.set("bankCode", bankCode);
    if (bankAccountNo !== "ALL") p.set("bankAccountNo", bankAccountNo);
    if (q) p.set("q", q);
    return p.toString();
  }, [side, from, to, basis, status, bankCode, bankAccountNo, q]);

  // โหลดหน้าแรกใหม่ทุกครั้งที่ filter เปลี่ยน (พร้อมยอดสรุปของทั้งชุด)
  useEffect(() => {
    const reqId = ++requestIdRef.current;
    let cancelled = false;

    // ยังไม่รู้ว่าจะเปิดมาที่งวดไหน — รอก่อน ไม่งั้นยิง API ด้วยงวดที่กำลังจะถูกแทนที่
    if (!initialPeriod.ready) return;

    async function loadFirstPage() {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`/api/reports/reconciliation?${params}&offset=0`);
        const data = await res.json();
        if (cancelled || reqId !== requestIdRef.current) return;
        if (!res.ok) {
          setError(data.error || "โหลดรายงานไม่สำเร็จ");
          setRows([]);
          setTotal(0);
          setSummary(null);
          setCoverage(null);
          return;
        }
        setRows(data.rows);
        setTotal(data.total ?? data.rows.length);
        setSummary(data.summary ?? null);
        if (Array.isArray(data.bankCodes)) setBankCodes(data.bankCodes);
        setSideCounts(data.sideCounts ?? null);
        setLockedSides(Array.isArray(data.lockedSides) ? data.lockedSides : []);
        setCoverage(data.coverage ?? null);
      } catch {
        if (!cancelled && reqId === requestIdRef.current) {
          setError("ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาตรวจสอบการเชื่อมต่อ");
          setRows([]);
          setTotal(0);
          setSummary(null);
        }
      } finally {
        if (!cancelled && reqId === requestIdRef.current) setLoading(false);
      }
    }

    loadFirstPage();
    return () => {
      cancelled = true;
    };
  }, [params, initialPeriod.ready]);

  const hasMore = rows.length < total;

  const loadMore = useCallback(async () => {
    if (loading || inFlightRef.current || !hasMore) return;
    const reqId = requestIdRef.current;
    inFlightRef.current = true;
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/reports/reconciliation?${params}&offset=${rows.length}`);
      const data = await res.json();
      // filter เปลี่ยนระหว่างรอ response — ทิ้งผลลัพธ์ชุดนี้ไป ไม่งั้นแถวจะปนกันคนละ filter
      if (reqId !== requestIdRef.current) return;
      if (!res.ok) {
        setError(data.error || "โหลดเพิ่มไม่สำเร็จ");
        return;
      }
      setRows((prev) => [...prev, ...data.rows]);
    } catch {
      if (reqId === requestIdRef.current) setError("ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาตรวจสอบการเชื่อมต่อ");
    } finally {
      inFlightRef.current = false;
      if (reqId === requestIdRef.current) setLoadingMore(false);
    }
  }, [loading, hasMore, params, rows.length]);

  // infinite scroll: โหลดชุดถัดไปเมื่อท้ายตารางใกล้เข้ามาในจอ
  // ใช้ IntersectionObserver เป็นหลัก + ผูก scroll/resize ไว้ด้วย เผื่อ observer ไม่ส่ง callback
  // (เช่นตอนแท็บถูกซ่อน) และเผื่อกรณีที่ 50 แถวแรกสั้นกว่าจอจนไม่มีการ scroll เลย
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;

    const nearViewport = () => el.getBoundingClientRect().top < window.innerHeight + 300;
    const check = () => {
      if (nearViewport()) loadMore();
    };

    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) loadMore();
    });
    io.observe(el);
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    check();

    return () => {
      io.disconnect();
      window.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };
  }, [loadMore, hasMore]);

  function shiftMonth(offset: number) {
    const [y, m] = from.split("-").map(Number);
    const next = monthRange(new Date(y, m - 1 + offset, 1));
    setFrom(next.from);
    setTo(next.to);
  }

  function resetToThisMonth() {
    const now = monthRange(new Date());
    setFrom(now.from);
    setTo(now.to);
  }

  async function handleExport() {
    setExporting(true);
    setError("");
    try {
      const res = await fetch(`/api/reports/reconciliation/export?${params}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "สร้างไฟล์ Excel ไม่สำเร็จ");
        return;
      }
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = /filename="?([^"]+)"?/.exec(disposition);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = match?.[1] ?? `reconciliation-report_${side.toLowerCase()}_${from}_${to}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError("ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาตรวจสอบการเชื่อมต่อ");
    } finally {
      setExporting(false);
    }
  }

  const t = summary?.totals;
  const sideHint = side === "AR" ? "เงินเข้า" : "เงินออก";

  // แถวของกลุ่มเดียวกันถูกเรียงให้ติดกันจากฝั่ง server แล้ว — ที่นี่แค่หาจุดเริ่มกลุ่มและสลับสีพื้นทีละกลุ่ม
  const displayRows = useMemo(() => {
    let band = 0;
    return rows.map((row, i) => {
      const prev = rows[i - 1];
      const groupStart =
        !prev || row.matchId === null || prev.matchId !== row.matchId || prev.groupNum !== row.groupNum;
      if (groupStart && i > 0) band++;
      return { row, groupStart, shaded: band % 2 === 1 };
    });
  }, [rows]);

  return (
    <main className="w-full min-w-0 px-3 py-4 sm:p-6 xl:p-8">
      <header className="mb-6 flex min-w-0 flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <button type="button" onClick={toggleMobileOpen} aria-label="เปิดเมนูหลัก" aria-expanded={mobileOpen}
            className="flex size-11 shrink-0 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 lg:hidden"><Menu size={22} /></button>
          <div className="hidden size-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-blue-600 shadow-lg shadow-blue-500/20 sm:flex">
            <BarChart3 size={22} className="text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="break-words text-xl font-bold tracking-tight text-slate-900 sm:text-3xl">รายงานการกระทบยอด</h1>
            <p className="mt-1 text-sm text-slate-500">{monthLabel(from)}</p>
          </div>
        </div>
        <button
          onClick={handleExport}
          disabled={exporting || loading}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-blue-500 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-blue-200 transition-colors hover:bg-blue-600 disabled:opacity-50"
        >
          {exporting ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
          ดาวน์โหลด Excel ({side})
        </button>
      </header>

      <section aria-label="ตัวกรองรายงาน" className="mb-6 min-w-0 rounded-[20px] border border-white/80 bg-white p-4 shadow-[0_10px_35px_rgba(30,64,175,0.06)] sm:p-6">
        {/* ---------- แท็บ AR / AP ---------- */}
        <div className="mb-5 max-w-full overflow-x-auto pb-1">
        <div className="inline-flex items-center gap-1 rounded-2xl border border-slate-200 bg-white p-1 shadow-sm">
          {SIDES.map((sd) => {
            const active = side === sd.value;
            const locked = lockedSides.includes(sd.value);
            return (
              <button
                key={sd.value}
                onClick={() => setSide(sd.value)}
                disabled={locked}
                title={locked ? "เห็นได้เฉพาะฝั่งที่ได้รับสิทธิ์ AP / AR" : undefined}
                aria-pressed={active}
                className={`inline-flex min-h-11 items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                  active ? SIDE_FILTER_ACTIVE_CLASS[sd.value] : SIDE_FILTER_INACTIVE_CLASS
                }`}
              >
                {sd.value === 'AR' ? <ArrowDownLeft size={16} className="shrink-0" aria-hidden="true" /> : <ArrowUpRight size={16} className="shrink-0" aria-hidden="true" />}
                {sd.label}
                <span className="text-xs font-normal">{sd.hint}</span>
                <span
                  className={`text-[11px] font-medium px-1.5 py-0.5 rounded-full tabular-nums ${
                    active ? "bg-white/20 text-white" : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {locked ? "—" : sideCounts ? sideCounts[sd.value].toLocaleString() : "…"}
                </span>
              </button>
            );
          })}
        </div>
        </div>

        {error && <p role="alert" className="mb-4 rounded-xl border border-red-100 bg-red-50 p-3 text-sm text-red-700">{error}</p>}

        {/* ---------- แถบ filter ---------- */}
        <div className="flex items-center gap-1.5 mb-3 flex-wrap">
          {STATUSES.map((s) => (
            <button
              key={s.value}
              onClick={() => setStatus(s.value)}
              aria-pressed={status === s.value}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                status === s.value ? "bg-blue-500 text-white shadow-md shadow-blue-200" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {s.label}
            </button>
          ))}
          <span className="w-px h-5 bg-slate-200 mx-1" />
          {["ALL", ...bankCodes].map((code) => (
            <button
              key={code}
              aria-pressed={bankCode === code}
              onClick={() => {
                setBankCode(code);
                // บัญชีที่เลือกค้างไว้อาจไม่ได้อยู่ในธนาคารใหม่ — ล้างทิ้งไม่ให้ได้รายงานว่างโดยไม่รู้สาเหตุ
                setBankAccountNo((prev) =>
                  prev !== "ALL" && code !== "ALL" && accounts.find((a) => a.bankAccountNo === prev)?.bankCode !== code
                    ? "ALL"
                    : prev
                );
              }}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                bankCode === code ? "bg-blue-500 text-white shadow-md shadow-blue-200" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {code === "ALL" ? "ทุกธนาคาร" : BANK_LABEL[code] ?? code}
            </button>
          ))}
        </div>

        <div className="mt-5 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-5">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 uppercase tracking-wide pb-1.5">
            <SlidersHorizontal size={13} /> กรอง
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-slate-500">บัญชีธนาคาร</label>
            <select
              value={bankAccountNo}
              onChange={(e) => {
                const next = e.target.value;
                setBankAccountNo(next);
                // เลือกบัญชีแล้วให้ปุ่มธนาคารตามไปด้วย ตัวเลขบนจอจะได้ไม่ขัดกับปุ่มที่ไฮไลต์อยู่
                const acc = accounts.find((a) => a.bankAccountNo === next);
                if (acc?.bankCode) setBankCode(acc.bankCode);
              }}
              className="min-h-10 w-full max-w-[270px] rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2 text-sm text-slate-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            >
              <option value="ALL">ทุกบัญชี{bankCode === "ALL" ? "" : `ของ ${BANK_LABEL[bankCode] ?? bankCode}`}</option>
              {accountOptions.map((a) => (
                <option key={a.bankAccountNo} value={a.bankAccountNo}>
                  {fullAccountLabel(a)}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1"><span className="text-[11px] font-medium text-slate-500">เกณฑ์วันที่</span>
              <HelpTooltip label="วิธีแสดงรายการตามวันที่">รายการจับคู่จะแสดงครบกลุ่มเมื่อฝั่งที่เลือกอยู่ในช่วงวันที่ หากไม่มีข้อมูลฝั่งนั้นจะใช้วันที่อีกฝั่ง รายการรอจับคู่ใช้วันที่ของตัวเอง แถบสีม่วงหมายถึงการจับคู่หลายรายการ โดยแสดงผลต่างที่แถวสุดท้าย</HelpTooltip>
            </div>
            <div className="flex min-h-10 rounded-xl border border-slate-200 bg-slate-50/50 p-1">
              <button
                onClick={() => setBasis("BANK")}
                className={`text-xs font-medium px-2.5 py-1 rounded-lg transition-colors ${
                  basis === "BANK" ? "bg-blue-500 text-white shadow-md shadow-blue-200" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                วันที่รายการธนาคาร
              </button>
              <button
                onClick={() => setBasis("GL")}
                className={`text-xs font-medium px-2.5 py-1 rounded-lg transition-colors ${
                  basis === "GL" ? "bg-blue-500 text-white shadow-md shadow-blue-200" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                วันที่รายการ BC365
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-slate-500">ตั้งแต่วันที่</label>
            <input
              type="date"
              value={from}
              max={to || undefined}
              onChange={(e) => setFrom(e.target.value)}
              className="min-h-10 rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2 text-sm text-slate-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-slate-500">ถึงวันที่</label>
            <input
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
              className="min-h-10 rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2 text-sm text-slate-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-slate-500">เลือกเดือน</label>
            <div className="flex items-center gap-1">
              <button
                onClick={() => shiftMonth(-1)}
                title="เดือนก่อนหน้า"
                className="flex size-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 hover:text-blue-600"
              >
                <ChevronLeft size={14} />
              </button>
              <button
                onClick={resetToThisMonth}
                className="inline-flex min-h-10 items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-blue-600"
              >
                <CalendarRange size={13} /> เดือนนี้
              </button>
              <button
                onClick={() => shiftMonth(1)}
                title="เดือนถัดไป"
                className="flex size-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 hover:text-blue-600"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-1 flex-1 min-w-[180px]">
            <label className="text-[11px] font-medium text-slate-500">ค้นหา</label>
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="รายละเอียด / Ref / Document No / ชื่อบัญชี / Match ID"
                className="min-h-10 w-full rounded-xl border border-slate-200 bg-slate-50/50 py-2 pl-8 pr-3 text-sm text-slate-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              />
            </div>
          </div>

          {(searchInput || bankCode !== "ALL" || bankAccountNo !== "ALL" || status !== "MATCHED") && (
            <button
              onClick={() => {
                setSearchInput("");
                setBankCode("ALL");
                setBankAccountNo("ALL");
                setStatus("MATCHED");
              }}
              className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-800 pb-2"
            >
              <RotateCcw size={13} /> ล้างตัวกรอง
            </button>
          )}
        </div>
      </section>
      {/* ---------- การ์ดสรุป ---------- */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          label="จำนวนรายการ"
          value={loading && !t ? "…" : total.toLocaleString()}
          sub={t ? `${t.matches.toLocaleString()} match · Bank ${t.bankLines.toLocaleString()} / BC ${t.glLines.toLocaleString()} บรรทัด` : undefined}
        />
        <SummaryCard
          label={`Bank ${sideHint}`}
          value={t ? formatAmount(side === "AR" ? t.bankIn : t.bankOut) : "…"}
          sub={t ? `${t.bankLines.toLocaleString()} บรรทัด` : undefined}
        />
        <SummaryCard
          label={`BC ${sideHint}`}
          value={t ? formatAmount(side === "AR" ? t.glIn : t.glOut) : "…"}
          sub={t ? `${t.glLines.toLocaleString()} บรรทัด` : undefined}
        />
        <SummaryCard
          label="ผลต่าง (ธนาคาร − BC365)"
          value={shownDiff === null ? "…" : formatAmount(shownDiff)}
          sub={
            shownDiff === null
              ? undefined
              : Math.abs(shownDiff) < 0.005
                ? "ยอดตรงกัน"
                : hasPendingImport
                  ? "ยอดยังไม่ตรง · เฉพาะธนาคารที่นำเข้าแล้ว"
                  : "ยอดยังไม่ตรง"
          }
          tone={shownDiff === null ? "default" : Math.abs(shownDiff) < 0.005 ? "good" : "bad"}
        />
      </div>

      {/* ธนาคารที่ยังไม่ได้นำเข้า statement ของงวดนี้ไม่ใช่ผลต่างที่ต้องไปตามหาสาเหตุ
          แยกมาเป็นหมายเหตุ ไม่เอาไปรวมในการ์ดผลต่างด้านบน */}
      {hasPendingImport && coverage && (
        <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-2.5 text-xs text-amber-800">
          <span className="font-semibold">ยังไม่ได้นำเข้ารายการเดินบัญชีของงวดนี้</span>
          <span className="text-amber-700">
            {coverage.pendingImport
              .map((p) => `${BANK_LABEL[p.bankCode] ?? p.bankCode} ${formatAmount(p.glNet)} (${p.glLines.toLocaleString()} บรรทัด)`)
              .join(" · ")}
          </span>
          <span className="text-amber-700">
            รวม {formatAmount(coverage.pendingImportNet)} บาท
            <HelpTooltip label="ยอดที่ยังไม่นำเข้า statement">ยอด BC365 ที่ยังไม่มี statement เทียบ จึงยังไม่นับรวมในผลต่างจากการกระทบยอด</HelpTooltip>
          </span>
        </div>
      )}

      {summary && summary.buckets.length > 1 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {summary.buckets.map((b) => (
            <span
              key={`${b.status}-${b.bankCode}`}
              className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full bg-white border border-slate-200 text-slate-600"
            >
              <span className={`w-1.5 h-1.5 rounded-full ${STATUS_BADGE[b.status].split(" ")[0]}`} />
              {STATUS_LABEL[b.status]} · {b.bankCode} · {b.rows.toLocaleString()} รายการ · สุทธิ {formatAmount(b.bankNet - b.glNet)}
            </span>
          ))}
        </div>
      )}

      {/* ---------- ตาราง ---------- */}
      <section aria-label="รายการกระทบยอด" className="min-w-0 rounded-[20px] border border-white/80 bg-white p-3 shadow-[0_10px_35px_rgba(30,64,175,0.06)] sm:p-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold text-slate-800">รายการกระทบยอด · {side}</h2>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-500">{loading ? 'กำลังโหลด…' : `${total.toLocaleString()} รายการ`}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] border-collapse text-sm">
            <thead className="bg-slate-50/80 text-slate-400">
              <tr>
                <th rowSpan={2} className="px-3 py-2 text-left text-xs font-semibold whitespace-nowrap">
                  สถานะ
                </th>
                <th colSpan={5} className="px-3 py-1.5 text-left text-xs font-semibold border-b border-slate-100 text-sky-700">
                  ฝั่งธนาคาร
                </th>
                <th colSpan={5} className="px-3 py-1.5 text-left text-xs font-semibold border-b border-l border-slate-100 text-violet-700">
                  ฝั่ง BC365 (GL)
                </th>
                <th rowSpan={2} className="px-3 py-2 text-right text-xs font-semibold whitespace-nowrap border-l border-slate-100">
                  ผลต่างของกลุ่ม
                  <span className="block text-[10px] font-normal text-slate-400">ธนาคาร − BC365</span>
                </th>
              </tr>
              <tr className="text-[11px] font-medium">
                <th className="px-3 py-1.5 text-left whitespace-nowrap">วันที่</th>
                <th className="px-3 py-1.5 text-left">รายละเอียด</th>
                <th className="px-3 py-1.5 text-left whitespace-nowrap">เลขอ้างอิง</th>
                <th className="px-3 py-1.5 text-left whitespace-nowrap">ทิศทาง</th>
                <th className="px-3 py-1.5 text-right whitespace-nowrap">จำนวนเงิน</th>
                <th className="px-3 py-1.5 text-left whitespace-nowrap border-l border-slate-100">วันที่</th>
                <th className="px-3 py-1.5 text-left whitespace-nowrap">เลขที่เอกสาร</th>
                <th className="px-3 py-1.5 text-left">ชื่อบัญชี</th>
                <th className="px-3 py-1.5 text-left whitespace-nowrap">ทิศทาง</th>
                <th className="px-3 py-1.5 text-right whitespace-nowrap">จำนวนเงิน</th>
              </tr>
            </thead>
            <tbody>
              {displayRows.map(({ row, groupStart, shaded }) => (
                <ReportTableRow key={row.rowKey} row={row} groupStart={groupStart} shaded={shaded} />
              ))}
            </tbody>
          </table>
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-sm text-slate-400 py-10 justify-center">
            <Loader2 size={16} className="animate-spin" /> กำลังโหลด...
          </div>
        )}

        {!loading && rows.length === 0 && (
          <div className="text-center text-sm text-slate-400 py-10">ไม่พบรายการในช่วงวันที่และเงื่อนไขที่เลือก</div>
        )}

        {!loading && rows.length > 0 && (
          <div ref={sentinelRef} className="py-4 text-center text-xs text-slate-400">
            {loadingMore ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 size={14} className="animate-spin" /> กำลังโหลดเพิ่ม...
              </span>
            ) : hasMore ? (
              <span className="inline-flex items-center gap-2">
                แสดง {rows.length.toLocaleString()} จาก {total.toLocaleString()} รายการ
                {/* ปกติโหลดต่อเองตอนเลื่อนถึงท้ายตาราง ปุ่มนี้ไว้กดเองเผื่อ IntersectionObserver ไม่ทำงาน */}
                <button onClick={loadMore} className="font-medium text-blue-500 underline underline-offset-2 hover:text-blue-600">
                  โหลดเพิ่ม
                </button>
              </span>
            ) : (
              `ครบทั้งหมด ${total.toLocaleString()} รายการ`
            )}
          </div>
        )}
      </section>
    </main>
  );
}
