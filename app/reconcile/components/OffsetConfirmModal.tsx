"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { ArrowDownLeft, ArrowUpRight, AlertCircle, Loader2, Lock, Scale, Search, X } from "lucide-react";
import { formatAmount } from "../../../lib/formatAmount";
import HelpTooltip from "../../../components/HelpTooltip";
import { REMARK_MAX_LENGTH, REMARK_MIN_LENGTH, remarkProblem } from "../../../lib/matchRemark";
import type { WorkApproval } from "../../../lib/periodWorkflow";

export type OffsetSelectionLine = {
  id: string;
  entryNo: number;
  date: string;
  ref: string;
  direction: "IN" | "OUT";
  amount: number;
  description?: string;
  accountNo?: string | null;
  accountName?: string | null;
};

function formatDMY(iso: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : iso;
}

function DirectionBadge({ direction }: { direction: "IN" | "OUT" }) {
  const isIn = direction === "IN";
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium border ${
        isIn ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-red-50 text-red-600 border-red-200"
      }`}
    >
      {isIn ? <ArrowDownLeft size={11} /> : <ArrowUpRight size={11} />}
      {direction}
    </span>
  );
}

// ค้นด้วยเลขเอกสาร วันที่ หรือยอดเงิน — ยอดพิมพ์มีหรือไม่มีจุลภาคก็ได้ (1,234.50 หรือ 1234.50)
export function matchesQuery(l: OffsetSelectionLine, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const digits = q.replace(/,/g, "");
  return (
    l.ref.toLowerCase().includes(q) ||
    l.date.includes(q) ||
    formatDMY(l.date).includes(q) ||
    (Boolean(l.description) && l.description!.toLowerCase().includes(q)) ||
    (digits !== "" && formatAmount(l.amount).replace(/,/g, "").includes(digits))
  );
}

function isLineLocked(
  line: OffsetSelectionLine | null,
  finalPeriodClosed: boolean,
  approvals: WorkApproval[]
): { locked: boolean; reason?: string } {
  if (!line) return { locked: false };
  if (finalPeriodClosed) {
    return { locked: true, reason: "งวดปิดแล้ว" };
  }
  const iso = line.date.slice(0, 10);
  const blocking = approvals.find(
    (a) => a.direction === line.direction && iso >= a.periodStart && iso <= a.periodEnd
  );
  if (blocking) {
    return { locked: true, reason: `ยืนยันงาน ${line.direction === "IN" ? "AR" : "AP"} แล้ว` };
  }
  return { locked: false };
}

/**
 * หักล้างเงินเข้ากับเงินออกใน BC365 (MatchType = 'OFFSET')
 *
 * ออกแบบตามหลักการเดียวกับหักล้างรายการธนาคาร (BankOffsetModal):
 * 1. ผู้ใช้เห็นเฉพาะฝั่งตัวเอง (AP เห็น OUT, AR เห็น IN)
 * 2. เมื่อเลือกรายการฝั่งตนเองแล้ว อีกฝั่งจะแสดงเฉพาะรายการที่ "ยอดเงินเท่ากันพอดี" เท่านั้น (ไม่เห็นรายการอื่นของอีกแผนก)
 * 3. มีช่องค้นหา (Search input) กล่องเดียว ค้นหาได้ทั้งเลขเอกสาร วันที่ หรือยอดเงิน
 * 4. บังคับระบุเหตุผลในการหักล้างเพื่อการตรวจสอบย้อนหลัง
 */
export default function OffsetConfirmModal({
  lines,
  initialSelectedIds = [],
  sourceDirection = "OUT",
  isMaster = false,
  finalPeriodClosed = false,
  approvals = [],
  busy = false,
  error = "",
  onCancel,
  onConfirm,
}: {
  lines: OffsetSelectionLine[];
  initialSelectedIds?: string[];
  sourceDirection?: "IN" | "OUT";
  isMaster?: boolean;
  finalPeriodClosed?: boolean;
  approvals?: WorkApproval[];
  busy?: boolean;
  error?: string;
  onCancel: () => void;
  onConfirm: (groups: number[][], reason: string) => Promise<void> | void;
}) {
  const [activeSourceDir, setActiveSourceDir] = useState<"IN" | "OUT">(sourceDirection);
  const oppositeDir = activeSourceDir === "IN" ? "OUT" : "IN";

  // ค่าเริ่มต้น: ถ้ามีการเลือกรายการไว้ก่อนเปิด modal
  const initialSource = useMemo(() => {
    return lines.find(
      (l) => initialSelectedIds.includes(l.id) && l.direction === activeSourceDir
    );
  }, [lines, initialSelectedIds, activeSourceDir]);

  const [sourceEntryNo, setSourceEntryNo] = useState<number | null>(() => initialSource?.entryNo ?? null);

  const initialCandidate = useMemo(() => {
    if (!initialSource) return null;
    return lines.find(
      (l) =>
        initialSelectedIds.includes(l.id) &&
        l.direction === oppositeDir &&
        Math.abs(l.amount - initialSource.amount) < 0.005
    );
  }, [lines, initialSelectedIds, initialSource, oppositeDir]);

  const [candidateEntryNo, setCandidateEntryNo] = useState<number | null>(() => initialCandidate?.entryNo ?? null);
  const [mobileTab, setMobileTab] = useState<"IN" | "OUT">(() => activeSourceDir);
  const [reason, setReason] = useState("");
  const [query, setQuery] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const locked = busy || submitting;

  useEffect(() => {
    const previous = document.activeElement;
    dialogRef.current?.focus();
    return () => {
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);

  const sourceLines = useMemo(
    () => lines.filter((l) => l.direction === activeSourceDir),
    [lines, activeSourceDir]
  );
  const selectedSource = useMemo(
    () => sourceLines.find((l) => l.entryNo === sourceEntryNo) ?? null,
    [sourceLines, sourceEntryNo]
  );

  // ฝั่งตรงข้าม: แสดงเฉพาะรายการที่ยอดเงินเท่ากันพอดีกับรายการต้นทางที่เลือก
  const candidateLines = useMemo(() => {
    if (!selectedSource) return [];
    return lines.filter(
      (l) => l.direction === oppositeDir && Math.abs(l.amount - selectedSource.amount) < 0.005
    );
  }, [lines, oppositeDir, selectedSource]);

  const selectedCandidate = useMemo(
    () => candidateLines.find((l) => l.entryNo === candidateEntryNo) ?? null,
    [candidateLines, candidateEntryNo]
  );

  const sourceLocked = isLineLocked(selectedSource, finalPeriodClosed, approvals);
  const candidateLocked = isLineLocked(selectedCandidate, finalPeriodClosed, approvals);

  const inTotal =
    (selectedSource?.direction === "IN" ? selectedSource.amount : 0) +
    (selectedCandidate?.direction === "IN" ? selectedCandidate.amount : 0);
  const outTotal =
    (selectedSource?.direction === "OUT" ? selectedSource.amount : 0) +
    (selectedCandidate?.direction === "OUT" ? selectedCandidate.amount : 0);
  const diff = Math.abs(inTotal - outTotal);

  let problem: string | null = null;
  if (!selectedSource) {
    problem = `เลือกรายการ${activeSourceDir === "IN" ? "เงินเข้า (AR)" : "เงินออก (AP)"}ก่อน`;
  } else if (!selectedCandidate) {
    problem = `เลือกคู่หักล้าง${oppositeDir === "IN" ? "เงินเข้า (AR)" : "เงินออก (AP)"}ที่ยอดเท่ากัน`;
  } else if (diff >= 0.005) {
    problem = `ยอดสองฝั่งต่างกัน ${formatAmount(diff)} บาท — ต้องเท่ากันพอดี`;
  } else if (sourceLocked.locked || candidateLocked.locked) {
    problem = sourceLocked.reason || candidateLocked.reason || "รายการอยู่ในงวดที่ปิดแล้ว";
  } else if (remarkProblem(reason)) {
    problem = remarkProblem(reason);
  }

  const canConfirm = !locked && problem === null && selectedSource !== null && selectedCandidate !== null;

  function clearSelection() {
    if (locked) return;
    setSourceEntryNo(null);
    setCandidateEntryNo(null);
    setSubmitError("");
  }

  function pickSource(entryNo: number) {
    if (locked) return;
    const isSelecting = sourceEntryNo !== entryNo;
    setSourceEntryNo((prev) => (prev === entryNo ? null : entryNo));
    setCandidateEntryNo(null);
    setSubmitError("");
    if (isSelecting) {
      setMobileTab(oppositeDir);
    }
  }

  async function confirm() {
    if (!canConfirm || !selectedSource || !selectedCandidate || submitting) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      await onConfirm([[selectedSource.entryNo, selectedCandidate.entryNo]], reason.trim());
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "หักล้างรายการไม่สำเร็จ");
    } finally {
      setSubmitting(false);
    }
  }

  function renderColumn(direction: "IN" | "OUT") {
    const isSource = direction === activeSourceDir;
    const list = isSource ? sourceLines : candidateLines;
    const selectedId = isSource ? sourceEntryNo : candidateEntryNo;

    const visible = list.filter(
      (line) =>
        line.entryNo === selectedId ||
        matchesQuery(line, query)
    );

    const title = direction === "IN" ? "เงินเข้า (AR)" : "เงินออก (AP)";

    return (
      <section aria-label={title} className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-3 py-2.5">
          <h3 className="flex items-center gap-2 text-xs font-semibold text-gray-700">
            <DirectionBadge direction={direction} />
            {title}
          </h3>
          <span className="text-[11px] text-gray-400">
            {isSource ? `${visible.length} รายการ` : selectedSource ? `${visible.length} รายการที่ยอดตรงกัน` : "0 รายการ"} · เลือก {selectedId ? 1 : 0}
          </span>
        </div>
        <p className="border-b border-gray-100 px-3 py-2 text-[11px] text-gray-500">
          {isSource
            ? "เลือกรายการจากฝั่งที่กำลังทำงาน"
            : "คู่ยอดเท่ากันในบัญชีเดียวกัน · วันที่ต่างกันได้"}
        </p>
        <div className="max-h-[32vh] overflow-y-auto md:max-h-[42vh]">
          {!isSource && !selectedSource ? (
            <p className="px-3 py-8 text-center text-xs text-gray-400">
              เลือกรายการ{activeSourceDir === "IN" ? "เงินเข้า (AR)" : "เงินออก (AP)"}ก่อน เพื่อค้นหาอีกฝั่ง
            </p>
          ) : visible.length === 0 ? (
            <p className="px-3 py-8 text-center text-xs text-gray-400">
              {query
                ? "ไม่มีรายการตรงกับคำค้น"
                : isSource
                ? "ไม่มีรายการในฝั่งนี้"
                : "ไม่พบคู่หักล้างที่ยอดเท่ากัน"}
            </p>
          ) : (
            visible.map((line) => {
              const picked = selectedId === line.entryNo;
              const lockInfo = isLineLocked(line, finalPeriodClosed, approvals);
              const blocked = lockInfo.locked;

              const isGreen = direction === "IN";
              return (
                <label
                  key={line.entryNo}
                  className={`flex items-start gap-2.5 border-t border-gray-50 px-3 py-3 transition-colors first:border-t-0 ${
                    blocked
                      ? "cursor-not-allowed bg-gray-50 opacity-60"
                      : picked
                      ? isGreen
                        ? "bg-emerald-50/70"
                        : "bg-red-50/70"
                      : isGreen
                      ? "cursor-pointer hover:bg-emerald-50/30"
                      : "cursor-pointer hover:bg-red-50/30"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={picked}
                    disabled={locked || blocked}
                    aria-label={`เลือก${title} ${line.ref}`}
                    onChange={() => {
                      if (isSource) {
                        pickSource(line.entryNo);
                      } else {
                        setCandidateEntryNo(picked ? null : line.entryNo);
                        setSubmitError("");
                      }
                    }}
                    className={`mt-1 h-4 w-4 shrink-0 rounded border-gray-300 ${
                      isGreen ? "accent-emerald-600" : "accent-red-600"
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                      <span className="text-[11px] tabular-nums text-gray-400">{formatDMY(line.date)}</span>
                      <span className="text-sm font-semibold tabular-nums text-gray-900">{formatAmount(line.amount)}</span>
                    </div>
                    <p className="mt-0.5 break-words text-sm font-medium text-gray-800">{line.ref}</p>
                    {line.description && line.description !== line.ref && (
                      <p className="break-words text-xs text-gray-600">{line.description}</p>
                    )}
                    {blocked && (
                      <p className="mt-1 flex items-start gap-1 text-[11px] text-red-600">
                        <Lock size={12} className="mt-0.5 shrink-0" />
                        {lockInfo.reason || "งวดปิดแล้ว"}
                      </p>
                    )}
                  </div>
                </label>
              );
            })
          )}
        </div>
      </section>
    );
  }

  const modal = (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-3 py-4 backdrop-blur-md sm:px-4 sm:py-6"
      onClick={() => {
        if (!locked) onCancel();
      }}
    >
      <motion.div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="gl-offset-title"
        initial={{ opacity: 0, scale: 0.94, y: 14 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        className="flex max-h-[92dvh] w-full min-w-0 max-w-4xl flex-col overflow-hidden rounded-2xl border border-white/70 bg-white/95 shadow-2xl backdrop-blur-2xl outline-none"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            if (!locked) onCancel();
          }
          if (event.key === "Tab") {
            const nodes = dialogRef.current?.querySelectorAll<HTMLElement>(
              'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex="0"]'
            );
            const first = nodes?.[0];
            const last = nodes?.[nodes?.length - 1];
            if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-gray-100 px-4 py-4 sm:px-5">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-teal-50 text-teal-600">
              <Scale size={18} />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 id="gl-offset-title" className="text-base font-semibold text-gray-900">
                  หักล้างเงินเข้ากับเงินออกใน BC365
                </h2>
                <HelpTooltip label="วิธีหักล้างรายการ BC365">
                  ใช้กับรายการกลับบัญชี (Reversal) หรือคีย์ผิดฝั่งใน BC365 ที่หักล้างกันเองจนสุทธิเป็นศูนย์ ไม่มีเงินผ่านธนาคาร ต้องระบุเหตุผล และห้ามหักล้างรายการในงวดปิด
                </HelpTooltip>
              </div>
              <p className="mt-0.5 text-xs text-gray-500">เลือกเงินเข้าและเงินออกอย่างละ 1 รายการที่ยอดเท่ากัน</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={locked}
            aria-label="ปิดหน้าต่าง"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 disabled:opacity-40"
          >
            <X size={18} />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-gray-50/60 px-3 py-4 sm:px-5">
          <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <span>ยอดเงินเข้าและเงินออกต้องเท่ากันพอดีและอยู่ในบัญชีเดียวกัน</span>
          </div>

          {/* แถบสลับฝั่งเริ่มต้น (เฉพาะ MASTER ที่มีสิทธิ์ทั้งสองฝั่ง) */}
          {isMaster && (
            <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600">
              <span className="font-medium text-gray-700">ฝั่งเริ่มต้น:</span>
              <button
                type="button"
                disabled={locked}
                onClick={() => {
                  if (activeSourceDir !== "IN") {
                    setActiveSourceDir("IN");
                    setSourceEntryNo(null);
                    setCandidateEntryNo(null);
                  }
                }}
                className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                  activeSourceDir === "IN"
                    ? "bg-emerald-600 text-white shadow-sm hover:bg-emerald-700"
                    : "bg-gray-100 text-gray-600 hover:bg-emerald-50 hover:text-emerald-700"
                }`}
              >
                เงินเข้า (AR)
              </button>
              <button
                type="button"
                disabled={locked}
                onClick={() => {
                  if (activeSourceDir !== "OUT") {
                    setActiveSourceDir("OUT");
                    setSourceEntryNo(null);
                    setCandidateEntryNo(null);
                  }
                }}
                className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                  activeSourceDir === "OUT"
                    ? "bg-red-600 text-white shadow-sm hover:bg-red-700"
                    : "bg-gray-100 text-gray-600 hover:bg-red-50 hover:text-red-700"
                }`}
              >
                เงินออก (AP)
              </button>
            </div>
          )}

          {/* ช่องค้นหาช่องเดียว ค้นหาได้ทั้งสองฝั่ง */}
          <div className="relative min-w-0">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              aria-label="ค้นหารายการหักล้าง BC365"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="ค้นหาเลขเอกสาร วันที่ หรือยอดเงิน"
              className="min-h-11 w-full min-w-0 rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm text-gray-700 focus:border-teal-500 focus:outline-none"
            />
          </div>
          <p className="text-[11px] text-gray-500">รายการที่เลือกไว้จะแสดงเสมอ แม้ไม่ตรงกับคำค้น</p>

          {/* สลับแท็บสำหรับหน้าจอมือถือ (ซ่อนเมื่อจอ md ขึ้นไป) */}
          <div className="flex md:hidden rounded-xl border border-gray-200 bg-gray-100 p-1 gap-1">
            <button
              type="button"
              onClick={() => setMobileTab("IN")}
              className={`flex-1 rounded-lg py-2 text-xs font-semibold transition-all flex items-center justify-center gap-1.5 ${
                mobileTab === "IN"
                  ? "bg-white text-emerald-700 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              <DirectionBadge direction="IN" />
              <span>เงินเข้า (AR)</span>
              {(activeSourceDir === "IN" ? sourceEntryNo !== null : candidateEntryNo !== null) && (
                <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800">
                  เลือก 1
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setMobileTab("OUT")}
              className={`flex-1 rounded-lg py-2 text-xs font-semibold transition-all flex items-center justify-center gap-1.5 ${
                mobileTab === "OUT"
                  ? "bg-white text-red-700 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              <DirectionBadge direction="OUT" />
              <span>เงินออก (AP)</span>
              {(activeSourceDir === "OUT" ? sourceEntryNo !== null : candidateEntryNo !== null) && (
                <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-800">
                  เลือก 1
                </span>
              )}
            </button>
          </div>

          <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2">
            <div className={mobileTab === "IN" ? "block" : "hidden md:block"}>
              {renderColumn("IN")}
            </div>
            <div className={mobileTab === "OUT" ? "block" : "hidden md:block"}>
              {renderColumn("OUT")}
            </div>
          </div>

          <div>
            <label htmlFor="gl-offset-reason" className="mb-1.5 block text-xs font-medium text-gray-700">
              เหตุผลในการหักล้าง <span className="text-red-600">*</span>
            </label>
            <textarea
              id="gl-offset-reason"
              rows={2}
              value={reason}
              disabled={locked}
              maxLength={REMARK_MAX_LENGTH}
              onChange={(event) => setReason(event.target.value)}
              placeholder={`เช่น รายการกลับบัญชี หรือคีย์ผิดฝั่งใน BC365 (อย่างน้อย ${REMARK_MIN_LENGTH} ตัวอักษร)`}
              className="w-full resize-y rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 disabled:opacity-50 focus:border-teal-500 focus:outline-none"
            />
          </div>

          {(submitError || error) && (
            <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-600">
              {submitError || error}
            </p>
          )}
        </div>

        <footer className="flex shrink-0 flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 border-t border-gray-100 bg-white px-4 py-3 sm:px-5">
          <div aria-live="polite" className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-3 sm:gap-x-4 gap-y-1 text-xs text-gray-500">
              <span>
                ขาเข้า <b className="tabular-nums text-gray-900">{formatAmount(inTotal)}</b>
              </span>
              <span>
                ขาออก <b className="tabular-nums text-gray-900">{formatAmount(outTotal)}</b>
              </span>
              <span>
                สุทธิ{" "}
                <b
                  className={`tabular-nums ${
                    selectedSource && selectedCandidate && diff < 0.005 ? "text-teal-700" : "text-red-600"
                  }`}
                >
                  {formatAmount(diff)}
                </b>
              </span>
            </div>
            {problem && <p className="mt-1 text-[11px] text-amber-700">{problem}</p>}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {(sourceEntryNo !== null || candidateEntryNo !== null) && (
              <button
                type="button"
                onClick={clearSelection}
                disabled={locked}
                className="min-h-10 px-2 text-xs text-gray-500 hover:text-gray-800 disabled:opacity-40"
              >
                ล้างที่เลือก
              </button>
            )}
            <button
              type="button"
              onClick={onCancel}
              disabled={locked}
              className="min-h-10 rounded-full border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
            >
              ปิด
            </button>
            <button
              type="button"
              onClick={() => void confirm()}
              disabled={!canConfirm}
              title={problem ?? undefined}
              className="flex min-h-10 items-center justify-center gap-1.5 rounded-full bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-40"
            >
              {locked ? <Loader2 size={14} className="animate-spin" /> : <Scale size={14} />}
              ยืนยันหักล้าง{selectedCandidate ? " 2 รายการ" : ""}
            </button>
          </div>
        </footer>
      </motion.div>
    </motion.div>
  );

  return createPortal(modal, document.body);
}
