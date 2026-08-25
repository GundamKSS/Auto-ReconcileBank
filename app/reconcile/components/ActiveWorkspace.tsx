"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  RotateCcw,
  RefreshCw,
  Sparkles,
  X,
  ArrowDownLeft,
  ArrowUpRight,
  ArrowLeftRight,
  Loader2,
  ChevronRight,
  CheckCircle2,
  Check,
  Pencil,
  CalendarRange,
  Link2,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { ReconcileSession } from "./types";
import SuggestPreviewModal, { Cluster } from "./Suggestpreviewmodal";
import { getCurrentUsername } from "../../../lib/currentUser";

type Direction = "IN" | "OUT";

type BankApiLine = {
  id: string;
  lineId: number;
  bankCode: string;
  date: string;
  ref: string;
  direction: Direction;
  description: string;
  amount: number;
};

type GlApiLine = {
  id: string;
  entryNo: number;
  bankCode: string;
  accountNo: string;
  accountName: string;
  date: string;
  ref: string;
  direction: Direction;
  description: string;
  amount: number;
};

type LineItem = {
  id: string;
  groupKey: string;
  date: string;
  ref: string;
  direction: Direction;
  description: string;
  amount: number;
};

function formatAmount(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatDate(iso: string) {
  return new Date(iso).toISOString().slice(0, 10);
}

// หา subset ของ items ที่ผลรวมเท่ากับ target พอดี (เหมือน backend ตอน suggest matches)
function findSubsetSumClient(
  items: { id: string; amount: number }[],
  target: number,
  maxSize = 5
): { id: string; amount: number }[] | null {
  const sorted = [...items].sort((a, b) => b.amount - a.amount);
  const chosen: { id: string; amount: number }[] = [];
  function backtrack(startIdx: number, remaining: number): boolean {
    if (Math.abs(remaining) < 0.005 && chosen.length > 0) return true;
    if (chosen.length >= maxSize) return false;
    for (let i = startIdx; i < sorted.length; i++) {
      if (sorted[i].amount - remaining > 0.005) continue;
      chosen.push(sorted[i]);
      if (backtrack(i + 1, remaining - sorted[i].amount)) return true;
      chosen.pop();
    }
    return false;
  }
  return backtrack(0, target) ? [...chosen] : null;
}

// หา id ของรายการที่จับกลุ่มกันได้จริง (1:1, 1:N, N:1) ภายใน "วันเดียวกัน + ทิศทางเดียวกัน"
// ไม่ใช่แค่ยอดรวมทั้งวันเท่ากันเฉยๆ — กันไม่ให้ auto-tick ทั้งวันทั้งที่จริงมีแค่บางส่วนจับคู่ได้จริง
function computeReadyIds(
  bankRaw: { id: string; date: string; direction: Direction; amount: number }[],
  glRaw: { id: string; date: string; direction: Direction; amount: number }[]
) {
  const bankByKey = new Map<string, { id: string; amount: number }[]>();
  for (const l of bankRaw) {
    const key = `${formatDate(l.date)}_${l.direction}`;
    const list = bankByKey.get(key) ?? [];
    list.push({ id: l.id, amount: l.amount });
    bankByKey.set(key, list);
  }
  const glByKey = new Map<string, { id: string; amount: number }[]>();
  for (const l of glRaw) {
    const key = `${formatDate(l.date)}_${l.direction}`;
    const list = glByKey.get(key) ?? [];
    list.push({ id: l.id, amount: l.amount });
    glByKey.set(key, list);
  }

  const readyBankIds: string[] = [];
  const readyGlIds: string[] = [];
  const clusterOf = new Map<string, number>(); // item id -> หมายเลขกลุ่ม (ไม่ทิ้งข้อมูลนี้อีกต่อไป)
  let clusterCounter = 0;

  function recordCluster(bankIds: string[], glIds: string[]) {
    clusterCounter += 1;
    for (const id of bankIds) clusterOf.set(id, clusterCounter);
    for (const id of glIds) clusterOf.set(id, clusterCounter);
  }

  for (const [key, bankItems] of bankByKey) {
    const glItemsOriginal = glByKey.get(key);
    if (!glItemsOriginal || glItemsOriginal.length === 0) continue;

    const remainingBank = [...bankItems];
    const remainingGl = [...glItemsOriginal];

    for (let i = remainingBank.length - 1; i >= 0; i--) {
      const b = remainingBank[i];
      const j = remainingGl.findIndex((g) => Math.abs(g.amount - b.amount) < 0.005);
      if (j !== -1) {
        readyBankIds.push(b.id);
        readyGlIds.push(remainingGl[j].id);
        recordCluster([b.id], [remainingGl[j].id]);
        remainingBank.splice(i, 1);
        remainingGl.splice(j, 1);
      }
    }
    for (let i = remainingBank.length - 1; i >= 0; i--) {
      const b = remainingBank[i];
      const subset = findSubsetSumClient(remainingGl, b.amount);
      if (subset) {
        readyBankIds.push(b.id);
        readyGlIds.push(...subset.map((s) => s.id));
        recordCluster([b.id], subset.map((s) => s.id));
        remainingBank.splice(i, 1);
        for (const s of subset) {
          const idx = remainingGl.findIndex((g) => g.id === s.id);
          if (idx !== -1) remainingGl.splice(idx, 1);
        }
      }
    }
    for (let i = remainingGl.length - 1; i >= 0; i--) {
      const g = remainingGl[i];
      const subset = findSubsetSumClient(remainingBank, g.amount);
      if (subset) {
        readyGlIds.push(g.id);
        readyBankIds.push(...subset.map((s) => s.id));
        recordCluster(subset.map((s) => s.id), [g.id]);
        remainingGl.splice(i, 1);
        for (const s of subset) {
          const idx = remainingBank.findIndex((b) => b.id === s.id);
          if (idx !== -1) remainingBank.splice(idx, 1);
        }
      }
    }
  }

  return { readyBankIds, readyGlIds, clusterOf };
}
function formatDMY(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function DirectionBadge({ direction }: { direction: Direction }) {
  const isIn = direction === "IN";
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full ${
        isIn ? "bg-teal-50 text-teal-700" : "bg-red-50 text-red-600"
      }`}
    >
      {isIn ? <ArrowDownLeft size={12} /> : <ArrowUpRight size={12} />}
      {direction}
    </span>
  );
}

function FilterTabs({ value, onChange }: { value: Direction; onChange: (v: Direction) => void }) {
  const options: Direction[] = ["IN", "OUT"];
  return (
    <div className="flex items-center gap-1 shrink-0">
      {options.map((opt) => (
        <button
          key={opt}
          onClick={() => onChange(opt)}
          className={`text-xs font-medium px-2.5 py-1 rounded-full transition-colors ${
            value === opt
              ? opt === "IN"
                ? "bg-teal-600 text-white"
                : "bg-red-500 text-white"
              : "text-gray-400 hover:text-gray-600"
          }`}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

function GroupTabs({
  groups,
  value,
  onChange,
}: {
  groups: { key: string; label: string; count: number }[];
  value: string;
  onChange: (v: string) => void;
}) {
  const totalCount = groups.reduce((s, g) => s + g.count, 0);
  if (groups.length <= 1) return null; // มีบัญชีเดียว ไม่ต้องโชว์แท็บให้รก
  return (
    <div className="flex items-center gap-1.5 px-4 pt-2.5 pb-1 flex-wrap shrink-0">
      <button
        onClick={() => onChange("ALL")}
        className={`text-xs font-medium px-2.5 py-1 rounded-full transition-colors ${
          value === "ALL" ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
        }`}
      >
        All {totalCount}
      </button>
      {groups.map((g) => (
        <button
          key={g.key}
          onClick={() => onChange(g.key)}
          className={`text-xs font-medium px-2.5 py-1 rounded-full transition-colors ${
            value === g.key ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
          }`}
          title={g.label}
        >
          {g.label} {g.count}
        </button>
      ))}
    </div>
  );
}

function CircleCheckbox({
  checked,
  indeterminate,
  ready,
  onClick,
}: {
  checked: boolean;
  indeterminate?: boolean;
  ready?: boolean;
  onClick: (e: React.MouseEvent) => void;
}) {
  const activeColor = ready ? "bg-green-600 border-green-600" : "bg-blue-600 border-blue-600";
  return (
    <>
      <style jsx>{`
        @keyframes checkPop {
          from {
            opacity: 0;
            transform: scale(0.4);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }
      `}</style>
      <button
        onClick={onClick}
        className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 border transition-all duration-150 active:scale-90 ${
          checked || indeterminate ? `${activeColor} scale-100` : "border-gray-300 bg-white hover:border-gray-400"
        }`}
        aria-label="select"
      >
        {checked && (
          <Check
            size={12}
            className="text-white"
            strokeWidth={3}
            style={{ animation: "checkPop 180ms ease-out" }}
          />
        )}
        {indeterminate && !checked && <span className="w-2 h-0.5 bg-white rounded" />}
      </button>
    </>
  );
}

const GROUP_COLORS = [
  "bg-purple-100 text-purple-700",
  "bg-orange-100 text-orange-700",
  "bg-cyan-100 text-cyan-700",
  "bg-pink-100 text-pink-700",
  "bg-lime-100 text-lime-700",
  "bg-indigo-100 text-indigo-700",
];

function DateGroupRow({
  date,
  items,
  expanded,
  onToggleExpand,
  selected,
  onToggle,
  matchReady,
  rowRef,
  highlighted,
  clusterOf,
  dateClusterNumbering,
}: {
  date: string;
  items: LineItem[];
  expanded: boolean;
  onToggleExpand: () => void;
  selected: Set<string>;
  onToggle: (id: string) => void;
  matchReady: boolean;
  rowRef?: (el: HTMLDivElement | null) => void;
  highlighted?: boolean;
  clusterOf: Map<string, number>;
  dateClusterNumbering: Map<string, Map<number, number>>;
}) {
  const total = items.reduce((sum, i) => sum + i.amount, 0);
  const selectedInGroup = items.filter((i) => selected.has(i.id)).length;
  const allSelected = selectedInGroup === items.length && items.length > 0;
  const someSelected = selectedInGroup > 0 && !allSelected;

  // เลขกลุ่มที่แสดง (1, 2, 3, ...) ต้องมาจาก map กลางที่คำนวณครั้งเดียวใน ActiveWorkspace แล้วส่งลงมา
  // ห้ามคำนวณแยกในแต่ละ panel เอง — เพราะฝั่ง bank/GL ดึงข้อมูลมาคนละ query เรียงคนละลำดับ
  // ถ้าต่างฝั่งคำนวณเลขกลุ่มเอง raw cluster เดียวกันจะได้เลขกำกับไม่ตรงกันข้ามฝั่ง (ดูสีผิด ดูเหมือนยอดไม่ตรง)
  const localClusterNo = dateClusterNumbering.get(date) ?? new Map<number, number>();

  function toggleGroup(e: React.MouseEvent) {
    e.stopPropagation();
    const shouldSelect = !allSelected;
    items.forEach((item) => {
      const isSel = selected.has(item.id);
      if (shouldSelect && !isSel) onToggle(item.id);
      if (!shouldSelect && isSel) onToggle(item.id);
    });
  }

  const rowBg = matchReady
    ? "bg-green-50/60"
    : someSelected || allSelected
    ? "bg-blue-50/40"
    : "";

  return (
    <div
      ref={rowRef}
      className={`border-b border-gray-50 last:border-b-0 transition-all duration-300 ${rowBg} ${
        highlighted ? "ring-2 ring-inset ring-blue-400 bg-blue-50/70" : ""
      }`}
    >
      <div className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 cursor-pointer" onClick={onToggleExpand}>
        <CircleCheckbox checked={allSelected} indeterminate={someSelected} ready={matchReady} onClick={toggleGroup} />
        <ChevronRight
          size={14}
          className="text-gray-400 shrink-0 transition-transform duration-200 ease-out"
          style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-sm text-gray-800 font-medium">{date}</span>
            <span className="text-[11px] text-gray-400">{items.length} รายการ</span>
            {matchReady && (
              <span className="text-[10px] font-semibold text-green-700 bg-green-100 px-2 py-0.5 rounded-full">
                MATCH READY
              </span>
            )}
            {someSelected && (
              <span className="text-[10px] font-semibold text-blue-700 bg-blue-100 px-2 py-0.5 rounded-full">
                เลือก {selectedInGroup}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs">
            <DirectionBadge direction={items[0]?.direction ?? "IN"} />
            <span className="text-gray-400">ยอดรวม {formatAmount(total)}</span>
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="text-[10px] text-gray-400">ยอดรวมวันนี้</p>
          <p className="text-base font-semibold text-gray-900 tabular-nums">{formatAmount(total)}</p>
        </div>
      </div>

      <div
        className="grid transition-[grid-template-rows] duration-200 ease-out"
        style={{ gridTemplateRows: expanded ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          <div className="bg-gray-50/60">
            {items.map((item) => {
              const isSelected = selected.has(item.id);
              const rawCluster = clusterOf.get(item.id);
              const groupNo = rawCluster !== undefined ? localClusterNo.get(rawCluster) : undefined;
              const groupColor = groupNo !== undefined ? GROUP_COLORS[(groupNo - 1) % GROUP_COLORS.length] : "";
              return (
                <label
                  key={item.id}
                  className={`flex items-center gap-3 pl-12 pr-4 py-2.5 cursor-pointer transition-colors border-t border-gray-100 ${
                    isSelected ? "bg-blue-50/60" : "hover:bg-gray-100/60"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => onToggle(item.id)}
                    className="w-4 h-4 rounded border-gray-300 shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 text-xs text-gray-400 mb-0.5 flex-wrap">
                      <span className="whitespace-nowrap">{item.ref}</span>
                      <DirectionBadge direction={item.direction} />
                      {groupNo !== undefined && (
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${groupColor}`}>
                          กลุ่ม {groupNo}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-800 truncate">{item.description}</p>
                  </div>
                  <span className="text-sm text-gray-700 tabular-nums whitespace-nowrap">{formatAmount(item.amount)}</span>
                </label>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function Panel({
  title,
  allItems,
  groups,
  groupTab,
  onGroupTabChange,
  selected,
  onToggle,
  filter,
  onFilterChange,
  loading,
  matchReadyDates,
  expandedDates,
  onToggleExpand,
  registerRowRef,
  highlightedDate,
  clusterOf,
  dateClusterNumbering,
  onSync,
  syncing,
  syncDisabled,
}: {
  title: string;
  allItems: LineItem[];
  groups: { key: string; label: string; count: number }[];
  groupTab: string;
  onGroupTabChange: (v: string) => void;
  selected: Set<string>;
  onToggle: (id: string) => void;
  filter: Direction;
  onFilterChange: (v: Direction) => void;
  loading: boolean;
  matchReadyDates: Set<string>;
  expandedDates: Set<string>;
  onToggleExpand: (date: string) => void;
  registerRowRef: (date: string, el: HTMLDivElement | null) => void;
  highlightedDate: string | null;
  clusterOf: Map<string, number>;
  dateClusterNumbering: Map<string, Map<number, number>>;
  onSync?: () => void;
  syncing?: boolean;
  syncDisabled?: boolean;
}) {
  const byGroup = groupTab === "ALL" ? allItems : allItems.filter((i) => i.groupKey === groupTab);
  const filtered = byGroup.filter((item) => item.direction === filter);

  const byDate = useMemo(() => {
    const map = new Map<string, LineItem[]>();
    for (const item of filtered) {
      const d = formatDate(item.date);
      if (!map.has(d)) map.set(d, []);
      map.get(d)!.push(item);
    }
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [filtered]);

  return (
    <div className="flex flex-col bg-white border border-gray-200 rounded-2xl overflow-hidden min-w-0 lg:h-full">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-100 flex-wrap shrink-0">
        <div className="flex items-baseline gap-2 min-w-0 flex-wrap">
          <h2 className="font-semibold text-[15px] text-gray-900 whitespace-nowrap">{title}</h2>
          <span className="text-xs text-gray-400 whitespace-nowrap">
            {selected.size} selected · {filtered.length} pending
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {onSync && (
            <button
              onClick={onSync}
              disabled={syncDisabled}
              title="ดึงรายการ GL ล่าสุด 40 วันจาก Business Central (BC365) มาอัปเดต — ใช้หลังบัญชีแก้ไขข้อมูลใน ERP เสร็จแล้ว"
              className="flex items-center gap-1.5 text-xs font-medium text-gray-600 border border-gray-200 px-2.5 py-1.5 rounded-full hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RefreshCw size={12} className={syncing ? "animate-spin" : ""} />
              {syncing ? "กำลังซิงค์..." : "ซิงค์จาก BC365"}
            </button>
          )}
          <FilterTabs value={filter} onChange={onFilterChange} />
        </div>
      </div>

      <GroupTabs groups={groups} value={groupTab} onChange={onGroupTabChange} />

      <div className="flex flex-col overflow-y-auto max-h-[55vh] lg:max-h-none lg:flex-1 lg:min-h-0">
        {loading && (
          <div className="px-4 py-10 text-center text-sm text-gray-400 flex items-center justify-center gap-2">
            <Loader2 size={16} className="animate-spin" /> กำลังโหลด...
          </div>
        )}
        {!loading && byDate.length === 0 && (
          <div className="px-4 py-10 text-center text-sm text-gray-400">ไม่มีรายการค้างจับคู่ในช่วงที่เลือก</div>
        )}
        {!loading &&
          byDate.map(([date, items]) => (
            <DateGroupRow
              key={date}
              date={date}
              items={items}
              expanded={expandedDates.has(date)}
              onToggleExpand={() => onToggleExpand(date)}
              selected={selected}
              onToggle={onToggle}
              matchReady={matchReadyDates.has(date)}
              rowRef={(el) => registerRowRef(date, el)}
              highlighted={highlightedDate === date}
              clusterOf={clusterOf}
              dateClusterNumbering={dateClusterNumbering}
            />
          ))}
      </div>
    </div>
  );
}

function SuccessToast({ title, message, onClose }: { title: string; message: string; onClose: () => void }) {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setLeaving(true), 3600);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(onClose, 200);
    return () => clearTimeout(t);
  }, [leaving, onClose]);

  return (
    <>
      <style jsx>{`
        @keyframes toastIn {
          from {
            opacity: 0;
            transform: translateY(-10px) scale(0.98);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
      `}</style>
      <div
        className="fixed top-5 right-5 z-50 flex items-start gap-3 bg-white border border-green-200 shadow-lg rounded-xl px-4 py-3 max-w-sm transition-all duration-200 ease-out"
        style={
          leaving
            ? { opacity: 0, transform: "translateY(-10px) scale(0.98)" }
            : { animation: "toastIn 250ms ease-out" }
        }
      >
        <CheckCircle2 size={20} className="text-green-600 shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="text-sm font-medium text-gray-900">{title}</p>
          <p className="text-xs text-gray-500 mt-0.5">{message}</p>
        </div>
        <button onClick={() => setLeaving(true)} className="text-gray-300 hover:text-gray-500 active:scale-90 transition-transform shrink-0">
          <X size={16} />
        </button>
      </div>
    </>
  );
}

export default function ActiveWorkspace({
  session,
  onEditFilters,
}: {
  session: ReconcileSession;
  onEditFilters: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const [glGroupTab, setGlGroupTab] = useState("ALL");
  const [directionFilter, setDirectionFilter] = useState<Direction>("IN");
  const [selectedBank, setSelectedBank] = useState<Set<string>>(new Set());
  const [selectedGl, setSelectedGl] = useState<Set<string>>(new Set());
  // โฟกัสตาราง: ซ่อนแถบข้อมูล/ย่อแถบสรุปด้านล่างชั่วคราว ให้พื้นที่ตารางเทียบทั้ง 2 ฝั่งใหญ่ขึ้น
  const [focusMode, setFocusMode] = useState(false);

  const [bankLinesRaw, setBankLinesRaw] = useState<BankApiLine[]>([]);
  const [glLinesRaw, setGlLinesRaw] = useState<GlApiLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ title: string; message: string } | null>(null);
  const [syncingGl, setSyncingGl] = useState(false);
  const [clusterOf, setClusterOf] = useState<Map<string, number>>(new Map());
  const [previewClusters, setPreviewClusters] = useState<Cluster[] | null>(null);

  // สวิชลิงค์วันที่: เปิด = กดขยายฝั่งไหน อีกฝั่งขยาย+เลื่อนตามให้อัตโนมัติ / ปิด = 2 ฝั่งอิสระต่อกัน
  const [linkDates, setLinkDates] = useState(true);
  const [expandedBankDates, setExpandedBankDates] = useState<Set<string>>(new Set());
  const [expandedGlDates, setExpandedGlDates] = useState<Set<string>>(new Set());
  const [highlight, setHighlight] = useState<{ side: "bank" | "gl"; date: string } | null>(null);
  const bankRowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const glRowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function registerBankRowRef(date: string, el: HTMLDivElement | null) {
    if (el) bankRowRefs.current.set(date, el);
    else bankRowRefs.current.delete(date);
  }
  function registerGlRowRef(date: string, el: HTMLDivElement | null) {
    if (el) glRowRefs.current.set(date, el);
    else glRowRefs.current.delete(date);
  }

  function flashHighlight(side: "bank" | "gl", date: string) {
    setHighlight({ side, date });
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHighlight(null), 1500);
  }

  function toggleBankExpand(date: string) {
    const willExpand = !expandedBankDates.has(date);
    setExpandedBankDates((prev) => {
      const next = new Set(prev);
      willExpand ? next.add(date) : next.delete(date);
      return next;
    });
    if (linkDates) {
      setExpandedGlDates((prev) => {
        const next = new Set(prev);
        willExpand ? next.add(date) : next.delete(date);
        return next;
      });
      if (willExpand) {
        requestAnimationFrame(() => {
          glRowRefs.current.get(date)?.scrollIntoView({ behavior: "smooth", block: "center" });
        });
        flashHighlight("gl", date);
      }
    }
  }

  function toggleGlExpand(date: string) {
    const willExpand = !expandedGlDates.has(date);
    setExpandedGlDates((prev) => {
      const next = new Set(prev);
      willExpand ? next.add(date) : next.delete(date);
      return next;
    });
    if (linkDates) {
      setExpandedBankDates((prev) => {
        const next = new Set(prev);
        willExpand ? next.add(date) : next.delete(date);
        return next;
      });
      if (willExpand) {
        requestAnimationFrame(() => {
          bankRowRefs.current.get(date)?.scrollIntoView({ behavior: "smooth", block: "center" });
        });
        flashHighlight("bank", date);
      }
    }
  }

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const qs = new URLSearchParams({
        bankCode: session.bankCode,
        from: session.periodStart,
        to: session.periodEnd,
        glExtendDays: session.includeSuspenseBuffer ? "7" : "0",
      });
      const res = await fetch(`/api/reconcile/data?${qs.toString()}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "โหลดข้อมูลไม่สำเร็จ");
        return;
      }
      setBankLinesRaw(data.bankLines);
      setGlLinesRaw(data.glLines);

      // auto-tick ทุกวันที่ยอด Bank กับ GL เท่ากันพอดีให้เลย ผู้ใช้แค่ตรวจแล้วกด Match ได้ทันที
      const { readyBankIds, readyGlIds, clusterOf: newClusterOf } = computeReadyIds(data.bankLines, data.glLines);
      setSelectedBank(new Set(readyBankIds));
      setSelectedGl(new Set(readyGlIds));
      setClusterOf(newClusterOf);
    } catch {
      setError("เชื่อมต่อ server ไม่ได้");
    } finally {
      setLoading(false);
    }
  }, [session.bankCode, session.periodStart, session.periodEnd, session.includeSuspenseBuffer]);

  useEffect(() => {
    // โหลดข้อมูลใหม่จาก server ทุกครั้งที่เปลี่ยนช่วงวันที่/บัญชีธนาคาร — fetch-on-mount ปกติ ไม่มีทางเลี่ยง setState ในนี้ได้
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadData();
  }, [loadData]);

  const bankLines: LineItem[] = useMemo(
    () =>
      bankLinesRaw.map((l) => ({
        id: l.id,
        groupKey: l.bankCode,
        date: l.date,
        ref: l.ref,
        direction: l.direction,
        description: l.description,
        amount: l.amount,
      })),
    [bankLinesRaw]
  );

  const glLines: LineItem[] = useMemo(
    () =>
      glLinesRaw.map((l) => ({
        id: l.id,
        groupKey: l.accountNo,
        date: l.date,
        ref: l.ref,
        direction: l.direction,
        description: `${l.description} · ${l.accountName}`,
        amount: l.amount,
      })),
    [glLinesRaw]
  );

  // ฝั่ง bank ไม่ต้องมีแท็บอีกแล้ว เพราะ session ล็อกธนาคารเดียวไว้ตั้งแต่ modal แล้ว (ไม่มีทางมีเกิน 1 กลุ่ม)
  const bankGroups = useMemo(() => {
    const map = new Map<string, number>();
    bankLines.forEach((l) => map.set(l.groupKey, (map.get(l.groupKey) ?? 0) + 1));
    return [...map.entries()].map(([key, count]) => ({ key, label: key, count }));
  }, [bankLines]);

  const glGroups = useMemo(() => {
    const map = new Map<string, { count: number; name: string }>();
    glLinesRaw.forEach((l) => {
      const existing = map.get(l.accountNo);
      map.set(l.accountNo, { count: (existing?.count ?? 0) + 1, name: l.accountName });
    });
    return [...map.entries()].map(([key, v]) => ({
      key,
      label: v.name ? `${key} (${v.name.match(/#[\d-]+$/)?.[0]?.slice(-4) ?? ""})` : key,
      count: v.count,
    }));
  }, [glLinesRaw]);

  // เช็คแยกอิสระต่อทิศทาง: วันไหนยอด IN ของ bank กับ GL เท่ากันพอดี ถือว่า ready แล้ว
  // ไม่ต้องรอให้ OUT ของวันเดียวกันตรงด้วย (และกลับกัน) เพราะบัญชีมองแยกกันจริงๆ
  const sumByDateDirection = useCallback((lines: LineItem[]) => {
    const map = new Map<string, number>();
    for (const l of lines) {
      const key = `${formatDate(l.date)}_${l.direction}`;
      map.set(key, (map.get(key) ?? 0) + l.amount);
    }
    return map;
  }, []);

  const matchReadyDatesByDirection = useMemo(() => {
    const bankSums = sumByDateDirection(bankLines);
    const glSums = sumByDateDirection(glLines);
    const ready: Record<Direction, Set<string>> = { IN: new Set(), OUT: new Set() };
    for (const [key, bSum] of bankSums) {
      const gSum = glSums.get(key);
      if (gSum === undefined || Math.abs(bSum - gSum) >= 0.005) continue;
      const [date, dir] = key.split("_") as [string, Direction];
      ready[dir].add(date);
    }
    return ready;
  }, [bankLines, glLines, sumByDateDirection]);

  const matchReadyDates = matchReadyDatesByDirection[directionFilter];

  // เลขกลุ่ม "กลุ่ม N" ที่โชว์บนจอต้องคำนวณครั้งเดียวใช้ร่วมกันทั้งฝั่ง bank และ GL ของวันเดียวกัน
  // ไล่จาก bankLines พอ เพราะทุก cluster ที่ computeReadyIds สร้างมีฝั่ง bank อย่างน้อย 1 รายการเสมอ
  // (ดู recordCluster ใน computeReadyIds — เรียกพร้อม bankIds/glIds ทั้งคู่ทุกครั้ง)
  const dateClusterNumbering = useMemo(() => {
    const map = new Map<string, Map<number, number>>();
    for (const l of bankLines) {
      const raw = clusterOf.get(l.id);
      if (raw === undefined) continue;
      const d = formatDate(l.date);
      let perDate = map.get(d);
      if (!perDate) {
        perDate = new Map<number, number>();
        map.set(d, perDate);
      }
      if (!perDate.has(raw)) perDate.set(raw, perDate.size + 1);
    }
    return map;
  }, [bankLines, clusterOf]);

  function toggleBank(id: string) {
    setSelectedBank((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function toggleGl(id: string) {
    setSelectedGl((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const selectedBankItems = useMemo(() => bankLinesRaw.filter((l) => selectedBank.has(l.id)), [selectedBank, bankLinesRaw]);
  const selectedGlItems = useMemo(() => glLinesRaw.filter((l) => selectedGl.has(l.id)), [selectedGl, glLinesRaw]);

  const bankTotal = useMemo(() => selectedBankItems.reduce((sum, l) => sum + l.amount, 0), [selectedBankItems]);
  const glTotal = useMemo(() => selectedGlItems.reduce((sum, l) => sum + l.amount, 0), [selectedGlItems]);
  const difference = bankTotal - glTotal;

  const amountMatches = Math.abs(difference) < 0.005;
  const canMatch = selectedBank.size > 0 && selectedGl.size > 0 && amountMatches;
  // Suspense พักได้แค่ฝั่ง GL (BC365) เท่านั้น — Bank Statement เป็นข้อมูลหลักจากธนาคาร ห้ามแก้ไข/ห้ามพัก
  const canMoveToSuspense = selectedGl.size > 0;

  function handleClear() {
    setSelectedBank(new Set());
    setSelectedGl(new Set());
  }

  // จัดกลุ่มรายการที่เลือกไว้ตาม "วันที่ + ทิศทาง" ก่อนส่ง แต่ละกลุ่มจะกลายเป็นคนละ MatchId แยกกัน
  // เพื่อให้ตรวจสอบย้อนหลังได้จริงว่า MatchId ไหนคือคู่ไหน ไม่ปนข้ามวัน/ข้ามทิศทางกันในบันทึกเดียว
  function groupSelectionByDateDirection() {
    const groups = new Map<string, { bankIds: number[]; glIds: number[] }>();

    function keyFor(itemId: string, date: string, direction: Direction) {
      const cluster = clusterOf.get(itemId);
      // มี cluster ที่ algorithm หาไว้แล้ว = ยึดตามนั้นเป๊ะ (ต้องตรงกับ badge สีที่โชว์บนจอ)
      // ไม่มี cluster (ผู้ใช้เลือกเองล้วนๆ) = fallback กลุ่มตามวันที่+ทิศทางเหมือนเดิม
      return cluster !== undefined ? `cluster_${cluster}` : `manual_${formatDate(date)}_${direction}`;
    }

    for (const l of selectedBankItems) {
      const key = keyFor(l.id, l.date, l.direction);
      const g = groups.get(key) ?? { bankIds: [], glIds: [] };
      g.bankIds.push(l.lineId);
      groups.set(key, g);
    }
    for (const l of selectedGlItems) {
      const key = keyFor(l.id, l.date, l.direction);
      const g = groups.get(key) ?? { bankIds: [], glIds: [] };
      g.glIds.push(l.entryNo);
      groups.set(key, g);
    }
    return groups;
  }

  async function handleMatch() {
    if (!canMatch || busy || syncingGl) return;
    setBusy(true);
    try {
      const grouped = groupSelectionByDateDirection();
      const groups = [...grouped.values()]
        .filter((g) => g.bankIds.length > 0 && g.glIds.length > 0)
        .map((g) => ({ bankLineIds: g.bankIds, glEntryNos: g.glIds }));

      const res = await fetch("/api/reconcile/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bankCode: session.bankCode, matchType: "MATCHED", groups, createdBy: getCurrentUsername() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Match ไม่สำเร็จ");
        return;
      }
      setToast({
        title: "จับคู่สำเร็จ",
        message:
          groups.length === 1
            ? `จับคู่สำเร็จ (MatchId ${data.matchId}) ยอด ${formatAmount(bankTotal)} บาท`
            : `จับคู่สำเร็จ ${groups.length} กลุ่มย่อย ภายใต้ MatchId ${data.matchId}`,
      });
      await loadData();
    } catch {
      setError("เชื่อมต่อ server ไม่ได้");
    } finally {
      setBusy(false);
    }
  }

  async function handleMoveToSuspense() {
    if (!canMoveToSuspense || busy || syncingGl) return;
    setBusy(true);
    try {
      const grouped = groupSelectionByDateDirection();
      // ส่งเฉพาะฝั่ง GL เข้ากลุ่ม suspense — ไม่ส่ง bankLineIds แม้จะมีฝั่ง Bank ถูกเลือกอยู่ด้วยก็ตาม
      const groups = [...grouped.values()]
        .filter((g) => g.glIds.length > 0)
        .map((g) => ({ bankLineIds: [], glEntryNos: g.glIds }));

      const res = await fetch("/api/reconcile/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bankCode: session.bankCode, matchType: "SUSPENSE", groups, createdBy: getCurrentUsername() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "ย้ายเข้าบัญชีพักไม่สำเร็จ");
        return;
      }
      setToast({
        title: "ย้ายเข้าบัญชีพักสำเร็จ",
        message: `ย้ายเข้าบัญชีพักโอนแล้ว (MatchId ${data.matchId}, ${groups.length} กลุ่มย่อย)`,
      });
      await loadData();
    } catch {
      setError("เชื่อมต่อ server ไม่ได้");
    } finally {
      setBusy(false);
    }
  }

  async function handleSuggestMatches() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/reconcile/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bankCode: session.bankCode,
          from: session.periodStart,
          to: session.periodEnd,
          glExtendDays: session.includeSuspenseBuffer ? "7" : "0",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Suggest matches ไม่สำเร็จ");
        return;
      }
      if (data.clusters.length === 0) {
        setError("ไม่พบรายการที่จับคู่กันได้แบบชัดเจน (1:1, 1:N, N:1) — เหลือแต่เคสซับซ้อนที่ต้องเลือกเอง");
        return;
      }
      setPreviewClusters(data.clusters);
    } catch {
      setError("เชื่อมต่อ server ไม่ได้");
    } finally {
      setBusy(false);
    }
  }

  // ให้บัญชีกดหลังแก้ไขข้อมูลใน BC365 (ERP) เสร็จแล้ว — ดึงรายการ GL ล่าสุด 40 วันมาอัปเดต SQL แล้วโหลดหน้า reconcile ใหม่
  async function handleSyncGl() {
    if (loading || busy || syncingGl) return;
    setSyncingGl(true);
    setError("");
    try {
      const res = await fetch("/api/reconcile/sync-gl", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "ซิงค์ข้อมูลจาก BC365 ไม่สำเร็จ");
        return;
      }
      await loadData();
      setToast({ title: "ซิงค์ข้อมูลสำเร็จ", message: "ดึงรายการ GL ล่าสุดจาก BC365 มาอัปเดตแล้ว" });
    } catch {
      setError("เชื่อมต่อ BC365 sync service ไม่ได้");
    } finally {
      setSyncingGl(false);
    }
  }

  return (
    <div
      className={`flex-1 min-w-0 flex flex-col lg:overflow-hidden transition-all duration-500 ease-out ${
        mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"
      }`}
    >
      {toast && <SuccessToast title={toast.title} message={toast.message} onClose={() => setToast(null)} />}
      {previewClusters && (
        <SuggestPreviewModal
          clusters={previewClusters}
          bankCode={session.bankCode}
          directionFilter={directionFilter}
          onClose={() => setPreviewClusters(null)}
          onConfirmed={async (message) => {
            setPreviewClusters(null);
            setToast({ title: "จับคู่สำเร็จ", message });
            await loadData();
          }}
        />
      )}

      <div className="px-4 sm:px-6 py-5 flex items-start justify-between gap-4 flex-wrap shrink-0">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Reconciliation workspace</h1>
          {!focusMode && (
            <p className="text-sm text-gray-500 mt-1">
              Bank Cr ↔ GL Dr · Bank Dr ↔ GL Cr · same date · GL แยกตามบัญชี
            </p>
          )}
          {error && <p className="text-sm text-red-600 mt-1">{error}</p>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setFocusMode((v) => !v)}
            className={`flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-full border transition-colors ${
              focusMode
                ? "text-blue-700 bg-blue-50 border-blue-200 hover:bg-blue-100"
                : "text-gray-600 border-gray-200 hover:bg-gray-50"
            }`}
            title="ซ่อนแถบข้อมูลด้านบน/ย่อแถบสรุปด้านล่าง ให้เห็นตารางเทียบทั้ง 2 ฝั่งชัดขึ้น"
          >
            {focusMode ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            {focusMode ? "ย่อกลับ" : "โฟกัสตาราง"}
          </button>
          <button
            onClick={loadData}
            disabled={loading || busy || syncingGl}
            className="flex items-center gap-1.5 text-sm text-gray-600 border border-gray-200 px-3.5 py-2 rounded-full hover:bg-gray-50 disabled:opacity-50"
          >
            <RotateCcw size={14} /> Reset
          </button>
          <button
            onClick={handleSuggestMatches}
            disabled={loading || busy || syncingGl}
            className="flex items-center gap-1.5 text-sm font-medium text-blue-600 border border-blue-200 bg-blue-50 px-3.5 py-2 rounded-full hover:bg-blue-100 disabled:opacity-50"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            Suggest matches
          </button>
        </div>
      </div>

      {/* Filter bar — สรุป scope ปัจจุบันจาก session + ปุ่มแก้ไข — ซ่อนตอนโฟกัสตาราง เพื่อเพิ่มพื้นที่ */}
      {!focusMode && (
        <div className="mx-4 sm:mx-6 mb-4 flex items-center justify-between gap-3 flex-wrap bg-blue-50/60 border border-blue-100 rounded-xl px-4 py-2.5 shrink-0">
          <div className="flex items-center gap-2 text-sm text-blue-900 flex-wrap">
            <CalendarRange size={15} className="text-blue-500" />
            <span className="font-medium">Bank: {session.bankCode}</span>
            <span className="text-blue-300">|</span>
            <span>
              Period: {formatDMY(session.periodStart)} - {formatDMY(session.periodEnd)}
            </span>
            {session.fileName && (
              <>
                <span className="text-blue-300">|</span>
                <span className="text-blue-700">{session.fileName}</span>
              </>
            )}
            {session.includeSuspenseBuffer && (
              <span className="text-[11px] font-medium text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                GL +7 วัน (พักโอนข้ามเดือน)
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={() => setLinkDates((v) => !v)}
              className="flex items-center gap-2 text-xs font-medium text-blue-900"
              title="เปิด = กดขยายวันฝั่งไหน อีกฝั่งขยาย+เลื่อนตามให้อัตโนมัติ"
            >
              <Link2 size={13} className={linkDates ? "text-blue-600" : "text-gray-400"} />
              ลิงค์วันที่ 2 ฝั่ง
              <span
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                  linkDates ? "bg-blue-600" : "bg-gray-300"
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                    linkDates ? "translate-x-[18px]" : "translate-x-1"
                  }`}
                />
              </span>
            </button>
            <button
              onClick={onEditFilters}
              className="flex items-center gap-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 px-3 py-1.5 rounded-full transition-colors"
            >
              <Pencil size={12} /> Edit
            </button>
          </div>
        </div>
      )}

      <div className="lg:flex-1 lg:min-h-0 px-4 sm:px-6 pb-4 lg:overflow-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:h-full">
          <Panel
            title="Bank statement"
            allItems={bankLines}
            groups={bankGroups}
            groupTab="ALL"
            onGroupTabChange={() => {}}
            selected={selectedBank}
            onToggle={toggleBank}
            filter={directionFilter}
            onFilterChange={setDirectionFilter}
            loading={loading}
            matchReadyDates={matchReadyDates}
            expandedDates={expandedBankDates}
            onToggleExpand={toggleBankExpand}
            registerRowRef={registerBankRowRef}
            highlightedDate={highlight?.side === "bank" ? highlight.date : null}
            clusterOf={clusterOf}
            dateClusterNumbering={dateClusterNumbering}
          />
          <Panel
            title="General Ledger (BC365)"
            allItems={glLines}
            groups={glGroups}
            groupTab={glGroupTab}
            onGroupTabChange={setGlGroupTab}
            selected={selectedGl}
            onToggle={toggleGl}
            filter={directionFilter}
            onFilterChange={setDirectionFilter}
            loading={loading}
            expandedDates={expandedGlDates}
            onToggleExpand={toggleGlExpand}
            registerRowRef={registerGlRowRef}
            highlightedDate={highlight?.side === "gl" ? highlight.date : null}
            matchReadyDates={matchReadyDates}
            clusterOf={clusterOf}
            dateClusterNumbering={dateClusterNumbering}
            onSync={handleSyncGl}
            syncing={syncingGl}
            syncDisabled={loading || busy || syncingGl}
          />
        </div>
      </div>

      <div className={`shrink-0 px-4 sm:px-6 bg-white border-t border-gray-100 transition-all ${focusMode ? "py-2" : "py-4"}`}>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-6 flex-wrap">
            <div>
              {!focusMode && <p className="text-[11px] font-medium text-gray-400 tracking-wide">BANK TOTAL</p>}
              <p className="text-base font-semibold text-gray-900">{formatAmount(bankTotal)}</p>
            </div>
            <div>
              {!focusMode && <p className="text-[11px] font-medium text-gray-400 tracking-wide">GL TOTAL</p>}
              <p className="text-base font-semibold text-gray-900">{formatAmount(glTotal)}</p>
            </div>
            <div>
              {!focusMode && <p className="text-[11px] font-medium text-gray-400 tracking-wide">DIFFERENCE</p>}
              <p className={`text-base font-semibold ${amountMatches ? "text-green-600" : "text-red-600"}`}>
                {formatAmount(difference)}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={handleClear} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 px-3 py-2">
              <X size={14} /> Clear
            </button>
            <button
              onClick={handleMoveToSuspense}
              disabled={!canMoveToSuspense || busy || syncingGl}
              className="text-sm font-medium text-amber-700 bg-amber-50 border border-amber-200 px-4 py-2 rounded-full disabled:opacity-40 disabled:cursor-not-allowed hover:bg-amber-100"
            >
              Move to suspense
            </button>
            <button
              onClick={handleMatch}
              disabled={!canMatch || busy || syncingGl}
              className="flex items-center gap-1.5 text-sm font-medium text-white bg-blue-600 px-4 py-2 rounded-full disabled:opacity-40 disabled:cursor-not-allowed hover:bg-blue-700"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <ArrowLeftRight size={14} />}
              Match {selectedBank.size}:{selectedGl.size}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}