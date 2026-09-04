"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  Download,
  Loader2,
  RotateCcw,
  Search,
  SlidersHorizontal,
} from "lucide-react";

type Direction = "IN" | "OUT";
type StatusValue = "MATCHED" | "SUSPENSE" | "UNMATCHED";
type StatusFilter = StatusValue | "ALL";
type DateBasis = "BANK" | "GL";

type ReportRow = {
  rowKey: string;
  status: StatusValue;
  matchId: number | null;
  groupNum: number | null;
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
  diff: number;
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

const STATUSES: { value: StatusFilter; label: string }[] = [
  { value: "MATCHED", label: "จับคู่แล้ว" },
  { value: "SUSPENSE", label: "พักไว้" },
  { value: "UNMATCHED", label: "ยังไม่จับคู่" },
  { value: "ALL", label: "ทั้งหมด" },
];

const STATUS_BADGE: Record<StatusValue, string> = {
  MATCHED: "bg-green-100 text-green-700",
  SUSPENSE: "bg-amber-100 text-amber-700",
  UNMATCHED: "bg-slate-200 text-slate-600",
};

const STATUS_LABEL: Record<StatusValue, string> = {
  MATCHED: "จับคู่แล้ว",
  SUSPENSE: "พักไว้",
  UNMATCHED: "ยังไม่จับคู่",
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
function formatAmount(n: number | null | undefined) {
  if (n === null || n === undefined) return "-";
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
  const valueColor = tone === "good" ? "text-green-600" : tone === "bad" ? "text-red-600" : "text-gray-900";
  return (
    <div className="bg-white border border-gray-200 rounded-2xl px-4 py-3">
      <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">{label}</p>
      <p className={`text-lg font-semibold tabular-nums mt-0.5 ${valueColor}`}>{value}</p>
      {sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

function EmptyCell() {
  return <span className="text-gray-300">—</span>;
}

function ReportTableRow({ row }: { row: ReportRow }) {
  const hasDiff = Math.abs(row.diff) >= 0.005;
  return (
    <tr className="border-b border-gray-100 hover:bg-gray-50/70">
      <td className="px-3 py-2 align-top whitespace-nowrap">
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_BADGE[row.status]}`}>
          {STATUS_LABEL[row.status]}
        </span>
        <p className="text-[10px] text-gray-400 mt-1">
          {row.matchId ? `#${row.matchId} · กลุ่ม ${row.groupNum}` : "—"}
          {row.bankCode ? ` · ${row.bankCode}` : ""}
        </p>
      </td>

      {/* ฝั่ง Bank Statement */}
      <td className="px-3 py-2 align-top whitespace-nowrap text-gray-500">
        {row.bank ? formatDay(row.bank.date) : <EmptyCell />}
      </td>
      <td className="px-3 py-2 align-top max-w-[280px]">
        {row.bank ? <span className="text-gray-700 line-clamp-2">{row.bank.description || "-"}</span> : <EmptyCell />}
      </td>
      <td className="px-3 py-2 align-top whitespace-nowrap text-gray-500">
        {row.bank ? row.bank.ref || "-" : <EmptyCell />}
      </td>
      <td className="px-3 py-2 align-top whitespace-nowrap">
        {row.bank ? <DirectionBadge direction={row.bank.direction} /> : <EmptyCell />}
      </td>
      <td className="px-3 py-2 align-top whitespace-nowrap text-right tabular-nums text-gray-900">
        {row.bank ? formatAmount(row.bank.amount) : <EmptyCell />}
      </td>

      {/* ฝั่ง BC365 (GL) */}
      <td className="px-3 py-2 align-top whitespace-nowrap text-gray-500 border-l border-gray-100">
        {row.gl ? formatDay(row.gl.date) : <EmptyCell />}
      </td>
      <td className="px-3 py-2 align-top whitespace-nowrap text-gray-700">
        {row.gl ? row.gl.documentNo || "-" : <EmptyCell />}
      </td>
      <td className="px-3 py-2 align-top max-w-[220px]">
        {row.gl ? <span className="text-gray-500 line-clamp-2">{row.gl.accountName || row.gl.accountNo || "-"}</span> : <EmptyCell />}
      </td>
      <td className="px-3 py-2 align-top whitespace-nowrap">
        {row.gl ? <DirectionBadge direction={row.gl.direction} /> : <EmptyCell />}
      </td>
      <td className="px-3 py-2 align-top whitespace-nowrap text-right tabular-nums text-gray-900">
        {row.gl ? formatAmount(row.gl.amount) : <EmptyCell />}
      </td>

      <td
        className={`px-3 py-2 align-top whitespace-nowrap text-right tabular-nums border-l border-gray-100 ${
          hasDiff ? "text-red-600 font-medium" : "text-gray-300"
        }`}
      >
        {hasDiff ? formatAmount(row.diff) : "0.00"}
      </td>
    </tr>
  );
}

export default function ReportWorkspace() {
  const initialRange = useMemo(() => monthRange(new Date()), []);

  const [status, setStatus] = useState<StatusFilter>("MATCHED");
  const [bankCode, setBankCode] = useState("ALL");
  const [basis, setBasis] = useState<DateBasis>("BANK");
  const [from, setFrom] = useState(initialRange.from);
  const [to, setTo] = useState(initialRange.to);
  const [searchInput, setSearchInput] = useState("");
  const [q, setQ] = useState("");

  const [rows, setRows] = useState<ReportRow[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [bankCodes, setBankCodes] = useState<string[]>([]);

  const requestIdRef = useRef(0);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // กันยิงซ้ำในเฟรมเดียวกัน — state loadingMore อัปเดตแบบ async เลยเช็คไม่ทันถ้ามีสองสัญญาณมาพร้อมกัน
  const inFlightRef = useRef(false);

  // หน่วงคำค้นก่อนยิง API ไม่ให้โหลดใหม่ทุกตัวอักษร
  useEffect(() => {
    const t = setTimeout(() => setQ(searchInput.trim()), 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  const params = useMemo(() => {
    const p = new URLSearchParams({ from, to, basis, status });
    if (bankCode !== "ALL") p.set("bankCode", bankCode);
    if (q) p.set("q", q);
    return p.toString();
  }, [from, to, basis, status, bankCode, q]);

  // โหลดหน้าแรกใหม่ทุกครั้งที่ filter เปลี่ยน (พร้อมยอดสรุปของทั้งชุด)
  useEffect(() => {
    const reqId = ++requestIdRef.current;
    let cancelled = false;

    async function loadFirstPage() {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`/api/reports/reconciliation?${params}&offset=0`);
        const data = await res.json();
        if (cancelled || reqId !== requestIdRef.current) return;
        if (!res.ok) {
          setError(data.error || "โหลดรีพอร์ตไม่สำเร็จ");
          setRows([]);
          setTotal(0);
          setSummary(null);
          return;
        }
        setRows(data.rows);
        setTotal(data.total ?? data.rows.length);
        setSummary(data.summary ?? null);
        if (Array.isArray(data.bankCodes)) setBankCodes(data.bankCodes);
      } catch {
        if (!cancelled && reqId === requestIdRef.current) {
          setError("เชื่อมต่อ server ไม่ได้");
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
  }, [params]);

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
      if (reqId === requestIdRef.current) setError("เชื่อมต่อ server ไม่ได้");
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
      a.download = match?.[1] ?? `reconciliation-report_${from}_${to}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError("เชื่อมต่อ server ไม่ได้");
    } finally {
      setExporting(false);
    }
  }

  const t = summary?.totals;

  return (
    <div className="flex-1 min-w-0 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-1">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">รายงานการกระทบยอด</h1>
        <button
          onClick={handleExport}
          disabled={exporting || loading}
          className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-xl bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50 transition-colors"
        >
          {exporting ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
          Export Excel
        </button>
      </div>
      <p className="text-sm text-gray-500 mb-5">
        สรุปการกระทบยอดของ {monthLabel(from)} — 1 แถวคือ 1 คู่ Bank–GL ในกลุ่มย่อยเดียวกัน เลื่อนลงเพื่อโหลดเพิ่มครั้งละ 50 รายการ
      </p>

      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

      {/* ---------- แถบ filter ---------- */}
      <div className="flex items-center gap-1.5 mb-3 flex-wrap">
        {STATUSES.map((s) => (
          <button
            key={s.value}
            onClick={() => setStatus(s.value)}
            className={`text-xs font-medium px-3 py-1.5 rounded-full transition-colors ${
              status === s.value ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
            }`}
          >
            {s.label}
          </button>
        ))}
        <span className="w-px h-5 bg-gray-200 mx-1" />
        {["ALL", ...bankCodes].map((code) => (
          <button
            key={code}
            onClick={() => setBankCode(code)}
            className={`text-xs font-medium px-3 py-1.5 rounded-full transition-colors ${
              bankCode === code ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
            }`}
          >
            {code === "ALL" ? "ทุกธนาคาร" : BANK_LABEL[code] ?? code}
          </button>
        ))}
      </div>

      <div className="mb-5 flex flex-wrap items-end gap-3 rounded-xl border border-gray-100 bg-gray-50/60 p-3.5">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wide pb-1.5">
          <SlidersHorizontal size={13} /> กรอง
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-gray-500">เกณฑ์วันที่</label>
          <div className="flex bg-white border border-gray-200 rounded-lg p-0.5">
            <button
              onClick={() => setBasis("BANK")}
              className={`text-xs font-medium px-2.5 py-1 rounded-md transition-colors ${
                basis === "BANK" ? "bg-gray-900 text-white" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              วันที่ Bank Statement
            </button>
            <button
              onClick={() => setBasis("GL")}
              className={`text-xs font-medium px-2.5 py-1 rounded-md transition-colors ${
                basis === "GL" ? "bg-gray-900 text-white" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              วันที่ฝั่ง BC
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-gray-500">ตั้งแต่วันที่</label>
          <input
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => setFrom(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white text-gray-700"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-gray-500">ถึงวันที่</label>
          <input
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => setTo(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white text-gray-700"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-gray-500">เลือกเดือน</label>
          <div className="flex items-center gap-1">
            <button
              onClick={() => shiftMonth(-1)}
              title="เดือนก่อนหน้า"
              className="p-1.5 rounded-lg border border-gray-200 bg-white text-gray-500 hover:text-gray-800"
            >
              <ChevronLeft size={14} />
            </button>
            <button
              onClick={resetToThisMonth}
              className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-600 hover:text-gray-900"
            >
              <CalendarRange size={13} /> เดือนนี้
            </button>
            <button
              onClick={() => shiftMonth(1)}
              title="เดือนถัดไป"
              className="p-1.5 rounded-lg border border-gray-200 bg-white text-gray-500 hover:text-gray-800"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-1 flex-1 min-w-[180px]">
          <label className="text-[11px] font-medium text-gray-500">ค้นหา</label>
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="รายละเอียด / Ref / Document No / ชื่อบัญชี / Match ID"
              className="w-full text-sm border border-gray-200 rounded-lg pl-8 pr-2.5 py-1.5 bg-white text-gray-700"
            />
          </div>
        </div>

        {(searchInput || bankCode !== "ALL" || status !== "MATCHED") && (
          <button
            onClick={() => {
              setSearchInput("");
              setBankCode("ALL");
              setStatus("MATCHED");
            }}
            className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-800 pb-2"
          >
            <RotateCcw size={13} /> ล้างตัวกรอง
          </button>
        )}
      </div>

      <p className="text-[11px] text-gray-400 -mt-3 mb-4">
        เกณฑ์วันที่ใช้กับรายการที่จับคู่แล้ว โดยดูทั้งกลุ่มย่อย — ถ้าฝั่งที่เลือกมีบรรทัดอยู่ในช่วงวันที่ จะดึงคู่ของอีกฝั่งมาด้วยแม้จะข้ามเดือน
        ถ้ากลุ่มไหนไม่มีบรรทัดฝั่งที่เลือกเลย (เช่นรายการพักไว้ที่มีแต่ฝั่ง BC) จะใช้วันที่ของอีกฝั่งแทน
        ส่วนรายการที่ยังไม่จับคู่ไม่มีคู่ให้ยึด จึงกรองด้วยวันที่ของตัวเองเสมอ
      </p>

      {/* ---------- การ์ดสรุป ---------- */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <SummaryCard
          label="จำนวนรายการ"
          value={loading && !t ? "…" : total.toLocaleString()}
          sub={t ? `${t.matches.toLocaleString()} match · Bank ${t.bankLines.toLocaleString()} / BC ${t.glLines.toLocaleString()} บรรทัด` : undefined}
        />
        <SummaryCard
          label="ฝั่ง Bank สุทธิ"
          value={t ? formatAmount(t.bankNet) : "…"}
          sub={t ? `เข้า ${formatAmount(t.bankIn)} · ออก ${formatAmount(t.bankOut)}` : undefined}
        />
        <SummaryCard
          label="ฝั่ง BC สุทธิ"
          value={t ? formatAmount(t.glNet) : "…"}
          sub={t ? `เข้า ${formatAmount(t.glIn)} · ออก ${formatAmount(t.glOut)}` : undefined}
        />
        <SummaryCard
          label="ผลต่าง (Bank − BC)"
          value={t ? formatAmount(t.diff) : "…"}
          sub={t ? (Math.abs(t.diff) < 0.005 ? "ยอดตรงกัน" : "ยอดยังไม่ตรง") : undefined}
          tone={t ? (Math.abs(t.diff) < 0.005 ? "good" : "bad") : "default"}
        />
      </div>

      {summary && summary.buckets.length > 1 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {summary.buckets.map((b) => (
            <span
              key={`${b.status}-${b.bankCode}`}
              className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full bg-white border border-gray-200 text-gray-600"
            >
              <span className={`w-1.5 h-1.5 rounded-full ${STATUS_BADGE[b.status].split(" ")[0]}`} />
              {STATUS_LABEL[b.status]} · {b.bankCode} · {b.rows.toLocaleString()} รายการ · สุทธิ {formatAmount(b.bankNet - b.glNet)}
            </span>
          ))}
        </div>
      )}

      {/* ---------- ตาราง ---------- */}
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead className="bg-gray-50 text-gray-500">
              <tr>
                <th rowSpan={2} className="px-3 py-2 text-left text-xs font-semibold whitespace-nowrap">
                  สถานะ
                </th>
                <th colSpan={5} className="px-3 py-1.5 text-left text-xs font-semibold border-b border-gray-100 text-sky-700">
                  ฝั่ง Bank Statement
                </th>
                <th colSpan={5} className="px-3 py-1.5 text-left text-xs font-semibold border-b border-l border-gray-100 text-violet-700">
                  ฝั่ง BC365 (GL)
                </th>
                <th rowSpan={2} className="px-3 py-2 text-right text-xs font-semibold whitespace-nowrap border-l border-gray-100">
                  ผลต่าง
                  <span className="block text-[10px] font-normal text-gray-400">Bank − BC</span>
                </th>
              </tr>
              <tr className="text-[11px] font-medium">
                <th className="px-3 py-1.5 text-left whitespace-nowrap">วันที่</th>
                <th className="px-3 py-1.5 text-left">รายละเอียด</th>
                <th className="px-3 py-1.5 text-left whitespace-nowrap">Ref</th>
                <th className="px-3 py-1.5 text-left whitespace-nowrap">ทิศทาง</th>
                <th className="px-3 py-1.5 text-right whitespace-nowrap">จำนวนเงิน</th>
                <th className="px-3 py-1.5 text-left whitespace-nowrap border-l border-gray-100">วันที่</th>
                <th className="px-3 py-1.5 text-left whitespace-nowrap">Document No</th>
                <th className="px-3 py-1.5 text-left">ชื่อบัญชี</th>
                <th className="px-3 py-1.5 text-left whitespace-nowrap">ทิศทาง</th>
                <th className="px-3 py-1.5 text-right whitespace-nowrap">จำนวนเงิน</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <ReportTableRow key={row.rowKey} row={row} />
              ))}
            </tbody>
          </table>
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-sm text-gray-400 py-10 justify-center">
            <Loader2 size={16} className="animate-spin" /> กำลังโหลด...
          </div>
        )}

        {!loading && rows.length === 0 && (
          <div className="text-center text-sm text-gray-400 py-10">ไม่พบรายการในช่วงวันที่และเงื่อนไขที่เลือก</div>
        )}

        {!loading && rows.length > 0 && (
          <div ref={sentinelRef} className="py-4 text-center text-xs text-gray-400">
            {loadingMore ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 size={14} className="animate-spin" /> กำลังโหลดเพิ่ม...
              </span>
            ) : hasMore ? (
              <span className="inline-flex items-center gap-2">
                แสดง {rows.length.toLocaleString()} จาก {total.toLocaleString()} รายการ
                {/* ปกติโหลดต่อเองตอนเลื่อนถึงท้ายตาราง ปุ่มนี้ไว้กดเองเผื่อ IntersectionObserver ไม่ทำงาน */}
                <button onClick={loadMore} className="font-medium text-gray-600 underline underline-offset-2 hover:text-gray-900">
                  โหลดเพิ่ม
                </button>
              </span>
            ) : (
              `ครบทั้งหมด ${total.toLocaleString()} รายการ`
            )}
          </div>
        )}
      </div>
    </div>
  );
}
