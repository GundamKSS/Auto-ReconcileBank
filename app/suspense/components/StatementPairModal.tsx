"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ArrowDownLeft, ArrowUpRight, CheckCircle2, Link2, Loader2, X } from "lucide-react";
import { formatAmount } from "../../../lib/formatAmount";
import type { ConfidenceLevel } from "../../../lib/matchAssistant";
import { MAX_PAIR_CANDIDATES, type PairCandidate, type PairReason, type PairSuggestion } from "../../../lib/suspenseSuggest";
import { formatDMY } from "../../reconcile/history/components/historyModel";

/** รายการ BC365 ที่พักไว้ ซึ่งผู้ใช้กดหาคู่ใน statement */
export type PairTarget = {
  matchId: number;
  entryNo: number;
  date: string;
  documentNo: string | null;
  direction: "IN" | "OUT";
  amount: number;
};

const LEVEL_STYLE: Record<ConfidenceLevel, { label: string; cls: string }> = {
  high: { label: "ความมั่นใจสูง", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  medium: { label: "ความมั่นใจปานกลาง", cls: "bg-amber-50 text-amber-700 ring-amber-200" },
  low: { label: "ความมั่นใจต่ำ", cls: "bg-slate-100 text-slate-500 ring-slate-200" },
};

const TONE_STYLE: Record<PairReason["tone"], string> = {
  good: "bg-emerald-50 text-emerald-700",
  warn: "bg-amber-50 text-amber-700",
  info: "bg-slate-100 text-slate-600",
};

// เดือนแบบที่ทีมบัญชีพูดกัน เช่น ต.ค. 2569 — statement คนละเดือนกับรายการพักต้องเห็นชัดว่าเป็นเดือนไหน
const monthFormatter = new Intl.DateTimeFormat("th-TH", { month: "short", year: "numeric", timeZone: "UTC" });
function monthLabel(iso: string) {
  return monthFormatter.format(new Date(`${iso}T00:00:00Z`));
}

function DirectionLabel({ direction }: { direction: "IN" | "OUT" }) {
  return direction === "IN" ? (
    <span className="inline-flex items-center gap-1 text-emerald-700"><ArrowDownLeft size={12} /> เงินเข้า</span>
  ) : (
    <span className="inline-flex items-center gap-1 text-rose-600"><ArrowUpRight size={12} /> เงินออก</span>
  );
}

function CandidateCard({ candidate, readOnly, onPick }: { candidate: PairCandidate; readOnly: boolean; onPick: () => void }) {
  const level = LEVEL_STYLE[candidate.level];
  return (
    <li className={`rounded-xl border p-3 ${candidate.recommended ? "border-emerald-300 bg-emerald-50/40" : "border-slate-200 bg-white"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="font-semibold text-slate-800">{formatDMY(candidate.bank.date)}</span>
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">
              {candidate.sameMonth ? "เดือนเดียวกับรายการพัก" : `statement เดือน ${monthLabel(candidate.bank.date)}`}
            </span>
            {candidate.recommended && (
              <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[11px] font-semibold text-white">แนะนำ</span>
            )}
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${level.cls}`}>{level.label}</span>
          </div>
          <p className="mt-1.5 break-words text-sm leading-relaxed text-slate-700">{candidate.bank.description || "ไม่มีรายละเอียด"}</p>
          {candidate.bank.chequeNo && <p className="mt-0.5 text-xs text-slate-500">เช็คเลขที่ {candidate.bank.chequeNo}</p>}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <span className="text-sm font-semibold tabular-nums text-slate-900">{formatAmount(candidate.bank.amount)}</span>
          <button
            type="button"
            onClick={onPick}
            disabled={readOnly}
            title={readOnly ? "ไม่มีสิทธิ์ AP หรือ AR ดูได้อย่างเดียว" : undefined}
            aria-label={`ใช่ รายการนี้ statement วันที่ ${formatDMY(candidate.bank.date)}`}
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-all hover:bg-blue-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100"
          >
            <CheckCircle2 size={13} /> ใช่ รายการนี้
          </button>
        </div>
      </div>
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {candidate.reasons.map((reason) => (
          <li key={reason.text} className={`rounded-full px-2 py-0.5 text-[11px] ${TONE_STYLE[reason.tone]}`}>{reason.text}</li>
        ))}
      </ul>
    </li>
  );
}

export default function StatementPairModal({
  target,
  readOnly,
  onClose,
  onPaired,
}: {
  target: PairTarget;
  readOnly: boolean;
  onClose: () => void;
  onPaired: (target: PairTarget, message: string) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [suggestion, setSuggestion] = useState<PairSuggestion | null>(null);
  const [chosen, setChosen] = useState<PairCandidate | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");

  // โหลดสดทุกครั้งที่เปิด ไม่ใช้ผลจากป้ายในตาราง เพราะป้ายมีแค่ตัวที่น่าจะใช่ที่สุดและอาจเก่าแล้ว
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/reconcile/suspense-pair?entryNos=${target.entryNo}&limit=${MAX_PAIR_CANDIDATES}`, { signal: controller.signal })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "หาคู่ใน statement ไม่สำเร็จ");
        const items: PairSuggestion[] = Array.isArray(data.items) ? data.items : [];
        const item = items.find((i) => i.entryNo === target.entryNo && i.matchId === target.matchId);
        if (!item) throw new Error("ไม่พบรายการพักนี้แล้ว อาจถูกคืนหรือจับคู่ไปแล้ว กรุณารีเฟรชหน้า");
        setSuggestion(item);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setLoadError(err instanceof Error ? err.message : "หาคู่ใน statement ไม่สำเร็จ");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [target.entryNo, target.matchId]);

  // กด Esc ปิดได้เหมือนหน้าต่างอื่นในหน้ากระทบยอด ยกเว้นระหว่างบันทึก
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function confirmPair() {
    if (!chosen || readOnly) return;
    setBusy(true);
    setActionError("");
    try {
      const res = await fetch("/api/reconcile/suspense-pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId: target.matchId, entryNo: target.entryNo, bankLineId: chosen.bank.lineId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error || "จับคู่กับ statement ไม่สำเร็จ");
        return;
      }
      onPaired(target, `จับคู่กับ statement วันที่ ${formatDMY(chosen.bank.date)} แล้ว`);
    } catch {
      setActionError("ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาตรวจสอบการเชื่อมต่อ");
    } finally {
      setBusy(false);
    }
  }

  const candidates = suggestion?.candidates ?? [];
  const total = suggestion?.total ?? 0;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4 backdrop-blur-md"
      onClick={() => !busy && onClose()}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 14 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 6, transition: { duration: 0.15 } }}
        transition={{ type: "spring", stiffness: 420, damping: 26 }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="statement-pair-title"
        className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-white/70 bg-white/80 shadow-2xl backdrop-blur-2xl backdrop-saturate-150"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-gray-100 px-5 py-4">
          <div className="min-w-0">
            <h2 id="statement-pair-title" className="text-base font-semibold text-gray-900">
              {chosen ? "ยืนยันจับคู่กับ statement" : "หาคู่ใน statement"}
            </h2>
            <p className="mt-0.5 text-xs text-gray-500">
              {chosen
                ? "ตรวจสองรายการนี้ให้แน่ใจก่อนบันทึก"
                : "ค้นหายอดเดียวกันใน statement ทุกเดือนของบัญชีนี้ ที่ยังไม่จับคู่"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => !busy && onClose()}
            aria-label="ปิด"
            disabled={busy}
            autoFocus
            className="text-gray-400 transition-transform hover:text-gray-600 active:scale-90 disabled:opacity-40"
          >
            <X size={18} />
          </button>
        </div>

        <div className="shrink-0 border-b border-gray-100 bg-violet-50/50 px-5 py-3">
          <p className="text-[11px] font-semibold text-violet-700">รายการพัก BC365</p>
          <div className="mt-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm">
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-slate-700">
              <span>{formatDMY(target.date)}</span>
              <span className="break-all font-medium">{target.documentNo || "ไม่มีเลขเอกสาร"}</span>
              <span className="text-xs"><DirectionLabel direction={target.direction} /></span>
            </div>
            <span className="font-semibold tabular-nums text-slate-900">{formatAmount(target.amount)}</span>
          </div>
          {suggestion?.closedPeriod && (
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
              รายการพักนี้อยู่ในงวด {formatDMY(suggestion.closedPeriod.periodStart)} ถึง {formatDMY(suggestion.closedPeriod.periodEnd)} ที่ปิดแล้ว
              จับคู่ได้ และยอดคงเหลือของงวดนั้นไม่เปลี่ยน แต่ถ้าจับคู่ผิด ต้องเปิดงวดนั้นคืนก่อนจึงจะยกเลิกได้
            </p>
          )}
        </div>

        <div className="flex-1 overflow-y-auto bg-white px-5 py-4">
          {loading ? (
            <p className="flex items-center justify-center gap-2 py-8 text-sm text-gray-400">
              <Loader2 size={16} className="animate-spin" /> กำลังหาใน statement...
            </p>
          ) : loadError ? (
            <p role="alert" className="py-6 text-center text-sm text-rose-600">{loadError}</p>
          ) : chosen ? (
            <div className="space-y-3">
              <table className="w-full text-sm">
                <thead className="text-[11px] text-gray-400">
                  <tr>
                    <th className="pb-2 text-left font-medium">ฝั่ง</th>
                    <th className="pb-2 text-left font-medium">วันที่</th>
                    <th className="pb-2 text-left font-medium">รายละเอียด</th>
                    <th className="pb-2 text-right font-medium">จำนวนเงิน</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  <tr>
                    <td className="py-2"><span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">BC365</span></td>
                    <td className="whitespace-nowrap py-2 text-gray-500">{formatDMY(target.date)}</td>
                    <td className="break-all py-2 text-gray-700">{target.documentNo || "ไม่มีเลขเอกสาร"}</td>
                    <td className="py-2 text-right tabular-nums text-gray-900">{formatAmount(target.amount)}</td>
                  </tr>
                  <tr>
                    <td className="py-2"><span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700">ธนาคาร</span></td>
                    <td className="whitespace-nowrap py-2 text-gray-500">{formatDMY(chosen.bank.date)}</td>
                    <td className="break-words py-2 text-gray-700">{chosen.bank.description || "ไม่มีรายละเอียด"}</td>
                    <td className="py-2 text-right tabular-nums text-gray-900">{formatAmount(chosen.bank.amount)}</td>
                  </tr>
                </tbody>
              </table>
              <p className="text-xs text-slate-500">บันทึกแล้ว รายการนี้จะออกจากรายการพัก และไปอยู่ในประวัติการจับคู่</p>
              {actionError && <p role="alert" className="text-sm text-rose-600">{actionError}</p>}
            </div>
          ) : candidates.length === 0 ? (
            <div className="py-6 text-center">
              <p className="text-sm text-slate-600">ยังไม่พบ statement ที่ยอดตรงกัน</p>
              <p className="mt-1 text-xs text-slate-400">นำเข้า statement เดือนถัดไปแล้ว ลองเปิดหน้านี้อีกครั้ง</p>
            </div>
          ) : (
            <>
              <ul className="space-y-2.5">
                {candidates.map((candidate) => (
                  <CandidateCard
                    key={candidate.bank.lineId}
                    candidate={candidate}
                    readOnly={readOnly}
                    onPick={() => {
                      setActionError("");
                      setChosen(candidate);
                    }}
                  />
                ))}
              </ul>
              {total > candidates.length && (
                <p className="mt-3 text-center text-xs text-slate-400">
                  แสดง {candidates.length.toLocaleString()} จาก {total.toLocaleString()} รายการที่ยอดตรงกัน
                </p>
              )}
            </>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 rounded-b-2xl border-t border-gray-100 bg-gray-50/60 px-5 py-4">
          {chosen ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setChosen(null);
                  setActionError("");
                }}
                disabled={busy}
                className="rounded-full px-4 py-2 text-sm text-gray-600 transition-all hover:bg-gray-100 active:scale-95 disabled:opacity-40"
              >
                ย้อนกลับ
              </button>
              <button
                type="button"
                onClick={confirmPair}
                disabled={busy || readOnly}
                className="flex items-center gap-1.5 rounded-full bg-blue-600 px-5 py-2 text-sm font-medium text-white transition-all hover:bg-blue-700 active:scale-95 disabled:opacity-50 disabled:active:scale-100"
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />}
                ยืนยันจับคู่
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="rounded-full px-4 py-2 text-sm text-gray-600 transition-all hover:bg-gray-100 active:scale-95"
            >
              ปิด
            </button>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
