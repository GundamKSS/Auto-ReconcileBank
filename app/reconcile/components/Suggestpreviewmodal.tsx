"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  X,
  ChevronRight,
  Check,
  X as XIcon,
  Sparkles,
  ArrowDownLeft,
  ArrowUpRight,
  ArrowLeftRight,
  Loader2,
  Link2,
} from "lucide-react";
import { getCurrentUsername } from "../../../lib/currentUser";

type Direction = "IN" | "OUT";
type ClusterType = "ONE_TO_ONE" | "ONE_TO_MANY" | "MANY_TO_ONE";

type BankLine = { lineId: number; date: string; description: string; direction: Direction; amount: number };
type GlLine = { entryNo: number; date: string; ref: string; accountName: string; direction: Direction; amount: number };

export type Cluster = {
  clusterId: number;
  type: ClusterType;
  bankLines: BankLine[];
  glLines: GlLine[];
};

type FlatItem = {
  id: string;
  clusterId: number;
  type: ClusterType;
  date: string;
  label: string;
  direction: Direction;
  amount: number;
};

function formatAmount(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatDate(iso: string) {
  return new Date(iso).toISOString().slice(0, 10);
}

function DirectionBadge({ direction }: { direction: Direction }) {
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

function ClusterBadge({ clusterId, type, excluded }: { clusterId: number; type: ClusterType; excluded: boolean }) {
  const isGreen = type === "ONE_TO_ONE";
  const colorClass = excluded
    ? "bg-red-100 text-red-600"
    : isGreen
    ? "bg-green-100 text-green-700"
    : "bg-amber-100 text-amber-700";
  return <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${colorClass}`}>กลุ่ม {clusterId}</span>;
}

// checkbox วงกลม: เขียว/เหลือง = เลือกอยู่ (ตามประเภท) / แดง = ถูกเอาออกแล้ว (ไม่ใช่แค่ยังไม่เลือก เพราะทุกอย่าง
// เริ่มต้นถูกติ๊กไว้ให้หมดแล้วตั้งแต่แรก การ "ไม่ติ๊ก" ในหน้านี้แปลว่า "ปฏิเสธ" ไม่ใช่ค่าเริ่มต้นเฉยๆ
function CircleCheckbox({
  state,
  color,
  onClick,
}: {
  state: "full" | "partial" | "none";
  color: "green" | "amber" | "mixed";
  onClick: (e: React.MouseEvent) => void;
}) {
  if (state === "none") {
    return (
      <button
        onClick={onClick}
        className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 border border-red-400 bg-red-500"
      >
        <XIcon size={11} className="text-white" strokeWidth={3} />
      </button>
    );
  }
  const activeColor = color === "green" ? "bg-green-600 border-green-600" : color === "amber" ? "bg-amber-500 border-amber-500" : "bg-blue-600 border-blue-600";
  return (
    <button
      onClick={onClick}
      className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 border transition-colors ${activeColor}`}
    >
      {state === "full" && <Check size={12} className="text-white" strokeWidth={3} />}
      {state === "partial" && <span className="w-2 h-0.5 bg-white rounded" />}
    </button>
  );
}

function DateGroupRow({
  date,
  items,
  selectedClusterIds,
  onToggleClusters,
  expanded,
  onToggleExpand,
  rowRef,
  highlighted,
}: {
  date: string;
  items: FlatItem[];
  selectedClusterIds: Set<number>;
  onToggleClusters: (clusterIds: number[]) => void;
  expanded: boolean;
  onToggleExpand: () => void;
  rowRef?: (el: HTMLDivElement | null) => void;
  highlighted?: boolean;
}) {
  const total = items.reduce((s, i) => s + i.amount, 0);
  const clusterIdsHere = Array.from(new Set(items.map((i) => i.clusterId)));
  const selectedHere = clusterIdsHere.filter((id) => selectedClusterIds.has(id));
  const state: "full" | "partial" | "none" =
    selectedHere.length === 0 ? "none" : selectedHere.length === clusterIdsHere.length ? "full" : "partial";
  const allGreen = items.every((i) => i.type === "ONE_TO_ONE");
  const color = allGreen ? "green" : items.every((i) => i.type !== "ONE_TO_ONE") ? "amber" : "mixed";

  return (
    <div
      ref={rowRef}
      className={`border-b border-gray-50 last:border-b-0 transition-all duration-300 ${
        state === "none" ? "bg-red-50/40" : ""
      } ${highlighted ? "ring-2 ring-inset ring-blue-400 bg-blue-50/70" : ""}`}
    >
      <div className="flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 cursor-pointer" onClick={onToggleExpand}>
        <CircleCheckbox
          state={state}
          color={color}
          onClick={(e) => {
            e.stopPropagation();
            onToggleClusters(clusterIdsHere);
          }}
        />
        <ChevronRight
          size={13}
          className="text-gray-400 shrink-0 transition-transform duration-200"
          style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-gray-800 font-medium">{date}</span>
            <span className="text-[11px] text-gray-400">{items.length} รายการ</span>
            {state === "none" && (
              <span className="text-[10px] font-semibold text-red-600 bg-red-100 px-2 py-0.5 rounded-full">ไม่รวม</span>
            )}
          </div>
        </div>
        <span className="text-sm font-semibold text-gray-900 tabular-nums shrink-0">{formatAmount(total)}</span>
      </div>

      {expanded && (
        <div className="bg-gray-50/60 pl-11 pr-3 pb-2 flex flex-col gap-1">
          {items.map((item) => {
            const excluded = !selectedClusterIds.has(item.clusterId);
            return (
              <div
                key={item.id}
                className={`flex items-center gap-2 text-sm py-1.5 border-t border-gray-100 cursor-pointer transition-opacity ${
                  excluded ? "opacity-50" : ""
                }`}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleClusters([item.clusterId]);
                }}
              >
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleClusters([item.clusterId]);
                  }}
                  className={`w-4 h-4 rounded flex items-center justify-center shrink-0 border transition-colors ${
                    excluded ? "border-red-400 bg-red-500" : "border-green-500 bg-green-500"
                  }`}
                  title={excluded ? "คลิกเพื่อรวมกลับเข้าไปจับคู่" : "คลิกเพื่อเอาออกจากการจับคู่ (กลุ่มนี้ทั้งกลุ่ม)"}
                >
                  {excluded ? (
                    <XIcon size={10} className="text-white" strokeWidth={3} />
                  ) : (
                    <Check size={10} className="text-white" strokeWidth={3} />
                  )}
                </button>
                <DirectionBadge direction={item.direction} />
                <ClusterBadge clusterId={item.clusterId} type={item.type} excluded={excluded} />
                <span className="flex-1 min-w-0 truncate text-gray-700">{item.label}</span>
                <span className="tabular-nums text-gray-900">{formatAmount(item.amount)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PreviewPanel({
  title,
  items,
  selectedClusterIds,
  onToggleClusters,
  expandedDates,
  onToggleExpand,
  registerRowRef,
  highlightedDate,
}: {
  title: string;
  items: FlatItem[];
  selectedClusterIds: Set<number>;
  onToggleClusters: (clusterIds: number[]) => void;
  expandedDates: Set<string>;
  onToggleExpand: (date: string) => void;
  registerRowRef: (date: string, el: HTMLDivElement | null) => void;
  highlightedDate: string | null;
}) {
  const byDate = useMemo(() => {
    const map = new Map<string, FlatItem[]>();
    for (const item of items) {
      const d = formatDate(item.date);
      if (!map.has(d)) map.set(d, []);
      map.get(d)!.push(item);
    }
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [items]);

  const selectedCount = new Set(items.filter((i) => selectedClusterIds.has(i.clusterId)).map((i) => i.id)).size;

  return (
    <div className="flex flex-col border border-gray-200 rounded-xl overflow-hidden min-w-0 lg:h-full">
      <div className="px-3 py-2.5 border-b border-gray-100 shrink-0">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        <p className="text-xs text-gray-400">
          {selectedCount} selected · {items.length} รายการ
        </p>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto max-h-[320px] lg:max-h-none">
        {byDate.length === 0 && <div className="px-3 py-8 text-center text-sm text-gray-400">ไม่มีรายการ</div>}
        {byDate.map(([date, dateItems]) => (
          <DateGroupRow
            key={date}
            date={date}
            items={dateItems}
            selectedClusterIds={selectedClusterIds}
            onToggleClusters={onToggleClusters}
            expanded={expandedDates.has(date)}
            onToggleExpand={() => onToggleExpand(date)}
            rowRef={(el) => registerRowRef(date, el)}
            highlighted={highlightedDate === date}
          />
        ))}
      </div>
    </div>
  );
}

export default function SuggestPreviewModal({
  clusters,
  bankCode,
  directionFilter,
  onClose,
  onConfirmed,
}: {
  clusters: Cluster[];
  bankCode: string;
  directionFilter: Direction;
  onClose: () => void;
  onConfirmed: (message: string) => void;
}) {
  // กรองเอาแค่ทิศทางที่หน้าหลักกำลังดูอยู่ตอนนี้ (IN/OUT) ให้ preview ตรงกับ scope ที่กำลังทำงานอยู่
  const filteredClusters = useMemo(
    () => clusters.filter((c) => (c.bankLines[0] ?? c.glLines[0])?.direction === directionFilter),
    [clusters, directionFilter]
  );

  const [selected, setSelected] = useState<Set<number>>(new Set(filteredClusters.map((c) => c.clusterId)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // สวิชลิงค์วันที่: เปิด (ค่าเริ่มต้น) = กดคลี่ดูวันฝั่งไหน อีกฝั่งคลี่+เลื่อนตามให้อัตโนมัติ / ปิด = 2 ฝั่งอิสระต่อกัน
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

  const greenClusters = filteredClusters.filter((c) => c.type === "ONE_TO_ONE");
  const yellowClusters = filteredClusters.filter((c) => c.type !== "ONE_TO_ONE");

  const bankFlat: FlatItem[] = useMemo(
    () =>
      filteredClusters.flatMap((c) =>
        c.bankLines.map((l) => ({
          id: `bank-${l.lineId}`,
          clusterId: c.clusterId,
          type: c.type,
          date: l.date,
          label: l.description,
          direction: l.direction,
          amount: l.amount,
        }))
      ),
    [filteredClusters]
  );
  const glFlat: FlatItem[] = useMemo(
    () =>
      filteredClusters.flatMap((c) =>
        c.glLines.map((l) => ({
          id: `gl-${l.entryNo}`,
          clusterId: c.clusterId,
          type: c.type,
          date: l.date,
          label: `${l.ref} · ${l.accountName}`,
          direction: l.direction,
          amount: l.amount,
        }))
      ),
    [filteredClusters]
  );

  function toggleClusters(ids: number[]) {
    setSelected((prev) => {
      const next = new Set(prev);
      const allIn = ids.every((id) => next.has(id));
      ids.forEach((id) => (allIn ? next.delete(id) : next.add(id)));
      return next;
    });
  }
  function selectAll(ids: number[]) {
    setSelected((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      return next;
    });
  }
  function deselectAll(ids: number[]) {
    setSelected((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });
  }

  const selectedClusters = filteredClusters.filter((c) => selected.has(c.clusterId));
  const bankTotal = useMemo(
    () => selectedClusters.reduce((s, c) => s + c.bankLines.reduce((ss, l) => ss + l.amount, 0), 0),
    [selectedClusters]
  );
  const glTotal = useMemo(
    () => selectedClusters.reduce((s, c) => s + c.glLines.reduce((ss, l) => ss + l.amount, 0), 0),
    [selectedClusters]
  );
  const difference = bankTotal - glTotal;
  const amountMatches = Math.abs(difference) < 0.005;

  const allGreenSelected = greenClusters.length > 0 && greenClusters.every((c) => selected.has(c.clusterId));
  const allYellowSelected = yellowClusters.length > 0 && yellowClusters.every((c) => selected.has(c.clusterId));

  async function submit(matchType: "MATCHED" | "SUSPENSE") {
    // ส่งเฉพาะกลุ่มที่ยังติ๊กอยู่เท่านั้น (selectedClusters) — กลุ่มที่ถูกเอาออก (สีแดง) จะไม่ถูกส่งไปเลย
    if (selectedClusters.length === 0 || busy) return;
    setBusy(true);
    setError("");
    try {
      const groups = selectedClusters.map((c) => ({
        bankLineIds: c.bankLines.map((l) => l.lineId),
        glEntryNos: c.glLines.map((l) => l.entryNo),
      }));
      const res = await fetch("/api/reconcile/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bankCode, matchType, groups, createdBy: getCurrentUsername() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "บันทึกไม่สำเร็จ");
        return;
      }
      onConfirmed(
        matchType === "MATCHED"
          ? `ยืนยันจับคู่สำเร็จ ${selectedClusters.length} กลุ่ม (MatchId ${data.matchId})`
          : `ย้ายเข้าบัญชีพักโอนแล้ว ${selectedClusters.length} กลุ่ม (MatchId ${data.matchId})`
      );
    } catch {
      setError("เชื่อมต่อ server ไม่ได้");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm px-4 py-6">
      <div className="w-full max-w-5xl h-[90vh] bg-white rounded-2xl shadow-xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-blue-600" />
            <h2 className="text-base font-semibold text-gray-900">Preview: Suggest matches</h2>
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
              {directionFilter}
            </span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-3 border-b border-gray-100 shrink-0">
          <p className="text-sm text-gray-500 mb-3">
            พบ {filteredClusters.length} กลุ่มที่จับคู่ได้ (เฉพาะฝั่ง {directionFilter} ตามที่หน้าหลักกำลังดูอยู่) — ยังไม่บันทึกอะไรทั้งสิ้น
            คลิก checkbox เพื่อเอารายการที่ไม่ต้องการออก (จะกลายเป็นสีแดง) แล้วค่อยกดยืนยันด้านล่าง
          </p>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() =>
                  allGreenSelected
                    ? deselectAll(greenClusters.map((c) => c.clusterId))
                    : selectAll(greenClusters.map((c) => c.clusterId))
                }
                disabled={greenClusters.length === 0}
                className="text-xs font-medium text-green-700 bg-green-50 border border-green-200 px-3 py-1.5 rounded-full hover:bg-green-100 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {allGreenSelected ? "ยกเลิกเลือก" : "เลือกทั้งหมด"} · 1:1 ({greenClusters.length})
              </button>
              <button
                onClick={() =>
                  allYellowSelected
                    ? deselectAll(yellowClusters.map((c) => c.clusterId))
                    : selectAll(yellowClusters.map((c) => c.clusterId))
                }
                disabled={yellowClusters.length === 0}
                className="text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-full hover:bg-amber-100 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {allYellowSelected ? "ยกเลิกเลือก" : "เลือกทั้งหมด"} · lump sum ({yellowClusters.length})
              </button>
              <button
                onClick={() => deselectAll(yellowClusters.map((c) => c.clusterId))}
                disabled={yellowClusters.length === 0}
                className="text-xs font-medium text-gray-600 bg-gray-50 border border-gray-200 px-3 py-1.5 rounded-full hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
                title="ยกเลิกกลุ่ม lump sum ทั้งหมด เหลือไว้แค่ 1:1 สีเขียว"
              >
                เอาเฉพาะ 1:1 (ยกเลิก lump sum ทั้งหมด)
              </button>
            </div>

            <button
              onClick={() => setLinkDates((v) => !v)}
              className="flex items-center gap-2 text-xs font-medium text-blue-900 shrink-0"
              title="เปิด = กดคลี่ดูวันฝั่งไหน อีกฝั่งคลี่+เลื่อนตามให้อัตโนมัติ (อิงวันที่เดียวกัน)"
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
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto lg:overflow-hidden px-5 py-3">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 lg:h-full lg:min-h-0">
            <PreviewPanel
              title="Bank statement"
              items={bankFlat}
              selectedClusterIds={selected}
              onToggleClusters={toggleClusters}
              expandedDates={expandedBankDates}
              onToggleExpand={toggleBankExpand}
              registerRowRef={registerBankRowRef}
              highlightedDate={highlight?.side === "bank" ? highlight.date : null}
            />
            <PreviewPanel
              title="General Ledger (BC365)"
              items={glFlat}
              selectedClusterIds={selected}
              onToggleClusters={toggleClusters}
              expandedDates={expandedGlDates}
              onToggleExpand={toggleGlExpand}
              registerRowRef={registerGlRowRef}
              highlightedDate={highlight?.side === "gl" ? highlight.date : null}
            />
          </div>
        </div>

        <div className="px-5 py-4 border-t border-gray-100 shrink-0">
          {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-5 flex-wrap">
              <div>
                <p className="text-[11px] font-medium text-gray-400 tracking-wide">BANK TOTAL</p>
                <p className="text-sm font-semibold text-gray-900">{formatAmount(bankTotal)}</p>
              </div>
              <div>
                <p className="text-[11px] font-medium text-gray-400 tracking-wide">GL TOTAL</p>
                <p className="text-sm font-semibold text-gray-900">{formatAmount(glTotal)}</p>
              </div>
              <div>
                <p className="text-[11px] font-medium text-gray-400 tracking-wide">DIFFERENCE</p>
                <p className={`text-sm font-semibold ${amountMatches ? "text-green-600" : "text-red-600"}`}>
                  {formatAmount(difference)}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-medium text-gray-400 tracking-wide">เลือกไว้</p>
                <p className="text-sm font-semibold text-gray-900">
                  {selectedClusters.length} / {filteredClusters.length} กลุ่ม
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button onClick={onClose} className="text-sm text-gray-600 hover:bg-gray-50 px-4 py-2 rounded-full transition-colors">
                ยกเลิก
              </button>
              <button
                onClick={() => submit("SUSPENSE")}
                disabled={selectedClusters.length === 0 || busy}
                className="text-sm font-medium text-amber-700 bg-amber-50 border border-amber-200 px-4 py-2 rounded-full hover:bg-amber-100 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Move to suspense
              </button>
              <button
                onClick={() => submit("MATCHED")}
                disabled={selectedClusters.length === 0 || !amountMatches || busy}
                className="flex items-center gap-1.5 text-sm font-medium text-white bg-blue-600 px-5 py-2 rounded-full hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : <ArrowLeftRight size={14} />}
                ยืนยัน Match ({selectedClusters.length})
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}