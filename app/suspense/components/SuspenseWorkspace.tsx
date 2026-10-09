"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronRight,
  ChevronDown,
  Loader2,
  ArrowDownLeft,
  ArrowUpRight,
  Undo2,
  CheckCircle2,
  Search,
  SlidersHorizontal,
  X,
  Layers,
  ArrowRight,
} from "lucide-react";
import Link from "next/link";
import { useSidebar } from "@/components/SidebarContext";
import UnsuspendConfirmModal, { ConfirmLine } from "./UnsuspendConfirmModal";
import { loadReconcileSession } from "../../../lib/reconcileSession";
import { useSessionState } from "../../../hooks/useSessionState";
import { oneOf } from "../../../lib/tabWorkspace";
import type { ReconcileSession } from "../../reconcile/components/types";
import type { BalanceData } from "../../reconcile/components/balanceTypes";
import { formatAmount } from '../../../lib/formatAmount';
import {
  sideLabelOf,
  suspenseBalanceParts,
  visibleLines,
  type MatchRecord,
  type SideTab,
  type UnifiedLine,
} from "./suspenseModel";

const GROUP_COLORS = [
  "border-purple-300 bg-purple-50",
  "border-orange-300 bg-orange-50",
  "border-cyan-300 bg-cyan-50",
  "border-pink-300 bg-pink-50",
  "border-lime-300 bg-lime-50",
  "border-indigo-300 bg-indigo-50",
];
const GROUP_BADGE_COLORS = [
  "bg-purple-100 text-purple-700",
  "bg-orange-100 text-orange-700",
  "bg-cyan-100 text-cyan-700",
  "bg-pink-100 text-pink-700",
  "bg-lime-100 text-lime-700",
  "bg-indigo-100 text-indigo-700",
];

function formatSigned(n: number) {
  if (Math.abs(n) < 0.005) return "0.00";
  return `${n > 0 ? "+" : "−"}${formatAmount(Math.abs(n))}`;
}
function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
}
function formatDate(iso: string) {
  return new Date(iso).toISOString().slice(0, 10);
}

// แท็บฝั่งรับ/จ่าย (กติกาการแยกฝั่งอยู่ใน suspenseModel.ts)
const SIDE_TABS: { value: SideTab; label: string }[] = [
  { value: "ALL", label: "ทั้งหมด" },
  { value: "IN", label: "เงินเข้า" },
  { value: "OUT", label: "เงินออก" },
];

function toConfirmLine(u: UnifiedLine): ConfirmLine {
  return {
    key: u.key,
    matchId: u.matchId,
    sourceType: u.sourceType,
    refId: u.refId,
    date: u.date,
    detail: u.detail,
    direction: u.direction,
    amount: u.amount,
  };
}

function DirectionBadge({ direction }: { direction: "IN" | "OUT" }) {
  const isIn = direction === "IN";
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full ${
        isIn ? "bg-purple-50 text-purple-700" : "bg-red-50 text-red-600"
      }`}
    >
      {isIn ? <ArrowDownLeft size={11} /> : <ArrowUpRight size={11} />}
      {isIn ? "เงินเข้า" : "เงินออก"}
    </span>
  );
}

function SourceTag({ sourceType }: { sourceType: "BANK" | "GL" }) {
  return (
    <span
      className={`text-[10px] font-semibold px-1.5 py-0.5 rounded whitespace-nowrap ${
        sourceType === "BANK" ? "bg-sky-100 text-sky-700" : "bg-slate-100 text-slate-600"
      }`}
    >
      {sourceType === "BANK" ? "ธนาคาร" : "BC365"}
    </span>
  );
}

function AgingBadge({ createdAt }: { createdAt: string }) {
  // อ่านเวลาปัจจุบันครั้งเดียวตอน mount (lazy initializer) แทนการเรียก Date.now() กลางฟังก์ชัน render ตรงๆ
  const [now] = useState(() => Date.now());
  const days = Math.max(0, Math.floor((now - new Date(createdAt).getTime()) / 86400000));
  const cls =
    days < 7 ? "bg-emerald-100 text-emerald-700" : days < 30 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700";
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${cls}`}>พักมา {days} วัน</span>
  );
}

function SuccessToast({ message, onClose }: { message: string; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 3200);
    return () => clearTimeout(t);
  }, [onClose]);

  return (
    <motion.div
      initial={{ opacity: 0, y: -16, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -10, scale: 0.96, transition: { duration: 0.18 } }}
      transition={{ type: "spring", stiffness: 480, damping: 24 }}
      className="fixed top-5 right-5 z-[60] flex items-start gap-3 bg-white/85 backdrop-blur-xl backdrop-saturate-150 border border-green-200/60 shadow-xl rounded-xl px-4 py-3 max-w-sm"
    >
      <CheckCircle2 size={20} className="text-green-600 shrink-0 mt-0.5" />
      <p className="text-sm font-medium text-gray-900">{message}</p>
    </motion.div>
  );
}

// แถบสรุปบรรทัดเดียว — ยอดพักโอนปลายงวดของบัญชี+งวดที่เลือกไว้ในหน้ากระทบยอด แล้วบอกว่า
// รายการในหน้านี้อธิบายไปได้เท่าไร ที่เหลือเป็นของหน้ากระทบยอด (ตารางผลต่างรายวันกับยอดคงเหลือสองฝั่ง
// อยู่ที่ป้ายยอดพักโอนในหน้ากระทบยอดอยู่แล้ว ไม่ทำซ้ำที่นี่)
function SuspenseBalanceBar({
  balance,
  loading,
  error,
  accountLabel,
  period,
}: {
  balance: BalanceData | null;
  loading: boolean;
  error: string;
  accountLabel: string | null;
  period: string | null;
}) {
  const parts = suspenseBalanceParts(balance);

  return (
    <section className="mb-6 rounded-2xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-500">ยอดพักโอนปลายงวด · บาท</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-slate-900">
            {loading ? "…" : parts.difference === null ? "—" : formatAmount(parts.difference)}
          </p>
        </div>
        <div className="min-w-0 sm:text-right">
          <p className="text-xs text-slate-600" title={accountLabel ?? undefined}>
            {accountLabel ?? "เลือกบัญชีและงวดในหน้ากระทบยอด"}
          </p>
          {period && <p className="mt-1 text-xs text-slate-400">{period}</p>}
        </div>
      </div>
      <details className="group border-t border-slate-100">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-2.5 text-xs font-medium text-slate-500 hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
          <ChevronDown size={14} className="transition-transform group-open:rotate-180" />
          ดูที่มาของยอด
        </summary>
        <div className="flex flex-wrap items-start gap-x-8 gap-y-4 px-5 pb-4">
          <div>
            <p className="text-xs text-slate-500">จากรายการพักในงวดนี้</p>
            <p className="mt-1 text-base font-semibold tabular-nums text-slate-800">
              {loading ? "…" : parts.explained === null ? "—" : formatSigned(parts.explained)}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500">จากรายการอื่น</p>
            <p className="mt-1 text-base font-semibold tabular-nums text-slate-800">
              {loading ? "…" : parts.rest === null ? "—" : formatSigned(parts.rest)}
            </p>
            <p className="mt-1 text-xs text-slate-400">ยกมา · ยังไม่จับคู่ · หักล้าง · ข้ามงวด</p>
          </div>
          <Link href="/reconcile" className="sm:ml-auto inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700">
            ดูในหน้ากระทบยอด <ArrowRight size={12} />
          </Link>
        </div>
      </details>
      {error && <p role="alert" className="px-5 pb-3 text-xs text-rose-600">{error}</p>}
    </section>
  );
}

function SubGroupTable({
  num,
  colorIdx,
  lines,
  selected,
  onToggleLine,
  selectable,
}: {
  selectable: boolean;
  num: number;
  colorIdx: number;
  lines: UnifiedLine[];
  selected: Set<string>;
  onToggleLine: (key: string) => void;
}) {
  return (
    <div className={`border-l-4 rounded-lg ${GROUP_COLORS[colorIdx % GROUP_COLORS.length]} p-3`}>
      <div className="flex items-center gap-2 mb-2">
        <span
          className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
            GROUP_BADGE_COLORS[colorIdx % GROUP_BADGE_COLORS.length]
          }`}
        >
          กลุ่ม {num}
        </span>
        <span className="text-xs text-gray-500">{lines.length} รายการ</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[520px]">
          <tbody className="divide-y divide-black/5">
            {lines.map((l) => (
              <tr key={l.key} className="hover:bg-white/60 transition-colors">
                <td className="py-1.5 pr-2 w-8">
                  {selectable && <input
                    type="checkbox"
                    aria-label={`เลือก ${l.detail}`}
                    checked={selected.has(l.key)}
                    onChange={() => onToggleLine(l.key)}
                    className="w-4 h-4 rounded border-gray-300"
                  />}
                </td>
                <td className="py-1.5 pr-3 text-xs text-gray-400 whitespace-nowrap">{formatDate(l.date)}</td>
                <td className="py-1.5 pr-3">
                  <SourceTag sourceType={l.sourceType} />
                </td>
                <td className="py-1.5 pr-3">
                  <DirectionBadge direction={l.direction} />
                </td>
                <td className="py-1.5 pr-3 text-gray-700 truncate max-w-[280px]" title={l.detail}>
                  {l.detail}
                </td>
                <td className="py-1.5 text-right tabular-nums text-gray-900 whitespace-nowrap">
                  {formatAmount(l.amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MatchCard({
  match,
  sideTab,
  selected,
  onToggleLine,
  onToggleMatch,
  onRevertMatch,
}: {
  match: MatchRecord;
  sideTab: SideTab;
  selected: Set<string>;
  onToggleLine: (key: string) => void;
  onToggleMatch: (match: MatchRecord) => void;
  onRevertMatch: (match: MatchRecord) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isDifferenceSuspense = match.suspenseKind === "DIFFERENCE";
  const unified = useMemo(() => visibleLines(match, sideTab), [match, sideTab]);
  const bankLineCount = unified.filter((l) => l.sourceType === "BANK").length;
  const glLineCount = unified.filter((l) => l.sourceType === "GL").length;
  const bankTotal = unified.filter((l) => l.sourceType === "BANK").reduce((s, l) => s + l.amount, 0);
  const glTotal = unified.filter((l) => l.sourceType === "GL").reduce((s, l) => s + l.amount, 0);
  const { hasIn, hasOut, label: sideLabel } = sideLabelOf(unified);

  const allKeys = unified.map((l) => l.key);
  const selectedCount = allKeys.filter((k) => selected.has(k)).length;
  const allSelected = allKeys.length > 0 && selectedCount === allKeys.length;

  const nums = Array.from(new Set(unified.map((l) => l.num))).sort((a, b) => a - b);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.15 } }}
      transition={{ duration: 0.2 }}
      className="bg-white border border-gray-200 rounded-2xl overflow-hidden"
    >
      <div className="w-full flex flex-wrap items-center gap-3 px-4 py-4 hover:bg-slate-50/60">
        {isDifferenceSuspense ? (
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${match.suspenseDirection === "IN" ? "bg-emerald-500" : "bg-rose-500"}`} />
        ) : (
          <input
            type="checkbox"
            checked={allSelected}
            onChange={() => onToggleMatch(match)}
            onClick={(e) => e.stopPropagation()}
            className="w-4 h-4 rounded border-gray-300 shrink-0"
            aria-label={`เลือกทั้งชุด #${match.matchId}`}
          />
        )}
        <button
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls={`suspense-detail-${match.matchId}`}
          className="flex items-center gap-3 flex-1 min-w-[200px] text-left"
        >
          {expanded ? (
            <ChevronDown size={14} className="text-gray-400 shrink-0" />
          ) : (
            <ChevronRight size={14} className="text-gray-400 shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-0.5">
              <span className="text-sm font-medium text-gray-900">#{match.matchId}</span>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                {match.bankCode}
              </span>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                {isDifferenceSuspense ? "พักส่วนต่าง" : "พักทั้งรายการ"}
              </span>
              {!isDifferenceSuspense && sideLabel && (
                <span
                  className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                    hasIn && hasOut
                      ? "bg-slate-100 text-slate-600"
                      : hasIn
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-rose-100 text-rose-700"
                  }`}
                >
                  {sideLabel}
                </span>
              )}

              {selectedCount > 0 && (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                  เลือก {selectedCount}
                </span>
              )}
            </div>
            <p className="mt-1 truncate text-sm text-slate-600" title={unified[0]?.detail}>
              {unified[0]?.detail ?? "ไม่มีรายละเอียด"}
            </p>
            <div className="mt-1.5 flex items-center gap-2 text-xs text-slate-400">
              <span>{unified.length} รายการ</span>
              <span>·</span>
              <AgingBadge createdAt={match.createdAt} />
            </div>
            {isDifferenceSuspense && match.remark && (
              <p className="mt-0.5 truncate text-xs text-amber-700" title={match.remark}>หมายเหตุ: {match.remark}</p>
            )}
          </div>
          <div className="text-right shrink-0">
            {isDifferenceSuspense ? (
              <>
                <p className={`text-sm font-semibold tabular-nums ${match.suspenseDirection === "IN" ? "text-emerald-700" : "text-rose-700"}`}>
                  {match.suspenseDirection === "IN" ? "รับ" : "จ่าย"} {formatAmount(Math.abs(match.suspenseDifference ?? 0))}
                </p>
                <p className="text-[11px] text-gray-400">ธนาคาร {formatAmount(bankTotal)} · BC {formatAmount(glTotal)}</p>
              </>
            ) : (
              <><p className="text-base font-semibold text-gray-900 tabular-nums">{formatAmount(glTotal)}</p><p className="text-[11px] text-slate-400">บาท</p></>
            )}
          </div>
        </button>
        {isDifferenceSuspense ? (
          <Link href="/reconcile/history" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100">
            ดูคู่ที่จับไว้ <ArrowRight size={13} />
          </Link>
        ) : (
          <button
            onClick={() => onRevertMatch(match)}
            className="flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-white hover:bg-blue-600 border border-blue-200 hover:border-blue-600 px-3 py-1.5 rounded-full transition-colors shrink-0"
          >
            <Undo2 size={13} />
            คืนไปจับคู่
          </button>
        )}
      </div>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="detail"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            style={{ overflow: "hidden" }}
          >
            <div id={`suspense-detail-${match.matchId}`} className="border-t border-gray-100 p-3 flex flex-col gap-2 bg-gray-50/50">
              <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-slate-500">
                <span>พักเมื่อ {formatDateTime(match.createdAt)} · ธนาคาร {bankLineCount} · BC365 {glLineCount}</span>
                <span className="sm:hidden font-semibold tabular-nums">{formatAmount(isDifferenceSuspense ? Math.abs(match.suspenseDifference ?? 0) : glTotal)} บาท</span>
              </div>
              {isDifferenceSuspense && <p className="px-1 text-xs text-slate-500">หากต้องการแก้ไข ให้ยกเลิกคู่ในประวัติการจับคู่</p>}
              {nums.map((num, idx) => (
                <SubGroupTable
                  key={num}
                  num={num}
                  colorIdx={idx}
                  lines={unified.filter((l) => l.num === num)}
                  selected={selected}
                  onToggleLine={onToggleLine}
                  selectable={!isDifferenceSuspense}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default function SuspenseWorkspace() {
  const { collapsed } = useSidebar();
  const [matches, setMatches] = useState<MatchRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [bankCodes, setBankCodes] = useState<string[]>([]);
  const [queueSummary, setQueueSummary] = useState({ incoming: 0, outgoing: 0, lineCount: 0, differenceCount: 0 });
  const [reconcileSession, setReconcileSession] = useState<ReconcileSession | null>(null);
  const [balance, setBalance] = useState<BalanceData | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceError, setBalanceError] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [showDateFilters, setShowDateFilters] = useSessionState("suspense:showDates", false);
  const [bankFilter, setBankFilter] = useSessionState("suspense:bankCode", "ALL");
  const [sideTab, setSideTab] = useSessionState<SideTab>("suspense:side", "ALL", oneOf('ALL', 'IN', 'OUT'));
  // จำนวน Match ของทุกฝั่งภายใต้ตัวกรองอื่นที่เลือกอยู่ — server นับมาให้โดยไม่สนฝั่งที่เลือก
  const [sideCounts, setSideCounts] = useState<Record<SideTab, number> | null>(null);
  const [dateFrom, setDateFrom] = useSessionState("suspense:from", "");
  const [dateTo, setDateTo] = useSessionState("suspense:to", "");
  const [searchInput, setSearchInput] = useSessionState("suspense:search", "");
  const [q, setQ] = useState(() => searchInput.trim());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmLines, setConfirmLines] = useState<ConfirmLine[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const [selectingAll, setSelectingAll] = useState(false);

  const requestIdRef = useRef(0);
  const selectAllRef = useRef<HTMLInputElement | null>(null);
  // จำ filter ของชุดที่โหลดล่าสุด — เปลี่ยน filter แล้วต้องล้างที่เลือกไว้ (รายการเดิมอาจไม่อยู่ในผลลัพธ์ใหม่
  // แต่ยังถูกนับในแถบด้านล่าง) ส่วนการโหลดใหม่หลังดึงกลับสำเร็จ (reloadToken) ให้คงที่เลือกที่เหลือไว้ตามเดิม
  const loadedParamsRef = useRef<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // กันยิงซ้ำในเฟรมเดียวกัน — state loadingMore อัปเดตแบบ async เลยเช็คไม่ทันถ้ามีสองสัญญาณมาพร้อมกัน
  const inFlightRef = useRef(false);

  useEffect(() => {
    const saved = loadReconcileSession();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReconcileSession(saved);
  }, []);

  useEffect(() => {
    if (!reconcileSession?.bankAccountNo) return;
    const controller = new AbortController();
    const qs = new URLSearchParams({
      bankAccountNo: reconcileSession.bankAccountNo,
      from: reconcileSession.periodStart,
      to: reconcileSession.periodEnd,
    });
    // เปลี่ยนบัญชี/งวดต้องแสดงสถานะโหลดของ request ชุดใหม่ทันที
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBalanceLoading(true);
    setBalanceError("");
    fetch(`/api/reconcile/balance?${qs}`, { signal: controller.signal })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "โหลดสรุปพักโอนไม่สำเร็จ");
        setBalance(data);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setBalanceError(err instanceof Error ? err.message : "โหลดสรุปพักโอนไม่สำเร็จ");
      })
      .finally(() => {
        if (!controller.signal.aborted) setBalanceLoading(false);
      });
    return () => controller.abort();
  }, [reconcileSession]);

  // หน่วงคำค้นก่อนยิง API ไม่ให้โหลดใหม่ทุกตัวอักษร (เหมือนหน้า Reports)
  useEffect(() => {
    const t = setTimeout(() => setQ(searchInput.trim()), 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  // รวมรายการพักทั้งแถวกับผลต่างของคู่ที่ยอด Bank/BC ไม่เท่ากัน
  const params = useMemo(() => {
    const p = new URLSearchParams({ matchType: "SUSPENSE", includeDifferenceSuspense: "1" });
    if (bankFilter !== "ALL") p.set("bankCode", bankFilter);
    if (sideTab !== "ALL") p.set("suspenseSide", sideTab);
    if (dateFrom) p.set("from", dateFrom);
    if (dateTo) p.set("to", dateTo);
    if (q) p.set("q", q);
    return p.toString();
  }, [bankFilter, sideTab, dateFrom, dateTo, q]);

  // โหลดหน้าแรกใหม่ทุกครั้งที่ filter เปลี่ยน หรือหลังดึงกลับสำเร็จ (reloadToken) — เดิม fetch ครั้งเดียวตอน mount
  // แล้วกรอง/ค้นหาฝั่ง client ล้วนๆ ทำให้เห็นรายการพักไว้แค่ 50 รายการแรกสุดเสมอ (ขีดจำกัดของ /api/history)
  // รายการที่พักไว้นานแล้ว (อายุเยอะ ควรรีบตาม) จึงอาจไม่โผล่มาให้เห็นเลยถ้าเดือนนั้นมีมากกว่า 50 รายการ
  useEffect(() => {
    const reqId = ++requestIdRef.current;
    let cancelled = false;

    async function loadFirstPage() {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`/api/history?${params}&offset=0`);
        const data = await res.json();
        if (cancelled || reqId !== requestIdRef.current) return;
        if (!res.ok) {
          setError(data.error || "โหลดข้อมูลไม่สำเร็จ");
          setMatches([]);
          setTotal(0);
          return;
        }
        if (loadedParamsRef.current !== null && loadedParamsRef.current !== params) setSelected(new Set());
        loadedParamsRef.current = params;
        setMatches(data.matches);
        setTotal(data.total ?? data.matches.length);
        if (data.suspenseSummary) setQueueSummary(data.suspenseSummary);
        if (data.suspenseSideCounts) setSideCounts(data.suspenseSideCounts);
        if (Array.isArray(data.bankCodes)) setBankCodes(data.bankCodes);
      } catch {
        if (!cancelled && reqId === requestIdRef.current) {
          setError("ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาตรวจสอบการเชื่อมต่อ");
          setMatches([]);
          setTotal(0);
        }
      } finally {
        if (!cancelled && reqId === requestIdRef.current) setLoading(false);
      }
    }

    loadFirstPage();
    return () => {
      cancelled = true;
    };
  }, [params, reloadToken]);

  const hasMore = matches.length < total;

  const loadMore = useCallback(async () => {
    if (loading || inFlightRef.current || !hasMore) return;
    const reqId = requestIdRef.current;
    inFlightRef.current = true;
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/history?${params}&offset=${matches.length}`);
      const data = await res.json();
      // filter เปลี่ยนระหว่างรอ response — ทิ้งผลลัพธ์ชุดนี้ไป ไม่งั้นแถวจะปนกันคนละ filter
      if (reqId !== requestIdRef.current) return;
      if (!res.ok) {
        setError(data.error || "โหลดเพิ่มไม่สำเร็จ");
        return;
      }
      setMatches((prev) => [...prev, ...data.matches]);
    } catch {
      if (reqId === requestIdRef.current) setError("ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาตรวจสอบการเชื่อมต่อ");
    } finally {
      inFlightRef.current = false;
      if (reqId === requestIdRef.current) setLoadingMore(false);
    }
  }, [loading, hasMore, params, matches.length]);

  // infinite scroll: โหลดชุดถัดไปเมื่อท้ายรายการใกล้เข้ามาในจอ (เหมือนหน้า Match History/Reports)
  // ใช้ IntersectionObserver เป็นหลัก + ผูก scroll/resize ไว้ด้วย เผื่อ observer ไม่ส่ง callback
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;

    const nearViewport = () => el.getBoundingClientRect().top < window.innerHeight + 300;
    // อ่าน layout แค่เฟรมละครั้ง — scroll event ยิงถี่กว่าเฟรม ถ้าเรียก getBoundingClientRect ทุกครั้งจะบังคับ reflow ซ้ำจนเลื่อนกระตุก
    let frame = 0;
    const check = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (nearViewport()) loadMore();
      });
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
      cancelAnimationFrame(frame);
    };
  }, [loadMore, hasMore]);

  // รายชื่อธนาคารสำหรับปุ่มกรอง มาจาก server (ทุกธนาคารที่มีรายการพักไว้จริง) ไม่ใช่แค่ธนาคารในหน้าที่โหลดมาแล้ว
  const banks = ["ALL", ...bankCodes];
  const hasActiveFilters = Boolean(dateFrom || dateTo || searchInput);

  function clearFilters() {
    setDateFrom("");
    setDateTo("");
    setSearchInput("");
  }

  function toggleLine(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleMatch(match: MatchRecord) {
    if (match.suspenseKind === "DIFFERENCE") return;
    const keys = visibleLines(match, sideTab).map((l) => l.key);
    const allSelected = keys.length > 0 && keys.every((k) => selected.has(k));
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) keys.forEach((k) => next.delete(k));
      else keys.forEach((k) => next.add(k));
      return next;
    });
  }

  const loadedKeys = useMemo(
    () =>
      matches
        .filter((m) => m.suspenseKind !== "DIFFERENCE")
        .flatMap((m) => visibleLines(m, sideTab))
        .map((l) => l.key),
    [matches, sideTab]
  );
  // "เลือกทั้งหมด" = ทุกรายการที่ตรงกับตัวกรอง ไม่ใช่แค่ 50 match ที่โหลดมาแล้ว — ยังโหลดไม่ครบถือว่ายังไม่ได้เลือกทั้งหมด
  const allSelected = !hasMore && loadedKeys.length > 0 && loadedKeys.every((k) => selected.has(k));
  const someSelected = loadedKeys.some((k) => selected.has(k));

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected && !allSelected;
  }, [someSelected, allSelected]);

  async function toggleSelectAll() {
    if (selectingAll) return;
    if (allSelected) {
      setSelected(new Set());
      return;
    }

    // ดึง match ที่เหลือทั้งหมดมาก่อน ไม่งั้นรายการที่ยังไม่ได้เลื่อนลงไปจะไม่ถูกดึงกลับด้วย
    const reqId = requestIdRef.current;
    inFlightRef.current = true; // กัน infinite scroll ยิงซ้อนระหว่างโหลดรวด
    setSelectingAll(true);
    setError("");
    try {
      let all = matches;
      while (all.length < total) {
        const res = await fetch(`/api/history?${params}&offset=${all.length}`);
        const data = await res.json();
        if (reqId !== requestIdRef.current) return;
        if (!res.ok) {
          setError(data.error || "โหลดรายการทั้งหมดไม่สำเร็จ");
          return;
        }
        if (!Array.isArray(data.matches) || data.matches.length === 0) break;
        // มีคนพักรายการใหม่ระหว่างโหลด ลำดับ offset จะเลื่อน ทำให้ match เดิมโผล่ซ้ำ — ตัดตัวซ้ำทิ้ง
        const seen = new Set(all.map((m) => m.matchId));
        all = [...all, ...(data.matches as MatchRecord[]).filter((m) => !seen.has(m.matchId))];
      }
      if (reqId !== requestIdRef.current) return;
      setMatches(all);
      setSelected(
        new Set(
          all
            .filter((m) => m.suspenseKind !== "DIFFERENCE")
            .flatMap((m) => visibleLines(m, sideTab))
            .map((l) => l.key)
        )
      );
    } catch {
      if (reqId === requestIdRef.current) setError("ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาตรวจสอบการเชื่อมต่อ");
    } finally {
      inFlightRef.current = false;
      setSelectingAll(false);
    }
  }

  function openConfirmForMatch(match: MatchRecord) {
    if (match.suspenseKind === "DIFFERENCE") return;
    setConfirmLines(visibleLines(match, sideTab).map(toConfirmLine));
  }

  function openConfirmForSelection() {
    const allUnified = matches.flatMap((m) => visibleLines(m, sideTab));
    const lines = allUnified.filter((l) => selected.has(l.key)).map(toConfirmLine);
    if (lines.length > 0) setConfirmLines(lines);
  }

  async function handleConfirmRevert() {
    if (!confirmLines || confirmLines.length === 0) return;
    setBusy(true);
    setError("");
    try {
      const items = confirmLines.map((l) => ({ matchId: l.matchId, sourceType: l.sourceType, refId: l.refId }));
      const res = await fetch("/api/reconcile/unsuspend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "ดึงกลับไม่สำเร็จ");
        return;
      }
      const revertedKeys = new Set(confirmLines.map((l) => l.key));
      setSelected((prev) => {
        const next = new Set(prev);
        revertedKeys.forEach((k) => next.delete(k));
        return next;
      });
      setToast(`คืนรายการเพื่อจับคู่ใหม่ สำเร็จ ${confirmLines.length} รายการ`);
      setConfirmLines(null);
      // โหลดหน้าแรกใหม่จาก server แทนการแก้ matches ในเครื่องเอง — กัน offset เพี้ยนกับ total ที่เซิร์ฟเวอร์นับไว้
      // (รายการที่ดึงกลับไปแล้วอาจอยู่ในหน้าที่ยังไม่โหลดมาก็ได้ ไม่ใช่แค่ในชุดที่แสดงอยู่)
      setReloadToken((t) => t + 1);
    } catch {
      setError("ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาตรวจสอบการเชื่อมต่อ");
    } finally {
      setBusy(false);
    }
  }

  const selectedCount = selected.size;
  const selectedTotal = useMemo(() => {
    const allUnified = matches.flatMap((m) => visibleLines(m, sideTab));
    return allUnified.filter((l) => selected.has(l.key)).reduce((s, l) => s + l.amount, 0);
  }, [matches, selected, sideTab]);

  return (
    <div className="flex-1 min-w-0 p-4 sm:p-6 pb-24">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">รายการพัก</h1>
          <p className="mt-1 text-sm text-slate-500">เลือกรายการ แล้วคืนไปจับคู่เมื่อพร้อม</p>
        </div>
        <Link href="/reconcile" className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
          ไปหน้ากระทบยอด <ArrowRight size={15} />
        </Link>
      </div>

      {error && <p role="alert" className="text-sm text-red-600 mb-4">{error}</p>}

      <SuspenseBalanceBar
        balance={balance}
        loading={balanceLoading}
        error={balanceError}
        accountLabel={reconcileSession?.accountName ?? reconcileSession?.bankAccountNo ?? null}
        period={reconcileSession ? `${reconcileSession.periodStart} – ${reconcileSession.periodEnd}` : null}
      />

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-1">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">รายการที่พักไว้</h2>
          <p className="text-[11px] text-slate-400">พักทั้งรายการ {queueSummary.lineCount} ชุด · พักส่วนต่าง {queueSummary.differenceCount} ชุด</p>
        </div>
      </div>

      {/* แยกฝั่งรับ/จ่ายที่ server (suspenseSide) ไม่ใช่กรองเฉพาะ 50 รายการที่โหลดมาแล้ว
          จำนวนบนแท็บมาจากการนับที่ไม่สนฝั่งที่เลือกอยู่ เลขของอีกฝั่งจึงไม่กลายเป็น 0 ตอนกดสลับ */}
      <div className="mb-4 grid grid-cols-3 gap-2">
        {SIDE_TABS.map((tab) => {
          const active = sideTab === tab.value;
          const count = sideCounts?.[tab.value] ?? null;
          const amount =
            tab.value === "IN" ? queueSummary.incoming : tab.value === "OUT" ? queueSummary.outgoing : null;
          return (
            <button
              key={tab.value}
              type="button"
              onClick={() => setSideTab(tab.value)}
              aria-pressed={active}
              className={`flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border px-3 py-3 text-sm font-semibold transition-colors ${
                active
                  ? tab.value === "IN"
                    ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                    : tab.value === "OUT"
                      ? "border-rose-300 bg-rose-50 text-rose-700"
                      : "border-blue-300 bg-blue-50 text-blue-700"
                  : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"
              }`}
            >
              {tab.label}
              <span
                className={`rounded-full px-1.5 py-0.5 text-[11px] font-medium tabular-nums ${
                  active ? "bg-gray-900/5 text-gray-700" : "bg-gray-100 text-gray-500"
                }`}
              >
                {count === null ? "…" : count.toLocaleString()}
              </span>
              {amount !== null && (
                <span className="w-full text-left text-xs font-normal text-slate-500 tabular-nums">
                  {formatAmount(amount)} บาท
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="mb-4 rounded-xl border border-slate-200 bg-white p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[180px] flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="search" value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
              aria-label="ค้นหารายการพัก" placeholder="ค้นหารายละเอียด หรือเลขอ้างอิง"
              className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-200" />
          </div>
          <select aria-label="ธนาคาร" value={bankFilter} onChange={(e) => setBankFilter(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-600">
            {banks.map((b) => <option key={b} value={b}>{b === "ALL" ? "ทุกธนาคาร" : b}</option>)}
          </select>
          <button type="button" onClick={() => setShowDateFilters((v) => !v)} aria-expanded={showDateFilters} aria-controls="suspense-date-filters"
            className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium ${dateFrom || dateTo ? "border-blue-200 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
            <SlidersHorizontal size={15} /> ช่วงวันที่
            {(dateFrom || dateTo) && <span className="h-1.5 w-1.5 rounded-full bg-blue-600" />}
          </button>
          {hasActiveFilters && <button onClick={clearFilters} className="inline-flex items-center gap-1 px-2 py-2 text-xs text-slate-500 hover:text-blue-600"><X size={13} /> ล้าง</button>}
        </div>
        {showDateFilters && <div id="suspense-date-filters" className="mt-3 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="suspense-from" className="text-xs text-slate-500">พักตั้งแต่</label>
            <input id="suspense-from" type="date" value={dateFrom} max={dateTo || undefined} onChange={(e) => setDateFrom(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700" />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="suspense-to" className="text-xs text-slate-500">ถึง</label>
            <input id="suspense-to" type="date" value={dateTo} min={dateFrom || undefined} onChange={(e) => setDateTo(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700" />
          </div>
        </div>}
        {(dateFrom || dateTo) && !showDateFilters && <p className="mt-2 text-xs text-blue-600">วันที่พัก: {dateFrom || "ไม่จำกัด"} – {dateTo || "ไม่จำกัด"}</p>}
        {dateFrom && dateTo && dateFrom > dateTo && <p role="alert" className="mt-2 text-xs text-amber-700">วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่ม</p>}
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-gray-400 py-10 justify-center">
          <Loader2 size={16} className="animate-spin" /> กำลังโหลด...
        </div>
      )}

      {!loading && matches.length === 0 && (
        <div className="text-center text-sm text-gray-400 py-10">
          {total === 0 && !hasActiveFilters && sideTab === "ALL"
            ? "ไม่มีรายการที่พักไว้"
            : sideTab === "IN"
              ? "ไม่มีรายการพักฝั่งรับที่ตรงกับตัวกรอง"
              : sideTab === "OUT"
                ? "ไม่มีรายการพักฝั่งจ่ายที่ตรงกับตัวกรอง"
                : "ไม่พบรายการที่ตรงกับตัวกรอง"}
        </div>
      )}

      {!loading && matches.length > 0 && (
        <div className="flex items-center gap-3 mb-3 px-4">
          <label className="flex items-center gap-3 text-sm text-gray-700 cursor-pointer select-none">
            <input
              ref={selectAllRef}
              type="checkbox"
              checked={allSelected}
              disabled={selectingAll || busy}
              onChange={toggleSelectAll}
              className="w-4 h-4 rounded border-gray-300"
            />
            <span className="font-medium">เลือกทั้งหมด</span>
          </label>
          <span className="text-xs text-gray-400">
            {selectingAll ? (
              <span className="inline-flex items-center gap-1.5">
                <Loader2 size={12} className="animate-spin" /> กำลังโหลดรายการทั้งหมด...
              </span>
            ) : (
              `${total.toLocaleString()} ชุด${hasActiveFilters || bankFilter !== "ALL" ? " ตามตัวกรอง" : ""}`
            )}
          </span>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {matches.map((m) => (
          <MatchCard
            key={m.matchId}
            match={m}
            sideTab={sideTab}
            selected={selected}
            onToggleLine={toggleLine}
            onToggleMatch={toggleMatch}
            onRevertMatch={openConfirmForMatch}
          />
        ))}
      </div>

      {!loading && matches.length > 0 && (
        <div ref={sentinelRef} className="py-4 text-center text-xs text-gray-400">
          {loadingMore ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" /> กำลังโหลดเพิ่ม...
            </span>
          ) : hasMore ? (
            <span className="inline-flex items-center gap-2">
              แสดง {matches.length.toLocaleString()} จาก {total.toLocaleString()} รายการ
              <button onClick={loadMore} className="font-medium text-gray-600 underline underline-offset-2 hover:text-gray-900">
                โหลดเพิ่ม
              </button>
            </span>
          ) : (
            `ครบทั้งหมด ${total.toLocaleString()} รายการ`
          )}
        </div>
      )}

      {/* กล่องเต็มความกว้างจอ เว้น padding-left เท่ากับความกว้าง sidebar ปัจจุบัน (คู่กับ MainContent)
          แล้วค่อย flex-center อยู่ข้างใน ปุ่มเลยไปจัดกึ่งกลาง "พื้นที่เนื้อหา/ตาราง" แทนกึ่งกลางทั้งจอ */}
      <div
        className={`fixed bottom-5 inset-x-0 z-40 flex justify-center pointer-events-none transition-[padding] duration-300 ${
          collapsed ? "lg:pl-[82px]" : "lg:pl-[300px]"
        }`}
      >
        <AnimatePresence>
          {selectedCount > 0 && (
            <motion.div
              initial={{ y: 90, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 90, opacity: 0 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="pointer-events-auto mx-3 flex max-w-full flex-wrap justify-center items-center gap-2 sm:gap-4 bg-gray-900 text-white rounded-2xl px-3 sm:pl-5 py-2 shadow-xl"
            >
              <div className="flex items-center gap-2 text-sm">
                <Layers size={14} className="text-gray-300" />
                <span className="font-medium">เลือกไว้ {selectedCount} รายการ</span>
                <span className="text-gray-400">·</span>
                <span className="tabular-nums text-gray-200">{formatAmount(selectedTotal)} บาท</span>
              </div>
              <button
                onClick={() => setSelected(new Set())}
                className="text-xs text-gray-300 hover:text-white px-2 py-1.5 transition-colors"
              >
                ล้างการเลือก
              </button>
              <button
                onClick={openConfirmForSelection}
                className="flex items-center gap-1.5 text-sm font-medium bg-blue-600 hover:bg-blue-500 active:scale-95 px-4 py-2 rounded-full transition-all"
              >
                <Undo2 size={14} />
                คืนไปจับคู่
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {confirmLines && (
          <UnsuspendConfirmModal
            lines={confirmLines}
            busy={busy}
            onCancel={() => !busy && setConfirmLines(null)}
            onConfirm={handleConfirmRevert}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>{toast && <SuccessToast message={toast} onClose={() => setToast("")} />}</AnimatePresence>
    </div>
  );
}
