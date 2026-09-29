"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject, type UIEvent } from "react";
import {
  RotateCcw,
  RefreshCw,
  X,
  ArrowDownLeft,
  ArrowUpRight,
  ArrowLeftRight,
  Loader2,
  ChevronRight,
  CheckCircle2,
  Check,
  Pencil,
  Link2,
  WandSparkles,
  AlertTriangle,
  Ban,
  ListChecks,
  Scale,
} from "lucide-react";
import { AnimatePresence } from "framer-motion";
import { ReconcileSession } from "./types";
import { extractDisplayNo, shortAccountLabel } from "../../../lib/bankAccounts";
import MatchAssistantModal from "./MatchAssistantModal";
import SuspenseConfirmModal from "./SuspenseConfirmModal";
import BalanceBadge from "./BalanceBadge";
import BalanceModal from "./BalanceModal";
import RemarkActionModal from "./RemarkActionModal";
import OffsetConfirmModal from "./OffsetConfirmModal";
import type { BalanceData } from "./balanceTypes";
import { AURA_GRADIENT } from "./AuraOrb";

type Direction = "IN" | "OUT";

// ผลต่างที่ยอมรับได้ตอนเทียบยอด Bank กับ GL — ครึ่งสตางค์ ต้องตรงกับเกณฑ์ฝั่ง server
// (app/api/reconcile/match/route.ts) ไม่งั้นปุ่มกดได้แต่ server ปฏิเสธ
const AMOUNT_TOLERANCE = 0.005;

type BankApiLine = {
  id: string;
  lineId: number;
  bankCode: string;
  // null = บรรทัดจากไฟล์ที่นำเข้าก่อนระบบแยกตามบัญชี และยังไม่ได้ระบุบัญชีย้อนหลัง
  accountNo: string | null;
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
  // API ส่ง null มาได้เมื่อ BankAccountMapping.BankAccountName ยังไม่ได้กรอก (ตอนนี้เป็น null ทุกแถว)
  // เดิมประกาศเป็น string เฉยๆ แล้วเอาไปต่อสตริงตรงๆ ทำให้ขึ้นคำว่า "null" บนหน้าจอทุกรายการ
  accountName: string | null;
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

// รายการในกลุ่มที่ระบบติ๊กให้ แยกตามประเภท — ใช้กับปุ่มเลือก/ยกเลิกทั้งหมดตามประเภท
type ClusterKind = { count: number; bankIds: string[]; glIds: string[] };

type MatchActivity = {
  bankRows: number;
  glRows: number;
  stage: "saving" | "refreshing" | "success" | "error";
  errorMessage?: string;
};

type WorkspaceDraft = {
  version: 1;
  savedAt: number;
  directionFilter: Direction;
  glGroupTab: string;
  selectedBank: string[];
  selectedGl: string[];
  linkDates: boolean;
  expandedBankDates: string[];
  expandedGlDates: string[];
  activeDate: string | null;
  bankScrollTop: number;
  glScrollTop: number;
};

const WORKSPACE_DRAFT_PREFIX = "reconcile-workspace-v1";

function workspaceDraftKey(session: ReconcileSession) {
  return [
    WORKSPACE_DRAFT_PREFIX,
    session.bankCode,
    session.bankAccountNo ?? "all",
    session.importId ?? "no-import",
    session.periodStart,
    session.periodEnd,
    session.includeSuspenseBuffer ? "buffer" : "normal",
  ].join(":");
}

function readWorkspaceDraft(key: string): WorkspaceDraft | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<WorkspaceDraft>;
    if (
      parsed.version !== 1 ||
      (parsed.directionFilter !== "IN" && parsed.directionFilter !== "OUT") ||
      !Array.isArray(parsed.selectedBank) ||
      !Array.isArray(parsed.selectedGl)
    ) {
      sessionStorage.removeItem(key);
      return null;
    }
    return parsed as WorkspaceDraft;
  } catch {
    sessionStorage.removeItem(key);
    return null;
  }
}

function formatAmount(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatDate(iso: string) {
  return new Date(iso).toISOString().slice(0, 10);
}

// หา subset ของ items ที่ผลรวมเท่ากับ target พอดี — ต้องตรงกับ findSubsetSum ใน lib/matchAssistant.ts ทุกประการ
// (ผู้ช่วยหาคู่ใช้ตัวนั้นกันรายการที่ตารางติ๊กไว้แล้ว ถ้าผลต่างกันจะเสนอคู่ข้ามวันที่ขัดกับกลุ่มบนตาราง)
function findSubsetSumClient(
  items: { id: string; amount: number }[],
  target: number,
  maxSize = 5
): { id: string; amount: number }[] | null {
  const sorted = [...items].sort((a, b) => b.amount - a.amount);
  const reach = [0];
  for (const item of sorted) reach.push(reach[reach.length - 1] + Math.max(item.amount, 0));
  const chosen: { id: string; amount: number }[] = [];
  function backtrack(startIdx: number, remaining: number): boolean {
    if (Math.abs(remaining) < 0.005 && chosen.length > 0) return true;
    const slots = maxSize - chosen.length;
    if (slots <= 0) return false;
    for (let i = startIdx; i < sorted.length; i++) {
      if (sorted[i].amount - remaining > 0.005) continue;
      // หยิบรายการใหญ่สุดที่เหลือจนเต็มโควตาก็ไม่ถึงเป้า = ไม่มีทางเจอ (ไม่ตัด SCB 31/08 GL 149 รายการค้าง ~5 วินาที)
      if (reach[Math.min(i + slots, sorted.length)] - reach[i] < remaining - 0.005) break;
      // ยอดซ้ำตัวก่อนหน้าในระดับเดียวกัน = กิ่งเดิมที่ลองแล้วไม่เจอ
      if (i > startIdx && sorted[i].amount === sorted[i - 1].amount) continue;
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
    // ที่เหลือทั้งหมดของวันนั้นยอดรวมเท่ากันพอดี = รวบเป็นกลุ่มเดียว — subset จำกัดไว้ไม่เกิน 5 รายการ (กันค้าง)
    // เดิมเลยไม่ติ๊กเคส Bank 1 ก้อนจ่าย GL 6 ใบขึ้นไป ทั้งที่แถวขึ้น MATCH READY (เคสจริง: BBL 10/08 OUT 168,491.01)
    // กลุ่มนี้มีหลายรายการ จึงเข้าหมวด "รวมยอด" ให้ตรวจก่อนกด Match เหมือนกลุ่ม 1:N อื่น
    if (remainingBank.length > 0 && remainingGl.length > 0) {
      const bankSum = remainingBank.reduce((s, b) => s + b.amount, 0);
      const glSum = remainingGl.reduce((s, g) => s + g.amount, 0);
      if (Math.abs(bankSum - glSum) < 0.005) {
        const bankIds = remainingBank.map((b) => b.id);
        const glIds = remainingGl.map((g) => g.id);
        readyBankIds.push(...bankIds);
        readyGlIds.push(...glIds);
        recordCluster(bankIds, glIds);
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
        isIn ? "bg-purple-50 text-purple-700" : "bg-red-50 text-red-600"
      }`}
    >
      {isIn ? <ArrowDownLeft size={12} /> : <ArrowUpRight size={12} />}
      {isIn ? "เงินเข้า" : "เงินออก"}
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
                ? "bg-purple-600 text-white"
                : "bg-red-500 text-white"
              : "text-gray-400 hover:text-gray-600"
          }`}
        >
          {opt === "IN" ? "เงินเข้า" : "เงินออก"}
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
  // const totalCount = groups.reduce((s, g) => s + g.count, 0);
  // if (groups.length <= 1) return null; // มีบัญชีเดียว ไม่ต้องโชว์แท็บให้รก
  // return (
    // <div className="flex items-center gap-1.5 px-4 pt-2.5 pb-1 flex-wrap shrink-0">
    //   <button
    //     onClick={() => onChange("ALL")}
    //     className={`text-xs font-medium px-2.5 py-1 rounded-full transition-colors ${
    //       value === "ALL" ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
    //     }`}
    //   >
    //     All {totalCount}
    //   </button>
    //   {groups.map((g) => (
    //     <button
    //       key={g.key}
    //       onClick={() => onChange(g.key)}
    //       className={`text-xs font-medium px-2.5 py-1 rounded-full transition-colors ${
    //         value === g.key ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
    //       }`}
    //       title={g.label}
    //     >
    //       {g.label} {g.count}
    //     </button>
    //   ))}
    // </div>
  // );
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
        aria-label="เลือกรายการ"
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
  onHoverStart,
  onHoverEnd,
  clusterOf,
  dateClusterNumbering,
  lumpClusterIds,
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
  onHoverStart: () => void;
  onHoverEnd: () => void;
  clusterOf: Map<string, number>;
  dateClusterNumbering: Map<string, Map<number, number>>;
  lumpClusterIds: Set<number>;
}) {
  const total = items.reduce((sum, i) => sum + i.amount, 0);
  const selectedInGroup = items.filter((i) => selected.has(i.id)).length;
  const allSelected = selectedInGroup === items.length && items.length > 0;
  const someSelected = selectedInGroup > 0 && !allSelected;

  // เลขกลุ่มที่แสดง (1, 2, 3, ...) ต้องมาจาก map กลางที่คำนวณครั้งเดียวใน ActiveWorkspace แล้วส่งลงมา
  // ห้ามคำนวณแยกในแต่ละ panel เอง — เพราะฝั่ง bank/GL ดึงข้อมูลมาคนละ query เรียงคนละลำดับ
  // ถ้าต่างฝั่งคำนวณเลขกลุ่มเอง raw cluster เดียวกันจะได้เลขกำกับไม่ตรงกันข้ามฝั่ง (ดูสีผิด ดูเหมือนยอดไม่ตรง)
  const localClusterNo = dateClusterNumbering.get(date) ?? new Map<number, number>();

  // วาดแถวย่อยเฉพาะวันที่เคยคลี่ (หลายพันแถวทำให้โหลด/ติ๊กช้า) และไม่ unmount ตอนหุบ เพื่อให้ animation หุบยังเล่นได้
  const [hasOpened, setHasOpened] = useState(expanded);
  if (expanded && !hasOpened) setHasOpened(true);

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
      onMouseEnter={onHoverStart}
      onMouseLeave={onHoverEnd}
      className={`border-b border-gray-50 last:border-b-0 transition-all duration-300 ${rowBg} ${
        highlighted
          ? "ring-2 ring-inset ring-blue-400 bg-blue-50/70"
          : "outline-transparent data-[hover=true]:outline-2 data-[hover=true]:outline-dashed data-[hover=true]:-outline-offset-2 data-[hover=true]:outline-blue-400"
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
                ยอดรวมตรงกัน
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
            {hasOpened && items.map((item) => {
              const isSelected = selected.has(item.id);
              const rawCluster = clusterOf.get(item.id);
              const groupNo = rawCluster !== undefined ? localClusterNo.get(rawCluster) : undefined;
              const groupColor = groupNo !== undefined ? GROUP_COLORS[(groupNo - 1) % GROUP_COLORS.length] : "";
              return (
                <label
                  key={item.id}
                  className={`group flex items-center gap-3 pl-12 pr-4 py-2.5 cursor-pointer transition-colors border-t border-gray-100 ${
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
                      {rawCluster !== undefined && lumpClusterIds.has(rawCluster) && (
                        <span
                          className="text-[10px] font-semibold px-1.5 py-0.5 rounded border border-amber-200 bg-amber-50 text-amber-700"
                          title="กลุ่มรวมยอด (1:N / N:1) — ยอดอาจตรงกันโดยบังเอิญ ควรตรวจก่อนกดจับคู่"
                        >
                          รวมยอด
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
  notchSide,
  totalLabel,
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
  onHoverDate,
  clusterOf,
  dateClusterNumbering,
  lumpClusterIds,
  onSync,
  syncing,
  syncDisabled,
  extraActions,
  scrollRef,
  onScroll,
}: {
  title: string;
  // ระบุฝั่งของ panel ใน shared frame — ใช้กำหนดเส้นแบ่งกลางและการจัดหัวข้อให้สมมาตร
  notchSide?: "left" | "right";
  totalLabel: string;
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
  onHoverDate: (date: string | null) => void;
  clusterOf: Map<string, number>;
  dateClusterNumbering: Map<string, Map<number, number>>;
  lumpClusterIds: Set<number>;
  onSync?: () => void;
  syncing?: boolean;
  syncDisabled?: boolean;
  // ปุ่มเพิ่มเติมข้างปุ่มซิงค์
  extraActions?: React.ReactNode;
  scrollRef?: RefObject<HTMLDivElement | null>;
  onScroll?: (event: UIEvent<HTMLDivElement>) => void;
}) {
  const byGroup = groupTab === "ALL" ? allItems : allItems.filter((i) => i.groupKey === groupTab);
  const filtered = byGroup.filter((item) => item.direction === filter);
  // นับ "selected" เฉพาะฝั่งทิศทางที่กำลังดูอยู่ (filter) — ไม่ใช่ selected.size ดิบซึ่งรวมอีกฝั่งที่ไม่เกี่ยวด้วย
  const selectedInDirection = filtered.filter((item) => selected.has(item.id)).length;
  const { byDate, pendingTotal } = useMemo(() => {
    const map = new Map<string, LineItem[]>();
    let total = 0;
    for (const item of filtered) {
      total += item.amount;
      const d = formatDate(item.date);
      if (!map.has(d)) map.set(d, []);
      map.get(d)!.push(item);
    }
    // เรียงวันที่ 1 ไปสิ้นเดือน ตามลำดับที่บัญชีไล่กระทบยอดจริง
    // เรียงเฉพาะตอนแสดงผล — ลำดับจาก API ต้องคงเดิม เพราะการจับกลุ่มอัตโนมัติกับผู้ช่วยหาคู่อิงลำดับนั้นร่วมกัน
    return { byDate: [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)), pendingTotal: total };
  }, [filtered]);

  return (
    <div
      className={`flex min-w-0 flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white lg:h-full ${
        notchSide === "right"
          ? "lg:rounded-none lg:border-0"
          : notchSide === "left"
            ? "lg:rounded-none lg:border-y-0 lg:border-r-0 lg:border-l lg:border-l-slate-200"
            : ""
      }`}
    >
      {/* หัวตาราง: summary row เดียวด้านบนและปุ่มควบคุมด้านล่าง */}
      <div className="px-4 py-3 border-b border-gray-100 shrink-0">
        <div
          className={`flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 ${
            notchSide === "left" ? "lg:justify-end lg:text-right" : ""
          }`}
        >
          <h2 className="whitespace-nowrap text-[15px] font-semibold text-gray-900">{title}</h2>
          <span className="whitespace-nowrap text-xs text-gray-400">
            เลือกแล้ว {selectedInDirection} · รอจับคู่ {filtered.length}
          </span>
          <p
            className={`whitespace-nowrap text-[11px] font-medium tracking-wide text-gray-400 ${
              notchSide === "left" ? "lg:order-first lg:mr-auto lg:text-left" : "lg:ml-auto lg:text-right"
            }`}
          >
            {totalLabel}{" "}
            <span className="text-sm font-semibold tracking-normal text-gray-900 tabular-nums">
              {loading ? "—" : formatAmount(pendingTotal)}
            </span>{" "}
            บาท
          </p>
        </div>
        <div className="mt-3 flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {onSync && (
              <button
                onClick={onSync}
                disabled={syncDisabled}
                title="อัปเดตรายการบัญชี 40 วันล่าสุดจาก BC365 ใช้หลังจากแก้ไขข้อมูลใน BC365 แล้ว"
                className="flex items-center gap-1.5 text-xs font-medium text-gray-600 border border-gray-200 px-2.5 py-1.5 rounded-full hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <RefreshCw size={12} className={syncing ? "animate-spin" : ""} />
                {syncing ? "กำลังดึงข้อมูล..." : "ดึงข้อมูลใหม่จาก BC365"}
              </button>
            )}
            {extraActions}
          </div>
          <FilterTabs value={filter} onChange={onFilterChange} />
        </div>
      </div>

      {/* <GroupTabs groups={groups} value={groupTab} onChange={onGroupTabChange} /> */}

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex flex-col overflow-y-auto max-h-[55vh] lg:max-h-none lg:flex-1 lg:min-h-0"
      >
        {loading && (
          <div className="px-4 py-10 text-center text-sm text-gray-400 flex items-center justify-center gap-2">
            <Loader2 size={16} className="animate-spin" /> กำลังโหลด...
          </div>
        )}
        {!loading && byDate.length === 0 && (
          <div className="px-4 py-10 text-center text-sm text-gray-400">ไม่พบรายการรอจับคู่ตามเงื่อนไขที่เลือก</div>
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
              onHoverStart={() => onHoverDate(date)}
              onHoverEnd={() => onHoverDate(null)}
              clusterOf={clusterOf}
              dateClusterNumbering={dateClusterNumbering}
              lumpClusterIds={lumpClusterIds}
            />
          ))}
      </div>
    </div>
  );
}

// ปุ่มเลือก/ยกเลิกทั้งหมดตามประเภทกลุ่มที่ระบบติ๊กให้ — แทนปุ่ม Suggest matches เดิมที่ให้ผลซ้ำกับการติ๊กอัตโนมัติ
function ClusterKindToggle({
  label,
  count,
  checked,
  tone,
  title,
  onClick,
}: {
  label: string;
  count: number;
  checked: boolean;
  tone: "green" | "amber";
  title: string;
  onClick: () => void;
}) {
  const onStyle =
    tone === "green" ? "border-green-200 bg-green-50 text-green-700" : "border-amber-200 bg-amber-50 text-amber-700";
  const dotStyle = tone === "green" ? "border-green-600 bg-green-600" : "border-amber-500 bg-amber-500";
  return (
    <button
      onClick={onClick}
      disabled={count === 0}
      title={title}
      className={`flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        checked ? onStyle : "border-gray-200 bg-white text-gray-500 hover:bg-gray-50"
      }`}
    >
      <span
        className={`flex h-3.5 w-3.5 items-center justify-center rounded-full border ${checked ? dotStyle : "border-gray-300"}`}
      >
        {checked && <Check size={9} className="text-white" strokeWidth={3} />}
      </span>
      {label} ({count})
    </button>
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
            transform: translateY(-16px) scale(0.9);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
      `}</style>
      <div
        className="fixed top-5 right-5 z-50 flex items-start gap-3 bg-white/85 backdrop-blur-xl backdrop-saturate-150 border border-green-200/60 shadow-xl rounded-xl px-4 py-3 max-w-sm transition-all duration-200 ease-out"
        style={
          leaving
            ? { opacity: 0, transform: "translateY(-10px) scale(0.98)" }
            : { animation: "toastIn 480ms cubic-bezier(0.34, 1.56, 0.64, 1)" }
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

  const [bankLinesRaw, setBankLinesRaw] = useState<BankApiLine[]>([]);
  const [glLinesRaw, setGlLinesRaw] = useState<GlApiLine[]>([]);
  // รัน sql/006 แล้วหรือยัง — ถ้ายัง หน้านี้ยังรวมทุกบัญชีของธนาคารเดียวกันอยู่ ต้องบอกผู้ใช้ให้รู้ตัว
  const [accountDimensionReady, setAccountDimensionReady] = useState(true);
  // จำนวนรายการฝั่ง bank ที่ยังไม่รู้ว่าเป็นบัญชีไหน (ไฟล์เก่า) — แสดงปนอยู่ในตารางแต่ต้องมีป้ายกำกับ
  const [unassignedBankLines, setUnassignedBankLines] = useState(0);

  // ป้ายบัญชีที่ใช้ทั่วหน้าจอ — ถอยเป็นขั้นๆ: ชื่อเต็ม -> รหัสบัญชี -> ธนาคาร
  // (session เก่าที่บันทึกไว้ก่อนระบบแยกตามบัญชี จะไม่มีทั้งชื่อและรหัส เหลือแค่ธนาคาร)
  const accountFullLabel = session.accountName ?? session.bankAccountNo ?? session.bankCode;
  const accountShortLabel = session.bankAccountNo
    ? shortAccountLabel({
        bankAccountNo: session.bankAccountNo,
        bankCode: session.bankCode,
        accountName: session.accountName,
        displayNo: extractDisplayNo(session.accountName),
      })
    : session.bankCode;
  const accountNotice = !accountDimensionReady
    ? `ยอดในหน้านี้ยังรวมทุกบัญชีของ ${session.bankCode}`
    : !session.bankAccountNo
      ? `งานเดิมนี้ยังไม่ได้ระบุเลขบัญชีของ ${session.bankCode}`
      : unassignedBankLines > 0
        ? `มี ${unassignedBankLines} รายการธนาคาร ที่ยังไม่ได้ระบุบัญชี`
        : null;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [matchActivity, setMatchActivity] = useState<MatchActivity | null>(null);
  const matchInFlightRef = useRef(false);
  const [toast, setToast] = useState<{ title: string; message: string } | null>(null);
  const [syncingGl, setSyncingGl] = useState(false);
  const [clusterOf, setClusterOf] = useState<Map<string, number>>(new Map());
  // ผู้ช่วยหาคู่ (popup หาคู่ที่ยอดตรงแต่ลงคนละวัน) — ดู MatchAssistantModal
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [confirmSuspenseOpen, setConfirmSuspenseOpen] = useState(false);
  // หน้าต่างที่ต้องใส่หมายเหตุ: จับคู่และพักโอนส่วนต่าง / ไม่นำ GL มาจับคู่
  const [remarkModal, setRemarkModal] = useState<"match" | "exclude" | null>(null);
  // จับชนขาเข้ากับขาออกฝั่ง GL จากรายการที่ติ๊กไว้บนตารางหลัก (ข้ามแท็บ IN/OUT ได้)
  const [offsetConfirmOpen, setOffsetConfirmOpen] = useState(false);
  const [remarkError, setRemarkError] = useState("");

  // ยอดคงเหลือ Bank เทียบ GL ของทั้งงวด — โหลดใหม่ทุกครั้งที่ตารางโหลดใหม่ (หลัง Match/พัก/ยกเลิก)
  const [balanceData, setBalanceData] = useState<BalanceData | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceError, setBalanceError] = useState("");
  const [balanceOpen, setBalanceOpen] = useState(false);
  const [dataVersion, setDataVersion] = useState(0);

  // สวิชลิงค์วันที่: เปิด = กดขยายฝั่งไหน อีกฝั่งขยาย+เลื่อนตามให้อัตโนมัติ / ปิด = 2 ฝั่งอิสระต่อกัน
  const [linkDates, setLinkDates] = useState(true);
  const [expandedBankDates, setExpandedBankDates] = useState<Set<string>>(new Set());
  const [expandedGlDates, setExpandedGlDates] = useState<Set<string>>(new Set());
  // วันที่ที่คลี่ดูล่าสุด — ตีกรอบน้ำเงินค้างไว้ทั้ง 2 ฝั่ง จนกว่าจะไปคลี่วันอื่น
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const draftKey = useMemo(() => workspaceDraftKey(session), [session]);
  const draftReadyRef = useRef(false);
  const bankScrollRef = useRef<HTMLDivElement>(null);
  const glScrollRef = useRef<HTMLDivElement>(null);
  const bankScrollTopRef = useRef(0);
  const glScrollTopRef = useRef(0);
  const bankRowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const glRowRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  function registerBankRowRef(date: string, el: HTMLDivElement | null) {
    if (el) bankRowRefs.current.set(date, el);
    else bankRowRefs.current.delete(date);
  }
  function registerGlRowRef(date: string, el: HTMLDivElement | null) {
    if (el) glRowRefs.current.set(date, el);
    else glRowRefs.current.delete(date);
  }

  // hover วันไหนก็ตีเส้นประวันเดียวกันทั้ง 2 ฝั่ง — ตั้ง attribute ตรงผ่าน ref เพราะ state จะ re-render หลายพันแถวทุกครั้งที่เมาส์ข้ามแถว
  const hoveredDateRef = useRef<string | null>(null);
  function markHoverDate(date: string | null) {
    const prev = hoveredDateRef.current;
    if (prev === date) return;
    if (prev) {
      bankRowRefs.current.get(prev)?.removeAttribute("data-hover");
      glRowRefs.current.get(prev)?.removeAttribute("data-hover");
    }
    hoveredDateRef.current = date;
    if (date) {
      bankRowRefs.current.get(date)?.setAttribute("data-hover", "true");
      glRowRefs.current.get(date)?.setAttribute("data-hover", "true");
    }
  }

  function toggleBankExpand(date: string) {
    const willExpand = !expandedBankDates.has(date);
    if (willExpand) setActiveDate(date);
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
      }
    }
  }

  function toggleGlExpand(date: string) {
    const willExpand = !expandedGlDates.has(date);
    if (willExpand) setActiveDate(date);
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
      }
    }
  }

  const restoreScrollPositions = useCallback((draft: WorkspaceDraft) => {
    bankScrollTopRef.current = Number(draft.bankScrollTop) || 0;
    glScrollTopRef.current = Number(draft.glScrollTop) || 0;
    // รอ React วาดรายการและคลี่กลุ่มวันที่ให้เสร็จก่อน จึงคืนตำแหน่ง scroll ที่บันทึกไว้
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (bankScrollRef.current) bankScrollRef.current.scrollTop = bankScrollTopRef.current;
        if (glScrollRef.current) glScrollRef.current.scrollTop = glScrollTopRef.current;
      });
    });
  }, []);

  const loadData = useCallback(async (draftToRestore?: WorkspaceDraft | null) => {
    setLoading(true);
    setError("");
    try {
      const qs = new URLSearchParams({
        bankCode: session.bankCode,
        from: session.periodStart,
        to: session.periodEnd,
        glExtendDays: session.includeSuspenseBuffer ? "7" : "0",
      });
      if (session.bankAccountNo) qs.set("bankAccountNo", session.bankAccountNo);
      const res = await fetch(`/api/reconcile/data?${qs.toString()}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "โหลดข้อมูลไม่สำเร็จ");
        return;
      }
      setBankLinesRaw(data.bankLines);
      setGlLinesRaw(data.glLines);
      setAccountDimensionReady(data.accountDimensionReady !== false);
      setUnassignedBankLines(Number(data.unassignedBankLines ?? 0));

      // ครั้งแรกของ workspace ใหม่จะ auto-tick ตามปกติ แต่ถ้ากลับมาจากหน้าอื่นให้คืนสิ่งที่ user เลือกไว้
      // พร้อมกรอง id ที่ถูกคนอื่น Match/ย้าย Suspense ไปแล้วออก ไม่ปล่อย selection เก่าค้างเป็นข้อมูลผี
      const { readyBankIds, readyGlIds, clusterOf: newClusterOf } = computeReadyIds(data.bankLines, data.glLines);
      if (draftToRestore) {
        const availableBank = new Set<string>(data.bankLines.map((line: BankApiLine) => line.id));
        const availableGl = new Set<string>(data.glLines.map((line: GlApiLine) => line.id));
        setSelectedBank(new Set(draftToRestore.selectedBank.filter((id) => availableBank.has(id))));
        setSelectedGl(new Set(draftToRestore.selectedGl.filter((id) => availableGl.has(id))));
        restoreScrollPositions(draftToRestore);
      } else {
        setSelectedBank(new Set(readyBankIds));
        setSelectedGl(new Set(readyGlIds));
      }
      setClusterOf(newClusterOf);
      setDataVersion((v) => v + 1);
    } catch {
      setError("ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาตรวจสอบการเชื่อมต่อ");
    } finally {
      setLoading(false);
    }
  }, [
    restoreScrollPositions,
    session.bankCode,
    session.bankAccountNo,
    session.periodStart,
    session.periodEnd,
    session.includeSuspenseBuffer,
  ]);

  useEffect(() => {
    const draft = readWorkspaceDraft(draftKey);
    if (draft) {
      // คืน snapshot จาก sessionStorage ตอน mount เท่านั้น จึงต้อง sync state หลายชิ้นใน effect เดียวกัน
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDirectionFilter(draft.directionFilter);
      setGlGroupTab(draft.glGroupTab || "ALL");
      setLinkDates(draft.linkDates !== false);
      setExpandedBankDates(new Set(draft.expandedBankDates ?? []));
      setExpandedGlDates(new Set(draft.expandedGlDates ?? []));
      setActiveDate(draft.activeDate ?? null);
    }
    // โหลดข้อมูลใหม่จาก server ทุกครั้งที่เปลี่ยนช่วงวันที่/บัญชีธนาคาร แล้วค่อยคืน draft ที่ยังใช้ได้
    void loadData(draft).finally(() => {
      draftReadyRef.current = true;
    });
  }, [draftKey, loadData]);

  useEffect(() => {
    if (!draftReadyRef.current || loading) return;
    const draft: WorkspaceDraft = {
      version: 1,
      savedAt: Date.now(),
      directionFilter,
      glGroupTab,
      selectedBank: [...selectedBank],
      selectedGl: [...selectedGl],
      linkDates,
      expandedBankDates: [...expandedBankDates],
      expandedGlDates: [...expandedGlDates],
      activeDate,
      bankScrollTop: bankScrollTopRef.current,
      glScrollTop: glScrollTopRef.current,
    };
    sessionStorage.setItem(draftKey, JSON.stringify(draft));
  }, [
    activeDate,
    directionFilter,
    draftKey,
    expandedBankDates,
    expandedGlDates,
    glGroupTab,
    linkDates,
    loading,
    selectedBank,
    selectedGl,
  ]);

  const balanceUnavailable = session.bankAccountNo ? null : "งานเดิมนี้ไม่ได้ระบุเลขบัญชี — กดแก้ไขเงื่อนไขแล้วเลือกบัญชีก่อน";

  const loadBalance = useCallback(async () => {
    if (!session.bankAccountNo) return;
    setBalanceLoading(true);
    setBalanceError("");
    try {
      const qs = new URLSearchParams({
        bankAccountNo: session.bankAccountNo,
        from: session.periodStart,
        to: session.periodEnd,
      });
      const res = await fetch(`/api/reconcile/balance?${qs.toString()}`);
      const data = await res.json();
      if (!res.ok) {
        setBalanceError(data.error || "คำนวณยอดคงเหลือไม่สำเร็จ");
        setBalanceData(null);
        return;
      }
      setBalanceData(data);
    } catch {
      setBalanceError("ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาตรวจสอบการเชื่อมต่อ");
    } finally {
      setBalanceLoading(false);
    }
  }, [session.bankAccountNo, session.periodStart, session.periodEnd]);

  useEffect(() => {
    if (dataVersion === 0) return;
    // ยอดคงเหลือขึ้นกับผลการจับคู่ล่าสุด จึงโหลดตามทุกครั้งที่ตารางโหลดเสร็จ
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadBalance();
  }, [dataVersion, loadBalance]);

  async function handleSaveOpening(amount: number): Promise<string | null> {
    if (!session.bankAccountNo) return "ต้องเลือกบัญชีก่อน";
    try {
      const res = await fetch("/api/reconcile/balance", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bankAccountNo: session.bankAccountNo,
          periodStart: session.periodStart,
          glOpeningBalance: amount,
        }),
      });
      const data = await res.json();
      if (!res.ok) return data.error || "บันทึกยอดยกมาไม่สำเร็จ";
      await loadBalance();
      return null;
    } catch {
      return "ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาตรวจสอบการเชื่อมต่อ";
    }
  }

  async function handleUndoExcluded(matchId: number, num: number, reason: string): Promise<string | null> {
    try {
      const res = await fetch("/api/reconcile/unmatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targets: [{ matchId, nums: [num] }], reason }),
      });
      const data = await res.json();
      if (!res.ok) return data.error || "ยกเลิกไม่สำเร็จ";
      // รายการ GL กลับเข้าตาราง — loadData จะโหลดยอดคงเหลือตามให้เอง
      await loadData(readWorkspaceDraft(draftKey));
      return null;
    } catch {
      return "ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาตรวจสอบการเชื่อมต่อ";
    }
  }

  function persistScroll(side: "bank" | "gl", top: number) {
    if (side === "bank") bankScrollTopRef.current = top;
    else glScrollTopRef.current = top;
    if (!draftReadyRef.current) return;
    const draft = readWorkspaceDraft(draftKey);
    if (!draft) return;
    if (side === "bank") draft.bankScrollTop = top;
    else draft.glScrollTop = top;
    draft.savedAt = Date.now();
    sessionStorage.setItem(draftKey, JSON.stringify(draft));
  }

  function handleResetWorkspace() {
    draftReadyRef.current = false;
    sessionStorage.removeItem(draftKey);
    bankScrollTopRef.current = 0;
    glScrollTopRef.current = 0;
    if (bankScrollRef.current) bankScrollRef.current.scrollTop = 0;
    if (glScrollRef.current) glScrollRef.current.scrollTop = 0;
    setDirectionFilter("IN");
    setGlGroupTab("ALL");
    setLinkDates(true);
    setExpandedBankDates(new Set());
    setExpandedGlDates(new Set());
    setActiveDate(null);
    void loadData().finally(() => {
      draftReadyRef.current = true;
    });
  }

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
        // ฝั่ง GL ref กับ description เป็น Document_No ตัวเดียวกัน (แถวแสดง ref อยู่แล้ว)
        // จึงแสดงชื่อบัญชีแทน — เดิมต่อเป็น "Document_No · ชื่อบัญชี" ทำให้เลขเอกสารขึ้นซ้ำ 2 ครั้งทุกแถว
        description: l.accountName ?? l.description,
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
    const map = new Map<string, { count: number; name: string | null }>();
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

  // สมาชิกของแต่ละกลุ่มที่ระบบติ๊กให้ — ใช้แยกกลุ่ม 1:1 ออกจากกลุ่มรวมยอด (1:N / N:1)
  const clusterMembers = useMemo(() => {
    const map = new Map<number, { direction: Direction; bankIds: string[]; glIds: string[] }>();
    function add(id: string, direction: Direction, side: "bankIds" | "glIds") {
      const cluster = clusterOf.get(id);
      if (cluster === undefined) return;
      let members = map.get(cluster);
      if (!members) {
        members = { direction, bankIds: [], glIds: [] };
        map.set(cluster, members);
      }
      members[side].push(id);
    }
    bankLinesRaw.forEach((l) => add(l.id, l.direction, "bankIds"));
    glLinesRaw.forEach((l) => add(l.id, l.direction, "glIds"));
    return map;
  }, [bankLinesRaw, glLinesRaw, clusterOf]);

  // กลุ่มรวมยอดมีโอกาสยอดตรงกันโดยบังเอิญมากกว่า 1:1 — ติดป้าย "รวมยอด" ให้ตรวจละเอียดก่อนกด Match
  const lumpClusterIds = useMemo(
    () =>
      new Set(
        [...clusterMembers]
          .filter(([, m]) => m.bankIds.length > 1 || m.glIds.length > 1)
          .map(([cluster]) => cluster)
      ),
    [clusterMembers]
  );

  // นับเฉพาะทิศทางที่กำลังดู — เลือก/ยกเลิกทั้งหมดต้องไม่ไปแตะแท็บ IN/OUT อีกฝั่งที่อาจเป็นคนละคนดูแล
  const clusterKinds = useMemo(() => {
    const empty = (): ClusterKind => ({ count: 0, bankIds: [], glIds: [] });
    const kinds = { oneToOne: empty(), lumpSum: empty() };
    for (const [cluster, m] of clusterMembers) {
      if (m.direction !== directionFilter) continue;
      const kind = lumpClusterIds.has(cluster) ? kinds.lumpSum : kinds.oneToOne;
      kind.count += 1;
      kind.bankIds.push(...m.bankIds);
      kind.glIds.push(...m.glIds);
    }
    return kinds;
  }, [clusterMembers, lumpClusterIds, directionFilter]);

  function isKindSelected(kind: ClusterKind) {
    return (
      kind.count > 0 &&
      kind.bankIds.every((id) => selectedBank.has(id)) &&
      kind.glIds.every((id) => selectedGl.has(id))
    );
  }

  function toggleKind(kind: ClusterKind) {
    const select = !isKindSelected(kind);
    const apply = (prev: Set<string>, ids: string[]) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (select) next.add(id);
        else next.delete(id);
      }
      return next;
    };
    setSelectedBank((prev) => apply(prev, kind.bankIds));
    setSelectedGl((prev) => apply(prev, kind.glIds));
  }

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

  // เลือกไว้ทั้งหมดข้าม IN/OUT ยังคงอยู่ใน selectedBank/selectedGl ตามเดิม (สลับแท็บไปมาไม่หายไปไหน)
  // แต่ "การกระทำ" (totals, Match, Move to suspense, Clear) ต้องเห็นแค่ฝั่งทิศทางที่กำลังเปิดดูอยู่เท่านั้น
  // เพราะ IN/OUT มักเป็นคนละคนรับผิดชอบ — กด Match ตอนอยู่แท็บ IN ต้องไม่ไปยุ่งกับ OUT ที่อีกคนเลือกค้างไว้
  const selectedBankItems = useMemo(
    () => bankLinesRaw.filter((l) => selectedBank.has(l.id) && l.direction === directionFilter),
    [selectedBank, bankLinesRaw, directionFilter]
  );
  const selectedGlItems = useMemo(
    () => glLinesRaw.filter((l) => selectedGl.has(l.id) && l.direction === directionFilter),
    [selectedGl, glLinesRaw, directionFilter]
  );

  const bankTotal = useMemo(() => selectedBankItems.reduce((sum, l) => sum + l.amount, 0), [selectedBankItems]);
  const glTotal = useMemo(() => selectedGlItems.reduce((sum, l) => sum + l.amount, 0), [selectedGlItems]);
  const difference = bankTotal - glTotal;

  const amountMatches = Math.abs(difference) < AMOUNT_TOLERANCE;
  // Suspense พักได้แค่ฝั่ง GL (BC365) เท่านั้น — Bank Statement เป็นข้อมูลหลักจากธนาคาร ห้ามแก้ไข/ห้ามพัก
  const canMoveToSuspense = selectedGlItems.length > 0;

  // ล้างเฉพาะรายการที่เลือกไว้ "ในทิศทางที่กำลังดูอยู่" — อีกฝั่งที่อีกคนเลือกไว้ไม่ถูกแตะ
  function handleClear() {
    setSelectedBank((prev) => {
      const next = new Set(prev);
      for (const l of selectedBankItems) next.delete(l.id);
      return next;
    });
    setSelectedGl((prev) => {
      const next = new Set(prev);
      for (const l of selectedGlItems) next.delete(l.id);
      return next;
    });
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

  // วางแผนว่า "จะบันทึกกลุ่มย่อยอะไรบ้าง" พร้อมบอกเหตุผลถ้ายังจับคู่ไม่ได้
  //
  // เดิมโค้ดตรงนี้ตัดกลุ่มที่ขาดฝั่งใดฝั่งหนึ่งทิ้งเงียบๆ ทำให้เกิดปัญหา 2 แบบ:
  //   1. เลือก Bank กับ GL ที่ยอดตรงกันแต่คนละวัน — ทั้งคู่ถูกตัดทิ้ง ส่ง groups ว่างไปที่ API
  //      ผู้ใช้เห็นปุ่ม "Match 1:1" กับผลต่าง 0.00 แต่กดแล้วได้ error "ต้องมีอย่างน้อย 1 กลุ่ม"
  //      ทั้งที่การจับคู่ข้ามวันคือเคสปกติที่สุดของงานกระทบยอด (ธนาคารตัดวันหนึ่ง บัญชีลงอีกวัน)
  //   2. เลือกคู่ที่ถูกต้องปนกับรายการข้ามวัน — รายการข้ามวันถูกตัดทิ้งเงียบ เหลือกลุ่มที่ยอดไม่ดุล
  //      บันทึกลง DB ได้สำเร็จ พร้อมแจ้งว่า "สำเร็จ" ด้วยยอดที่ไม่ตรงกับที่บันทึกจริง
  //
  // ตอนนี้: รายการที่จับกลุ่มตามวันไม่ลงตัวจะถูกยุบรวมเป็นกลุ่มเดียว (จับคู่ข้ามวันได้)
  // และทุกกลุ่มที่จะส่งต้องมียอดสองฝั่งดุลกันจริง ไม่ใช่ดุลแค่ยอดรวมทั้งหมด
  // ถ้ายังไม่เข้าเงื่อนไข จะปิดปุ่มพร้อมบอกเหตุผล ไม่ตัดรายการทิ้งเงียบอีกต่อไป
  const matchPlan = useMemo(() => {
    if (selectedBankItems.length === 0 || selectedGlItems.length === 0) {
      return {
        groups: [] as { bankIds: number[]; glIds: number[] }[],
        problem: null as string | null,
        needsRemark: false,
      };
    }

    const bankById = new Map(selectedBankItems.map((l) => [l.lineId, l]));
    const glById = new Map(selectedGlItems.map((l) => [l.entryNo, l]));

    const raw = [...groupSelectionByDateDirection().values()];
    const groups: { bankIds: number[]; glIds: number[] }[] = [];
    const unresolvedBank: number[] = [];
    const unresolvedGl: number[] = [];

    // กลุ่มวันเดียวที่ดุลแล้วแยกบันทึกได้ตามเดิม ส่วนกลุ่มที่ขาดฝั่งใดฝั่งหนึ่ง
    // หรือมีทั้งสองฝั่งแต่ยอดยังไม่ดุล ต้องนำไปรวมกับรายการข้ามวันก่อนตรวจยอด
    // เช่น Bank วันที่ 31 = 70 + Bank วันที่ 28 = 12 จับกับ GL วันที่ 31 = 82
    for (const group of raw) {
      const bankSum = group.bankIds.reduce((s, id) => s + (bankById.get(id)?.amount ?? 0), 0);
      const glSum = group.glIds.reduce((s, id) => s + (glById.get(id)?.amount ?? 0), 0);
      const completeAndBalanced =
        group.bankIds.length > 0 &&
        group.glIds.length > 0 &&
        Math.abs(bankSum - glSum) < AMOUNT_TOLERANCE;

      if (completeAndBalanced) groups.push(group);
      else {
        unresolvedBank.push(...group.bankIds);
        unresolvedGl.push(...group.glIds);
      }
    }

    if (unresolvedBank.length > 0 && unresolvedGl.length > 0) {
      groups.push({ bankIds: unresolvedBank, glIds: unresolvedGl });
    } else if (unresolvedBank.length > 0 || unresolvedGl.length > 0) {
      const isBank = unresolvedBank.length > 0;
      const refs = isBank
        ? unresolvedBank.map((id) => bankById.get(id)?.ref ?? `L-${id}`)
        : unresolvedGl.map((id) => glById.get(id)?.ref ?? `#${id}`);
      const shown = refs.slice(0, 3).join(", ");
      const more = refs.length > 3 ? ` และอีก ${refs.length - 3} รายการ` : "";
      return {
        groups: [],
        problem: `ยังไม่ได้เลือกรายการฝั่ง ${isBank ? "GL (BC365)" : "Bank"} มาจับคู่กับ ${shown}${more}`,
        needsRemark: false,
      };
    }

    // ยอดไม่เท่ากัน: จับคู่รายการต้นทางตามจริง แล้วพักโอนเฉพาะส่วนต่างพร้อมหมายเหตุไว้กับ MatchId
    // รวบทุกรายการที่เลือกเป็นกลุ่มเดียว เพื่อให้ยอดพักโอนผูกกับเหตุผลเดียวชัดเจน ไม่กระจายไปหลายกลุ่มย่อย
    const unbalanced = groups.some((g) => {
      const bankSum = g.bankIds.reduce((s, id) => s + (bankById.get(id)?.amount ?? 0), 0);
      const glSum = g.glIds.reduce((s, id) => s + (glById.get(id)?.amount ?? 0), 0);
      return Math.abs(bankSum - glSum) >= AMOUNT_TOLERANCE;
    });
    if (unbalanced) {
      return {
        groups: [
          {
            bankIds: selectedBankItems.map((l) => l.lineId),
            glIds: selectedGlItems.map((l) => l.entryNo),
          },
        ],
        problem: null as string | null,
        needsRemark: true,
      };
    }

    return { groups, problem: null as string | null, needsRemark: false };
    // groupSelectionByDateDirection อ่านค่าจาก selectedBankItems/selectedGlItems/clusterOf เท่านั้น
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBankItems, selectedGlItems, clusterOf]);

  const canMatch = matchPlan.groups.length > 0 && matchPlan.problem === null;

  function handleMatchClick() {
    if (!canMatch || busy || syncingGl) return;
    if (matchPlan.needsRemark) {
      setRemarkError("");
      setRemarkModal("match");
      return;
    }
    void handleMatch();
  }

  async function handleMatch(remark?: string) {
    if (!canMatch || busy || syncingGl || matchInFlightRef.current) return;
    const startedAt = Date.now();
    matchInFlightRef.current = true;
    setBusy(true);
    setMatchActivity({
      bankRows: selectedBankItems.length,
      glRows: selectedGlItems.length,
      stage: "saving",
    });
    let keepResultVisible = false;
    try {
      const groups = matchPlan.groups.map((g) => ({ bankLineIds: g.bankIds, glEntryNos: g.glIds }));

      const res = await fetch("/api/reconcile/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bankCode: session.bankCode,
          bankAccountNo: session.bankAccountNo,
          matchType: "MATCHED",
          groups,
          ...(remark ? { remark } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const message = data.error || "จับคู่ไม่สำเร็จ";
        setError(message);
        keepResultVisible = true;
        setMatchActivity((current) =>
          current ? { ...current, stage: "error", errorMessage: message } : current
        );
        return;
      }
      setMatchActivity((current) => (current ? { ...current, stage: "refreshing" } : current));
      await loadData();

      // กัน overlay กระพริบวาบในเคส server ตอบเร็วมาก ให้ผู้ใช้เห็นชัดว่ารับคำสั่ง Match แล้ว
      const remainingFeedbackMs = Math.max(0, 650 - (Date.now() - startedAt));
      if (remainingFeedbackMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, remainingFeedbackMs));
      }
      setMatchActivity((current) => (current ? { ...current, stage: "success" } : current));
      // ค้างสถานะเขียวไว้สั้นๆ ให้ผู้ใช้รับรู้ผลสำเร็จก่อนกลับสู่ตาราง
      await new Promise((resolve) => setTimeout(resolve, 850));
      setToast({
        title: "จับคู่สำเร็จ",
        message: remark
          ? `จับคู่สำเร็จ (เลขอ้างอิง ${data.matchId}) · พักส่วนต่างไว้ ${Number(data.suspenseDifference ?? data.difference ?? 0) < 0 ? "−" : "+"}${formatAmount(Math.abs(Number(data.suspenseDifference ?? data.difference ?? 0)))} บาท`
          : groups.length === 1
            ? `จับคู่สำเร็จ (เลขอ้างอิง ${data.matchId}) ยอด ${formatAmount(bankTotal)} บาท`
            : `จับคู่สำเร็จ ${groups.length} กลุ่ม (เลขอ้างอิง ${data.matchId})`,
      });
    } catch {
      const message = "ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาตรวจสอบการเชื่อมต่อ";
      setError(message);
      keepResultVisible = true;
      setMatchActivity((current) =>
        current ? { ...current, stage: "error", errorMessage: message } : current
      );
    } finally {
      matchInFlightRef.current = false;
      if (!keepResultVisible) setMatchActivity(null);
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
        body: JSON.stringify({
          bankCode: session.bankCode,
          bankAccountNo: session.bankAccountNo,
          matchType: "SUSPENSE",
          groups,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "พักรายการไม่สำเร็จ");
        return;
      }
      setToast({
        title: "พักรายการไว้แล้ว",
        message: `รอจับคู่กับธนาคารภายหลัง · คืนรายการได้ที่หน้ารายการพัก (เลขอ้างอิง ${data.matchId}, ${groups.length} กลุ่ม)`,
      });
      await loadData();
    } catch {
      setError("ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาตรวจสอบการเชื่อมต่อ");
    } finally {
      setBusy(false);
    }
  }

  // ไม่นำมาจับคู่ — รายการ GL ที่ไม่มีวันมีคู่ในธนาคาร เช่น JV ปรับปรุงยอดท้ายเดือน (ประชุม 17 ก.ย. 2026)
  // ต่างจากพัก: ไม่ได้รอเคลียร์ในอนาคต จึงแยกสถานะให้ดูออกในรายงาน
  async function handleExclude(remark: string) {
    if (selectedGlItems.length === 0 || busy || syncingGl) return;
    setBusy(true);
    setRemarkError("");
    try {
      const res = await fetch("/api/reconcile/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bankCode: session.bankCode,
          bankAccountNo: session.bankAccountNo,
          matchType: "EXCLUDED",
          groups: [{ bankLineIds: [], glEntryNos: selectedGlItems.map((l) => l.entryNo) }],
          remark,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRemarkError(data.error || "บันทึกไม่สำเร็จ");
        return;
      }
      setRemarkModal(null);
      setToast({
        title: "บันทึกเป็น JV ปรับปรุงแล้ว",
        message: `ระบุรายการ BC365 ${selectedGlItems.length} รายการเป็น JV ปรับปรุง และอัปเดตยอดพักโอนแล้ว (เลขอ้างอิง ${data.matchId})`,
      });
      await loadData(readWorkspaceDraft(draftKey));
    } catch {
      setRemarkError("ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาตรวจสอบการเชื่อมต่อ");
    } finally {
      setBusy(false);
    }
  }

  // เลือก GL ที่ระบบหาคู่ไม่เจอทั้งหมดในแท็บที่ดูอยู่ — ทีมบัญชีจับคู่ครบแล้วจะพักที่เหลือทีเดียว
  // (ในที่ประชุมสั่งซ้ำหลายรอบว่า "ที่ยังไม่เจอ กดทั้งหมดแล้วพักไป") ไม่รวมรายการที่ระบบจับกลุ่มกับ Bank ได้
  const remainingGlIds = useMemo(
    () => glLinesRaw.filter((l) => l.direction === directionFilter && !clusterOf.has(l.id)).map((l) => l.id),
    [glLinesRaw, directionFilter, clusterOf]
  );
  const remainingGlSelected = remainingGlIds.length > 0 && remainingGlIds.every((id) => selectedGl.has(id));
  function toggleRemainingGl() {
    setSelectedGl((prev) => {
      const next = new Set(prev);
      for (const id of remainingGlIds) {
        if (remainingGlSelected) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }

  // ติ๊กค้างไว้ข้ามแท็บ IN/OUT ได้อยู่แล้ว (selectedGl เก็บทั้งสองทิศ) — ยกไปเป็นกลุ่มตั้งต้นในหน้าต่างจับชน
  // ต่างจากปุ่มอื่นในแถบล่างที่ตั้งใจให้เห็นเฉพาะทิศที่เปิดดูอยู่ เพราะ IN/OUT มักคนละคนดูแล
  const offsetSelection = useMemo(
    () => glLinesRaw.filter((l) => selectedGl.has(l.id)),
    [glLinesRaw, selectedGl]
  );
  const offsetCounts = useMemo(() => {
    const inCount = offsetSelection.filter((l) => l.direction === "IN").length;
    return { inCount, outCount: offsetSelection.length - inCount };
  }, [offsetSelection]);
  async function handleOffsetSelection(groups: number[][]) {
    if (groups.length === 0 || busy || syncingGl) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/reconcile/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bankCode: session.bankCode,
          bankAccountNo: session.bankAccountNo,
          matchType: "OFFSET",
          groups: groups.map((entryNos) => ({ bankLineIds: [], glEntryNos: entryNos })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "บันทึกรายการหักล้างไม่สำเร็จ");
        return;
      }
      setOffsetConfirmOpen(false);
      const rows = groups.reduce((sum, g) => sum + g.length, 0);
      setToast({
        title: "บันทึกรายการหักล้างแล้ว",
        message:
          groups.length === 1
            ? `หักล้าง BC365 ${rows} รายการ (เลขอ้างอิง ${data.matchId})`
            : `หักล้าง BC365 ${rows} รายการ ${groups.length} กลุ่ม (เลขอ้างอิง ${data.matchId})`,
      });
      await loadData();
    } catch {
      setError("ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาตรวจสอบการเชื่อมต่อ");
    } finally {
      setBusy(false);
    }
  }

  const remarkLines = useMemo(
    () =>
      remarkModal === "match"
        ? [
            ...selectedBankItems.map((l) => ({ id: l.id, side: "Bank" as const, date: l.date, ref: `${l.ref} ${l.description ?? ""}`.trim(), amount: l.amount })),
            ...selectedGlItems.map((l) => ({ id: l.id, side: "GL" as const, date: l.date, ref: l.ref, amount: l.amount })),
          ]
        : selectedGlItems.map((l) => ({ id: l.id, side: "GL" as const, date: l.date, ref: l.ref, amount: l.amount })),
    [remarkModal, selectedBankItems, selectedGlItems]
  );

  // ปิดผู้ช่วยหาคู่ — ถ้าจับคู่ไประหว่างเปิด popup ต้องโหลดตารางใหม่ ไม่งั้นรายการที่จับไปแล้วยังค้างอยู่บนจอ
  function handleAssistantClose(matchedPairs: number) {
    setAssistantOpen(false);
    if (matchedPairs === 0) return;
    setToast({ title: "จับคู่สำเร็จ", message: `ผู้ช่วยจับคู่จับคู่ข้ามวันแล้ว ${matchedPairs} คู่` });
    loadData();
  }

  // ยอด Bank ที่ยังไม่มีคู่ในทิศทางที่กำลังดู — ส่งให้ออร่าของผู้ช่วยหาคู่วิ่งโชว์ระหว่างค้นหา
  const assistantPreviewAmounts = useMemo(
    () =>
      bankLinesRaw
        .filter((l) => l.direction === directionFilter && !clusterOf.has(l.id))
        .slice(0, 40)
        .map((l) => Number(l.amount)),
    [bankLinesRaw, directionFilter, clusterOf]
  );

  // ให้บัญชีกดหลังแก้ไขข้อมูลใน BC365 (ERP) เสร็จแล้ว — ดึงรายการ GL ล่าสุด 40 วันมาอัปเดต SQL แล้วโหลดหน้า reconcile ใหม่
  async function handleSyncGl() {
    if (loading || busy || syncingGl) return;
    setSyncingGl(true);
    setError("");
    try {
      const res = await fetch("/api/reconcile/sync-gl", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "ดึงข้อมูลจาก BC365 ไม่สำเร็จ");
        return;
      }
      await loadData();
      setToast({ title: "ดึงข้อมูลใหม่แล้ว", message: "อัปเดตรายการบัญชีล่าสุดจาก BC365 เรียบร้อย" });
    } catch {
      setError("ไม่สามารถเชื่อมต่อบริการดึงข้อมูล BC365 ได้");
    } finally {
      setSyncingGl(false);
    }
  }

  return (
    <div
      className={`relative flex-1 min-w-0 flex flex-col lg:overflow-hidden transition-all duration-500 ease-out ${
        mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"
      }`}
    >
      {toast && <SuccessToast title={toast.title} message={toast.message} onClose={() => setToast(null)} />}
      {matchActivity && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/[0.08] px-4 backdrop-blur-[2px]"
          role="status"
          aria-live="assertive"
          aria-busy="true"
          aria-label="กำลังจับคู่รายการ"
        >
          <div className="animate-match-card-in relative w-full max-w-[350px] overflow-hidden rounded-[1.75rem] border border-white/90 bg-white/80 shadow-[0_24px_70px_rgba(15,23,42,0.16),inset_0_1px_0_white] backdrop-blur-2xl backdrop-saturate-150">
            <div
              aria-hidden
              className={`absolute -right-12 -top-16 h-36 w-36 rounded-full blur-3xl ${
                matchActivity.stage === "success"
                  ? "bg-emerald-200/35"
                  : matchActivity.stage === "error"
                    ? "bg-rose-200/35"
                    : "bg-blue-200/25"
              }`}
            />
            <div aria-hidden className="absolute left-8 right-8 top-0 h-px bg-white" />

            <div className="relative px-5 pb-4 pt-5">
              <div className="flex items-center gap-3.5">
                <div
                  className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full border bg-white/75 shadow-[0_7px_20px_rgba(15,23,42,0.08),inset_0_1px_0_white] ${
                    matchActivity.stage === "success"
                      ? "border-emerald-200 text-emerald-600"
                      : matchActivity.stage === "error"
                        ? "border-rose-200 text-rose-600"
                        : "animate-match-breathe border-slate-200/70 text-blue-600"
                  }`}
                >
                  <span
                    aria-hidden
                    className={`absolute inset-1.5 rounded-full ${
                      matchActivity.stage === "success"
                        ? "bg-emerald-500/[0.08]"
                        : matchActivity.stage === "error"
                          ? "bg-rose-500/[0.08]"
                          : "bg-blue-500/[0.07]"
                    }`}
                  />
                  {matchActivity.stage === "success" ? (
                    <CheckCircle2 className="animate-match-result relative" size={20} strokeWidth={2.3} />
                  ) : matchActivity.stage === "error" ? (
                    <AlertTriangle className="animate-match-result relative" size={20} strokeWidth={2.2} />
                  ) : (
                    <ArrowLeftRight className="relative" size={19} strokeWidth={2} />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <p
                      className={`text-[10px] font-semibold uppercase tracking-[0.17em] ${
                        matchActivity.stage === "success"
                          ? "text-emerald-600"
                          : matchActivity.stage === "error"
                            ? "text-rose-600"
                            : "text-slate-400"
                      }`}
                    >
                      {matchActivity.stage === "success"
                        ? "Completed"
                        : matchActivity.stage === "error"
                          ? "Unable to match"
                          : "Reconciliation"}
                    </p>
                    <span className="rounded-full border border-slate-200/70 bg-white/55 px-2 py-0.5 text-[10px] font-medium tabular-nums text-slate-500">
                      {matchActivity.bankRows + matchActivity.glRows} แถว
                    </span>
                  </div>
                  <p
                    key={matchActivity.stage}
                    className="animate-match-stage mt-1 text-[15px] font-semibold tracking-[-0.01em] text-slate-800"
                  >
                    {matchActivity.stage === "saving"
                      ? "กำลังจับคู่รายการ"
                      : matchActivity.stage === "refreshing"
                        ? "กำลังอัปเดตตาราง"
                        : matchActivity.stage === "success"
                          ? "จับคู่สำเร็จแล้ว"
                          : "จับคู่ไม่สำเร็จ"}
                  </p>
                  {matchActivity.stage === "error" ? (
                    <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-rose-600/80">
                      {matchActivity.errorMessage}
                    </p>
                  ) : (
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      ธนาคาร {matchActivity.bankRows} <span className="mx-1 text-slate-300">·</span> BC365 {matchActivity.glRows}
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-4 h-[3px] overflow-hidden rounded-full bg-slate-200/60">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    matchActivity.stage === "success"
                      ? "w-full bg-emerald-500"
                      : matchActivity.stage === "error"
                        ? "w-full bg-rose-500"
                        : "animate-match-progress w-[38%] bg-gradient-to-r from-blue-500 via-sky-400 to-indigo-500"
                  }`}
                />
              </div>

              {matchActivity.stage === "error" && (
                <div className="mt-4 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setMatchActivity(null)}
                    className="rounded-full border border-slate-200 bg-white/70 px-4 py-1.5 text-xs font-semibold text-slate-600 shadow-sm transition-colors hover:bg-white"
                  >
                    ปิด
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      <AnimatePresence>
        {assistantOpen && (
          <MatchAssistantModal
            key="match-assistant"
            bankCode={session.bankCode}
            bankAccountNo={session.bankAccountNo}
            periodStart={session.periodStart}
            periodEnd={session.periodEnd}
            direction={directionFilter}
            previewAmounts={assistantPreviewAmounts}
            onClose={handleAssistantClose}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {remarkModal && (
          <RemarkActionModal
            key="remark-action"
            mode={remarkModal}
            lines={remarkLines}
            busy={busy}
            error={remarkError}
            onCancel={() => setRemarkModal(null)}
            onConfirm={(remark) => {
              if (remarkModal === "exclude") {
                void handleExclude(remark);
              } else {
                setRemarkModal(null);
                void handleMatch(remark);
              }
            }}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {offsetConfirmOpen && (
          <OffsetConfirmModal
            key="offset-confirm"
            lines={glLinesRaw.map((l) => ({
              id: l.id,
              entryNo: l.entryNo,
              date: l.date,
              ref: l.ref,
              direction: l.direction,
              amount: l.amount,
            }))}
            initialSelectedIds={offsetSelection.map((l) => l.id)}
            busy={busy}
            error={error}
            onCancel={() => setOffsetConfirmOpen(false)}
            onConfirm={handleOffsetSelection}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {balanceOpen && (
          <BalanceModal
            key="balance"
            data={balanceData}
            loading={balanceLoading}
            error={balanceError}
            accountLabel={accountFullLabel}
            onClose={() => setBalanceOpen(false)}
            onSaveOpening={handleSaveOpening}
            onUndoExcluded={handleUndoExcluded}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {confirmSuspenseOpen && (
          <SuspenseConfirmModal
            key="suspense-confirm"
            lines={selectedGlItems}
            direction={directionFilter}
            autoMatchedCount={selectedGlItems.filter((l) => clusterOf.has(l.id)).length}
            busy={busy}
            onCancel={() => setConfirmSuspenseOpen(false)}
            onConfirm={async () => {
              await handleMoveToSuspense();
              setConfirmSuspenseOpen(false);
            }}
          />
        )}
      </AnimatePresence>

      {/* Active workspace มีรูปแบบเดียว: ตารางเต็มพื้นที่พร้อมแถบคำสั่งแบบบางด้านบน */}
      <div className="shrink-0 px-4 pt-3 sm:px-6">
        <div className="relative flex min-h-14 items-center gap-3 rounded-2xl border border-slate-200/90 bg-white/95 px-3 py-2 shadow-[0_10px_30px_rgba(15,23,42,0.10),inset_0_1px_0_white] backdrop-blur-xl">
          <div className="min-w-0 flex-1 px-1 lg:max-w-[calc(50%_-_104px)]">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 shrink-0 rounded-full bg-blue-500 shadow-[0_0_0_4px_rgba(59,130,246,0.10)]" />
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">กระทบยอด</p>
            </div>
            <p className="mt-0.5 truncate text-xs font-semibold text-slate-700" title={accountFullLabel}>
              {accountShortLabel}
              <span className="mx-1.5 font-normal text-slate-300">•</span>
              <span className="font-medium text-slate-500">
                {formatDMY(session.periodStart)}–{formatDMY(session.periodEnd)}
              </span>
            </p>
            {error && <p className="mt-0.5 truncate text-[11px] font-medium text-red-600">{error}</p>}
            {accountNotice && (
              <p className="mt-0.5 flex items-center gap-1 truncate text-[10px] font-medium text-amber-700" title={accountNotice}>
                <AlertTriangle size={11} className="shrink-0" />
                <span className="truncate">{accountNotice}</span>
              </p>
            )}
          </div>

          <BalanceBadge
            difference={balanceData?.difference ?? null}
            remaining={balanceData?.adjustment.remaining ?? null}
            needsOpening={Boolean(balanceData && balanceData.gl.opening === null)}
            unavailable={balanceUnavailable}
            loading={loading || (balanceLoading && !balanceData)}
            floating
            onOpen={() => setBalanceOpen(true)}
          />

          <div className="ml-auto flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={handleResetWorkspace}
                disabled={loading || busy || syncingGl}
                className="flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50"
                title="โหลดรายการล่าสุดและล้างการเลือกทั้งหมด โดยใช้บัญชีและช่วงวันที่เดิม"
              >
                <RotateCcw size={14} />
                <span className="hidden 2xl:inline">โหลดข้อมูลใหม่</span>
              </button>
              <button
                type="button"
                onClick={() => setAssistantOpen(true)}
                disabled={loading || busy || syncingGl}
                className="relative overflow-hidden rounded-xl p-[1.5px] disabled:opacity-50"
                title="ค้นหาคู่แนะนำ รวมถึงรายการต่างวันที่ กรุณาตรวจสอบก่อนยืนยันจับคู่"
              >
                <span
                  aria-hidden
                  className="absolute left-1/2 top-1/2 aspect-square w-[200%] -translate-x-1/2 -translate-y-1/2 animate-aura-spin"
                  style={{ background: AURA_GRADIENT }}
                />
                <span className="relative flex h-8 items-center gap-1.5 rounded-[10px] bg-white px-3 text-xs font-semibold text-violet-700">
                  <WandSparkles size={14} />
                  <span className="hidden 2xl:inline">ผู้ช่วยจับคู่</span>
                </span>
              </button>
              <button
                type="button"
                aria-pressed={linkDates}
                onClick={() => setLinkDates((value) => !value)}
                className={`flex h-9 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold transition-all ${
                  linkDates
                    ? "border-blue-200 bg-blue-50 text-blue-700 shadow-[0_3px_10px_rgba(37,99,235,0.10)]"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
                title={
                  linkDates
                    ? "เปิดอยู่ — สองตารางกางวันเดียวกันและเลื่อนตามกัน กดเพื่อให้แยกกัน"
                    : "ปิดอยู่ — สองตารางเลื่อนแยกกัน กดเพื่อให้เลื่อนตามกัน"
                }
              >
                <Link2 size={14} />
                <span className="hidden 2xl:inline">เลื่อนตามกัน</span>
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${
                    linkDates ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {linkDates ? "เปิด" : "ปิด"}
                </span>
              </button>
              <button
                type="button"
                onClick={onEditFilters}
                className="flex h-9 items-center gap-1.5 rounded-xl border border-blue-200 bg-white px-3 text-xs font-semibold text-blue-700 transition-colors hover:bg-blue-50"
                title="เปลี่ยนธนาคาร บัญชี หรือช่วงวันที่"
              >
                <Pencil size={14} />
                <span className="hidden 2xl:inline">แก้ไขเงื่อนไข</span>
              </button>
          </div>
        </div>
      </div>

      <div className="relative px-4 pb-4 sm:px-6 lg:min-h-0 lg:flex-1 lg:overflow-hidden lg:pt-2">
        <div className="relative grid grid-cols-1 gap-4 lg:h-full lg:grid-cols-2 lg:gap-0 lg:overflow-hidden lg:rounded-2xl lg:border lg:border-slate-200 lg:bg-white lg:shadow-[0_8px_28px_rgba(15,23,42,0.06)]">
          <Panel
            title="รายการเดินบัญชีธนาคาร"
            notchSide="right"
            totalLabel="ยอดรอจับคู่"
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
            highlightedDate={activeDate}
            onHoverDate={markHoverDate}
            clusterOf={clusterOf}
            dateClusterNumbering={dateClusterNumbering}
            lumpClusterIds={lumpClusterIds}
            scrollRef={bankScrollRef}
            onScroll={(event) => persistScroll("bank", event.currentTarget.scrollTop)}
          />
          {/* จอเล็กที่ตารางเรียงซ้อนกัน ไม่มีรอยต่อให้คร่อม จึงแทรกเป็นชิ้นปกติระหว่างสองตารางแทน */}
          <BalanceBadge
            difference={balanceData?.difference ?? null}
            remaining={balanceData?.adjustment.remaining ?? null}
            needsOpening={Boolean(balanceData && balanceData.gl.opening === null)}
            unavailable={balanceUnavailable}
            loading={loading || (balanceLoading && !balanceData)}
            floating={false}
            onOpen={() => setBalanceOpen(true)}
          />

          <Panel
            title="รายการบัญชี BC365"
            notchSide="left"
            totalLabel="ยอดรอจับคู่"
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
            highlightedDate={activeDate}
            onHoverDate={markHoverDate}
            matchReadyDates={matchReadyDates}
            clusterOf={clusterOf}
            dateClusterNumbering={dateClusterNumbering}
            lumpClusterIds={lumpClusterIds}
            onSync={handleSyncGl}
            syncing={syncingGl}
            syncDisabled={loading || busy || syncingGl}
            extraActions={
              <button
                onClick={toggleRemainingGl}
                disabled={loading || busy || syncingGl || remainingGlIds.length === 0}
                aria-pressed={remainingGlSelected}
                title="เลือกรายการ BC365 ที่ไม่มีคู่แนะนำในแท็บนี้ เพื่อพักหลายรายการพร้อมกัน กดอีกครั้งเพื่อยกเลิกการเลือก"
                className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-full border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  remainingGlSelected
                    ? "border-blue-200 bg-blue-50 text-blue-700"
                    : "border-gray-200 text-gray-600 hover:bg-gray-50"
                }`}
              >
                <ListChecks size={12} />
                {remainingGlSelected ? "ยกเลิกการเลือกทั้งหมด" : "เลือกทั้งหมดที่ไม่มีคู่"} ({remainingGlIds.length})
              </button>
            }
            scrollRef={glScrollRef}
            onScroll={(event) => persistScroll("gl", event.currentTarget.scrollTop)}
          />
        </div>
      </div>

      <div className="shrink-0 border-t border-gray-100 bg-white px-4 py-2 sm:px-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-6 flex-wrap">
            {/* เดิมเป็นเลข 3 ตัวลอยๆ ไม่มีป้ายบอกว่าเลขไหนคืออะไร */}
            <div>
              <p className="text-[10px] font-medium text-gray-400">ยอดธนาคารที่เลือก</p>
              <p className="text-base font-semibold text-gray-900">{formatAmount(bankTotal)}</p>
            </div>
            <div>
              <p className="text-[10px] font-medium text-gray-400">ยอด BC365 ที่เลือก</p>
              <p className="text-base font-semibold text-gray-900">{formatAmount(glTotal)}</p>
            </div>
            <div>
              <p className="text-[10px] font-medium text-gray-400">{amountMatches ? "ยอดเท่ากัน" : "ยอดต่างกัน"}</p>
              <p className={`text-base font-semibold ${amountMatches ? "text-green-600" : "text-red-600"}`}>
                {formatAmount(difference)}
              </p>
            </div>

            {/* บอกตรงๆ ว่าทำไมปุ่ม Match ยังกดไม่ได้ — เดิมปุ่มเทาเฉยๆ โดยไม่มีคำอธิบาย */}
            {matchPlan.problem && (
              <p className="max-w-md text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">
                {matchPlan.problem}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <ClusterKindToggle
              label="ยอดตรงกันพอดี"
              count={clusterKinds.oneToOne.count}
              checked={isKindSelected(clusterKinds.oneToOne)}
              tone="green"
              title="เลือกหรือยกเลิกการเลือกทั้งหมด — คู่ที่ธนาคาร 1 รายการ ยอดตรงกับ BC365 1 รายการ ในวันเดียวกัน"
              onClick={() => toggleKind(clusterKinds.oneToOne)}
            />
            <ClusterKindToggle
              label="ต้องรวมหลายรายการ"
              count={clusterKinds.lumpSum.count}
              checked={isKindSelected(clusterKinds.lumpSum)}
              tone="amber"
              title="เลือกหรือยกเลิกการเลือกทั้งหมด — คู่ที่ต้องรวมหลายรายการเข้าด้วยกันยอดจึงเท่า อาจตรงกันโดยบังเอิญ ควรตรวจก่อนกดจับคู่"
              onClick={() => toggleKind(clusterKinds.lumpSum)}
            />
            <button onClick={handleClear} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 px-3 py-2">
              <X size={14} /> ล้างการเลือก
            </button>
            <button
              onClick={() => {
                setError("");
                setOffsetConfirmOpen(true);
              }}
              disabled={loading || busy || syncingGl || glLinesRaw.length === 0}
              title="รายการ BC365 เงินเข้ากับเงินออกที่ล้างกันเอง ไม่มีคู่ในธนาคาร — เปิดหน้าต่างเลือกได้ทั้งสองฝั่งในที่เดียว"
              className="flex items-center gap-1.5 rounded-full border border-teal-200 bg-teal-50 px-4 py-2 text-sm font-medium text-teal-700 hover:bg-teal-100 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Scale size={14} /> หักล้างรายการ BC365
              {offsetSelection.length > 0 && (
                <span className="tabular-nums text-xs">
                  ({offsetCounts.inCount}:{offsetCounts.outCount})
                </span>
              )}
            </button>
            <button
              onClick={() => {
                setRemarkError("");
                setRemarkModal("exclude");
              }}
              disabled={selectedGlItems.length === 0 || busy || syncingGl}
              title="ใช้กับ JV ปรับปรุงที่บันทึกใน BC365 แล้ว รายการที่เลือกจะไม่นำไปจับคู่กับธนาคาร และจะใช้คำนวณยอดพักโอน"
              className="flex items-center gap-1.5 text-sm font-medium text-slate-700 bg-white border border-slate-200 px-4 py-2 rounded-full disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50"
            >
              <Ban size={14} /> ระบุเป็น JV ปรับปรุง
            </button>
            <button
              onClick={() => setConfirmSuspenseOpen(true)}
              disabled={!canMoveToSuspense || busy || syncingGl}
              title="พักรายการ BC365 ที่เลือกไว้เพื่อรอจับคู่ภายหลัง สามารถคืนรายการได้ที่หน้ารายการพัก"
              className="text-sm font-medium text-amber-700 bg-amber-50 border border-amber-200 px-4 py-2 rounded-full disabled:opacity-40 disabled:cursor-not-allowed hover:bg-amber-100"
            >
              พักรายการ
            </button>
            <button
              onClick={handleMatchClick}
              disabled={!canMatch || busy || syncingGl}
              title={
                matchPlan.problem ??
                (matchPlan.needsRemark
                  ? "ยอดทั้งสองฝั่งไม่เท่ากัน ระบบจะจับคู่ตามยอดจริงและพักเฉพาะส่วนต่าง โดยต้องระบุหมายเหตุ"
                  : matchPlan.groups.length > 1
                    ? `จะบันทึกแยกเป็น ${matchPlan.groups.length} กลุ่ม (แยกตามวันที่)`
                    : undefined)
              }
              className="flex items-center gap-1.5 text-sm font-medium text-white bg-blue-600 px-4 py-2 rounded-full disabled:opacity-40 disabled:cursor-not-allowed hover:bg-blue-700"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <ArrowLeftRight size={14} />}
              {matchPlan.needsRemark ? "จับคู่และพักส่วนต่าง" : "จับคู่"} {selectedBankItems.length}:{selectedGlItems.length}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
