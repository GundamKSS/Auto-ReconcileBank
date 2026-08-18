"use client";

import { useEffect, useMemo, useState } from "react";
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
} from "lucide-react";
import { useSidebar } from "@/components/SidebarContext";
import UnsuspendConfirmModal, { ConfirmLine } from "./UnsuspendConfirmModal";

type RawBankLine = {
  lineId: number;
  num: number;
  date: string;
  description?: string;
  direction: "IN" | "OUT";
  amount: number;
};
type RawGlLine = {
  entryNo: number;
  num: number;
  date: string;
  ref?: string;
  accountName?: string;
  direction: "IN" | "OUT";
  amount: number;
};

type MatchRecord = {
  matchId: number;
  bankCode: string;
  matchType: "MATCHED" | "SUSPENSE";
  createdBy: string | null;
  createdAt: string;
  bankLines: RawBankLine[];
  glLines: RawGlLine[];
};

type UnifiedLine = {
  key: string;
  matchId: number;
  sourceType: "BANK" | "GL";
  refId: number;
  num: number;
  date: string;
  detail: string;
  direction: "IN" | "OUT";
  amount: number;
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
function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
}
function formatDate(iso: string) {
  return new Date(iso).toISOString().slice(0, 10);
}

function toUnifiedLines(match: MatchRecord): UnifiedLine[] {
  const bank: UnifiedLine[] = match.bankLines.map((l) => ({
    key: `${match.matchId}:BANK:${l.lineId}`,
    matchId: match.matchId,
    sourceType: "BANK",
    refId: l.lineId,
    num: l.num,
    date: l.date,
    detail: l.description || "-",
    direction: l.direction,
    amount: l.amount,
  }));
  const gl: UnifiedLine[] = match.glLines.map((l) => ({
    key: `${match.matchId}:GL:${l.entryNo}`,
    matchId: match.matchId,
    sourceType: "GL",
    refId: l.entryNo,
    num: l.num,
    date: l.date,
    detail: [l.ref, l.accountName].filter(Boolean).join(" · ") || "-",
    direction: l.direction,
    amount: l.amount,
  }));
  return [...bank, ...gl];
}

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
        isIn ? "bg-teal-50 text-teal-700" : "bg-red-50 text-red-600"
      }`}
    >
      {isIn ? <ArrowDownLeft size={11} /> : <ArrowUpRight size={11} />}
      {direction}
    </span>
  );
}

function SourceTag({ sourceType }: { sourceType: "BANK" | "GL" }) {
  return (
    <span
      className={`text-[10px] font-semibold px-1.5 py-0.5 rounded whitespace-nowrap ${
        sourceType === "BANK" ? "bg-sky-100 text-sky-700" : "bg-violet-100 text-violet-700"
      }`}
    >
      {sourceType}
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
      initial={{ opacity: 0, y: -10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -10, scale: 0.98 }}
      transition={{ duration: 0.2 }}
      className="fixed top-5 right-5 z-[60] flex items-start gap-3 bg-white border border-green-200 shadow-lg rounded-xl px-4 py-3 max-w-sm"
    >
      <CheckCircle2 size={20} className="text-green-600 shrink-0 mt-0.5" />
      <p className="text-sm font-medium text-gray-900">{message}</p>
    </motion.div>
  );
}

function SubGroupTable({
  num,
  colorIdx,
  lines,
  selected,
  onToggleLine,
}: {
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
                  <input
                    type="checkbox"
                    checked={selected.has(l.key)}
                    onChange={() => onToggleLine(l.key)}
                    className="w-4 h-4 rounded border-gray-300"
                  />
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
  selected,
  onToggleLine,
  onToggleMatch,
  onRevertMatch,
}: {
  match: MatchRecord;
  selected: Set<string>;
  onToggleLine: (key: string) => void;
  onToggleMatch: (match: MatchRecord) => void;
  onRevertMatch: (match: MatchRecord) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const unified = useMemo(() => toUnifiedLines(match), [match]);
  const bankTotal = match.bankLines.reduce((s, l) => s + l.amount, 0);
  const glTotal = match.glLines.reduce((s, l) => s + l.amount, 0);

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
      <div className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50">
        <input
          type="checkbox"
          checked={allSelected}
          onChange={() => onToggleMatch(match)}
          onClick={(e) => e.stopPropagation()}
          className="w-4 h-4 rounded border-gray-300 shrink-0"
          title="เลือกทั้งหมดใน match นี้"
        />
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-3 flex-1 min-w-0 text-left"
        >
          {expanded ? (
            <ChevronDown size={14} className="text-gray-400 shrink-0" />
          ) : (
            <ChevronRight size={14} className="text-gray-400 shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-0.5">
              <span className="text-sm font-medium text-gray-900">Match #{match.matchId}</span>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                {match.bankCode}
              </span>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                SUSPENSE
              </span>
              <AgingBadge createdAt={match.createdAt} />
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                {nums.length} กลุ่มย่อย
              </span>
              {selectedCount > 0 && (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                  เลือก {selectedCount}
                </span>
              )}
            </div>
            <p className="text-xs text-gray-400">
              {formatDateTime(match.createdAt)} · Bank {match.bankLines.length} รายการ · GL {match.glLines.length}{" "}
              รายการ
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-sm font-semibold text-gray-900 tabular-nums">{formatAmount(bankTotal)}</p>
            {Math.abs(bankTotal - glTotal) >= 0.005 && (
              <p className="text-[11px] text-red-500">GL {formatAmount(glTotal)}</p>
            )}
          </div>
        </button>
        <button
          onClick={() => onRevertMatch(match)}
          className="flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-white hover:bg-blue-600 border border-blue-200 hover:border-blue-600 px-3 py-1.5 rounded-full transition-colors shrink-0"
        >
          <Undo2 size={13} />
          ดึงกลับไป Reconcile
        </button>
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
            <div className="border-t border-gray-100 p-3 flex flex-col gap-2 bg-gray-50/50">
              {nums.map((num, idx) => (
                <SubGroupTable
                  key={num}
                  num={num}
                  colorIdx={idx}
                  lines={unified.filter((l) => l.num === num)}
                  selected={selected}
                  onToggleLine={onToggleLine}
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [bankFilter, setBankFilter] = useState("ALL");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [searchText, setSearchText] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmLines, setConfirmLines] = useState<ConfirmLine[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/history?matchType=SUSPENSE");
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "โหลดข้อมูลไม่สำเร็จ");
        return;
      }
      setMatches(data.matches);
    } catch {
      setError("เชื่อมต่อ server ไม่ได้");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // fetch-on-mount ปกติ
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  const banks = ["ALL", ...Array.from(new Set(matches.map((m) => m.bankCode)))];
  const hasActiveFilters = Boolean(dateFrom || dateTo || searchText);

  const filtered = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return matches.filter((m) => {
      if (bankFilter !== "ALL" && m.bankCode !== bankFilter) return false;
      const d = formatDate(m.createdAt);
      if (dateFrom && d < dateFrom) return false;
      if (dateTo && d > dateTo) return false;
      if (q) {
        const hay = [
          String(m.matchId),
          ...m.bankLines.map((l) => l.description ?? ""),
          ...m.glLines.map((l) => `${l.ref ?? ""} ${l.accountName ?? ""}`),
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [matches, bankFilter, dateFrom, dateTo, searchText]);

  function clearFilters() {
    setDateFrom("");
    setDateTo("");
    setSearchText("");
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
    const keys = toUnifiedLines(match).map((l) => l.key);
    const allSelected = keys.length > 0 && keys.every((k) => selected.has(k));
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) keys.forEach((k) => next.delete(k));
      else keys.forEach((k) => next.add(k));
      return next;
    });
  }

  function openConfirmForMatch(match: MatchRecord) {
    setConfirmLines(toUnifiedLines(match).map(toConfirmLine));
  }

  function openConfirmForSelection() {
    const allUnified = matches.flatMap(toUnifiedLines);
    const lines = allUnified.filter((l) => selected.has(l.key)).map(toConfirmLine);
    if (lines.length > 0) setConfirmLines(lines);
  }

  function applyRevertLocally(revertedKeys: Set<string>) {
    setMatches((prev) =>
      prev
        .map((m) => ({
          ...m,
          bankLines: m.bankLines.filter((l) => !revertedKeys.has(`${m.matchId}:BANK:${l.lineId}`)),
          glLines: m.glLines.filter((l) => !revertedKeys.has(`${m.matchId}:GL:${l.entryNo}`)),
        }))
        .filter((m) => m.bankLines.length > 0 || m.glLines.length > 0)
    );
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
      applyRevertLocally(revertedKeys);
      setSelected((prev) => {
        const next = new Set(prev);
        revertedKeys.forEach((k) => next.delete(k));
        return next;
      });
      setToast(`ดึงกลับไป Reconcile สำเร็จ ${confirmLines.length} รายการ`);
      setConfirmLines(null);
    } catch {
      setError("เชื่อมต่อ server ไม่ได้");
    } finally {
      setBusy(false);
    }
  }

  const selectedCount = selected.size;
  const selectedTotal = useMemo(() => {
    const allUnified = matches.flatMap(toUnifiedLines);
    return allUnified.filter((l) => selected.has(l.key)).reduce((s, l) => s + l.amount, 0);
  }, [matches, selected]);

  return (
    <div className="flex-1 min-w-0 p-4 sm:p-6 pb-24">
      <h1 className="text-xl sm:text-2xl font-bold text-gray-900 mb-1">Suspense</h1>
      <p className="text-sm text-gray-500 mb-5">
        รายการที่พักไว้จากหน้า Reconcile — ติ๊กเลือกรายการแล้วกดดึงกลับไป Reconcile เพื่อคืนสถานะเป็น UNMATCHED แล้วไปจับคู่ใหม่ได้
      </p>

      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

      <div className="flex items-center gap-1.5 mb-4">
        {banks.map((b) => (
          <button
            key={b}
            onClick={() => setBankFilter(b)}
            className={`text-xs font-medium px-3 py-1.5 rounded-full transition-colors ${
              bankFilter === b ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
            }`}
          >
            {b}
          </button>
        ))}
      </div>

      <div className="mb-5 flex flex-wrap items-end gap-3 rounded-xl border border-gray-100 bg-gray-50/60 p-3.5">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wide pb-1.5">
          <SlidersHorizontal size={13} /> กรอง
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-gray-500">พักตั้งแต่วันที่</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white text-gray-700"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-gray-500">ถึงวันที่</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white text-gray-700"
          />
        </div>
        <div className="flex flex-col gap-1 flex-1 min-w-[180px]">
          <label className="text-[11px] font-medium text-gray-500">ค้นหา</label>
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="รายละเอียด, เลขอ้างอิง, Match #..."
              className="text-sm border border-gray-200 rounded-lg pl-7 pr-2.5 py-1.5 bg-white text-gray-700 w-full"
            />
          </div>
        </div>
        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 hover:bg-blue-50 px-2.5 py-1.5 rounded-lg transition-colors"
          >
            <X size={12} /> ล้างตัวกรอง
          </button>
        )}
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-gray-400 py-10 justify-center">
          <Loader2 size={16} className="animate-spin" /> กำลังโหลด...
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div className="text-center text-sm text-gray-400 py-10">
          {matches.length === 0 ? "ไม่มีรายการที่พักไว้" : "ไม่พบรายการที่ตรงกับตัวกรอง"}
        </div>
      )}

      <div className="flex flex-col gap-3">
        {filtered.map((m) => (
          <MatchCard
            key={m.matchId}
            match={m}
            selected={selected}
            onToggleLine={toggleLine}
            onToggleMatch={toggleMatch}
            onRevertMatch={openConfirmForMatch}
          />
        ))}
      </div>

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
              className="pointer-events-auto flex items-center gap-4 bg-gray-900 text-white rounded-full pl-5 pr-2 py-2 shadow-xl"
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
                ล้างเลือก
              </button>
              <button
                onClick={openConfirmForSelection}
                className="flex items-center gap-1.5 text-sm font-medium bg-blue-600 hover:bg-blue-500 active:scale-95 px-4 py-2 rounded-full transition-all"
              >
                <Undo2 size={14} />
                ดึงกลับไป Reconcile
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
