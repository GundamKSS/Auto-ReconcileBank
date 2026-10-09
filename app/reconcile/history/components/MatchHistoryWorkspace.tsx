"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronRight,
  ChevronLeft,
  Loader2,
  Undo2,
  CheckCircle2,
  Search,
  X,
} from "lucide-react";
import { getCurrentUsername } from "../../../../lib/currentUser";
import { useSidebar } from "../../../../components/SidebarContext";
import UnmatchConfirmModal, { UnmatchTarget } from "./UnmatchConfirmModal";
import HistoryTable, { HISTORY_TYPE_LABELS } from "./HistoryTable";
import { useInitialPeriod } from '../../../../hooks/useInitialPeriod';
import { useSessionState } from '../../../../hooks/useSessionState';
import { isNullableString, oneOf } from '../../../../lib/tabWorkspace';
import {
  MATCH_TYPE_META,
  MATCH_TYPE_ORDER,
  MatchRecord,
  MatchTypeValue,
  SubGroup,
  splitByDirection,
  toSubGroups,
} from "./historyModel";

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

// AP = เงินออก, AR = เงินเข้า — ความหมายเดียวกับหน้า Dashboard/Reports (app/dashboard/components/shared.ts)
type Side = "AP" | "AR" | "ALL";
// BANK = วันที่ใน statement, GL = วันที่ลงบัญชีใน BC365, CREATED = เวลาที่กดบันทึกในระบบนี้
type DateBasis = "BANK" | "GL" | "CREATED";
// แท็บประเภทของรายการ — "ALL" = ทุกประเภทปนกันในลิสต์เดียว
type TypeFilter = "ALL" | MatchTypeValue;

const SIDE_TABS: { value: Side; label: string }[] = [
  { value: "ALL", label: "ทั้งหมด" },
  { value: "AR", label: "เงินเข้า" },
  { value: "AP", label: "เงินออก" },
];

const TYPE_TABS: { value: TypeFilter; label: string; hint: string; activeClass: string }[] = [
  { value: "ALL", label: "ทั้งหมด", hint: "ทุกประเภท", activeClass: "border-blue-600 text-blue-700" },
  ...MATCH_TYPE_ORDER.map((t) => ({
    value: t as TypeFilter,
    label: HISTORY_TYPE_LABELS[t],
    hint: MATCH_TYPE_META[t].hint,
    activeClass: MATCH_TYPE_META[t].tabClass,
  })),
];

/** แท็บประเภทนี้มีบรรทัดฝั่ง Bank ให้กรองด้วยวันที่ Statement / AR / AP ได้หรือไม่ */
function typeHasBankSide(filter: TypeFilter) {
  return filter === "ALL" || MATCH_TYPE_META[filter].hasBankSide;
}

function toUnmatchTarget(g: SubGroup, match: MatchRecord): UnmatchTarget {
  if (match.matchType === "OFFSET") {
    // UnmatchConfirmModal variant "offset" อ่าน bank*/gl* เป็นขาเข้า/ขาออก
    const { inLines, outLines, inTotal, outTotal } = splitByDirection(g.glLines);
    return {
      key: g.key,
      matchId: g.matchId,
      num: g.num,
      bankCode: match.bankCode,
      bankCount: inLines.length,
      glCount: outLines.length,
      bankTotal: inTotal,
      glTotal: outTotal,
    };
  }
  return {
    key: g.key,
    matchId: g.matchId,
    num: g.num,
    bankCode: match.bankCode,
    bankCount: g.bankLines.length,
    glCount: g.glLines.length,
    bankTotal: g.bankLines.length > 0 ? g.bankTotal : g.glTotal,
    glTotal: g.glTotal,
  };
}

// ---------------------------------------------------------------------------

function SuccessToast({ message, onClose }: { message: string; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 4000);
    return () => clearTimeout(t);
  }, [onClose]);

  return (
    <motion.div
      initial={{ opacity: 0, y: -16, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -10, scale: 0.96, transition: { duration: 0.18 } }}
      transition={{ type: "spring", stiffness: 480, damping: 24 }}
      className="fixed top-5 right-5 z-50 flex items-start gap-3 bg-white/85 backdrop-blur-xl backdrop-saturate-150 border border-green-200/60 shadow-xl rounded-xl px-4 py-3 max-w-sm"
    >
      <CheckCircle2 size={20} className="text-green-600 shrink-0 mt-0.5" />
      <div className="flex-1">
        <p className="text-sm font-medium text-gray-900">สำเร็จ</p>
        <p className="text-xs text-gray-500 mt-0.5">{message}</p>
      </div>
      <button onClick={onClose} className="text-gray-300 hover:text-gray-500 shrink-0">
        <X size={16} />
      </button>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------

export default function MatchHistoryWorkspace() {
  // เปิดมาที่งวดที่กำลังกระทบยอดอยู่ หรืองวดล่าสุดที่มีข้อมูลจริง
  // (เดิมใช้ "เดือนก่อนหน้า" ซึ่งยังเดาผิดได้บ่อย เช่นมานั่งปิดงวดช้ากว่า 1 เดือน ก็เจอหน้าว่างอยู่ดี)
  const initialPeriod = useInitialPeriod('history');
  const initialRange = initialPeriod.range;
  // แถบสรุปที่เลือกลอยอยู่กึ่งกลาง "พื้นที่ตาราง" — บน desktop ต้องเผื่อความกว้าง sidebar เหมือน MainContent
  // ไม่งั้นจะเยื้องไปทางขวาเพราะ fixed อิงขอบจอ ไม่ใช่ขอบ content
  const { collapsed } = useSidebar();

  const [bankFilter, setBankFilter] = useSessionState("history:bankCode", "ALL");
  const [typeFilter, setTypeFilter] = useSessionState<TypeFilter>("history:type", "ALL", oneOf('ALL', 'MATCHED', 'SUSPENSE', 'OFFSET', 'EXCLUDED'));
  const [side, setSide] = useSessionState<Side>("history:side", "ALL", oneOf('ALL', 'AP', 'AR'));
  // จำนวน Match ของแต่ละแท็บภายใต้เงื่อนไขอื่นที่เลือกอยู่ — null ระหว่างรอโหลดครั้งแรก
  const [sideCounts, setSideCounts] = useState<Record<Side, number> | null>(null);
  const [typeCounts, setTypeCounts] = useState<Record<TypeFilter, number> | null>(null);
  const [bankCodes, setBankCodes] = useState<string[]>([]);
  // เก็บเฉพาะวันที่ที่ผู้ใช้เปลี่ยนเอง ส่วนค่าเริ่มต้นคำนวณจากงวดที่ resolve ได้ระหว่าง render
  // (ไม่คัดลอกลง state ผ่าน effect เพราะทำให้เกิด render ซ้อนและยิง request ด้วยค่า default ทิ้งหนึ่งรอบ)
  const [fromOverride, setFrom] = useSessionState<string | null>("history:from", null, isNullableString);
  const [toOverride, setTo] = useSessionState<string | null>("history:to", null, isNullableString);
  const from = fromOverride ?? initialRange.from;
  const to = toOverride ?? initialRange.to;
  // ค่าเริ่มต้นเป็นวันที่ลงบัญชีใน BC365 — เป็นวันที่เดียวที่รายการทุกประเภทมีเหมือนกัน
  // (พักโอน/หักล้างกันเอง/JV ปรับปรุง ไม่มีบรรทัดฝั่ง Bank จึงไม่มีวันที่ statement ให้อ้างอิง)
  const [dateBasis, setDateBasis] = useSessionState<DateBasis>("history:basis", "GL", oneOf('BANK', 'GL', 'CREATED'));
  const [queryInput, setQueryInput] = useSessionState("history:searchInput", "");
  const [query, setQuery] = useSessionState("history:search", "");

  const [matches, setMatches] = useState<MatchRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);

  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [pendingUnmatch, setPendingUnmatch] = useState<UnmatchTarget[]>([]);
  const [pendingVariant, setPendingVariant] = useState<"match" | "offset">("match");
  const [unmatchBusy, setUnmatchBusy] = useState(false);
  const [unmatchError, setUnmatchError] = useState("");
  const [toast, setToast] = useState<string | null>(null);

  const requestIdRef = useRef(0);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // กันยิงซ้ำในเฟรมเดียวกัน — state loadingMore อัปเดตแบบ async เลยเช็คไม่ทันถ้ามีสองสัญญาณมาพร้อมกัน
  const inFlightRef = useRef(false);

  const sideApplies = typeHasBankSide(typeFilter);
  const bankDateApplies = typeHasBankSide(typeFilter);

  const params = useMemo(() => {
    const p = new URLSearchParams({ from, to, dateBasis });
    if (typeFilter !== "ALL") p.set("matchType", typeFilter);
    if (bankFilter !== "ALL") p.set("bankCode", bankFilter);
    if (sideApplies && side !== "ALL") p.set("side", side);
    if (query) p.set("q", query);
    return p.toString();
  }, [from, to, dateBasis, typeFilter, bankFilter, sideApplies, side, query]);

  // โหลดหน้าแรกใหม่ทุกครั้งที่ filter เปลี่ยน หรือหลังยกเลิกการจับคู่สำเร็จ (reloadToken)
  useEffect(() => {
    // ยังไม่รู้ว่าจะเปิดมาที่งวดไหน — รอก่อน ไม่งั้นยิง API ด้วยงวดที่กำลังจะถูกแทนที่
    if (!initialPeriod.ready) return;

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
        setMatches(data.matches);
        setTotal(data.total ?? data.matches.length);
        if (Array.isArray(data.bankCodes)) setBankCodes(data.bankCodes);
        if (data.sideCounts) setSideCounts(data.sideCounts);
        if (data.typeCounts) setTypeCounts(data.typeCounts);
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

    // โหลดข้อมูลจาก server ตอน filter เปลี่ยน/mount เท่านั้น — ไม่มีทาง derive ระหว่าง render ได้
    loadFirstPage();
    return () => {
      cancelled = true;
    };
  }, [params, initialPeriod.ready, reloadToken]);

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

  // infinite scroll: โหลดชุดถัดไปเมื่อท้ายรายการใกล้เข้ามาในจอ
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

  function updateTypeFilter(next: TypeFilter) {
    setTypeFilter(next);
    // ประเภทที่ไม่มีบรรทัดฝั่ง Bank กรองด้วยวันที่ statement หรือ AR/AP ไม่ได้ — สลับกลับไปค่าที่ใช้ได้เสมอ
    if (!typeHasBankSide(next)) {
      if (dateBasis === "BANK") setDateBasis("GL");
      setSide("ALL");
    }
    setSelectedKeys(new Set());
  }
  function updateSide(next: Side) {
    setSide(next);
    setSelectedKeys(new Set());
  }
  function updateBankFilter(code: string) {
    setBankFilter(code);
    setSelectedKeys(new Set());
  }
  function updateFrom(v: string) {
    setFrom(v);
    setSelectedKeys(new Set());
  }
  function updateTo(v: string) {
    setTo(v);
    setSelectedKeys(new Set());
  }
  function updateDateBasis(next: DateBasis) {
    setDateBasis(next);
    setSelectedKeys(new Set());
  }
  function submitSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setQuery(queryInput.trim());
    setSelectedKeys(new Set());
  }
  function clearSearch() {
    setQueryInput("");
    setQuery("");
    setSelectedKeys(new Set());
  }
  function shiftMonth(offset: number) {
    const [y, m] = from.split("-").map(Number);
    const next = monthRange(new Date(y, m - 1 + offset, 1));
    setFrom(next.from);
    setTo(next.to);
    setSelectedKeys(new Set());
  }
  function resetToThisMonth() {
    const now = monthRange(new Date());
    setFrom(now.from);
    setTo(now.to);
    setSelectedKeys(new Set());
  }

  // แตกทุก Match เป็นกลุ่มย่อยครั้งเดียว แล้วใช้ร่วมกันทั้งการ์ด/แถบเลือก/modal
  const groupsByMatchId = useMemo(() => {
    const map = new Map<number, SubGroup[]>();
    for (const m of matches) map.set(m.matchId, toSubGroups(m));
    return map;
  }, [matches]);

  const matchById = useMemo(() => new Map(matches.map((m) => [m.matchId, m])), [matches]);

  // รายการพักโอน (SUSPENSE) ยกเลิกจากหน้านี้ไม่ได้ — ใช้ /api/reconcile/unsuspend ที่หน้า /suspense
  const eligibleGroups = useMemo(
    () =>
      matches
        .filter((m) => MATCH_TYPE_META[m.matchType].revertable)
        .flatMap((m) => (groupsByMatchId.get(m.matchId) ?? []).filter((g) => g.status === "ACTIVE")),
    [matches, groupsByMatchId]
  );
  const allEligibleSelected = eligibleGroups.length > 0 && eligibleGroups.every((g) => selectedKeys.has(g.key));

  const selectedGroups = useMemo(
    () => eligibleGroups.filter((g) => selectedKeys.has(g.key)),
    [eligibleGroups, selectedKeys]
  );

  function toggleGroup(key: string) {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (allEligibleSelected) {
        for (const g of eligibleGroups) next.delete(g.key);
        return next;
      }
      for (const g of eligibleGroups) next.add(g.key);
      return next;
    });
  }

  function requestUnmatch(groups: SubGroup[]) {
    setUnmatchError("");
    const targets = groups
      .map((g) => {
        const match = matchById.get(g.matchId);
        return match ? toUnmatchTarget(g, match) : null;
      })
      .filter((t): t is UnmatchTarget => t !== null);
    // หน้าต่างยืนยันมีสำนวนเฉพาะของหักล้างกันเอง (ขาเข้า/ขาออก) — ใช้ได้ก็ต่อเมื่อที่เลือกเป็น OFFSET ล้วน
    const allOffset = groups.every((g) => matchById.get(g.matchId)?.matchType === "OFFSET");
    setPendingVariant(allOffset && groups.length > 0 ? "offset" : "match");
    setPendingUnmatch(targets);
  }

  async function handleConfirmUnmatch(reason: string) {
    if (pendingUnmatch.length === 0) return;
    setUnmatchBusy(true);
    setUnmatchError("");
    try {
      // ส่งเป็น targets ระดับกลุ่มย่อย — กลุ่มที่ไม่ได้เลือกใน Match เดียวกันจะยังจับคู่อยู่ตามเดิม
      const targetsByMatchId = new Map<number, number[]>();
      for (const t of pendingUnmatch) {
        const nums = targetsByMatchId.get(t.matchId) ?? [];
        nums.push(t.num);
        targetsByMatchId.set(t.matchId, nums);
      }

      const res = await fetch("/api/reconcile/unmatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targets: [...targetsByMatchId.entries()].map(([matchId, nums]) => ({ matchId, nums })),
          reason,
          unmatchedBy: getCurrentUsername(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setUnmatchError(data.error || "ยกเลิกการจับคู่ไม่สำเร็จ");
        return;
      }
      const groupCount = typeof data.groupCount === "number" ? data.groupCount : pendingUnmatch.length;
      setToast(
        pendingVariant === "offset"
          ? `ยกเลิกหักล้างกันเองสำเร็จ ${groupCount} กลุ่ม — รายการ BC กลับไปอยู่หน้ากระทบยอด แล้ว`
          : groupCount > 1
            ? `ยกเลิกสำเร็จ ${groupCount} กลุ่มย่อย จาก ${targetsByMatchId.size} Match — คืนสถานะ ${data.revertedBankLineCount} รายการเป็น “รอจับคู่” แล้ว`
            : `ยกเลิก Match #${pendingUnmatch[0].matchId} กลุ่ม ${pendingUnmatch[0].num} สำเร็จ — คืนสถานะ ${data.revertedBankLineCount} รายการเป็น “รอจับคู่” แล้ว`
      );
      const unmatchedKeys = new Set(pendingUnmatch.map((t) => t.key));
      setSelectedKeys((prev) => {
        const next = new Set(prev);
        for (const key of unmatchedKeys) next.delete(key);
        return next;
      });
      setPendingUnmatch([]);
      setReloadToken((v) => v + 1);
    } catch {
      setUnmatchError("ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาตรวจสอบการเชื่อมต่อ");
    } finally {
      setUnmatchBusy(false);
    }
  }

  const banks = ["ALL", ...bankCodes];

  return (
    <div className="flex-1 min-w-0 p-4 pb-24 sm:p-6 sm:pb-24">
      <AnimatePresence>{toast && <SuccessToast message={toast} onClose={() => setToast(null)} />}</AnimatePresence>
      {/* ต้องครอบ AnimatePresence ไม่งั้น exit animation ที่เขียนไว้ใน UnmatchConfirmModal จะไม่เคยเล่น — ปิดแล้วหายฉับ */}
      <AnimatePresence>
        {pendingUnmatch.length > 0 && (
          <UnmatchConfirmModal
            targets={pendingUnmatch}
            variant={pendingVariant}
            busy={unmatchBusy}
            onCancel={() => {
              if (!unmatchBusy) {
                setPendingUnmatch([]);
                setUnmatchError("");
              }
            }}
            onConfirm={handleConfirmUnmatch}
          />
        )}
      </AnimatePresence>

      <div
        className={`fixed bottom-5 inset-x-0 z-40 flex justify-center px-4 pointer-events-none transition-[padding] duration-300 ${
          collapsed ? "lg:pl-[82px]" : "lg:pl-[300px]"
        }`}
      >
        <AnimatePresence>
          {selectedGroups.length > 0 && (
            <motion.div
              initial={{ y: 90, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 90, opacity: 0 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="pointer-events-auto flex flex-wrap justify-center items-center gap-3 bg-gray-900 text-white rounded-xl shadow-xl pl-5 pr-2 py-2"
            >
              <span className="text-sm font-medium">เลือก {selectedGroups.length} แถว</span>
              <button onClick={() => setSelectedKeys(new Set())} className="text-xs text-gray-300 hover:text-white px-2">
                ล้างการเลือก
              </button>
              <button
                onClick={() => requestUnmatch(selectedGroups)}
                className="flex items-center gap-1.5 text-xs font-medium bg-red-600 hover:bg-red-500 active:scale-95 px-4 py-2 rounded-full transition-all"
              >
                <Undo2 size={13} /> ส่งกลับที่เลือก
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="mb-5">
        <h1 className="text-xl font-bold text-gray-900 sm:text-2xl">ประวัติการจับคู่</h1>
        <p className="mt-1 text-sm text-slate-500">เทียบธนาคารกับ BC365 ได้ทีละแถว</p>
      </div>

      <section aria-label="ค้นหาและกรองประวัติ" className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
        <form onSubmit={submitSearch} className="mb-4 flex flex-wrap gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="search" value={queryInput} onChange={(event) => setQueryInput(event.target.value)} placeholder="ค้นหาเลขเอกสาร รายละเอียด หรือยอดเงิน" aria-label="ค้นหาประวัติการจับคู่ทั้งหมด" className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-9 text-sm text-slate-700 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100" />
            {queryInput && <button type="button" onClick={clearSearch} aria-label="ล้างคำค้นหา" className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"><X size={14} /></button>}
          </div>
          <button type="submit" className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700">ค้นหา</button>
        </form>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="history-from" className="mb-1 block text-xs text-slate-500">ตั้งแต่</label>
            <input id="history-from" type="date" value={from} max={to || undefined} onChange={(e) => updateFrom(e.target.value)} className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-700" />
          </div>
          <div>
            <label htmlFor="history-to" className="mb-1 block text-xs text-slate-500">ถึง</label>
            <input id="history-to" type="date" value={to} min={from || undefined} onChange={(e) => updateTo(e.target.value)} className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-700" />
          </div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => shiftMonth(-1)} aria-label="เดือนก่อนหน้า" className="flex size-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"><ChevronLeft size={15} /></button>
            <button type="button" onClick={resetToThisMonth} className="h-9 rounded-lg border border-slate-200 px-3 text-xs text-slate-600 hover:bg-slate-50">เดือนนี้</button>
            <button type="button" onClick={() => shiftMonth(1)} aria-label="เดือนถัดไป" className="flex size-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"><ChevronRight size={15} /></button>
          </div>
          <div>
            <label htmlFor="history-date-basis" className="mb-1 block text-xs text-slate-500">วันที่จาก</label>
            <select id="history-date-basis" value={dateBasis} onChange={(e) => updateDateBasis(e.target.value as DateBasis)} className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-700">
              <option value="GL">BC365</option><option value="BANK" disabled={!bankDateApplies}>ธนาคาร</option><option value="CREATED">วันที่บันทึก</option>
            </select>
          </div>
          <div>
            <label htmlFor="history-bank" className="mb-1 block text-xs text-slate-500">ธนาคาร</label>
            <select id="history-bank" value={bankFilter} onChange={(e) => updateBankFilter(e.target.value)} className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-700">{banks.map((b) => <option key={b} value={b}>{b === "ALL" ? "ทุกธนาคาร" : b}</option>)}</select>
          </div>

        </div>
        {typeFilter === "ALL" && dateBasis === "BANK" && <p className="mt-3 text-xs text-amber-700">วันที่ธนาคารแสดงเฉพาะรายการที่มีฝั่งธนาคาร เลือกวันที่ BC365 เพื่อดูทุกประเภท</p>}
      </section>

      {sideApplies && (
        <div aria-label="กรองฝั่งธนาคาร" className="mb-4 grid grid-cols-3 gap-2">
          {SIDE_TABS.map((tab) => {
            const active = side === tab.value;
            const count = sideCounts?.[tab.value] ?? null;
            const activeClass = tab.value === "AR"
              ? "border-emerald-300 bg-emerald-50 text-emerald-700"
              : tab.value === "AP"
                ? "border-rose-300 bg-rose-50 text-rose-700"
                : "border-blue-300 bg-blue-50 text-blue-700";
            return (
              <button
                key={tab.value}
                type="button"
                onClick={() => updateSide(tab.value)}
                aria-pressed={active}
                className={`flex min-h-14 flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border px-3 py-3 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 ${
                  active ? activeClass : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"
                }`}
              >
                {tab.label}
                <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-medium tabular-nums ${
                  active ? "bg-gray-900/5 text-gray-700" : "bg-gray-100 text-gray-500"
                }`}>
                  {count === null ? "…" : count.toLocaleString()}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-1 border-b border-slate-200">
        {TYPE_TABS.map((tab) => <button key={tab.value} type="button" onClick={() => updateTypeFilter(tab.value)} aria-pressed={typeFilter === tab.value} className={`inline-flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium ${typeFilter === tab.value ? tab.activeClass : "border-transparent text-slate-500 hover:text-slate-800"}`}>
          {tab.label}<span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs tabular-nums text-slate-500">{typeCounts?.[tab.value]?.toLocaleString() ?? "…"}</span>
        </button>)}
      </div>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
      {unmatchError && <p className="mb-4 text-sm text-red-600">{unmatchError}</p>}

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <span>
            <strong className="font-semibold text-gray-900">{total.toLocaleString()}</strong> ชุด · {[...groupsByMatchId.values()].reduce((count, groups) => count + groups.length, 0).toLocaleString()} แถวที่แสดง
          </span>
          {query && (
            <span className="inline-flex max-w-[320px] items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
              <span className="truncate">“{query}”</span>
              <button type="button" onClick={clearSearch} className="shrink-0 rounded-full hover:bg-blue-100" aria-label="ล้างคำค้นหา">
                <X size={12} />
              </button>
            </span>
          )}
        </div>
        <label className="inline-flex cursor-pointer select-none items-center gap-1.5 text-xs font-medium text-gray-500">
          <input
            type="checkbox"
            checked={allEligibleSelected}
            onChange={toggleSelectAll}
            disabled={loading || eligibleGroups.length === 0}
            className="size-3.5 rounded border-gray-300"
          />
          เลือกแถวที่ส่งกลับได้ ({eligibleGroups.length})
        </label>
      </div>

      {loading && matches.length === 0 && (
        <div className="flex items-center gap-2 text-sm text-gray-400 py-10 justify-center">
          <Loader2 size={16} className="animate-spin" /> กำลังโหลด...
        </div>
      )}

      {!loading && matches.length === 0 && (
        <div className="text-center text-sm text-gray-400 py-10">ไม่พบรายการในช่วงวันที่และเงื่อนไขที่เลือก</div>
      )}

      {matches.length > 0 && (
        <>
          <HistoryTable matches={matches} groupsByMatchId={groupsByMatchId} selectedKeys={selectedKeys} onToggleGroup={toggleGroup} onRequestUnmatch={requestUnmatch} loading={loading} onLoadMore={loadMore}>

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
          </HistoryTable>
        </>
      )}
    </div>
  );
}
