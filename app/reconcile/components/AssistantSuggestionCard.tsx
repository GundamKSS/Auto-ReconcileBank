"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  CircleCheck,
  EyeOff,
  Info,
  Loader2,
  TriangleAlert,
  Undo2,
} from "lucide-react";
import {
  confidenceLevel,
  type AssistantReason,
  type AssistantSuggestion,
  type ConfidenceLevel,
} from "../../../lib/matchAssistant";

export type CardStatus = "open" | "matching" | "matched" | "skipped";

const LEVEL_STYLE: Record<ConfidenceLevel, { label: string; ring: string; text: string }> = {
  high: { label: "ความมั่นใจสูง", ring: "#16a34a", text: "text-green-700" },
  medium: { label: "ความมั่นใจปานกลาง", ring: "#f59e0b", text: "text-amber-700" },
  low: { label: "ความมั่นใจต่ำ", ring: "#9ca3af", text: "text-gray-500" },
};

function formatAmount(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatDMY(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
function gapLabel(dayGap: number) {
  return `${dayGap > 0 ? "+" : "−"}${Math.abs(dayGap)} วัน`;
}

function ConfidenceRing({ score }: { score: number }) {
  const style = LEVEL_STYLE[confidenceLevel(score)];
  const r = 17;
  const circumference = 2 * Math.PI * r;
  return (
    <div className="flex items-center gap-2">
      <div className="relative size-11 shrink-0">
        <svg viewBox="0 0 44 44" className="size-full -rotate-90">
          <circle cx="22" cy="22" r={r} fill="none" stroke="#f3f4f6" strokeWidth="4" />
          <motion.circle
            cx="22"
            cy="22"
            r={r}
            fill="none"
            stroke={style.ring}
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset: circumference * (1 - score / 100) }}
            transition={{ duration: 0.8, ease: "easeOut", delay: 0.15 }}
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-[11px] font-bold text-gray-900 tabular-nums">
          {score}%
        </span>
      </div>
      <span className={`text-xs font-semibold ${style.text}`}>{style.label}</span>
    </div>
  );
}

function ReasonChip({ reason }: { reason: AssistantReason }) {
  const { cls, Icon } =
    reason.tone === "good"
      ? { cls: "bg-green-50 text-green-700 border-green-100", Icon: CircleCheck }
      : reason.tone === "warn"
      ? { cls: "bg-amber-50 text-amber-700 border-amber-100", Icon: TriangleAlert }
      : { cls: "bg-blue-50 text-blue-700 border-blue-100", Icon: Info };
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border ${cls}`}>
      <Icon size={11} className="shrink-0" />
      {reason.text}
    </span>
  );
}

function SideBox({
  side,
  date,
  refText,
  detail,
  sub,
  amount,
  badge,
}: {
  side: "bank" | "gl";
  date: string;
  refText: string;
  detail: string;
  sub?: string | null;
  amount: number;
  badge?: React.ReactNode;
}) {
  const isBank = side === "bank";
  return (
    <div
      className={`min-w-0 rounded-xl border px-3 py-2.5 ${
        isBank ? "border-sky-100 bg-sky-50/50" : "border-violet-100 bg-violet-50/50"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={`text-[10px] font-semibold tracking-wide ${isBank ? "text-sky-700" : "text-violet-700"}`}>
          {isBank ? "BANK STATEMENT" : "GL (BC365)"}
        </span>
        {badge}
      </div>
      <p className="mt-1 text-sm font-medium text-gray-900 truncate">
        {date} <span className="text-xs font-normal text-gray-400">· {refText}</span>
      </p>
      <p className="text-xs text-gray-500 truncate" title={detail}>
        {detail}
      </p>
      {sub && (
        <p className="text-[11px] text-gray-400 truncate" title={sub}>
          {sub}
        </p>
      )}
      <p className="mt-1 text-lg font-semibold text-gray-900 tabular-nums">{formatAmount(amount)}</p>
    </div>
  );
}

function BankGroupBox({ banks }: { banks: AssistantSuggestion["banks"] }) {
  const total = banks.reduce((sum, bank) => sum + bank.amount, 0);
  return (
    <div className="min-w-0 rounded-xl border border-sky-100 bg-sky-50/50 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold tracking-wide text-sky-700">BANK STATEMENT</span>
        <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-700">
          รวม {banks.length} รายการ
        </span>
      </div>
      <div className="mt-1.5 divide-y divide-sky-100/80">
        {banks.map((bank) => (
          <div key={bank.lineId} className="flex items-start justify-between gap-3 py-1.5 first:pt-0">
            <div className="min-w-0">
              <p className="text-xs font-medium text-gray-800">
                {formatDMY(bank.date)} <span className="font-normal text-gray-400">· {bank.ref}</span>
              </p>
              <p className="truncate text-[11px] text-gray-400" title={bank.description}>
                {bank.description || "-"}
              </p>
            </div>
            <span className="shrink-0 text-xs font-semibold tabular-nums text-gray-800">
              {formatAmount(bank.amount)}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex items-center justify-between border-t border-sky-200/70 pt-2">
        <span className="text-[10px] font-semibold text-sky-700">ยอดรวม BANK</span>
        <span className="text-lg font-semibold tabular-nums text-gray-900">{formatAmount(total)}</span>
      </div>
    </div>
  );
}

// การ์ด 1 ใบ = Bank 1 รายการหรือหลายรายการ กับ GL ที่ยอดรวมตรงกันแต่คนละวัน
export default function AssistantSuggestionCard({
  suggestion,
  index,
  selectedEntryNo,
  consumedGl,
  consumedBank,
  status,
  matchId,
  error,
  busy,
  onSelect,
  onMatch,
  onSkip,
  onUndoSkip,
}: {
  suggestion: AssistantSuggestion;
  index: number;
  selectedEntryNo: number | null;
  consumedGl: Set<number>; // GL ที่ถูกจับคู่ไปแล้วในรอบนี้ (จากการ์ดใบอื่น)
  consumedBank: Set<number>; // Bank ที่ถูกใช้โดยการ์ด 1:1 หรือ N:1 ใบอื่นแล้ว
  status: CardStatus;
  matchId?: number;
  error?: string;
  busy: boolean; // มีการ์ดใบไหนกำลังบันทึกอยู่
  onSelect: (entryNo: number) => void;
  onMatch: (entryNo: number) => void;
  onSkip: () => void;
  onUndoSkip: () => void;
}) {
  const [showAlternatives, setShowAlternatives] = useState(false);
  const { banks } = suggestion;
  const bank = banks[0];
  const matched = status === "matched";
  const bankUnavailable = !matched && banks.some((item) => consumedBank.has(item.lineId));

  // GL ที่การ์ดใบอื่นจับคู่ไปแล้วต้องหายไปจากตัวเลือก — กันกด Match GL ตัวเดียวซ้ำ 2 คู่
  const available = matched
    ? suggestion.candidates
    : suggestion.candidates.filter((c) => !consumedGl.has(c.gl.entryNo));
  const selected = available.find((c) => c.gl.entryNo === selectedEntryNo) ?? available[0];

  if (status === "skipped") {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-gray-200 bg-gray-50/60 px-4 py-2.5 text-xs text-gray-400">
        <span className="truncate">
          ข้ามแล้ว · Bank {banks.length > 1 ? `${banks.length} รายการ · รวม ${formatAmount(banks.reduce((s, b) => s + b.amount, 0))}` : `${formatDMY(bank.date)} · ${formatAmount(bank.amount)}`}
        </span>
        <button
          onClick={onUndoSkip}
          className="flex items-center gap-1 font-medium text-gray-600 hover:text-gray-900 shrink-0"
        >
          <Undo2 size={12} /> ย้อนกลับ
        </button>
      </div>
    );
  }

  if (bankUnavailable) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-gray-200 bg-gray-50/60 px-4 py-2.5 text-xs text-gray-400">
        <span className="truncate">
          ใช้ไม่ได้แล้ว · Bank ในกลุ่มนี้ถูกจับคู่จากคำแนะนำใบอื่นแล้ว
        </span>
        <CheckCircle2 size={14} className="shrink-0 text-green-500" />
      </div>
    );
  }

  const DirIcon = bank.direction === "IN" ? ArrowDownLeft : ArrowUpRight;

  return (
    <motion.div
      initial={{ opacity: 0, y: 14, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 380, damping: 30, delay: Math.min(index * 0.06, 0.5) }}
      className={`rounded-2xl border p-4 shadow-sm transition-colors ${
        matched ? "border-green-200 bg-green-50/70" : "border-gray-200 bg-white hover:shadow-md"
      }`}
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        {selected ? (
          <ConfidenceRing score={selected.score} />
        ) : (
          <span className="text-xs text-gray-400">ไม่มีตัวเลือกเหลือ</span>
        )}
        <div className="flex items-center gap-2">
          {suggestion.kind === "N:1" && (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-200">
              รวมยอด {banks.length}:1
            </span>
          )}
          <span
            className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full ${
              bank.direction === "IN" ? "bg-purple-50 text-purple-700" : "bg-red-50 text-red-600"
            }`}
          >
            <DirIcon size={11} />
            {bank.direction}
          </span>
          {status === "open" && (
            <button
              onClick={onSkip}
              disabled={busy}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 px-2 py-1 rounded-full hover:bg-gray-100 disabled:opacity-40"
              title="ซ่อนการ์ดนี้ไว้ก่อน ไม่จับคู่"
            >
              <EyeOff size={12} /> ข้าม
            </button>
          )}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-stretch gap-2">
        {banks.length > 1 ? (
          <BankGroupBox banks={banks} />
        ) : (
          <SideBox
            side="bank"
            date={formatDMY(bank.date)}
            refText={bank.ref}
            detail={bank.description || "-"}
            sub={bank.channel ? `ช่องทาง ${bank.channel}` : null}
            amount={bank.amount}
          />
        )}
        <div className="flex sm:flex-col items-center justify-center gap-1.5 py-1">
          <span
            className="flex size-8 items-center justify-center rounded-full text-white shadow-[0_0_16px_rgba(139,92,246,0.35)]"
            style={{ background: matched ? "#16a34a" : "linear-gradient(135deg,#8b5cf6,#3b82f6,#22d3ee)" }}
          >
            {matched ? <CheckCircle2 size={15} /> : <ArrowLeftRight size={14} />}
          </span>
          {selected && (
            <span className="text-[11px] font-semibold text-violet-700 tabular-nums whitespace-nowrap">
              {banks.length > 1 ? `สูงสุด ${Math.abs(selected.dayGap)} วัน` : gapLabel(selected.dayGap)}
            </span>
          )}
        </div>
        {selected ? (
          <SideBox
            side="gl"
            date={formatDMY(selected.gl.date)}
            refText={selected.gl.documentNo || `#${selected.gl.entryNo}`}
            detail={
              selected.gl.accountName ? `${selected.gl.accountNo} · ${selected.gl.accountName}` : selected.gl.accountNo
            }
            amount={selected.gl.amount}
            badge={
              selected.outsidePeriod ? (
                <span className="text-[10px] font-semibold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">นอกงวด</span>
              ) : null
            }
          />
        ) : (
          <div className="flex items-center justify-center rounded-xl border border-dashed border-gray-200 px-3 py-4 text-center text-xs text-gray-400">
            GL ที่เป็นไปได้ถูกจับคู่กับรายการอื่นในรอบนี้แล้ว
          </div>
        )}
      </div>

      {selected && !matched && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {selected.reasons.map((r) => (
            <ReasonChip key={r.text} reason={r} />
          ))}
        </div>
      )}

      {!matched && available.length > 1 && (
        <div className="mt-3">
          <button
            onClick={() => setShowAlternatives((v) => !v)}
            className="flex items-center gap-1 text-xs font-medium text-violet-700 hover:text-violet-900"
          >
            <ChevronDown size={14} className={`transition-transform ${showAlternatives ? "rotate-180" : ""}`} />
            เลือก GL ยอดเท่ากันตัวอื่น ({available.length})
          </button>
          {showAlternatives && (
            <div className="mt-2 flex flex-col gap-1">
              {available.map((c) => {
                const active = c.gl.entryNo === selected?.gl.entryNo;
                return (
                  <button
                    key={c.gl.entryNo}
                    onClick={() => onSelect(c.gl.entryNo)}
                    disabled={busy}
                    className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-left text-xs transition-colors disabled:opacity-50 ${
                      active ? "border-violet-300 bg-violet-50" : "border-gray-100 hover:bg-gray-50"
                    }`}
                  >
                    <span
                      className={`size-3.5 shrink-0 rounded-full border-2 ${
                        active ? "border-violet-600 bg-violet-600 shadow-[inset_0_0_0_2px_white]" : "border-gray-300"
                      }`}
                    />
                    <span className="w-20 shrink-0 font-medium text-gray-800">{formatDMY(c.gl.date)}</span>
                    <span className="flex-1 min-w-0 truncate text-gray-500">{c.gl.documentNo}</span>
                    <span className="shrink-0 text-violet-700 tabular-nums">{gapLabel(c.dayGap)}</span>
                    <span
                      className={`shrink-0 w-10 text-right font-semibold tabular-nums ${
                        LEVEL_STYLE[confidenceLevel(c.score)].text
                      }`}
                    >
                      {c.score}%
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="mt-3 flex items-center justify-end gap-3 flex-wrap">
        {error && <p className="mr-auto text-xs text-red-600">{error}</p>}
        {matched ? (
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-green-700">
            <CheckCircle2 size={16} /> จับคู่แล้ว · MatchId {matchId}
          </span>
        ) : (
          <button
            onClick={() => selected && onMatch(selected.gl.entryNo)}
            disabled={!selected || busy}
            className="flex items-center gap-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 active:scale-95 px-4 py-2 rounded-full transition-all disabled:opacity-40 disabled:active:scale-100"
          >
            {status === "matching" ? <Loader2 size={14} className="animate-spin" /> : <ArrowLeftRight size={14} />}
            Match คู่นี้
          </button>
        )}
      </div>
    </motion.div>
  );
}
