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
  Scale,
} from "lucide-react";
import { AnimatePresence } from "framer-motion";
import { ReconcileSession } from "./types";
import { extractDisplayNo, shortAccountLabel } from "../../../lib/bankAccounts";
import MatchAssistantModal from "./MatchAssistantModal";
import SuspenseConfirmModal from "./SuspenseConfirmModal";
import GlOffsetModal, { type OffsetTab } from "./GlOffsetModal";
import DifferenceBadge from "./DifferenceBadge";
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
  // 'REVERSAL' = แถวที่ BC สร้างตอนกด Reverse — ใช้ติดป้ายในหน้าต่างหักล้างกันเอง
  sourceCode: string | null;
  direction: Direction;
  description: string;
  amount: number;
};

// คู่กลับรายการใน BC ที่ /api/reconcile/data แยกออกจากตารางแล้ว รอผู้ใช้ยืนยันบันทึกเป็นหักล้างกันเอง
type ReversalPairApi = { key: string; original: GlApiLine; reversal: GlApiLine };

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
                ? "bg-purple-600 text-white"
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
  onHoverStart,
  onHoverEnd,
  clusterOf,
  dateClusterNumbering,
  lumpClusterIds,
  onOffsetRequest,
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
  // เฉพาะตาราง GL — ปุ่มบนแถวสำหรับหาคู่หักล้างกันเอง (รายการที่แก้ด้วย JV ยอดเท่ากันแต่ทิศตรงข้าม)
  onOffsetRequest?: (id: string) => void;
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
                          title="กลุ่มรวมยอด (1:N / N:1) — ยอดอาจตรงกันโดยบังเอิญ ควรตรวจก่อนกด Match"
                        >
                          รวมยอด
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-800 truncate">{item.description}</p>
                  </div>
                  {onOffsetRequest && (
                    <button
                      type="button"
                      onClick={(e) => {
                        // อยู่ใน <label> — กันไม่ให้การกดปุ่มไปติ๊ก/ปลด checkbox ของแถวด้วย
                        e.preventDefault();
                        e.stopPropagation();
                        onOffsetRequest(item.id);
                      }}
                      title="หาคู่หักล้างกันเอง — รายการ BC ที่ยกเลิกกันเอง ยอดเท่ากันแต่ทิศตรงข้าม (เช่น แก้ด้วย JV)"
                      aria-label="หาคู่หักล้างกันเอง"
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-teal-200 bg-white text-teal-600 opacity-0 transition-opacity hover:bg-teal-50 focus-visible:opacity-100 group-hover:opacity-100"
                    >
                      <Scale size={12} />
                    </button>
                  )}
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
  subtitle,
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
  onOffsetRequest,
  scrollRef,
  onScroll,
}: {
  title: string;
  // บัญชีที่ตารางนี้กำลังแสดง — ต้องเห็นตลอดเวลา เพราะยอดรวมด้านล่างหมายถึงบัญชีนี้บัญชีเดียว
  subtitle?: string;
  // มุมบนด้านในที่ถูกกล่องผลต่าง "แหว่ง" ไป — เว้นที่ให้ด้วยการเติม padding แถวแรกของหัวตาราง
  // ("right" = ตารางฝั่งซ้ายโดนแหว่งมุมบนขวา / "left" = ตารางฝั่งขวาโดนแหว่งมุมบนซ้าย)
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
  // ปุ่มเพิ่มเติมข้างปุ่มซิงค์ (ตาราง GL ใช้วางปุ่มหักล้างกันเอง)
  extraActions?: React.ReactNode;
  onOffsetRequest?: (id: string) => void;
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
    return { byDate: [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)), pendingTotal: total };
  }, [filtered]);

  return (
    <div className="flex flex-col bg-white border border-gray-200 rounded-2xl overflow-hidden min-w-0 lg:h-full">
      {/* หัวตาราง 2 แถว: แถวบนเป็นข้อความล้วน (เว้นที่ให้รอยแหว่งได้) แถวล่างเป็นปุ่มควบคุม
          เดิมรวมเป็นแถวเดียวโดยเอาปุ่มไว้ขวาสุด ซึ่งชนกับรอยแหว่งที่มุมบนด้านในพอดี */}
      <div className="px-4 py-3 border-b border-gray-100 shrink-0">
        <div
          className={`min-w-0 ${
            notchSide === "right" ? "lg:pr-[122px]" : notchSide === "left" ? "lg:pl-[122px]" : ""
          }`}
        >
          <div className="flex items-baseline gap-2 flex-wrap">
            <h2 className="font-semibold text-[15px] text-gray-900 whitespace-nowrap">{title}</h2>
            <span className="text-xs text-gray-400 whitespace-nowrap">
              {selectedInDirection} selected · {filtered.length} pending
            </span>
          </div>
          {subtitle && (
            <p className="text-[11px] text-gray-500 truncate mt-0.5" title={subtitle}>
              {subtitle}
            </p>
          )}
          <p className="text-[11px] font-medium text-gray-400 tracking-wide mt-0.5 whitespace-nowrap">
            {totalLabel}{" "}
            <span className="text-sm font-semibold text-gray-900 tabular-nums tracking-normal">
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
                title="ดึงรายการ GL ล่าสุด 40 วันจาก Business Central (BC365) มาอัปเดต — ใช้หลังบัญชีแก้ไขข้อมูลใน ERP เสร็จแล้ว"
                className="flex items-center gap-1.5 text-xs font-medium text-gray-600 border border-gray-200 px-2.5 py-1.5 rounded-full hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <RefreshCw size={12} className={syncing ? "animate-spin" : ""} />
                {syncing ? "กำลังซิงค์..." : "ซิงค์จาก BC365"}
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
              onHoverStart={() => onHoverDate(date)}
              onHoverEnd={() => onHoverDate(null)}
              clusterOf={clusterOf}
              dateClusterNumbering={dateClusterNumbering}
              lumpClusterIds={lumpClusterIds}
              onOffsetRequest={onOffsetRequest}
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
  const [reversalPairs, setReversalPairs] = useState<ReversalPairApi[]>([]);
  // หน้าต่างหักล้างกันเอง — focusEntryNo มีค่าเมื่อเปิดจากปุ่มบนแถว GL
  const [offsetModal, setOffsetModal] = useState<{ tab: OffsetTab; focusEntryNo: number | null } | null>(null);
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
        ? `มี ${unassignedBankLines} รายการ Bank ที่ยังไม่ได้ระบุบัญชี`
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
      setReversalPairs(Array.isArray(data.reversalPairs) ? data.reversalPairs : []);
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
    } catch {
      setError("เชื่อมต่อ server ไม่ได้");
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

  // ยอดคงค้างของแต่ละฝั่งในทิศทางที่กำลังดู — ต้องคำนวณด้วยกติกาเดียวกับ pendingTotal ใน Panel เป๊ะ
  // (กรองตามแท็บกลุ่มก่อน แล้วค่อยกรองตามทิศทาง) ไม่งั้นตัวเลขบนป้ายผลต่างกับในหัวตารางจะไม่ตรงกัน
  const sumPending = useCallback(
    (lines: LineItem[], groupTab: string) =>
      lines
        .filter((l) => (groupTab === "ALL" || l.groupKey === groupTab) && l.direction === directionFilter)
        .reduce((sum, l) => sum + l.amount, 0),
    [directionFilter]
  );
  const bankPendingTotal = useMemo(() => sumPending(bankLines, "ALL"), [bankLines, sumPending]);
  const glPendingTotal = useMemo(() => sumPending(glLines, glGroupTab), [glLines, glGroupTab, sumPending]);

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
      return { groups: [] as { bankIds: number[]; glIds: number[] }[], problem: null as string | null };
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
      };
    }

    for (let i = 0; i < groups.length; i++) {
      const bankSum = groups[i].bankIds.reduce((s, id) => s + (bankById.get(id)?.amount ?? 0), 0);
      const glSum = groups[i].glIds.reduce((s, id) => s + (glById.get(id)?.amount ?? 0), 0);
      if (Math.abs(bankSum - glSum) >= AMOUNT_TOLERANCE) {
        return {
          groups: [],
          problem:
            groups.length === 1
              ? `ยอดสองฝั่งต่างกัน ${formatAmount(Math.abs(bankSum - glSum))} — จับคู่ไม่ได้`
              : `กลุ่มย่อยที่ ${i + 1} ยอดไม่ตรงกัน (Bank ${formatAmount(bankSum)} / GL ${formatAmount(glSum)}) — ลองจับคู่ทีละกลุ่ม`,
        };
      }
    }

    return { groups, problem: null as string | null };
    // groupSelectionByDateDirection อ่านค่าจาก selectedBankItems/selectedGlItems/clusterOf เท่านั้น
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBankItems, selectedGlItems, clusterOf]);

  const canMatch = matchPlan.groups.length > 0 && matchPlan.problem === null;

  async function handleMatch() {
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
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const message = data.error || "Match ไม่สำเร็จ";
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
        message:
          groups.length === 1
            ? `จับคู่สำเร็จ (MatchId ${data.matchId}) ยอด ${formatAmount(bankTotal)} บาท`
            : `จับคู่สำเร็จ ${groups.length} กลุ่มย่อย ภายใต้ MatchId ${data.matchId}`,
      });
    } catch {
      const message = "เชื่อมต่อ server ไม่ได้";
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

  // บันทึก/ยกเลิกหักล้างกันเองสำเร็จ — โหลดตารางใหม่แต่คืนสิ่งที่ผู้ใช้ติ๊กไว้ด้วย draft ล่าสุดใน sessionStorage
  // (loadData เปล่าๆ จะรีเซ็ตเป็นการติ๊กอัตโนมัติ ทำให้รายการที่เลือกไว้ในอีกแท็บหายไปทั้งที่ไม่เกี่ยวกัน)
  function handleOffsetChanged() {
    void loadData(readWorkspaceDraft(draftKey));
  }

  // ปิดผู้ช่วยหาคู่ — ถ้าจับคู่ไประหว่างเปิด popup ต้องโหลดตารางใหม่ ไม่งั้นรายการที่จับไปแล้วยังค้างอยู่บนจอ
  function handleAssistantClose(matchedPairs: number) {
    setAssistantOpen(false);
    if (matchedPairs === 0) return;
    setToast({ title: "จับคู่สำเร็จ", message: `ผู้ช่วยหาคู่จับคู่ข้ามวันแล้ว ${matchedPairs} คู่` });
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
                      Bank {matchActivity.bankRows} <span className="mx-1 text-slate-300">·</span> GL {matchActivity.glRows}
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
        {offsetModal && (
          <GlOffsetModal
            key="gl-offset"
            bankCode={session.bankCode}
            bankAccountNo={session.bankAccountNo}
            accountLabel={accountFullLabel}
            periodStart={session.periodStart}
            periodEnd={session.periodEnd}
            glExtendDays={session.includeSuspenseBuffer ? 7 : 0}
            pairs={reversalPairs}
            glLines={glLinesRaw}
            initialTab={offsetModal.tab}
            focusEntryNo={offsetModal.focusEntryNo}
            onChanged={handleOffsetChanged}
            onClose={() => setOffsetModal(null)}
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
        <div className="flex min-h-14 items-center gap-3 rounded-2xl border border-slate-200/90 bg-white/95 px-3 py-2 shadow-[0_10px_30px_rgba(15,23,42,0.10),inset_0_1px_0_white] backdrop-blur-xl">
          <div className="min-w-0 flex-1 px-1">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 shrink-0 rounded-full bg-blue-500 shadow-[0_0_0_4px_rgba(59,130,246,0.10)]" />
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Reconcile</p>
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

          <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={handleResetWorkspace}
                disabled={loading || busy || syncingGl}
                className="flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50"
                title="โหลดข้อมูลใหม่"
              >
                <RotateCcw size={14} />
                <span className="hidden xl:inline">รีเซ็ต</span>
              </button>
              <button
                type="button"
                onClick={() => setAssistantOpen(true)}
                disabled={loading || busy || syncingGl}
                className="relative overflow-hidden rounded-xl p-[1.5px] disabled:opacity-50"
                title="เปิดผู้ช่วยหาคู่"
              >
                <span
                  aria-hidden
                  className="absolute left-1/2 top-1/2 aspect-square w-[200%] -translate-x-1/2 -translate-y-1/2 animate-aura-spin"
                  style={{ background: AURA_GRADIENT }}
                />
                <span className="relative flex h-8 items-center gap-1.5 rounded-[10px] bg-white px-3 text-xs font-semibold text-violet-700">
                  <WandSparkles size={14} />
                  <span>ผู้ช่วยจับคู่</span>
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
                    ? "ลิงก์วันที่เปิดอยู่ — กดเพื่อให้ทั้ง 2 ฝั่งเป็นอิสระต่อกัน"
                    : "ลิงก์วันที่ปิดอยู่ — กดเพื่อให้ทั้ง 2 ฝั่งขยายและเลื่อนพร้อมกัน"
                }
              >
                <Link2 size={14} />
                <span>ลิงก์วันที่</span>
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
                <span className="hidden xl:inline">แก้ไขเงื่อนไข</span>
              </button>
          </div>
        </div>
      </div>

      <div className="relative px-4 pb-4 sm:px-6 lg:min-h-0 lg:flex-1 lg:overflow-hidden lg:pt-2">
        {/* relative เพราะกล่องผลต่างลอยอยู่ที่มุมบนตรงกลาง คร่อมรอยต่อของสองตาราง */}
        <div className="relative grid grid-cols-1 gap-4 lg:h-full lg:grid-cols-2 lg:gap-3">
          <DifferenceBadge
            bankTotal={bankPendingTotal}
            glTotal={glPendingTotal}
            loading={loading}
            floating
          />
          <Panel
            title="Bank statement"
            subtitle={accountFullLabel}
            notchSide="right"
            totalLabel="BANK TOTAL"
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
          <DifferenceBadge
            bankTotal={bankPendingTotal}
            glTotal={glPendingTotal}
            loading={loading}
            floating={false}
          />

          <Panel
            title="General Ledger (BC365)"
            subtitle={accountFullLabel}
            notchSide="left"
            totalLabel="GL TOTAL"
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
                onClick={() => setOffsetModal({ tab: reversalPairs.length > 0 ? "auto" : "manual", focusEntryNo: null })}
                disabled={loading || busy || syncingGl}
                title={
                  reversalPairs.length > 0
                    ? `มีคู่กลับรายการใน BC ${reversalPairs.length} คู่ที่ซ่อนจากตารางแล้ว (ไม่รวมในยอด) — กดเพื่อตรวจและยืนยัน`
                    : "หักล้างกันเอง — รายการ BC ที่ยกเลิกกันเอง (กด Reverse หรือแก้ด้วย JV) ยอดสุทธิ 0 ไม่ต้องจับคู่กับ Bank"
                }
                className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-full border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  reversalPairs.length > 0
                    ? "border-teal-200 bg-teal-50 text-teal-700 hover:bg-teal-100"
                    : "border-gray-200 text-gray-600 hover:bg-gray-50"
                }`}
              >
                <Scale size={12} />
                หักล้างกันเอง
                {reversalPairs.length > 0 && (
                  <span className="rounded-full bg-teal-600 px-1.5 text-[10px] font-semibold leading-4 text-white tabular-nums">
                    {reversalPairs.length}
                  </span>
                )}
              </button>
            }
            onOffsetRequest={(id) => {
              const line = glLinesRaw.find((l) => l.id === id);
              setOffsetModal({ tab: "manual", focusEntryNo: line?.entryNo ?? null });
            }}
            scrollRef={glScrollRef}
            onScroll={(event) => persistScroll("gl", event.currentTarget.scrollTop)}
          />
        </div>
      </div>

      <div className="shrink-0 border-t border-gray-100 bg-white px-4 py-2 sm:px-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-6 flex-wrap">
            <div>
              <p className="text-base font-semibold text-gray-900">{formatAmount(bankTotal)}</p>
            </div>
            <div>
              <p className="text-base font-semibold text-gray-900">{formatAmount(glTotal)}</p>
            </div>
            <div>
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
              label="1:1"
              count={clusterKinds.oneToOne.count}
              checked={isKindSelected(clusterKinds.oneToOne)}
              tone="green"
              title="เลือก/ยกเลิกทั้งหมด — กลุ่มที่ Bank 1 รายการยอดตรงกับ GL 1 รายการในวันเดียวกัน"
              onClick={() => toggleKind(clusterKinds.oneToOne)}
            />
            <ClusterKindToggle
              label="รวมยอด 1:N·N:1"
              count={clusterKinds.lumpSum.count}
              checked={isKindSelected(clusterKinds.lumpSum)}
              tone="amber"
              title="เลือก/ยกเลิกทั้งหมด — กลุ่มที่ต้องรวมหลายรายการให้ยอดเท่ากัน ยอดอาจตรงกันโดยบังเอิญ ควรตรวจก่อนกด Match"
              onClick={() => toggleKind(clusterKinds.lumpSum)}
            />
            <button onClick={handleClear} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 px-3 py-2">
              <X size={14} /> Clear
            </button>
            <button
              onClick={() => setConfirmSuspenseOpen(true)}
              disabled={!canMoveToSuspense || busy || syncingGl}
              className="text-sm font-medium text-amber-700 bg-amber-50 border border-amber-200 px-4 py-2 rounded-full disabled:opacity-40 disabled:cursor-not-allowed hover:bg-amber-100"
            >
              Move to suspense
            </button>
            <button
              onClick={handleMatch}
              disabled={!canMatch || busy || syncingGl}
              title={matchPlan.problem ?? (matchPlan.groups.length > 1 ? `จะบันทึกเป็น ${matchPlan.groups.length} กลุ่มย่อย` : undefined)}
              className="flex items-center gap-1.5 text-sm font-medium text-white bg-blue-600 px-4 py-2 rounded-full disabled:opacity-40 disabled:cursor-not-allowed hover:bg-blue-700"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <ArrowLeftRight size={14} />}
              Match {selectedBankItems.length}:{selectedGlItems.length}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
