"use client";

// รายละเอียดของ Match 1 ใบตอนกดคลี่ — จัดหน้าเป็น "สองฝั่ง" แบบเดียวกับหน้า Reconcile
// (ฝั่งซ้าย = ต้นทาง, ฝั่งขวา = ปลายทาง, ตรงกลางบอกว่าสองฝั่งสัมพันธ์กันยังไง)
//
// ต่างจากของเดิมที่ซ้อนเป็น Match → วันที่ → กลุ่มย่อย → ตารางสองฝั่ง (กดสามชั้นกว่าจะเห็นข้อมูล):
// คลี่ครั้งเดียวเห็นทุกบรรทัดของทั้ง Match ในตารางสองฝั่งชุดเดียว แล้วใช้ "สีประจำกลุ่มย่อย"
// โยงว่าแถวไหนจับคู่กับแถวไหน — หลักเดียวกับชิป "กลุ่ม N" ในหน้า Reconcile
//
// หน้าตาของแต่ละประเภท:
//   MATCHED  Bank statement        ⇆   General Ledger (BC365)
//   OFFSET   BC365 · ขาเข้า        ⇆   BC365 · ขาออก            (สุทธิต้องเป็น 0.00)
//   SUSPENSE General Ledger (BC365) →  การ์ดบัญชีพักโอน          (ไม่มีฝั่ง Bank เพราะยังรอคู่)
//   EXCLUDED General Ledger (BC365) ⊘  การ์ดไม่นำมาจับคู่

import { useMemo, useState } from "react";
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowRight,
  ArrowUpRight,
  Ban,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Layers3,
  Scale,
  Wallet,
} from "lucide-react";
import {
  AMOUNT_TOLERANCE,
  LineItem,
  MatchRecord,
  SubGroup,
  cleanAccountName,
  formatAmount,
  formatDMY,
  formatDate,
  formatSigned,
  groupColor,
  offsetKind,
  splitByDirection,
  summarizeGroups,
} from "./historyModel";
import { extractDisplayNo } from "../../../../lib/bankAccounts";
import { isReversalSource } from "../../../../lib/glOffset";

type PanelTone = "bank" | "bc" | "in" | "out";

const TONES: Record<PanelTone, { border: string; headBorder: string; headBg: string; dot: string; title: string; sub: string; footBg: string; total: string }> = {
  bank: {
    border: "border-sky-200/80",
    headBorder: "border-sky-100",
    headBg: "bg-sky-50/80",
    dot: "bg-sky-500",
    title: "text-sky-900",
    sub: "text-sky-600",
    footBg: "bg-sky-50/50",
    total: "text-sky-800",
  },
  bc: {
    border: "border-violet-200/80",
    headBorder: "border-violet-100",
    headBg: "bg-violet-50/80",
    dot: "bg-violet-500",
    title: "text-violet-900",
    sub: "text-violet-600",
    footBg: "bg-violet-50/50",
    total: "text-violet-800",
  },
  in: {
    border: "border-purple-200/80",
    headBorder: "border-purple-100",
    headBg: "bg-purple-50/80",
    dot: "bg-purple-500",
    title: "text-purple-900",
    sub: "text-purple-600",
    footBg: "bg-purple-50/50",
    total: "text-purple-800",
  },
  out: {
    border: "border-red-200/80",
    headBorder: "border-red-100",
    headBg: "bg-red-50/80",
    dot: "bg-red-500",
    title: "text-red-900",
    sub: "text-red-500",
    footBg: "bg-red-50/50",
    total: "text-red-700",
  },
};

function DirectionBadge({ direction }: { direction: "IN" | "OUT" }) {
  const isIn = direction === "IN";
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
        isIn ? "bg-purple-50 text-purple-700" : "bg-red-50 text-red-600"
      }`}
    >
      {isIn ? <ArrowDownLeft size={10} /> : <ArrowUpRight size={10} />}
      {direction}
    </span>
  );
}

type DetailLine = { line: LineItem; num: number; side: "BANK" | "GL" };

/** เรียงตามวันที่จริง แล้วค่อยตามกลุ่มย่อย — บัญชีไล่อ่านจากวันที่ 1 ไปสิ้นเดือนเหมือนกระดาษทำการ */
function sortLines(lines: DetailLine[]) {
  return [...lines].sort((a, b) => {
    const da = formatDate(a.line.date);
    const db = formatDate(b.line.date);
    if (da !== db) return da < db ? -1 : 1;
    if (a.num !== b.num) return a.num - b.num;
    return b.line.amount - a.line.amount;
  });
}

function LineRow({
  entry,
  showGroupChip,
  showAccount,
  selectable,
  selected,
  highlighted,
  dimmed,
  onHoverGroup,
  onToggleGroup,
}: {
  entry: DetailLine;
  showGroupChip: boolean;
  /** เขียนบัญชีไว้ในแถวด้วยหรือไม่ — ใส่เฉพาะตอน Match คร่อมหลายบัญชี ไม่งั้นซ้ำกับหัวตาราง */
  showAccount: boolean;
  selectable: boolean;
  selected: boolean;
  highlighted: boolean;
  dimmed: boolean;
  onHoverGroup: (num: number | null) => void;
  onToggleGroup: (num: number) => void;
}) {
  const { line, side } = entry;
  const color = groupColor(entry.num);
  const reversed = line.status === "REVERSED";
  const isBank = side === "BANK";

  const ref = line.ref?.trim() || "";
  const accountNo = extractDisplayNo(line.accountName) ?? line.accountNo ?? "";
  // ฝั่ง BC ไม่มีคอลัมน์คำอธิบายใน BankAccountLedgerEntries — ใช้เลข Entry เป็นตัวอ้างอิงแทน
  // (ค้นหาในช่องค้นหาของหน้านี้ได้ตรงๆ) แล้วต่อชื่อบัญชีเฉพาะตอนที่ Match คร่อมหลายบัญชี
  const detail = isBank
    ? line.description?.trim() || "—"
    : [
        line.entryNo != null ? `Entry #${line.entryNo}` : "",
        showAccount ? [cleanAccountName(line.accountName), accountNo].filter(Boolean).join(" · ") : "",
      ]
        .filter(Boolean)
        .join(" · ") || "—";

  return (
    <div
      onMouseEnter={() => onHoverGroup(entry.num)}
      onMouseLeave={() => onHoverGroup(null)}
      onClick={() => selectable && !reversed && onToggleGroup(entry.num)}
      onKeyDown={(event) => {
        if (selectable && !reversed && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onToggleGroup(entry.num);
        }
      }}
      role={selectable && !reversed ? "checkbox" : undefined}
      aria-checked={selectable && !reversed ? selected : undefined}
      tabIndex={selectable && !reversed ? 0 : undefined}
      className={`grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-2.5 px-3 py-2 transition-all ${
        reversed
          ? "bg-gray-50/80"
          : selected
            ? "bg-blue-50 ring-1 ring-inset ring-blue-200"
            : highlighted
              ? color.row
              : dimmed
                ? "opacity-40"
                : selectable
                  ? "cursor-pointer hover:bg-blue-50/60"
                  : "hover:bg-gray-50"
      }`}
    >
      <span className="flex size-5 shrink-0 items-center justify-center pt-0.5">
        {selectable && !reversed ? (
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleGroup(entry.num)}
            onClick={(event) => event.stopPropagation()}
            className="size-3.5 cursor-pointer rounded border-gray-300 text-blue-600 focus:ring-blue-400"
            aria-label={`เลือกกลุ่ม ${entry.num} เพื่อส่งกลับไป Reconcile`}
          />
        ) : (
          <span className={`size-1.5 rounded-full ${reversed ? "bg-gray-300" : color.dot}`} aria-hidden />
        )}
      </span>
      <div className="min-w-0">
        <div className="mb-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <span className="whitespace-nowrap text-[11px] font-semibold tabular-nums text-gray-500">
            {formatDMY(line.date)}
          </span>
          <DirectionBadge direction={line.direction} />
          {showGroupChip && (
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${color.chip}`}>กลุ่ม {entry.num}</span>
          )}
          {ref && (
            <span className="truncate text-[11px] text-gray-400" title={ref}>
              {ref}
            </span>
          )}
          {!isBank && isReversalSource(line.sourceCode) && (
            <span
              className="rounded bg-gray-100 px-1 py-0.5 text-[9px] font-semibold text-gray-500"
              title="แถวกลับรายการที่ BC สร้างให้อัตโนมัติ (Source_Code = REVERSAL)"
            >
              REVERSAL
            </span>
          )}
          {reversed && (
            <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[9px] font-semibold text-red-600">
              ยกเลิกแล้ว
            </span>
          )}
        </div>
        <p className={`truncate text-xs ${reversed ? "text-gray-400 line-through" : "text-gray-600"}`} title={detail}>
          {detail}
        </p>
      </div>
      <span
        className={`whitespace-nowrap pt-0.5 text-sm font-semibold tabular-nums ${
          reversed ? "text-gray-400 line-through" : "text-gray-800"
        }`}
      >
        {formatAmount(line.amount)}
      </span>
    </div>
  );
}

function LinePanel({
  tone,
  title,
  subtitle,
  entries,
  totalLabel,
  showGroupChip,
  selectable,
  selectedNums,
  highlightNums,
  hasHighlight,
  onHoverGroup,
  onToggleGroup,
  emptyText,
}: {
  tone: PanelTone;
  title: string;
  subtitle?: string;
  entries: DetailLine[];
  totalLabel: string;
  showGroupChip: boolean;
  selectable: boolean;
  selectedNums: Set<number>;
  highlightNums: Set<number>;
  hasHighlight: boolean;
  onHoverGroup: (num: number | null) => void;
  onToggleGroup: (num: number) => void;
  emptyText: string;
}) {
  const t = TONES[tone];
  const sorted = useMemo(() => sortLines(entries), [entries]);
  // หัวตารางบอกบัญชีอยู่แล้วเมื่อทั้งตารางเป็นบัญชีเดียว — แถวจึงไม่ต้องเขียนซ้ำทุกบรรทัด
  const showAccount = new Set(sorted.map((e) => e.line.accountNo ?? "")).size > 1;
  // ยอดรวมท้ายตารางนับเฉพาะบรรทัดที่ยังมีผล — บรรทัดที่ยกเลิกไปแล้วยังโชว์ไว้เป็นร่องรอย แต่ไม่ควรถูกรวมยอด
  const total = sorted.reduce((s, e) => (e.line.status === "ACTIVE" ? s + e.line.amount : s), 0);
  const activeCount = sorted.filter((e) => e.line.status === "ACTIVE").length;

  return (
    <div className={`flex min-w-0 flex-col overflow-hidden rounded-xl border bg-white ${t.border}`}>
      <div className={`flex items-center justify-between gap-2 border-b px-3 py-2 ${t.headBorder} ${t.headBg}`}>
        <div className="flex min-w-0 items-center gap-2">
          <span className={`size-2 shrink-0 rounded-full ${t.dot}`} />
          <div className="min-w-0">
            <p className={`truncate text-xs font-semibold ${t.title}`}>{title}</p>
            {subtitle && (
              <p className={`truncate text-[10px] ${t.sub}`} title={subtitle}>
                {subtitle}
              </p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {selectable && <span className="hidden text-[10px] text-gray-400 sm:inline">คลิกแถวเพื่อเลือก</span>}
          <span className={`text-[10px] font-medium ${t.sub}`}>{activeCount} รายการ</span>
        </div>
      </div>

      {/* Match ที่พัก GL ทั้งเดือนทีเดียวมีได้เป็นร้อยบรรทัด — จำกัดความสูงแล้วให้เลื่อนในตาราง
          เหมือนตารางหน้า Reconcile แทนที่จะดันการ์ดยาวจนหาการ์ดถัดไปไม่เจอ */}
      <div className="max-h-[26rem] divide-y divide-gray-100 overflow-y-auto">
        {sorted.length === 0 ? (
          <div className="flex min-h-20 items-center justify-center px-3 py-5 text-xs text-gray-400">{emptyText}</div>
        ) : (
          sorted.map((entry, index) => (
            <LineRow
              key={`${entry.side}-${entry.line.lineId ?? entry.line.entryNo ?? index}`}
              entry={entry}
              showGroupChip={showGroupChip}
              showAccount={showAccount}
              selectable={selectable}
              selected={selectedNums.has(entry.num)}
              highlighted={highlightNums.has(entry.num)}
              dimmed={hasHighlight && !highlightNums.has(entry.num)}
              onHoverGroup={onHoverGroup}
              onToggleGroup={onToggleGroup}
            />
          ))
        )}
      </div>

      <div className={`mt-auto flex items-center justify-between border-t px-3 py-2 ${t.headBorder} ${t.footBg}`}>
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-400">{totalLabel}</span>
        <span className={`text-sm font-bold tabular-nums ${t.total}`}>{formatAmount(total)}</span>
      </div>
    </div>
  );
}

/** เส้นเชื่อมสองฝั่ง — แนวนอนตอนตารางเรียงซ้อนกันบนจอเล็ก และแนวตั้งตอนวางคู่กันบนจอใหญ่ */
function Connector({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-center gap-2 py-1 lg:flex-col lg:px-2 lg:py-0">
      <span className="h-px flex-1 bg-gray-200 lg:h-auto lg:w-px lg:flex-1" />
      {children}
      <span className="h-px flex-1 bg-gray-200 lg:h-auto lg:w-px lg:flex-1" />
    </div>
  );
}

function ConnectorPill({
  tone,
  icon,
  label,
  title,
}: {
  tone: "ok" | "warn" | "bad" | "muted";
  icon: React.ReactNode;
  label: string;
  title: string;
}) {
  const cls =
    tone === "ok"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : tone === "warn"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : tone === "bad"
          ? "border-red-200 bg-red-50 text-red-600"
          : "border-slate-200 bg-slate-50 text-slate-600";
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border bg-white px-2.5 py-1 text-[11px] font-semibold shadow-sm ${cls}`}
    >
      {icon}
      {label}
    </span>
  );
}

/** การ์ด "ปลายทาง" ของรายการที่ไม่มีฝั่ง Bank — ใช้กับพักโอนและ JV ปรับปรุงพักโอน */
function DestinationCard({
  tone,
  icon,
  title,
  subtitle,
  inTotal,
  outTotal,
  netLabel,
  note,
  footer,
}: {
  tone: "amber" | "slate";
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  inTotal: number;
  outTotal: number;
  netLabel: string;
  note: string;
  footer?: React.ReactNode;
}) {
  const isAmber = tone === "amber";
  const net = inTotal - outTotal;
  return (
    <div
      className={`flex min-w-0 flex-col overflow-hidden rounded-xl border border-dashed ${
        isAmber ? "border-amber-300 bg-amber-50/40" : "border-slate-300 bg-slate-50/60"
      }`}
    >
      <div
        className={`flex items-center gap-2 border-b border-dashed px-3 py-2 ${
          isAmber ? "border-amber-200 bg-amber-50/70" : "border-slate-200 bg-slate-100/70"
        }`}
      >
        <span
          className={`flex size-6 shrink-0 items-center justify-center rounded-full ${
            isAmber ? "bg-amber-100 text-amber-700" : "bg-slate-200 text-slate-600"
          }`}
        >
          {icon}
        </span>
        <div className="min-w-0">
          <p className={`truncate text-xs font-semibold ${isAmber ? "text-amber-900" : "text-slate-800"}`}>{title}</p>
          <p className={`truncate text-[10px] ${isAmber ? "text-amber-600" : "text-slate-500"}`}>{subtitle}</p>
        </div>
      </div>

      <div className="flex flex-1 flex-col justify-center gap-1.5 px-3 py-3">
        <div className="flex items-center justify-between text-xs">
          <span className="inline-flex items-center gap-1 text-gray-500">
            <ArrowDownLeft size={11} className="text-purple-500" /> ขาเข้า
          </span>
          <span className="font-semibold tabular-nums text-gray-700">{formatAmount(inTotal)}</span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="inline-flex items-center gap-1 text-gray-500">
            <ArrowUpRight size={11} className="text-red-500" /> ขาออก
          </span>
          <span className="font-semibold tabular-nums text-gray-700">{formatAmount(outTotal)}</span>
        </div>
        <div
          className={`mt-1 flex items-center justify-between border-t border-dashed pt-2 ${
            isAmber ? "border-amber-200" : "border-slate-200"
          }`}
        >
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-400">{netLabel}</span>
          <span className={`text-sm font-bold tabular-nums ${isAmber ? "text-amber-800" : "text-slate-800"}`}>
            {formatSigned(net)}
          </span>
        </div>
      </div>

      <div
        className={`border-t border-dashed px-3 py-2 text-[11px] leading-relaxed ${
          isAmber ? "border-amber-200 text-amber-800" : "border-slate-200 text-slate-600"
        }`}
      >
        {note}
        {footer}
      </div>
    </div>
  );
}

function TwoColumn({
  left,
  connector,
  right,
}: {
  left: React.ReactNode;
  connector: React.ReactNode;
  right: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 items-stretch gap-2 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:gap-0">
      {left}
      {connector}
      {right}
    </div>
  );
}

export default function MatchDetail({
  match,
  groups,
  selectedKeys,
  onToggleGroup,
  revertable,
}: {
  match: MatchRecord;
  groups: SubGroup[];
  selectedKeys: Set<string>;
  onToggleGroup: (key: string) => void;
  revertable: boolean;
}) {
  const [hoveredGroup, setHoveredGroup] = useState<number | null>(null);
  const [focusedGroupNum, setFocusedGroupNum] = useState<number | null>(null);

  const focusedIndex = focusedGroupNum === null ? -1 : groups.findIndex((g) => g.num === focusedGroupNum);
  const visibleGroups = useMemo(
    () => (focusedIndex >= 0 ? [groups[focusedIndex]] : groups),
    [focusedIndex, groups]
  );

  const bankEntries: DetailLine[] = useMemo(
    () => visibleGroups.flatMap((g) => g.bankLines.map((line) => ({ line, num: g.num, side: "BANK" as const }))),
    [visibleGroups]
  );
  const glEntries: DetailLine[] = useMemo(
    () => visibleGroups.flatMap((g) => g.glLines.map((line) => ({ line, num: g.num, side: "GL" as const }))),
    [visibleGroups]
  );

  const multiGroup = groups.length > 1;
  const selectedNums = useMemo(
    () => new Set(groups.filter((g) => selectedKeys.has(g.key)).map((g) => g.num)),
    [groups, selectedKeys]
  );
  // ไฮไลต์ตามกลุ่มที่ชี้อยู่ก่อน ถ้าไม่ได้ชี้อะไรจึงใช้กลุ่มที่ติ๊กเลือกไว้
  const highlightNums = focusedIndex >= 0 ? new Set<number>() : hoveredGroup !== null ? new Set([hoveredGroup]) : selectedNums;
  const hasHighlight = focusedIndex < 0 && multiGroup && highlightNums.size > 0 && highlightNums.size < groups.length;

  const activeGroups = visibleGroups.filter((g) => g.status === "ACTIVE");
  const summary = summarizeGroups(activeGroups);

  // ป้ายบัญชี BC ของ Match นี้ (ปกติมีบัญชีเดียว) — ช่วยให้รู้ว่ากำลังดูบัญชีไหนโดยไม่ต้องไล่อ่านทีละแถว
  const accountLabel = useMemo(() => {
    const names = new Set(
      glEntries.map((e) => cleanAccountName(e.line.accountName) || e.line.accountNo || "").filter(Boolean)
    );
    return names.size === 1 ? [...names][0] : names.size > 1 ? `${names.size} บัญชี` : "";
  }, [glEntries]);

  function groupSummaryText(g: SubGroup) {
    if (match.matchType === "MATCHED") return `${g.bankLines.length} : ${g.glLines.length}`;
    if (match.matchType === "OFFSET") {
      const { inLines, outLines } = splitByDirection(g.glLines);
      return `${inLines.length} เข้า : ${outLines.length} ออก`;
    }
    return `${g.glLines.length} รายการ`;
  }

  function groupAmount(g: SubGroup) {
    if (match.matchType === "MATCHED") return g.bankTotal;
    if (match.matchType === "OFFSET") return splitByDirection(g.glLines).inTotal;
    return g.glTotal;
  }

  function moveFocus(offset: number) {
    const nextIndex = Math.min(groups.length - 1, Math.max(0, (focusedIndex < 0 ? -1 : focusedIndex) + offset));
    setFocusedGroupNum(groups[nextIndex]?.num ?? null);
  }

  const groupStrip = multiGroup && (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white">
            <Layers3 size={15} />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-slate-800">รายการจับคู่ {groups.length} กลุ่ม</p>
            <p className="truncate text-[11px] text-slate-400">
              {focusedIndex >= 0
                ? `กำลังดูเฉพาะกลุ่ม ${groups[focusedIndex].num} · ${groupSummaryText(groups[focusedIndex])} · ${formatAmount(groupAmount(groups[focusedIndex]))}`
                : `ดูภาพรวมทั้งหมด · Bank ${groups.reduce((sum, g) => sum + g.bankLines.length, 0)} รายการ · BC ${groups.reduce((sum, g) => sum + g.glLines.length, 0)} รายการ`}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[12rem] flex-1 sm:flex-none">
            <select
              value={focusedGroupNum ?? "ALL"}
              onChange={(event) => setFocusedGroupNum(event.target.value === "ALL" ? null : Number(event.target.value))}
              className="h-9 w-full appearance-none rounded-lg border border-slate-200 bg-slate-50 pl-3 pr-8 text-xs font-semibold text-slate-700 outline-none transition focus:border-blue-400 focus:bg-white focus:ring-4 focus:ring-blue-50"
              aria-label="เลือกกลุ่มย่อยที่ต้องการดู"
            >
              <option value="ALL">ดูทุกกลุ่ม ({groups.length})</option>
              {groups.map((g) => (
                <option key={g.key} value={g.num}>
                  กลุ่ม {g.num} · {groupSummaryText(g)} · {formatAmount(groupAmount(g))}
                </option>
              ))}
            </select>
            <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          </div>

          <div className="flex overflow-hidden rounded-lg border border-slate-200 bg-white">
            <button
              type="button"
              onClick={() => moveFocus(-1)}
              disabled={focusedIndex <= 0}
              className="flex size-9 items-center justify-center text-slate-500 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-200"
              title="กลุ่มก่อนหน้า"
            >
              <ChevronLeft size={15} />
            </button>
            <button
              type="button"
              onClick={() => moveFocus(1)}
              disabled={focusedIndex === groups.length - 1}
              className="flex size-9 items-center justify-center border-l border-slate-200 text-slate-500 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-200"
              title="กลุ่มถัดไป"
            >
              <ChevronRight size={15} />
            </button>
          </div>

        </div>
      </div>
    </div>
  );

  function toggleGroupByNum(num: number) {
    const group = groups.find((candidate) => candidate.num === num);
    if (group && group.status === "ACTIVE") onToggleGroup(group.key);
  }

  const sharedPanelProps = {
    showGroupChip: multiGroup && focusedIndex < 0,
    selectable: revertable,
    selectedNums,
    highlightNums,
    hasHighlight,
    onHoverGroup: setHoveredGroup,
    onToggleGroup: toggleGroupByNum,
  };

  let body: React.ReactNode;

  if (match.matchType === "OFFSET") {
    const inEntries = glEntries.filter((e) => e.line.direction === "IN");
    const outEntries = glEntries.filter((e) => e.line.direction === "OUT");
    const inTotal = inEntries.reduce((s, e) => (e.line.status === "ACTIVE" ? s + e.line.amount : s), 0);
    const outTotal = outEntries.reduce((s, e) => (e.line.status === "ACTIVE" ? s + e.line.amount : s), 0);
    const net = Math.round((inTotal - outTotal) * 100) / 100;
    const balanced = Math.abs(net) < AMOUNT_TOLERANCE;
    const kinds = new Set(activeGroups.map((g) => offsetKind(g.glLines)));

    body = (
      <TwoColumn
        left={
          <LinePanel
            tone="in"
            title="BC365 · ขาเข้า"
            subtitle={accountLabel || undefined}
            entries={inEntries}
            totalLabel="IN TOTAL"
            emptyText="ไม่มีรายการขาเข้า"
            {...sharedPanelProps}
          />
        }
        connector={
          <Connector>
            <ConnectorPill
              tone={balanced ? "ok" : "bad"}
              icon={<Scale size={12} />}
              label={`สุทธิ ${formatAmount(net)}`}
              title="หักล้างกันเอง: ขาเข้า − ขาออก ต้องเป็น 0.00 จึงไม่มีเงินผ่านธนาคาร"
            />
            {kinds.has("REVERSAL") && (
              <span className="hidden text-[10px] font-medium text-teal-600 lg:mt-1.5 lg:block">กลับรายการใน BC</span>
            )}
          </Connector>
        }
        right={
          <LinePanel
            tone="out"
            title="BC365 · ขาออก"
            subtitle={accountLabel || undefined}
            entries={outEntries}
            totalLabel="OUT TOTAL"
            emptyText="ไม่มีรายการขาออก"
            {...sharedPanelProps}
          />
        }
      />
    );
  } else if (match.matchType === "SUSPENSE" || match.matchType === "EXCLUDED") {
    const isSuspense = match.matchType === "SUSPENSE";
    const active = glEntries.filter((e) => e.line.status === "ACTIVE").map((e) => e.line);
    const { inTotal, outTotal } = splitByDirection(active);

    body = (
      <TwoColumn
        left={
          <LinePanel
            tone="bc"
            title="General Ledger (BC365)"
            subtitle={accountLabel || undefined}
            entries={glEntries}
            totalLabel="BC TOTAL"
            emptyText="ไม่มีรายการฝั่งนี้"
            {...sharedPanelProps}
          />
        }
        connector={
          <Connector>
            <ConnectorPill
              tone={isSuspense ? "warn" : "muted"}
              icon={isSuspense ? <ArrowRight size={12} /> : <Ban size={12} />}
              label={isSuspense ? "ยกไปพัก" : "ไม่จับคู่"}
              title={
                isSuspense
                  ? "ย้ายรายการ BC เข้าบัญชีพักโอน — ยังไม่มีคู่ฝั่ง Bank ในงวดนี้"
                  : "JV ปรับปรุงพักโอน — ตั้งใจไม่นำมาจับคู่กับ Bank เลย"
              }
            />
          </Connector>
        }
        right={
          isSuspense ? (
            <DestinationCard
              tone="amber"
              icon={<Wallet size={13} />}
              title="บัญชีพักโอน (Suspense)"
              subtitle="รอจับคู่กับ Bank ในงวดถัดไป"
              inTotal={inTotal}
              outTotal={outTotal}
              netLabel="ยอดพักสุทธิ"
              note="รายการฝั่งซ้ายถูกยกออกจากงวดนี้ไปพักไว้ก่อน จึงไม่มีฝั่ง Bank มาคู่ — ยอดสุทธินี้คือส่วนที่ทำให้ยอดคงเหลือ Bank กับ BC ต่างกัน"
              footer={
                <>
                  {" "}
                  <a href="/suspense" className="font-semibold underline underline-offset-2 hover:text-amber-950">
                    ดึงกลับ/จัดการที่หน้าพักโอน
                  </a>
                </>
              }
            />
          ) : (
            <DestinationCard
              tone="slate"
              icon={<Ban size={13} />}
              title="ไม่นำมาจับคู่กับ Bank"
              subtitle="JV ปรับปรุงพักโอนใน BC"
              inTotal={inTotal}
              outTotal={outTotal}
              netLabel="ผลต่อยอดพักโอน"
              note={
                match.remark
                  ? `เหตุผลที่บันทึกไว้: ${match.remark}`
                  : "รายการ BC ที่ไม่มีวันมีคู่ในธนาคาร เช่น JV ปรับปรุงยอดปลายงวด — ใช้ปิดยอดพักโอนโดยไม่ต้องรอ statement"
              }
            />
          )
        }
      />
    );
  } else {
    const balanced = Math.abs(summary.difference) < AMOUNT_TOLERANCE;

    body = (
      <TwoColumn
        left={
          <LinePanel
            tone="bank"
            title="Bank statement"
            subtitle={match.bankCode}
            entries={bankEntries}
            totalLabel="BANK TOTAL"
            emptyText="ไม่มีรายการฝั่งนี้"
            {...sharedPanelProps}
          />
        }
        connector={
          <Connector>
            <ConnectorPill
              tone={balanced ? "ok" : "warn"}
              icon={balanced ? <ArrowLeftRight size={12} /> : <Scale size={12} />}
              label={balanced ? "ยอดตรงกัน" : `ส่วนต่าง ${formatAmount(Math.abs(summary.difference))}`}
              title={
                balanced
                  ? "ยอดรวมสองฝั่งเท่ากัน"
                  : "จับคู่ทั้งที่ยอดสองฝั่งไม่เท่ากัน — ส่วนต่างถูกพักโอนไว้พร้อมหมายเหตุ"
              }
            />
            {!balanced && (
              <span className="hidden whitespace-nowrap text-[10px] font-medium text-amber-600 lg:mt-1.5 lg:block">
                พักโอน {formatSigned(summary.difference)}
              </span>
            )}
          </Connector>
        }
        right={
          <LinePanel
            tone="bc"
            title="General Ledger (BC365)"
            subtitle={accountLabel || undefined}
            entries={glEntries}
            totalLabel="BC TOTAL"
            emptyText="ไม่มีรายการฝั่งนี้"
            {...sharedPanelProps}
          />
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-3 border-t border-gray-100 bg-slate-50/70 p-3 sm:p-4">
      {groupStrip}
      {body}
      {match.remark && match.matchType !== "EXCLUDED" && (
        <p className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs text-amber-800">
          <span className="font-semibold">หมายเหตุตอนบันทึก:</span> {match.remark}
        </p>
      )}
    </div>
  );
}
