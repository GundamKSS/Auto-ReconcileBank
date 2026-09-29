"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronRight,
  ChevronLeft,
  CalendarRange,
  SlidersHorizontal,
  Loader2,
  Undo2,
  CheckCircle2,
  Search,
  ExternalLink,
  X,
} from "lucide-react";
import { getCurrentUsername } from "../../../../lib/currentUser";
import { useSidebar } from "../../../../components/SidebarContext";
import UnmatchConfirmModal, { UnmatchTarget } from "./UnmatchConfirmModal";
import MatchDetail from "./MatchDetail";
import {
  AMOUNT_TOLERANCE,
  MATCH_TYPE_META,
  MATCH_TYPE_ORDER,
  MatchRecord,
  MatchTypeValue,
  SubGroup,
  formatAmount,
  formatDateTime,
  formatSigned,
  splitByDirection,
  summarizeGroups,
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
  { value: "AP", label: "AP · เงินออก" },
  { value: "AR", label: "AR · เงินเข้า" },
  { value: "ALL", label: "ทั้งสองฝั่ง" },
];

const TYPE_TABS: { value: TypeFilter; label: string; hint: string; activeClass: string }[] = [
  { value: "ALL", label: "ทั้งหมด", hint: "ทุกประเภท", activeClass: "border-blue-600 text-blue-700" },
  ...MATCH_TYPE_ORDER.map((t) => ({
    value: t as TypeFilter,
    label: MATCH_TYPE_META[t].label,
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

function MatchCard({
  match,
  groups,
  selectedKeys,
  onToggleGroup,
  onToggleAllGroups,
  onRequestUnmatch,
}: {
  match: MatchRecord;
  groups: SubGroup[];
  selectedKeys: Set<string>;
  onToggleGroup: (key: string) => void;
  onToggleAllGroups: (groups: SubGroup[]) => void;
  onRequestUnmatch: (groups: SubGroup[]) => void;
}) {
  const meta = MATCH_TYPE_META[match.matchType];
  const [expanded, setExpanded] = useState(false);
  const headerCheckboxRef = useRef<HTMLInputElement | null>(null);

  const activeGroups = useMemo(() => groups.filter((g) => g.status === "ACTIVE"), [groups]);
  const reversedCount = groups.length - activeGroups.length;
  const fullyReversed = activeGroups.length === 0;
  const selectable = meta.revertable && activeGroups.length > 0;
  const selectedCount = selectable ? activeGroups.filter((g) => selectedKeys.has(g.key)).length : 0;
  const allSelected = selectable && selectedCount === activeGroups.length;

  // ติ๊กบางกลุ่ม = ช่องหัวการ์ดเป็นสถานะกลางๆ (indeterminate) — ตั้งผ่าน DOM ได้ทางเดียว
  useEffect(() => {
    if (headerCheckboxRef.current) {
      headerCheckboxRef.current.indeterminate = selectedCount > 0 && !allSelected;
    }
  }, [selectedCount, allSelected]);

  // สรุปบนหัวการ์ดจากกลุ่มที่ยังใช้งานอยู่ — ยกเลิกหมดแล้วค่อยสรุปจากทุกกลุ่ม ให้ยังรู้ว่าเคยเป็นรายการอะไร
  const summaryGroups = fullyReversed ? groups : activeGroups;
  const summary = summarizeGroups(summaryGroups);
  const isMatched = match.matchType === "MATCHED";
  const difference = isMatched ? summary.difference : 0;
  const hasDifference = Math.abs(difference) >= AMOUNT_TOLERANCE;

  // ยอดหลักมุมขวาของหัวการ์ดต่างกันตามประเภท — MATCHED ยึดยอดฝั่ง Bank ที่เหลือมีแต่ฝั่ง BC
  // (ไม่ห่อ useMemo — React Compiler จัดให้เอง และ summary เป็น object ที่สร้างใหม่ทุก render อยู่แล้ว)
  const offsetSplit = splitByDirection(summary.glLines);
  const headlineAmount =
    match.matchType === "MATCHED" ? summary.bankTotal : match.matchType === "OFFSET" ? offsetSplit.inTotal : summary.glTotal;
  const headlineLabel =
    match.matchType === "MATCHED"
      ? hasDifference
        ? `BC ${formatAmount(summary.glTotal)}`
        : "ยอดที่จับคู่"
      : match.matchType === "OFFSET"
        ? "ยอดที่หักล้าง"
        : match.matchType === "SUSPENSE"
          ? "ยอดที่พักไว้"
          : "ยอด JV";
  const countText =
    match.matchType === "MATCHED"
      ? `Bank ${summary.bankLines.length} รายการ · BC ${summary.glLines.length} รายการ`
      : match.matchType === "OFFSET"
        ? `BC ${summary.glLines.length} รายการ (${offsetSplit.inLines.length} เข้า : ${offsetSplit.outLines.length} ออก)`
        : `BC ${summary.glLines.length} รายการ`;

  // เลขเอกสารฝั่ง BC ที่เห็นจากหัวการ์ด — รายการ BC ล้วนไม่มีรายละเอียดฝั่ง Bank ให้ดู จึงต้องบอกตรงนี้แทน
  const docs = meta.hasBankSide
    ? []
    : Array.from(new Set(summary.glLines.map((l) => l.ref).filter((r): r is string => Boolean(r))));
  const docLine =
    docs.length === 0 ? "" : docs.slice(0, 4).join(" · ") + (docs.length > 4 ? ` และอีก ${docs.length - 4} ใบ` : "");

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: fullyReversed ? 0.7 : 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={`overflow-hidden rounded-2xl border bg-white transition-colors duration-200 ${
        !fullyReversed && selectedCount > 0 ? "border-gray-900" : "border-gray-200"
      }`}
    >
      {/* จอแคบ: ยอดกับปุ่มยกเลิกตกลงไปอยู่บรรทัดถัดไปทั้งก้อน — ไม่งั้นชื่อ/ชิปถูกบีบจนเหลือคอลัมน์ละ 1-2 ตัวอักษร */}
      <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
        <div className="flex w-5 shrink-0 items-center justify-center">
          {selectable && (
            <input
              ref={headerCheckboxRef}
              type="checkbox"
              checked={allSelected}
              onChange={() => onToggleAllGroups(activeGroups)}
              className="h-4 w-4 cursor-pointer rounded border-gray-300 text-gray-900 focus:ring-gray-400"
              aria-label={`เลือกทุกกลุ่มย่อยของ Match #${match.matchId}`}
            />
          )}
        </div>

        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex min-w-0 flex-1 basis-[min(100%,16rem)] items-center gap-3 text-left hover:opacity-70"
          aria-expanded={expanded}
        >
          <ChevronRight
            size={14}
            className={`shrink-0 text-gray-400 transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}
          />
          <div className="min-w-0 flex-1">
            <div className="mb-0.5 flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-gray-900">เลขอ้างอิง #{match.matchId}</span>
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-600">
                {match.bankCode}
              </span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${meta.chipClass}`}>
                {meta.label}
              </span>
              {groups.length > 1 && (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                  {groups.length} กลุ่มย่อย
                </span>
              )}
              {hasDifference && (
                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                  พักโอนส่วนต่าง {formatSigned(difference)}
                </span>
              )}
              {fullyReversed ? (
                <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-600">
                  ยกเลิกแล้ว
                </span>
              ) : (
                reversedCount > 0 && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                    ยกเลิกบางส่วน {reversedCount}/{groups.length} กลุ่ม
                  </span>
                )
              )}
              {selectedCount > 0 && (
                <span className="rounded-full bg-gray-900 px-2 py-0.5 text-[10px] font-semibold text-white">
                  เลือกแล้ว {selectedCount}/{activeGroups.length} กลุ่ม
                </span>
              )}
            </div>
            {docLine && (
              <p className="truncate text-xs text-gray-500" title={docLine}>
                {docLine}
              </p>
            )}
            <p className="text-xs text-gray-400">
              {formatDateTime(match.createdAt)}
              {match.createdBy ? ` · โดย ${match.createdBy}` : ""} · {countText}
              {!expanded ? " · กดเพื่อคลี่ดูรายละเอียดสองฝั่ง" : ""}
            </p>
            {match.remark && <p className="mt-0.5 truncate text-xs text-amber-700">หมายเหตุ: {match.remark}</p>}
            {fullyReversed && (
              <p className="mt-0.5 text-xs text-red-500">
                ยกเลิกโดย {match.reversedBy ?? groups[0]?.reversedBy ?? "ไม่ทราบผู้ยกเลิก"}
                {match.reversedAt ? ` เมื่อ ${formatDateTime(match.reversedAt)}` : ""}
                {match.reversedReason ? ` — เหตุผล: ${match.reversedReason}` : ""}
              </p>
            )}
          </div>
        </button>

        <div className="ml-auto flex shrink-0 items-center gap-3">
          <div className="text-right">
            <p className="text-sm font-semibold tabular-nums text-gray-900">{formatAmount(headlineAmount)}</p>
            <p className={`text-[11px] ${hasDifference ? "text-amber-700" : "text-gray-400"}`}>{headlineLabel}</p>
          </div>

          {selectable ? (
            <button
              onClick={() => onRequestUnmatch(activeGroups)}
              className="flex shrink-0 items-center gap-1.5 rounded-full border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:border-red-600 hover:bg-red-600 hover:text-white"
              title={
                match.matchType === "OFFSET"
                  ? "ส่งรายการ BC กลับไปเลือกใหม่ที่หน้ากระทบยอด"
                  : "ส่งรายการใน Match นี้กลับไปเลือกและจับคู่ใหม่ที่หน้ากระทบยอด"
              }
            >
              <Undo2 size={13} />
              {activeGroups.length > 1 ? "ส่งกลับทั้งหมด" : "คืนรายการเพื่อจับคู่ใหม่"}
            </button>
          ) : (
            !fullyReversed && (
              <a
                href="/suspense"
                className="flex shrink-0 items-center gap-1.5 rounded-full border border-amber-200 px-3 py-1.5 text-xs font-medium text-amber-700 transition-colors hover:border-amber-500 hover:bg-amber-50"
                title="รายการพักโอนดึงกลับได้ที่หน้ารายการพัก ซึ่งเลือกได้ทีละบรรทัดและทำเป็นชุด"
              >
                <ExternalLink size={13} />
                หน้ารายการพัก
              </a>
            )
          )}
        </div>
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
            <MatchDetail
              match={match}
              groups={groups}
              selectedKeys={selectedKeys}
              onToggleGroup={onToggleGroup}
              revertable={meta.revertable}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

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
  // ค่าเริ่มต้นเป็น "เดือนก่อนหน้า" ไม่ใช่เดือนนี้ — งานปกติคือเดือนนี้นั่งกระทบยอด statement ของเดือนที่แล้ว
  // ถ้าเปิดมาที่เดือนนี้จะเจอหน้าว่างเกือบทุกครั้ง
  const initialRange = useMemo(() => {
    const now = new Date();
    return monthRange(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  }, []);
  // แถบสรุปที่เลือกลอยอยู่กึ่งกลาง "พื้นที่ตาราง" — บน desktop ต้องเผื่อความกว้าง sidebar เหมือน MainContent
  // ไม่งั้นจะเยื้องไปทางขวาเพราะ fixed อิงขอบจอ ไม่ใช่ขอบ content
  const { collapsed } = useSidebar();

  const [bankFilter, setBankFilter] = useState("ALL");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("ALL");
  const [side, setSide] = useState<Side>("ALL");
  // จำนวน Match ของแต่ละแท็บภายใต้เงื่อนไขอื่นที่เลือกอยู่ — null ระหว่างรอโหลดครั้งแรก
  const [sideCounts, setSideCounts] = useState<Record<Side, number> | null>(null);
  const [typeCounts, setTypeCounts] = useState<Record<TypeFilter, number> | null>(null);
  const [bankCodes, setBankCodes] = useState<string[]>([]);
  const [from, setFrom] = useState(initialRange.from);
  const [to, setTo] = useState(initialRange.to);
  // ค่าเริ่มต้นเป็นวันที่ลงบัญชีใน BC365 — เป็นวันที่เดียวที่รายการทุกประเภทมีเหมือนกัน
  // (พักโอน/หักล้างกันเอง/JV ปรับปรุง ไม่มีบรรทัดฝั่ง Bank จึงไม่มีวันที่ statement ให้อ้างอิง)
  const [dateBasis, setDateBasis] = useState<DateBasis>("GL");
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");

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

  function toggleAllGroupsOfMatch(groups: SubGroup[]) {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      const allSelected = groups.every((g) => next.has(g.key));
      for (const g of groups) {
        if (allSelected) next.delete(g.key);
        else next.add(g.key);
      }
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
    <div className="flex-1 min-w-0 p-4 sm:p-6">
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
              className="pointer-events-auto flex items-center gap-3 bg-gray-900 text-white rounded-full shadow-xl pl-5 pr-2 py-2"
            >
              <span className="text-sm font-medium">เลือกแล้ว {selectedGroups.length} กลุ่ม</span>
              <button onClick={() => setSelectedKeys(new Set())} className="text-xs text-gray-300 hover:text-white px-2">
                ล้างการเลือก
              </button>
              <button
                onClick={() => requestUnmatch(selectedGroups)}
                className="flex items-center gap-1.5 text-xs font-medium bg-red-600 hover:bg-red-500 active:scale-95 px-4 py-2 rounded-full transition-all"
              >
                <Undo2 size={13} /> คืนรายการเพื่อจับคู่ใหม่
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="mb-5">
        <h1 className="text-xl font-bold text-gray-900 sm:text-2xl">ประวัติการจับคู่</h1>
        <p className="mt-1 text-sm text-gray-500">
          ตรวจสอบประวัติการจับคู่ การหักล้างรายการ BC365 รายการพัก และ JV ปรับปรุง
          เลือกแต่ละกลุ่มเพื่อดูรายละเอียด หรือคืนรายการเพื่อจับคู่ใหม่
        </p>
      </div>

      <section className="mb-5 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-[0_8px_28px_rgba(15,23,42,0.05)]">
        <div className="border-b border-gray-100 p-4">
          <form onSubmit={submitSearch} className="flex flex-col gap-2 sm:flex-row">
            <div className="relative min-w-0 flex-1">
              <Search
                size={17}
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400"
              />
              <input
                type="search"
                value={queryInput}
                onChange={(event) => setQueryInput(event.target.value)}
                placeholder="ค้นหายอดเงิน, Match ID, เลขเอกสาร, เลข Entry, เช็ค หรือรายละเอียด..."
                className="h-11 w-full rounded-xl border border-gray-200 bg-gray-50/70 pl-10 pr-10 text-sm text-gray-800 outline-none transition focus:border-blue-300 focus:bg-white focus:ring-4 focus:ring-blue-50"
                aria-label="ค้นหาประวัติการจับคู่ทั้งหมด"
              />
              {queryInput && (
                <button
                  type="button"
                  onClick={clearSearch}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-700"
                  aria-label="ล้างคำค้นหา"
                >
                  <X size={14} />
                </button>
              )}
            </div>
            <button
              type="submit"
              className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 active:scale-[0.98]"
            >
              <Search size={15} /> ค้นหาทั้งหมด
            </button>
          </form>
          <p className="mt-2 text-[11px] text-gray-400">
            ค้นหาจากข้อมูลทั้งหมดในระบบ ไม่จำกัดเฉพาะรายการที่โหลดอยู่บนหน้าจอ
          </p>
        </div>

        <div className="bg-gray-50/60 p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-gray-500">
                <SlidersHorizontal size={12} /> อ้างอิงวันที่จาก
              </label>
              <div className="flex rounded-xl border border-gray-200 bg-white p-1">
                {([
                  ["BANK", "Statement"],
                  ["GL", "BC365"],
                  ["CREATED", "วันที่บันทึก"],
                ] as const).map(([value, label]) => {
                  const disabled = value === "BANK" && !bankDateApplies;
                  return (
                    <button
                      key={value}
                      type="button"
                      disabled={disabled}
                      onClick={() => updateDateBasis(value)}
                      aria-pressed={dateBasis === value}
                      title={
                        disabled
                          ? "ประเภทที่เลือกไม่มีบรรทัดฝั่งธนาคารจึงไม่มีวันที่ statement ให้อ้างอิง"
                          : undefined
                      }
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                        dateBasis === value
                          ? "bg-gray-900 text-white shadow-sm"
                          : disabled
                            ? "cursor-not-allowed text-gray-300"
                            : "text-gray-500 hover:bg-gray-100"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-medium text-gray-500">ตั้งแต่วันที่</label>
              <input
                type="date"
                value={from}
                onChange={(e) => updateFrom(e.target.value)}
                className="h-9 rounded-lg border border-gray-200 bg-white px-2.5 text-sm text-gray-700"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-medium text-gray-500">ถึงวันที่</label>
              <input
                type="date"
                value={to}
                onChange={(e) => updateTo(e.target.value)}
                className="h-9 rounded-lg border border-gray-200 bg-white px-2.5 text-sm text-gray-700"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-medium text-gray-500">เลื่อนช่วงเดือน</label>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => shiftMonth(-1)}
                  title="เดือนก่อนหน้า"
                  className="flex size-9 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 hover:text-gray-800"
                >
                  <ChevronLeft size={14} />
                </button>
                <button
                  type="button"
                  onClick={resetToThisMonth}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-xs font-medium text-gray-600 hover:text-gray-900"
                >
                  <CalendarRange size={13} /> เดือนนี้
                </button>
                <button
                  type="button"
                  onClick={() => shiftMonth(1)}
                  title="เดือนถัดไป"
                  className="flex size-9 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 hover:text-gray-800"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>

            {sideApplies && (
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-medium text-gray-500">ทิศทางฝั่งธนาคาร</label>
                <div className="flex rounded-xl border border-gray-200 bg-white p-1">
                  {SIDE_TABS.map((tab) => {
                    const count = sideCounts?.[tab.value] ?? null;
                    return (
                      <button
                        key={tab.value}
                        type="button"
                        onClick={() => updateSide(tab.value)}
                        aria-pressed={side === tab.value}
                        className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                          side === tab.value ? "bg-gray-900 text-white shadow-sm" : "text-gray-500 hover:bg-gray-100"
                        }`}
                      >
                        {tab.label}
                        <span
                          className={`rounded-full px-1.5 text-[10px] font-medium tabular-nums ${
                            side === tab.value ? "bg-white/20 text-white" : "bg-gray-100 text-gray-500"
                          }`}
                        >
                          {count === null ? "…" : count.toLocaleString()}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {typeFilter === "ALL" && dateBasis === "BANK" && (
            <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-[11px] text-amber-800">
              กำลังกรองด้วยวันที่ Statement — รายการที่ไม่มีฝั่งธนาคาร(หักล้างกันเอง, พักโอน, JV ปรับปรุง) จะไม่แสดง
              เลือก &quot;BC365&quot; เพื่อดูครบทุกประเภท
            </p>
          )}

          <div className="mt-4 flex items-center gap-2 overflow-x-auto border-t border-gray-200/80 pt-3">
            <span className="shrink-0 text-[11px] font-semibold text-gray-400">ธนาคาร</span>
            {banks.map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => updateBankFilter(b)}
                className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                  bankFilter === b ? "bg-blue-600 text-white" : "border border-gray-200 bg-white text-gray-500 hover:bg-gray-100"
                }`}
              >
                {b === "ALL" ? "ทุกธนาคาร" : b}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-1 overflow-x-auto border-t border-gray-100 px-3">
          {TYPE_TABS.map((tab) => {
            const active = typeFilter === tab.value;
            const count = typeCounts?.[tab.value] ?? null;
            return (
              <button
                key={tab.value}
                type="button"
                onClick={() => updateTypeFilter(tab.value)}
                aria-pressed={active}
                className={`-mb-px inline-flex shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold transition-colors ${
                  active ? tab.activeClass : "border-transparent text-gray-400 hover:text-gray-700"
                }`}
              >
                {tab.label}
                <span className="hidden text-xs font-normal sm:inline">{tab.hint}</span>
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[11px] font-medium tabular-nums ${
                    active ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-500"
                  }`}
                >
                  {count === null ? "…" : count.toLocaleString()}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
      {unmatchError && <p className="mb-4 text-sm text-red-600">{unmatchError}</p>}

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <span>
            พบ <strong className="font-semibold text-gray-900">{total.toLocaleString()}</strong> ชุดการบันทึก
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
            disabled={eligibleGroups.length === 0}
            className="size-3.5 rounded border-gray-300"
          />
          เลือกทุกกลุ่มที่ยกเลิกได้ ({eligibleGroups.length})
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
          {/* ตอนเปลี่ยนตัวกรอง/หลัง Unmatch ให้คงรายการเดิมไว้แบบจางๆ ระหว่างรอผลใหม่ แทนการล้างเป็น spinner ทั้งหน้า
              ซึ่งทำให้ความสูงหน้ายุบลงชั่วครู่ แล้ว scroll กระโดดกลับขึ้นบน */}
          <div
            aria-busy={loading}
            className={`flex flex-col gap-3 transition-opacity duration-200 ${loading ? "opacity-50 pointer-events-none" : ""}`}
          >
            {matches.map((m) => (
              <MatchCard
                key={m.matchId}
                match={m}
                groups={groupsByMatchId.get(m.matchId) ?? []}
                selectedKeys={selectedKeys}
                onToggleGroup={toggleGroup}
                onToggleAllGroups={toggleAllGroupsOfMatch}
                onRequestUnmatch={requestUnmatch}
              />
            ))}
          </div>

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
        </>
      )}
    </div>
  );
}
