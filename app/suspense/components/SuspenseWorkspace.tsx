"use client";

import HelpTooltip from '../../../components/HelpTooltip';
import { SIDE_FILTER_ACTIVE_CLASS, SIDE_FILTER_INACTIVE_CLASS } from '../../../components/sideFilterStyles';
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronDown,
  Loader2,
  Undo2,
  CheckCircle2,
  Search,
  SlidersHorizontal,
  X,
  Layers,
  ArrowRight,
  ArrowDownLeft,
  ArrowUpRight,
} from "lucide-react";
import Link from "next/link";
import { useSidebar } from "@/components/SidebarContext";
import UnsuspendConfirmModal, { ConfirmLine } from "./UnsuspendConfirmModal";
import SuspenseTable from "./SuspenseTable";
import StatementPairModal, { type PairTarget } from "./StatementPairModal";
import { MAX_PAIR_TARGETS, type PairSuggestion } from "../../../lib/suspenseSuggest";
import { loadReconcileSession } from "../../../lib/reconcileSession";
import { useSessionState } from "../../../hooks/useSessionState";
import { oneOf } from "../../../lib/tabWorkspace";
import type { ReconcileSession } from "../../reconcile/components/types";
import type { BalanceData } from "../../reconcile/components/balanceTypes";
import { formatAmount } from '../../../lib/formatAmount';
import { missingWorkSide, visibleWorkSides, type WorkPermissions } from '../../../lib/workRoles';
import {
  suspenseBalanceParts,
  visibleLines,
  type MatchRecord,
  type RawGlLine,
  type SideTab,
  type UnifiedLine,
} from "./suspenseModel";

function formatSigned(n: number) {
  if (Math.abs(n) < 0.005) return "0.00";
  return `${n > 0 ? "+" : "−"}${formatAmount(Math.abs(n))}`;
}
// แท็บฝั่งรับ/จ่าย (กติกาการแยกฝั่งอยู่ใน suspenseModel.ts)
const SIDE_TABS = [
  { value: "ALL" as const, label: "ทั้งหมด", icon: Layers, activeClass: SIDE_FILTER_ACTIVE_CLASS.ALL },
  { value: "IN" as const, label: "เงินเข้า", icon: ArrowDownLeft, activeClass: SIDE_FILTER_ACTIVE_CLASS.AR },
  { value: "OUT" as const, label: "เงินออก", icon: ArrowUpRight, activeClass: SIDE_FILTER_ACTIVE_CLASS.AP },
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
  const [pickedSideTab, setSideTab] = useSessionState<SideTab>("suspense:side", "ALL", oneOf('ALL', 'IN', 'OUT'));
  // สิทธิ์ AP/AR ของผู้ใช้ — มากับหน้าแรกของ /api/history ซึ่งกรองรายการพักตามสิทธิ์ไว้แล้วฝั่ง server
  const [workPermissions, setWorkPermissions] = useState<WorkPermissions | undefined>(undefined);
  const visibleSides = visibleWorkSides(workPermissions);
  // สิทธิ์ฝั่งเดียว → อยู่ได้แค่แท็บฝั่งนั้น ("ทั้งหมด" ก็ปิด เพราะจะโชว์บรรทัดอีกฝั่งของชุดที่พักไว้ทั้งรับและจ่าย)
  const blockedTabs: SideTab[] =
    visibleSides.length === 1 ? (["ALL", "IN", "OUT"] as const).filter((t) => t !== visibleSides[0]) : [];
  const sideTab: SideTab = blockedTabs.includes(pickedSideTab) ? visibleSides[0] : pickedSideTab;
  // ไม่มีสิทธิ์ AP/AR เลย เห็นได้ทั้งสองฝั่งแต่คืนรายการไม่ได้ — server ปฏิเสธเหมือนกัน
  const readOnly = Boolean(missingWorkSide(workPermissions, visibleSides, "any"));
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
  // statement ที่ยอดตรงกับรายการพักแต่ละรายการ (ตาม Entry No.) — ป้ายใต้รายการ BC365 ในตาราง
  const [pairHints, setPairHints] = useState<Map<number, PairSuggestion>>(new Map());
  const [pairTarget, setPairTarget] = useState<PairTarget | null>(null);
  // Entry No. ที่ขอป้ายไปแล้ว — ขอเฉพาะรายการที่เพิ่งโหลดมา ไม่ขอซ้ำทุกครั้งที่เลื่อนโหลดเพิ่ม
  const requestedHintsRef = useRef<Set<number>>(new Set());
  // เลขรอบของป้าย — หลังจับคู่หรือคืนรายการ ผลที่ค้างอยู่ของรอบก่อนต้องทิ้งไป
  const hintGenerationRef = useRef(0);

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
        if (data.workPermissions) setWorkPermissions(data.workPermissions);
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

  // หา statement ให้รายการพักที่เพิ่งโหลดมา ทีละไม่เกิน MAX_PAIR_TARGETS รายการต่อคำขอ
  // พักส่วนต่างเป็นคู่ที่จับไว้แล้ว ไม่ต้องหา
  useEffect(() => {
    const ids = [
      ...new Set(matches.filter((m) => m.suspenseKind !== "DIFFERENCE").flatMap((m) => m.glLines.map((g) => g.entryNo))),
    ].filter((id) => !requestedHintsRef.current.has(id));
    if (ids.length === 0) return;
    ids.forEach((id) => requestedHintsRef.current.add(id));
    const generation = hintGenerationRef.current;

    (async () => {
      for (let i = 0; i < ids.length; i += MAX_PAIR_TARGETS) {
        const chunk = ids.slice(i, i + MAX_PAIR_TARGETS);
        try {
          const res = await fetch(`/api/reconcile/suspense-pair?entryNos=${chunk.join(",")}`);
          if (generation !== hintGenerationRef.current) return;
          if (!res.ok) throw new Error("hint request failed");
          const data = await res.json();
          if (generation !== hintGenerationRef.current) return;
          setPairHints((prev) => {
            const next = new Map(prev);
            for (const item of data.items as PairSuggestion[]) next.set(item.entryNo, item);
            return next;
          });
        } catch {
          // ป้ายเป็นตัวช่วยเสริม ขอไม่สำเร็จก็ไม่ขึ้นป้าย แต่ให้ขอใหม่ได้ตอนโหลดรายการรอบถัดไป
          // ปล่อยทั้งชุดที่พลาดและชุดที่ยังไม่ได้ขอ ไม่งั้นชุดหลังจะถูกข้ามไปตลอด
          if (generation === hintGenerationRef.current) ids.slice(i).forEach((id) => requestedHintsRef.current.delete(id));
          return;
        }
      }
    })();
  }, [matches]);

  function resetPairHints() {
    hintGenerationRef.current += 1;
    requestedHintsRef.current = new Set();
    setPairHints(new Map());
  }

  function openPairFinder(match: MatchRecord, gl: RawGlLine) {
    setPairTarget({
      matchId: match.matchId,
      entryNo: gl.entryNo,
      date: gl.date,
      documentNo: gl.ref ?? null,
      direction: gl.direction,
      amount: gl.amount,
    });
  }

  // target มาจากหน้าต่างที่บันทึกสำเร็จเอง — ปิดเฉพาะหน้าต่างนั้น ถ้าผู้ใช้เปิดรายการอื่นค้างไว้แล้วต้องไม่ปิดตามไปด้วย
  function handlePaired(target: PairTarget, message: string) {
    setPairTarget((current) =>
      current && current.matchId === target.matchId && current.entryNo === target.entryNo ? null : current
    );
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(`${target.matchId}:GL:${target.entryNo}`);
      return next;
    });
    setToast(message);
    resetPairHints();
    setReloadToken((t) => t + 1);
  }

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

  function toggleLines(lines: UnifiedLine[]) {
    const keys = lines.map((line) => line.key);
    setSelected((prev) => {
      const allSelected = keys.length > 0 && keys.every((key) => prev.has(key));
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

  function openConfirmForLines(lines: UnifiedLine[]) {
    if (lines.length > 0) setConfirmLines(lines.map(toConfirmLine));
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
      // รายการที่คืนไปกลายเป็น BC365 รอจับคู่ ซึ่งเป็นคู่แข่งของ statement ในป้ายของรายการพักอื่น
      resetPairHints();
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
          <div className="flex items-center gap-1.5"><h1 className="text-xl sm:text-2xl font-bold text-gray-900">รายการพัก</h1>
            <HelpTooltip label="เกี่ยวกับรายการพัก">เลือกรายการที่พร้อม แล้วกดคืนไปจับคู่ที่หน้ากระทบยอด</HelpTooltip>
          </div>
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
        period={reconcileSession ? `${reconcileSession.periodStart} ถึง ${reconcileSession.periodEnd}` : null}
      />

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-1">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">รายการที่พักไว้</h2>
          <p className="text-[11px] text-slate-400">
            พักทั้งรายการ {queueSummary.lineCount} ชุด · พักส่วนต่าง {queueSummary.differenceCount} ชุด
            {sideTab === "IN" && queueSummary.incoming > 0 && ` · ยอดรวมเงินเข้า ${formatAmount(queueSummary.incoming)} บาท`}
            {sideTab === "OUT" && queueSummary.outgoing > 0 && ` · ยอดรวมเงินออก ${formatAmount(queueSummary.outgoing)} บาท`}
          </p>
        </div>
      </div>

      {/* แยกฝั่งรับ/จ่ายที่ server (suspenseSide) ไม่ใช่กรองเฉพาะ 50 รายการที่โหลดมาแล้ว
          จำนวนบนแท็บมาจากการนับที่ไม่สนฝั่งที่เลือกอยู่ เลขของอีกฝั่งจึงไม่กลายเป็น 0 ตอนกดสลับ */}
      <div className="mb-4">
        <div
          role="tablist"
          aria-label="แยกฝั่งรายการพัก"
          className="inline-flex max-w-full overflow-x-auto min-w-0 self-start rounded-2xl border border-slate-200 bg-white p-1 shadow-sm"
        >
          {SIDE_TABS.map((tab, index) => {
            const active = sideTab === tab.value;
            const blocked = blockedTabs.includes(tab.value);
            const count = sideCounts?.[tab.value] ?? null;
            const amount =
              blocked ? null : tab.value === "IN" ? queueSummary.incoming : tab.value === "OUT" ? queueSummary.outgoing : null;
            const Icon = tab.icon;
            return (
              <button
                key={tab.value}
                id={`suspense-tab-${tab.value}`}
                type="button"
                role="tab"
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                onClick={() => setSideTab(tab.value)}
                onKeyDown={(event) => {
                  const target =
                    event.key === "Home"
                      ? SIDE_TABS[0]
                      : event.key === "End"
                      ? SIDE_TABS[SIDE_TABS.length - 1]
                      : event.key === "ArrowLeft"
                      ? SIDE_TABS[(index - 1 + SIDE_TABS.length) % SIDE_TABS.length]
                      : event.key === "ArrowRight"
                      ? SIDE_TABS[(index + 1) % SIDE_TABS.length]
                      : null;
                  if (target && !blockedTabs.includes(target.value)) {
                    event.preventDefault();
                    setSideTab(target.value);
                    document.getElementById(`suspense-tab-${target.value}`)?.focus();
                  }
                }}
                disabled={blocked}
                title={blocked ? "เห็นได้เฉพาะฝั่งที่ได้รับสิทธิ์ AP / AR" : undefined}
                className={`flex min-h-11 min-w-0 shrink-0 items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold transition-colors sm:px-4 sm:text-sm ${
                  active ? tab.activeClass : SIDE_FILTER_INACTIVE_CLASS
                } disabled:cursor-not-allowed disabled:opacity-40`}
              >
                <Icon size={16} className="hidden shrink-0 sm:block" />
                <span>{tab.label}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${
                    active ? "bg-white/20 text-white" : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {blocked ? "—" : count === null ? "…" : count.toLocaleString()}
                </span>
                {amount !== null && (
                  <span
                    className={`hidden text-xs font-normal sm:inline tabular-nums ${
                      active ? "text-white/80" : "text-slate-400"
                    }`}
                  >
                    · {formatAmount(amount)} บาท
                  </span>
                )}
              </button>
            );
          })}
        </div>
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
        {(dateFrom || dateTo) && !showDateFilters && <p className="mt-2 text-xs text-blue-600">วันที่พัก: {dateFrom || "ไม่จำกัด"} ถึง {dateTo || "ไม่จำกัด"}</p>}
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
              disabled={selectingAll || busy || readOnly}
              title={readOnly ? "ไม่มีสิทธิ์ AP / AR ดูได้อย่างเดียว" : undefined}
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

      {matches.length > 0 && (
        <SuspenseTable
          matches={matches}
          sideTab={sideTab}
          readOnly={readOnly}
          selected={selected}
          onToggleLine={toggleLine}
          onToggleLines={toggleLines}
          onRequestReturn={openConfirmForLines}
          loading={loading || selectingAll || busy}
          onLoadMore={loadMore}
          pairHints={pairHints}
          onFindPair={openPairFinder}
        >
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
        </SuspenseTable>
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

      <AnimatePresence>
        {pairTarget && (
          <StatementPairModal
            key={`${pairTarget.matchId}:${pairTarget.entryNo}`}
            target={pairTarget}
            readOnly={readOnly}
            onClose={() => setPairTarget(null)}
            onPaired={handlePaired}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>{toast && <SuccessToast message={toast} onClose={() => setToast("")} />}</AnimatePresence>
    </div>
  );
}
