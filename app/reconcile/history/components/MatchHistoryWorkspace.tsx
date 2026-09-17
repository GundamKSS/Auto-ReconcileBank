"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronRight,
  ChevronLeft,
  CalendarRange,
  SlidersHorizontal,
  Loader2,
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Undo2,
  CheckCircle2,
  X,
} from "lucide-react";
import { getCurrentUsername } from "../../../../lib/currentUser";
import { useSidebar } from "../../../../components/SidebarContext";
import UnmatchConfirmModal, { UnmatchTarget } from "./UnmatchConfirmModal";

type LineStatus = "ACTIVE" | "REVERSED";

type LineItem = {
  lineId?: number;
  entryNo?: number;
  num: number;
  date: string;
  description?: string;
  ref?: string;
  accountName?: string;
  direction: "IN" | "OUT";
  amount: number;
  status: LineStatus;
  reversedAt: string | null;
  reversedBy: string | null;
  reversedReason: string | null;
};

type MatchRecord = {
  matchId: number;
  bankCode: string;
  matchType: "MATCHED" | "SUSPENSE";
  createdBy: string | null;
  createdAt: string;
  status: LineStatus;
  reversedAt: string | null;
  reversedBy: string | null;
  reversedReason: string | null;
  bankLines: LineItem[];
  glLines: LineItem[];
};

// กลุ่มย่อย (Num) = 1 cluster ที่บาลานซ์กันเอง ไม่ว่าจะ 1:1, 1:N, N:1 — เป็นหน่วยที่ติ๊กเลือก/ยกเลิกได้
type SubGroup = {
  key: string;
  matchId: number;
  num: number;
  bankLines: LineItem[];
  glLines: LineItem[];
  bankTotal: number;
  glTotal: number;
  status: LineStatus;
  reversedAt: string | null;
  reversedBy: string | null;
  reversedReason: string | null;
};

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

function formatAmount(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
// สร้าง formatter ครั้งเดียว — toLocaleString แบบใส่ options จะสร้าง Intl ใหม่ทุกครั้ง
// ซึ่งหน้านี้เรียกทุกการ์ดทุกครั้งที่ติ๊ก checkbox (re-render ทั้งรายการ) ทำให้กดแล้วหน่วง
const dateTimeFormatter = new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short" });
function formatDateTime(iso: string) {
  return dateTimeFormatter.format(new Date(iso));
}
function formatDate(iso: string) {
  return new Date(iso).toISOString().slice(0, 10);
}
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
// เรียงตามที่ผู้ใช้ขอ: AP / AR / All
type Side = "AP" | "AR" | "ALL";
const SIDE_TABS: { value: Side; label: string; hint: string }[] = [
  { value: "AP", label: "AP", hint: "เงินออก" },
  { value: "AR", label: "AR", hint: "เงินเข้า" },
  { value: "ALL", label: "All", hint: "ทั้งสองฝั่ง" },
];

function subGroupKey(matchId: number, num: number) {
  return `${matchId}:${num}`;
}

/** แตก Match ออกเป็นกลุ่มย่อยตาม Num — สถานะของกลุ่มมาจากบรรทัดข้างใน (ยกเลิกทีเดียวทั้งกลุ่มเสมอ) */
function toSubGroups(match: MatchRecord): SubGroup[] {
  const nums = Array.from(
    new Set([...match.bankLines.map((l) => l.num), ...match.glLines.map((l) => l.num)])
  ).sort((a, b) => a - b);

  return nums.map((num) => {
    const bankLines = match.bankLines.filter((l) => l.num === num);
    const glLines = match.glLines.filter((l) => l.num === num);
    const lines = [...bankLines, ...glLines];
    const reversedLine = lines.find((l) => l.status === "REVERSED");
    // ถือว่ากลุ่มถูกยกเลิกเมื่อทุกบรรทัดในกลุ่มถูกยกเลิก — เผื่อกรณีข้อมูลเก่าที่ยกเลิกไว้ที่หัว Match เท่านั้น
    // ให้ดูสถานะหัว Match ประกอบด้วย
    const reversed = match.status === "REVERSED" || (lines.length > 0 && lines.every((l) => l.status === "REVERSED"));
    return {
      key: subGroupKey(match.matchId, num),
      matchId: match.matchId,
      num,
      bankLines,
      glLines,
      bankTotal: bankLines.reduce((s, l) => s + l.amount, 0),
      glTotal: glLines.reduce((s, l) => s + l.amount, 0),
      status: reversed ? "REVERSED" : "ACTIVE",
      reversedAt: reversedLine?.reversedAt ?? match.reversedAt,
      reversedBy: reversedLine?.reversedBy ?? match.reversedBy,
      reversedReason: reversedLine?.reversedReason ?? match.reversedReason,
    };
  });
}

function toUnmatchTarget(g: SubGroup, bankCode: string): UnmatchTarget {
  return {
    key: g.key,
    matchId: g.matchId,
    num: g.num,
    bankCode,
    bankCount: g.bankLines.length,
    glCount: g.glLines.length,
    bankTotal: g.bankTotal,
    glTotal: g.glTotal,
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
      {direction}
    </span>
  );
}

function HistorySidePanel({
  side,
  lines,
  total,
}: {
  side: "BANK" | "GL";
  lines: LineItem[];
  total: number;
}) {
  const isBank = side === "BANK";
  return (
    <div
      className={`min-w-0 overflow-hidden rounded-xl border ${
        isBank ? "border-sky-200/80 bg-white" : "border-violet-200/80 bg-white"
      }`}
    >
      <div
        className={`flex items-center justify-between gap-3 border-b px-3 py-2 ${
          isBank ? "border-sky-100 bg-sky-50/80" : "border-violet-100 bg-violet-50/80"
        }`}
      >
        <div className="flex items-center gap-2">
          <span className={`size-2 rounded-full ${isBank ? "bg-sky-500" : "bg-violet-500"}`} />
          <span className={`text-xs font-semibold ${isBank ? "text-sky-800" : "text-violet-800"}`}>
            {isBank ? "Bank statement" : "BC365 · General Ledger"}
          </span>
        </div>
        <span className={`text-[10px] font-medium ${isBank ? "text-sky-600" : "text-violet-600"}`}>
          {lines.length} รายการ
        </span>
      </div>

      <div className="divide-y divide-gray-100">
        {lines.length === 0 ? (
          <div className="flex min-h-20 items-center justify-center px-3 py-4 text-xs text-gray-400">
            ไม่มีรายการฝั่งนี้
          </div>
        ) : (
          lines.map((line, index) => {
            const detail = isBank
              ? [line.ref, line.description].filter(Boolean).join(" · ") || "-"
              : [line.ref, line.accountName].filter(Boolean).join(" · ") || "-";
            return (
              <div
                key={isBank ? line.lineId ?? index : line.entryNo ?? index}
                className="grid grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-x-3 px-3 py-2.5"
              >
                <span className="whitespace-nowrap text-[11px] font-medium text-gray-400">{formatDate(line.date)}</span>
                <DirectionBadge direction={line.direction} />
                <p className="min-w-0 truncate text-xs text-gray-500" title={detail}>
                  {detail}
                </p>
                <span className="whitespace-nowrap text-xs font-medium tabular-nums text-gray-700">
                  {formatAmount(line.amount)}
                </span>
              </div>
            );
          })
        )}
      </div>

      <div
        className={`flex items-center justify-between border-t px-3 py-2 ${
          isBank ? "border-sky-100 bg-sky-50/45" : "border-violet-100 bg-violet-50/45"
        }`}
      >
        <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-gray-400">Total</span>
        <span className={`text-sm font-bold tabular-nums ${isBank ? "text-sky-800" : "text-violet-800"}`}>
          {formatAmount(total)}
        </span>
      </div>
    </div>
  );
}

// ตารางรวม Bank/GL ของกลุ่มย่อยหนึ่งกลุ่ม หน้าตาเดียวกับหน้า Suspense — ต่างกันตรงที่ "หน่วยที่เลือก"
// คือทั้งกลุ่ม ไม่ใช่รายบรรทัด (Unmatch ต้องยกทั้งกลุ่มเสมอ ไม่งั้นกลุ่มที่เหลือจะยอดไม่บาลานซ์)
// เลยทำให้ติ๊กช่องไหนก็ติ๊ก/ปลดครบทั้งกลุ่มพร้อมกัน
function SubGroupBlock({
  group,
  colorIdx,
  selected,
  onToggleSelect,
  onRequestUnmatch,
}: {
  group: SubGroup;
  colorIdx: number;
  selected: boolean;
  onToggleSelect: () => void;
  onRequestUnmatch: () => void;
}) {
  const balanced = Math.abs(group.bankTotal - group.glTotal) < 0.005;
  const reversed = group.status === "REVERSED";

  return (
    <div
      className={`border-l-4 rounded-lg p-3 ${GROUP_COLORS[colorIdx % GROUP_COLORS.length]} ${
        reversed ? "opacity-60" : ""
      } ${selected ? "ring-2 ring-gray-900/70" : ""}`}
    >
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <div className="w-4 flex items-center justify-center shrink-0">
          {!reversed && (
            <input
              type="checkbox"
              checked={selected}
              onChange={onToggleSelect}
              className="w-4 h-4 rounded border-gray-300 text-gray-900 focus:ring-gray-400 cursor-pointer"
              aria-label={`เลือกกลุ่มย่อยที่ ${group.num} ของ Match #${group.matchId}`}
            />
          )}
        </div>
        <span
          className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
            GROUP_BADGE_COLORS[colorIdx % GROUP_BADGE_COLORS.length]
          }`}
        >
          กลุ่ม {group.num}
        </span>
        <span className="text-xs text-gray-500">
          {group.bankLines.length + group.glLines.length} รายการ ({group.bankLines.length} Bank : {group.glLines.length} BC)
        </span>
        {!balanced && <span className="text-[11px] text-red-500 font-medium">ยอดไม่ตรง!</span>}
        {reversed && (
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-600">ยกเลิกแล้ว</span>
        )}
        <span className="flex-1" />
        {!reversed && (
          <button
            onClick={onRequestUnmatch}
            className="flex items-center gap-1.5 text-[11px] font-medium text-red-600 hover:text-white hover:bg-red-600 border border-red-200 hover:border-red-600 px-2.5 py-1 rounded-full transition-colors shrink-0"
            title="ยกเลิกเฉพาะกลุ่มย่อยนี้ — กลุ่มอื่นใน Match เดียวกันยังจับคู่อยู่ตามเดิม"
          >
            <Undo2 size={12} />
            Unmatch กลุ่มนี้
          </button>
        )}
      </div>

      {reversed && (
        <p className="text-[11px] text-red-500 mb-2">
          ยกเลิกโดย {group.reversedBy ?? "ไม่ทราบผู้ยกเลิก"}
          {group.reversedAt ? ` เมื่อ ${formatDateTime(group.reversedAt)}` : ""}
          {group.reversedReason ? ` — เหตุผล: ${group.reversedReason}` : ""}
        </p>
      )}

      <div className="grid grid-cols-1 items-stretch gap-2 md:grid-cols-[minmax(0,1fr)_32px_minmax(0,1fr)]">
        <HistorySidePanel
          side="BANK"
          lines={group.bankLines}
          total={group.bankTotal}
        />
        <div className="flex items-center justify-center">
          <span
            className={`flex size-7 items-center justify-center rounded-full border bg-white shadow-sm ${
              balanced ? "border-emerald-200 text-emerald-600" : "border-red-200 text-red-500"
            }`}
            title={balanced ? "ยอดสองฝั่งตรงกัน" : "ยอดสองฝั่งไม่ตรงกัน"}
          >
            <ArrowLeftRight size={13} />
          </span>
        </div>
        <HistorySidePanel
          side="GL"
          lines={group.glLines}
          total={group.glTotal}
        />
      </div>
    </div>
  );
}

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
  const [expanded, setExpanded] = useState(false);
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());
  const headerCheckboxRef = useRef<HTMLInputElement | null>(null);

  const activeGroups = useMemo(() => groups.filter((g) => g.status === "ACTIVE"), [groups]);
  const reversedCount = groups.length - activeGroups.length;
  const selectedCount = activeGroups.filter((g) => selectedKeys.has(g.key)).length;
  const allSelected = activeGroups.length > 0 && selectedCount === activeGroups.length;

  // ติ๊กบางกลุ่ม = ช่องหัวการ์ดเป็นสถานะกลางๆ (indeterminate) — ตั้งผ่าน DOM ได้ทางเดียว
  useEffect(() => {
    if (headerCheckboxRef.current) {
      headerCheckboxRef.current.indeterminate = selectedCount > 0 && !allSelected;
    }
  }, [selectedCount, allSelected]);

  const activeBankTotal = activeGroups.reduce((s, g) => s + g.bankTotal, 0);
  const activeGlTotal = activeGroups.reduce((s, g) => s + g.glTotal, 0);
  const activeBankLineCount = activeGroups.reduce((s, g) => s + g.bankLines.length, 0);
  const activeGlLineCount = activeGroups.reduce((s, g) => s + g.glLines.length, 0);
  const fullyReversed = activeGroups.length === 0;

  // จัดกลุ่มย่อยใต้วันที่ Bank ล่าสุดของกลุ่มนั้น เพื่อไม่ให้กลุ่ม N:1 ที่มีหลายวันถูกแสดงซ้ำหลายครั้ง
  // ถ้าเป็นข้อมูล SUSPENSE เก่าที่ไม่มี Bank จึงค่อยถอยไปใช้วันที่ GL ล่าสุดแทน
  const groupsByDate = useMemo(() => {
    const map = new Map<string, SubGroup[]>();
    for (const group of groups) {
      const dates = (group.bankLines.length > 0 ? group.bankLines : group.glLines).map((line) => formatDate(line.date));
      const anchorDate = dates.sort((a, b) => b.localeCompare(a))[0] ?? "ไม่ทราบวันที่";
      const list = map.get(anchorDate) ?? [];
      list.push(group);
      map.set(anchorDate, list);
    }
    return [...map.entries()].sort(([a], [b]) => b.localeCompare(a));
  }, [groups]);

  function toggleExpandedDate(date: string) {
    setExpandedDates((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  }

  // opacity ของการ์ดที่ยกเลิกหมดแล้วต้องใส่ผ่าน animate — framer ตั้ง opacity เป็น inline style ซึ่งจะทับ class opacity-70
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: fullyReversed ? 0.7 : 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={`bg-white border rounded-2xl overflow-hidden transition-colors duration-200 ${
        fullyReversed ? "border-gray-200" : selectedCount > 0 ? "border-gray-900" : "border-gray-200"
      }`}
    >
      <div className="w-full flex items-center gap-3 px-4 py-3">
        <div className="shrink-0 w-5 flex items-center justify-center">
          {activeGroups.length > 0 && (
            <input
              ref={headerCheckboxRef}
              type="checkbox"
              checked={allSelected}
              onChange={() => onToggleAllGroups(activeGroups)}
              className="w-4 h-4 rounded border-gray-300 text-gray-900 focus:ring-gray-400 cursor-pointer"
              aria-label={`เลือกทุกกลุ่มย่อยของ Match #${match.matchId}`}
            />
          )}
        </div>

        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-3 flex-1 min-w-0 text-left hover:opacity-70"
        >
          <ChevronRight
            size={14}
            className={`text-gray-400 shrink-0 transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-0.5">
              <span className="text-sm font-medium text-gray-900">Match #{match.matchId}</span>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                {match.bankCode}
              </span>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-700">
                MATCHED
              </span>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                {groups.length} กลุ่มย่อย
              </span>
              {fullyReversed ? (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-600">
                  ยกเลิกแล้ว
                </span>
              ) : (
                reversedCount > 0 && (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                    ยกเลิกบางส่วน {reversedCount}/{groups.length} กลุ่ม
                  </span>
                )
              )}
              {selectedCount > 0 && (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-900 text-white">
                  เลือกแล้ว {selectedCount}/{activeGroups.length} กลุ่ม
                </span>
              )}
            </div>
            <p className="text-xs text-gray-400">
              {formatDateTime(match.createdAt)}
              {match.createdBy ? ` · โดย ${match.createdBy}` : ""} · Bank {activeBankLineCount} รายการ · GL{" "}
              {activeGlLineCount} รายการ
              {!expanded && activeGroups.length > 0 ? " · กดเพื่อคลี่ดูและติ๊กเลือกรายกลุ่มย่อย" : ""}
            </p>
            {fullyReversed && (
              <p className="text-xs text-red-500 mt-0.5">
                ยกเลิกโดย {match.reversedBy ?? groups[0]?.reversedBy ?? "ไม่ทราบผู้ยกเลิก"}
                {match.reversedAt ? ` เมื่อ ${formatDateTime(match.reversedAt)}` : ""}
                {match.reversedReason ? ` — เหตุผล: ${match.reversedReason}` : ""}
              </p>
            )}
          </div>
        </button>

        <div className="text-right shrink-0">
          <p className="text-sm font-semibold text-gray-900 tabular-nums">{formatAmount(activeBankTotal)}</p>
          {Math.abs(activeBankTotal - activeGlTotal) >= 0.005 && (
            <p className="text-[11px] text-red-500">GL {formatAmount(activeGlTotal)}</p>
          )}
        </div>

        {activeGroups.length > 0 && (
          <button
            onClick={() => onRequestUnmatch(activeGroups)}
            className="flex items-center gap-1.5 text-xs font-medium text-red-600 hover:text-white hover:bg-red-600 border border-red-200 hover:border-red-600 px-3 py-1.5 rounded-full transition-colors shrink-0"
            title="ยกเลิกการจับคู่ทั้ง Match นี้ — รายการจะกลับไป UNMATCHED ให้จับคู่ใหม่ได้"
          >
            <Undo2 size={13} />
            {activeGroups.length > 1 ? "Unmatch ทั้งใบ" : "Unmatch"}
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
            <div className="flex flex-col gap-2 border-t border-gray-100 bg-gray-50/50 p-3">
              {groupsByDate.map(([date, dateGroups]) => {
                const dateExpanded = expandedDates.has(date);
                const bankCount = dateGroups.reduce((sum, group) => sum + group.bankLines.length, 0);
                const glCount = dateGroups.reduce((sum, group) => sum + group.glLines.length, 0);
                const bankTotal = dateGroups.reduce((sum, group) => sum + group.bankTotal, 0);
                return (
                  <div key={date} className="overflow-hidden rounded-xl border border-gray-200 bg-white">
                    <button
                      type="button"
                      onClick={() => toggleExpandedDate(date)}
                      className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-gray-50"
                      aria-expanded={dateExpanded}
                    >
                      <ChevronRight
                        size={14}
                        className={`shrink-0 text-gray-400 transition-transform ${dateExpanded ? "rotate-90" : ""}`}
                      />
                      <span className="text-sm font-semibold text-gray-800">{date}</span>
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
                        {dateGroups.length} กลุ่มย่อย
                      </span>
                      <span className="hidden text-[11px] text-gray-400 sm:inline">
                        Bank {bankCount} · BC {glCount}
                      </span>
                      <span className="flex-1" />
                      <span className="text-sm font-semibold tabular-nums text-gray-900">{formatAmount(bankTotal)}</span>
                    </button>

                    <AnimatePresence initial={false}>
                      {dateExpanded && (
                        <motion.div
                          key="groups"
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2, ease: "easeInOut" }}
                          className="overflow-hidden"
                        >
                          <div className="flex flex-col gap-2 border-t border-gray-100 bg-gray-50/60 p-2">
                            {dateGroups.map((group) => (
                              <SubGroupBlock
                                key={group.key}
                                group={group}
                                colorIdx={groups.indexOf(group)}
                                selected={selectedKeys.has(group.key)}
                                onToggleSelect={() => onToggleGroup(group.key)}
                                onRequestUnmatch={() => onRequestUnmatch([group])}
                              />
                            ))}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>
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

export default function MatchHistoryWorkspace() {
  // กรองตามวันที่ของ Bank Statement → ค่าเริ่มต้นเป็น "เดือนก่อนหน้า" ไม่ใช่เดือนนี้
  // งานปกติคือเดือนนี้นั่งกระทบยอด statement ของเดือนที่แล้ว ถ้าเปิดมาที่เดือนนี้จะเจอหน้าว่างเกือบทุกครั้ง
  // (ทดสอบกับข้อมูลจริง 16 ก.ย. 2026: statement ก.ย. = 0 รายการ, ส.ค. = 20 รายการ)
  const initialRange = useMemo(() => {
    const now = new Date();
    return monthRange(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  }, []);
  // แถบสรุปที่เลือกลอยอยู่กึ่งกลาง "พื้นที่ตาราง" — บน desktop ต้องเผื่อความกว้าง sidebar เหมือน MainContent
  // ไม่งั้นจะเยื้องไปทางขวาเพราะ fixed อิงขอบจอ ไม่ใช่ขอบ content
  const { collapsed } = useSidebar();

  const [bankFilter, setBankFilter] = useState("ALL");
  const [side, setSide] = useState<Side>("ALL");
  // จำนวน Match ของแต่ละแท็บภายใต้เงื่อนไขอื่นที่เลือกอยู่ — null ระหว่างรอโหลดครั้งแรก
  const [sideCounts, setSideCounts] = useState<Record<Side, number> | null>(null);
  const [bankCodes, setBankCodes] = useState<string[]>([]);
  const [from, setFrom] = useState(initialRange.from);
  const [to, setTo] = useState(initialRange.to);

  const [matches, setMatches] = useState<MatchRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);

  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [pendingUnmatch, setPendingUnmatch] = useState<UnmatchTarget[]>([]);
  const [unmatchBusy, setUnmatchBusy] = useState(false);
  const [unmatchError, setUnmatchError] = useState("");
  const [toast, setToast] = useState<string | null>(null);

  const requestIdRef = useRef(0);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // กันยิงซ้ำในเฟรมเดียวกัน — state loadingMore อัปเดตแบบ async เลยเช็คไม่ทันถ้ามีสองสัญญาณมาพร้อมกัน
  const inFlightRef = useRef(false);

  // matchType=MATCHED เสมอ — หน้านี้เป็นประวัติการจับคู่อย่างเดียว รายการที่พักโอน (SUSPENSE)
  // มีหน้า /suspense ของตัวเองอยู่แล้ว ไม่ต้องมาปนกันที่นี่
  const params = useMemo(() => {
    // dateBasis=BANK: from/to กรองที่วันที่ของรายการใน Bank Statement ไม่ใช่วันที่กดจับคู่
    const p = new URLSearchParams({ from, to, matchType: "MATCHED", dateBasis: "BANK" });
    if (bankFilter !== "ALL") p.set("bankCode", bankFilter);
    if (side !== "ALL") p.set("side", side);
    return p.toString();
  }, [from, to, bankFilter, side]);

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
      } catch {
        if (!cancelled && reqId === requestIdRef.current) {
          setError("เชื่อมต่อ server ไม่ได้");
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
      if (reqId === requestIdRef.current) setError("เชื่อมต่อ server ไม่ได้");
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

  const bankCodeByMatchId = useMemo(
    () => new Map(matches.map((m) => [m.matchId, m.bankCode as string])),
    [matches]
  );

  const eligibleGroups = useMemo(
    () => matches.flatMap((m) => (groupsByMatchId.get(m.matchId) ?? []).filter((g) => g.status === "ACTIVE")),
    [matches, groupsByMatchId]
  );
  const allEligibleSelected =
    eligibleGroups.length > 0 && eligibleGroups.every((g) => selectedKeys.has(g.key));

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
    setPendingUnmatch(groups.map((g) => toUnmatchTarget(g, bankCodeByMatchId.get(g.matchId) ?? "")));
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
        groupCount > 1
          ? `ยกเลิกการจับคู่สำเร็จ ${groupCount} กลุ่มย่อย จาก ${targetsByMatchId.size} Match — คืนสถานะ ${data.revertedBankLineCount} รายการเป็น UNMATCHED แล้ว`
          : `ยกเลิกการจับคู่ Match #${pendingUnmatch[0].matchId} กลุ่ม ${pendingUnmatch[0].num} สำเร็จ — คืนสถานะ ${data.revertedBankLineCount} รายการเป็น UNMATCHED แล้ว`
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
      setUnmatchError("เชื่อมต่อ server ไม่ได้");
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
              <span className="text-sm font-medium">{selectedGroups.length} กลุ่มย่อยที่เลือก</span>
              <button onClick={() => setSelectedKeys(new Set())} className="text-xs text-gray-300 hover:text-white px-2">
                ล้าง
              </button>
              <button
                onClick={() => requestUnmatch(selectedGroups)}
                className="flex items-center gap-1.5 text-xs font-medium bg-red-600 hover:bg-red-500 active:scale-95 px-4 py-2 rounded-full transition-all"
              >
                <Undo2 size={13} /> Unmatch ที่เลือก
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <h1 className="text-xl sm:text-2xl font-bold text-gray-900 mb-1">ประวัติการจับคู่ (Match History)</h1>
      <p className="text-sm text-gray-500 mb-5">
        ย้อนดูได้ว่า Match แต่ละครั้งจับคู่รายการไหนกับรายการไหนบ้าง — กดคลี่การ์ดเพื่อติ๊กเลือกเป็น
        &ldquo;กลุ่มย่อย&rdquo; แล้วกด Unmatch เฉพาะกลุ่มที่แมชผิดได้ กลุ่มอื่นใน Match เดียวกันยังจับคู่อยู่ตามเดิม
        รายการที่ยกเลิกจะคืนสถานะไปจับคู่ใหม่ได้ในหน้า Reconcile (ต้องใส่เหตุผลทุกครั้ง เก็บไว้ตรวจสอบย้อนหลังได้)
        — หน้านี้แสดงเฉพาะรายการที่จับคู่แล้ว ไม่รวมรายการพักโอน
      </p>

      {/* แท็บ AP / AR / All — หน้าตาเดียวกับแท็บ AR/AP ของหน้า Dashboard */}
      <div className="mb-4 flex items-center gap-1 overflow-x-auto border-b border-gray-200">
        {SIDE_TABS.map((tab) => {
          const active = side === tab.value;
          const count = sideCounts?.[tab.value] ?? null;
          return (
            <button
              key={tab.value}
              onClick={() => updateSide(tab.value)}
              aria-pressed={active}
              className={`-mb-px inline-flex shrink-0 items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors ${
                active ? "border-gray-900 text-gray-900" : "border-transparent text-gray-400 hover:text-gray-700"
              }`}
            >
              {tab.label}
              <span className="text-xs font-normal">{tab.hint}</span>
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

      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}
      {unmatchError && <p className="text-sm text-red-600 mb-4">{unmatchError}</p>}

      <div className="flex items-center gap-1.5 mb-3 flex-wrap">
        <label className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={allEligibleSelected}
            onChange={toggleSelectAll}
            disabled={eligibleGroups.length === 0}
            className="w-3.5 h-3.5 rounded border-gray-300"
          />
          เลือกทุกกลุ่มย่อยที่ยกเลิกได้ในหน้านี้ ({eligibleGroups.length})
        </label>
        <span className="w-px h-5 bg-gray-200 mx-1" />
        {banks.map((b) => (
          <button
            key={b}
            onClick={() => updateBankFilter(b)}
            className={`text-xs font-medium px-3 py-1.5 rounded-full transition-colors ${
              bankFilter === b ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
            }`}
          >
            {b === "ALL" ? "ทุกธนาคาร" : b}
          </button>
        ))}
      </div>

      <div className="mb-5 flex flex-wrap items-end gap-3 rounded-xl border border-gray-100 bg-gray-50/60 p-3.5">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wide pb-1.5">
          <SlidersHorizontal size={13} /> กรองวันที่ Bank Statement
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-gray-500">ตั้งแต่วันที่</label>
          <input
            type="date"
            value={from}
            onChange={(e) => updateFrom(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white text-gray-700"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-gray-500">ถึงวันที่</label>
          <input
            type="date"
            value={to}
            onChange={(e) => updateTo(e.target.value)}
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
      </div>

      {loading && matches.length === 0 && (
        <div className="flex items-center gap-2 text-sm text-gray-400 py-10 justify-center">
          <Loader2 size={16} className="animate-spin" /> กำลังโหลด...
        </div>
      )}

      {!loading && matches.length === 0 && (
        <div className="text-center text-sm text-gray-400 py-10">ไม่พบประวัติการจับคู่ที่มีรายการ Bank Statement ในช่วงวันที่และเงื่อนไขที่เลือก</div>
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
