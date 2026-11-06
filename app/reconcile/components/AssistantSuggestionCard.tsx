"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { formatAmount } from '../../../lib/formatAmount';
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleCheck,
  Copy,
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

function formatDMY(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
function gapLabel(dayGap: number) {
  if (dayGap === 0) return "วันเดียวกัน";
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
        <span className="text-[10px] font-semibold tracking-wide text-sky-700">รายการธนาคาร</span>
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
              {[bank.senderBank, bank.senderAccountNo, bank.senderAccountName].some(Boolean) && (
                <p className="truncate text-[10px] text-sky-700 font-mono">
                  {[bank.senderBank, bank.senderAccountNo, bank.senderAccountName].filter(Boolean).join(" · ")}
                </p>
              )}
            </div>
            <span className="shrink-0 text-xs font-semibold tabular-nums text-gray-800">
              {formatAmount(bank.amount)}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex items-center justify-between border-t border-sky-200/70 pt-2">
        <span className="text-[10px] font-semibold text-sky-700">ยอดรวมธนาคาร</span>
        <span className="text-lg font-semibold tabular-nums text-gray-900">{formatAmount(total)}</span>
      </div>
    </div>
  );
}

// การ์ด 1 ใบ = Bank 1 รายการหรือหลายรายการ กับ GL ที่ยอดรวมตรงกันแต่คนละวัน (หรือคนละบัญชี)
export default function AssistantSuggestionCard({
  suggestion,
  index,
  bankCode,
  bankAccountNo,
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
  bankCode?: string;
  bankAccountNo?: string | null;
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
  const [copied, setCopied] = useState(false);
  const { banks } = suggestion;
  const bank = banks[0];
  const matched = status === "matched";
  const bankUnavailable = !matched && banks.some((item) => consumedBank.has(item.lineId));

  // GL ที่การ์ดใบอื่นจับคู่ไปแล้วต้องหายไปจากตัวเลือก — กันกด Match GL ตัวเดียวซ้ำ 2 คู่
  const available = matched
    ? suggestion.candidates
    : suggestion.candidates.filter((c) => !consumedGl.has(c.gl.entryNo));
  const selected = available.find((c) => c.gl.entryNo === selectedEntryNo) ?? available[0];
  const isCrossDirection = Boolean(selected?.crossDirection);
  const isCrossAccountBank = Boolean(suggestion.crossAccountBank);
  const isCrossAccountGl = Boolean(selected?.crossAccount);
  const isCrossAccount = isCrossAccountGl || isCrossAccountBank;
  const isBlocked = isCrossAccount || isCrossDirection;

  async function copyIssueNotice() {
    if (!selected) return;
    const activeAcc = [bankCode, bankAccountNo].filter(Boolean).join(" · ") || "บัญชีปัจจุบัน";
    let text = "";

    if (isCrossDirection) {
      const bankDir = bank.direction === "IN" ? "เงินเข้า (CR)" : "เงินออก (DR)";
      const glDir = selected.gl.direction === "IN" ? "เงินเข้า (CR)" : "เงินออก (DR)";
      text = [
        `แจ้งตรวจสอบรายการ BC365 อาจบันทึกผิดฝั่ง (เดบิต/เครดิตสลับด้าน):`,
        `- รายการ Statement (${activeAcc}): วันที่ ${formatDMY(bank.date)} ยอด ${formatAmount(bank.amount)} บาท [${bankDir}] ${bank.description ? `(${bank.description})` : ""}`.trim(),
        `- พบใน BC365 บันทึกเป็น [${glDir}]: เลขที่เอกสาร ${selected.gl.documentNo || "-"} (Entry #${selected.gl.entryNo}) วันที่ ${formatDMY(selected.gl.date)} ยอด ${formatAmount(selected.gl.amount)} บาท`,
        `กรุณาตรวจสอบว่ามีการลงบัญชีกลับด้าน (สลับ DR/CR) หรือไม่ หากผิดกรุณา Reverse/ปรับปรุงใน BC365 ให้ถูกต้อง`,
      ].join("\n");
    } else if (isCrossAccountBank) {
      text = [
        `แจ้งตรวจสอบรายการ BC365 พบ Statement อยู่ต่างบัญชี:`,
        `- ใน BC365 ลงไว้ที่บัญชีนี้ (${activeAcc}): เลขที่เอกสาร ${selected.gl.documentNo || "-"} (Entry #${selected.gl.entryNo}) วันที่ ${formatDMY(selected.gl.date)} ยอด ${formatAmount(selected.gl.amount)} บาท (${selected.gl.direction})`,
        `- แต่พบยอดตรงกันใน Statement ของบัญชี ${bank.accountNo ?? "ต่างบัญชี"}: วันที่ ${formatDMY(bank.date)} ยอด ${formatAmount(bank.amount)} บาท (${bank.direction}) ${bank.description ? `(${bank.description})` : ""}`.trim(),
        `กรุณาตรวจสอบว่าใน BC365 ลงบัญชีธนาคารผิด หรือ Statement เข้าผิดบัญชี`,
      ].join("\n");
    } else if (isCrossAccountGl) {
      const wrongAcc = [selected.gl.bankCode, selected.gl.accountNo, selected.gl.accountName]
        .filter(Boolean)
        .join(" · ");
      text = [
        `แจ้งตรวจสอบรายการ BC365 อาจลงผิดบัญชีธนาคาร:`,
        `- รายการ Statement (${activeAcc}): วันที่ ${formatDMY(bank.date)} ยอด ${formatAmount(bank.amount)} บาท (${bank.direction}) ${bank.description ? `(${bank.description})` : ""}`.trim(),
        `- พบใน BC365 บัญชี ${wrongAcc}: เลขที่เอกสาร ${selected.gl.documentNo || "-"} (Entry #${selected.gl.entryNo}) วันที่ ${formatDMY(selected.gl.date)} ยอด ${formatAmount(selected.gl.amount)} บาท`,
        `กรุณาตรวจสอบและแก้ไขรหัสธนาคารใน BC365 ให้ตรงกับ Statement แล้วดึงข้อมูลใหม่`,
      ].join("\n");
    }

    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore clipboard failure silently
    }
  }

  if (status === "skipped") {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-gray-200 bg-gray-50/60 px-4 py-2.5 text-xs text-gray-400">
        <span className="truncate">
          ข้ามแล้ว · ธนาคาร {banks.length > 1 ? `${banks.length} รายการ · รวม ${formatAmount(banks.reduce((s, b) => s + b.amount, 0))}` : `${formatDMY(bank.date)} · ${formatAmount(bank.amount)}`}
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
          คำแนะนำนี้ใช้ไม่ได้แล้ว เนื่องจากรายการธนาคารในกลุ่มถูกจับคู่แล้ว
        </span>
        <CheckCircle2 size={14} className="shrink-0 text-green-500" />
      </div>
    );
  }

  const DirIcon = bank.direction === "IN" ? ArrowDownLeft : ArrowUpRight;

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: 14, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 380, damping: 30, delay: Math.min(index * 0.04, 0.3) }}
      className={`rounded-2xl border p-4 shadow-sm transition-colors ${
        matched
          ? "border-green-200 bg-green-50/70"
          : isCrossDirection
          ? "border-rose-200 bg-rose-50/20 hover:shadow-md"
          : isCrossAccount
          ? "border-amber-200 bg-amber-50/20 hover:shadow-md"
          : "border-gray-200 bg-white hover:shadow-md"
      }`}
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        {selected ? (
          <ConfidenceRing score={selected.score} />
        ) : (
          <span className="text-xs text-gray-400">ไม่มีตัวเลือกเหลือ</span>
        )}
        <div className="flex items-center gap-2 flex-wrap">
          {isCrossDirection && selected && (
            <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2.5 py-0.5 text-[11px] font-semibold text-rose-800 ring-1 ring-inset ring-rose-300">
              <TriangleAlert size={11} className="shrink-0" />
              บันทึกผิดฝั่ง ({selected.gl.direction === "IN" ? "BC365 เงินเข้า" : "BC365 เงินออก"})
            </span>
          )}
          {isCrossAccount && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-inset ring-amber-300">
              <TriangleAlert size={11} className="shrink-0" />
              {isCrossAccountBank
                ? `Statement อยู่ต่างบัญชี · ${bank.accountNo ?? "อื่น"}`
                : `BC365 อยู่ต่างบัญชี · ${selected?.gl.accountNo}`}
            </span>
          )}
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
            sub={[
              [bank.senderBank, bank.senderAccountNo, bank.senderAccountName].filter(Boolean).join(" · ") || null,
              bank.channel ? `ช่องทาง ${bank.channel}` : null,
            ]
              .filter(Boolean)
              .join(" · ") || null}
            amount={bank.amount}
            badge={
              isCrossAccountBank ? (
                <span className="text-[10px] font-semibold text-amber-800 bg-amber-100 border border-amber-200 px-1.5 py-0.5 rounded">
                  ต่างบัญชี: {bank.accountNo}
                </span>
              ) : undefined
            }
          />
        )}
        <div className="flex sm:flex-col items-center justify-center gap-1.5 py-1">
          <span
            className="flex size-8 items-center justify-center rounded-full text-white shadow-[0_0_16px_rgba(139,92,246,0.35)]"
            style={{
              background: matched
                ? "#16a34a"
                : isCrossDirection
                ? "#e11d48"
                : isCrossAccount
                ? "#d97706"
                : "linear-gradient(135deg,#8b5cf6,#3b82f6,#22d3ee)",
            }}
          >
            {matched ? (
              <CheckCircle2 size={15} />
            ) : isBlocked ? (
              <TriangleAlert size={14} />
            ) : (
              <ArrowLeftRight size={14} />
            )}
          </span>
          {selected && (
            <span
              className={`text-[11px] font-semibold tabular-nums whitespace-nowrap ${
                isCrossDirection
                  ? "text-rose-700"
                  : isCrossAccount
                  ? "text-amber-700"
                  : "text-violet-700"
              }`}
            >
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
              [selected.gl.bankCode, selected.gl.accountNo, selected.gl.accountName].filter(Boolean).join(" · ")
            }
            amount={selected.gl.amount}
            badge={
              <div className="flex items-center gap-1">
                {selected.crossDirection && (
                  <span className="text-[10px] font-semibold text-rose-800 bg-rose-100 border border-rose-200 px-1.5 py-0.5 rounded">
                    ผิดฝั่ง ({selected.gl.direction})
                  </span>
                )}
                {selected.crossAccount && (
                  <span className="text-[10px] font-semibold text-amber-800 bg-amber-100 border border-amber-200 px-1.5 py-0.5 rounded">
                    ต่างบัญชี
                  </span>
                )}
                {selected.outsidePeriod && (
                  <span className="text-[10px] font-semibold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">
                    นอกงวด
                  </span>
                )}
              </div>
            }
          />
        ) : (
          <div className="flex items-center justify-center rounded-xl border border-dashed border-gray-200 px-3 py-4 text-center text-xs text-gray-400">
            รายการ BC365 ที่เคยแนะนำถูกจับคู่กับรายการอื่นในรอบนี้แล้ว
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
            เลือกรายการ BC365 อื่นที่ยอดเท่ากัน ({available.length})
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
                    <span className="flex-1 min-w-0 truncate text-gray-500">
                      {c.gl.documentNo}
                      {c.crossDirection && (
                        <span className="ml-1.5 rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-800">
                          ผิดฝั่ง ({c.gl.direction})
                        </span>
                      )}
                      {c.crossAccount && (
                        <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                          ต่างบัญชี: {c.gl.accountNo}
                        </span>
                      )}
                    </span>
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
        ) : isCrossDirection ? (
          <div className="flex w-full flex-wrap items-center justify-between gap-2 rounded-xl border border-rose-200 bg-rose-50/80 px-3 py-2">
            <p className="text-xs font-medium text-rose-800">
              ⚠️ ห้ามจับคู่ข้ามฝั่ง — Statement กับ BC365 ลงทิศทางตรงกันข้าม (เดบิต/เครดิตสลับด้าน) กรุณาตรวจสอบและปรับปรุงใน BC365
            </p>
            <button
              type="button"
              onClick={copyIssueNotice}
              className="inline-flex items-center gap-1.5 rounded-full border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold text-rose-800 shadow-xs transition-colors hover:bg-rose-100"
            >
              {copied ? <Check size={13} className="text-green-600" /> : <Copy size={13} />}
              {copied ? "คัดลอกแล้ว" : "คัดลอกแจ้งแก้ BC365"}
            </button>
          </div>
        ) : isCrossAccount ? (
          <div className="flex w-full flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-2">
            <p className="text-xs font-medium text-amber-800">
              {isCrossAccountBank
                ? "⚠️ ห้ามจับคู่ — รายการ Statement นี้อยู่ต่างบัญชีธนาคาร กรุณาตรวจสอบว่าลง BC365 ถูกบัญชีหรือไม่"
                : "⚠️ ห้ามจับคู่ข้ามบัญชี — กรุณาแก้รหัสธนาคารใน BC365 ให้ตรงก่อนแล้วกดดึงข้อมูลใหม่"}
            </p>
            <button
              type="button"
              onClick={copyIssueNotice}
              className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-800 shadow-xs transition-colors hover:bg-amber-100"
            >
              {copied ? <Check size={13} className="text-green-600" /> : <Copy size={13} />}
              {copied ? "คัดลอกแล้ว" : "คัดลอกแจ้งแก้ BC365"}
            </button>
          </div>
        ) : (
          <button
            onClick={() => selected && onMatch(selected.gl.entryNo)}
            disabled={!selected || busy}
            className="flex items-center gap-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 active:scale-95 px-4 py-2 rounded-full transition-all disabled:opacity-40 disabled:active:scale-100"
          >
            {status === "matching" ? <Loader2 size={14} className="animate-spin" /> : <ArrowLeftRight size={14} />}
            ยืนยันจับคู่
          </button>
        )}
      </div>
    </motion.div>
  );
}
