"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { ArrowDownLeft, ArrowUpRight, AlertCircle, Loader2, Lock, Scale, Search, X } from "lucide-react";
import { formatAmount } from "../../../lib/formatAmount";
import HelpTooltip from "../../../components/HelpTooltip";
import { bankOffsetSelection, type BankOffsetLookup } from "../../../lib/bankOffsetSelection";
import { REMARK_MAX_LENGTH, REMARK_MIN_LENGTH } from "../../../lib/matchRemark";

export type BankModalLine = {
  id: string;
  lineId: number;
  bankCode: string;
  accountNo: string | null;
  date: string;
  ref: string;
  direction: "IN" | "OUT";
  description: string;
  amount: number;
  senderBank?: string | null;
  senderAccountNo?: string | null;
  senderAccountName?: string | null;
  isOffset?: boolean;
  offsetMatchId?: number | null;
  offsetNum?: number | null;
  offsetRemark?: string | null;
  offsetBy?: string | null;
  offsetCounterpartRef?: string | null;
  offsetCounterpartDate?: string | null;
  offsetCounterpartDescription?: string | null;
};

type DisplayLine = Omit<BankModalLine, 'id' | 'accountNo' | 'description'> & {
  description: string | null;
  isPeriodClosed?: boolean;
  closedReason?: string | null;
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

export default function BankOffsetModal({
  isOpen,
  onClose,
  initialLine,
  availableLines,
  sourceDirection,
  isMaster = false,
  busy,
  onConfirm,
  onRequestUndoOffset,
}: {
  isOpen: boolean;
  onClose: () => void;
  initialLine: BankModalLine | null;
  availableLines: BankModalLine[];
  sourceDirection: "IN" | "OUT";
  isMaster?: boolean;
  busy: boolean;
  onConfirm: (sourceLineId: number, targetLineId: number, reason: string) => Promise<void>;
  onRequestUndoOffset?: (info: { matchId: number; num: number; ref: string; amount: number; remark: string | null }) => void;
}) {
  const [sourceId, setSourceId] = useState<number | null>(() => initialLine?.direction === sourceDirection && !initialLine?.isOffset ? initialLine.lineId : null);
  const [lookup, setLookup] = useState<BankOffsetLookup | null>(null);
  const [candidateId, setCandidateId] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [query, setQuery] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [retry, setRetry] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [activeSourceDir, setActiveSourceDir] = useState<"IN" | "OUT">(() => sourceDirection);
  const [mobileTab, setMobileTab] = useState<"IN" | "OUT">(() => sourceDirection);
  const submittingRef = useRef(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const locked = busy || submitting;
  const sources = availableLines
    .filter((line) => line.direction === activeSourceDir)
    .sort((a, b) => (a.isOffset ? 1 : 0) - (b.isOffset ? 1 : 0));
  const selectedSource = sources.find((line) => line.lineId === sourceId && !line.isOffset) ?? null;
  const currentSourceId = selectedSource?.lineId ?? null;

  function switchSourceDir(dir: "IN" | "OUT") {
    if (locked || dir === activeSourceDir) return;
    setActiveSourceDir(dir);
    setMobileTab(dir);
    setSourceId(null);
    setCandidateId(null);
    setLookup(null);
    setSubmitError('');
  }

  useEffect(() => {
    if (!isOpen || currentSourceId === null) return;
    const controller = new AbortController();
    const lineId = currentSourceId;
    async function load() {
      try {
        const res = await fetch(`/api/reconcile/bank-offset-candidates?lineId=${lineId}`, { cache: 'no-store', signal: controller.signal });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'ดึงรายการหักล้างไม่สำเร็จ');
        if (!controller.signal.aborted) setLookup({ sourceLineId: lineId, sourceLine: data.sourceLine,
          candidates: data.candidates || [], error: '' });
      } catch (err) {
        if (!controller.signal.aborted) setLookup({ sourceLineId: lineId, sourceLine: null, candidates: [],
          error: err instanceof Error ? err.message : 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้' });
      }
    }
    void load();
    return () => controller.abort();
  }, [isOpen, currentSourceId, retry]);

  useEffect(() => {
    if (!isOpen) return;
    const previous = document.activeElement;
    dialogRef.current?.focus();
    return () => { if (previous instanceof HTMLElement) previous.focus(); };
  }, [isOpen]);

  const selection = bankOffsetSelection(currentSourceId, lookup, candidateId, reason);
  const loading = currentSourceId !== null && !selection.current;
  const candidates = selection.current?.candidates ?? [];
  const canConfirm = !locked && !loading && !selection.problem;
  // Never retain the previous counterpart's amount while a new source is loading.
  const inTotal = selection.source ? selection.inTotal : selectedSource?.direction === 'IN' ? selectedSource.amount : 0;
  const outTotal = selection.source ? selection.outTotal : selectedSource?.direction === 'OUT' ? selectedSource.amount : 0;
  const search = query.trim().toLowerCase();

  function clearSelection() {
    if (locked) return;
    setSourceId(null); setCandidateId(null); setLookup(null); setSubmitError('');
  }
  function pickSource(lineId: number) {
    if (locked) return;
    const isSelecting = sourceId !== lineId;
    setSourceId((previous) => (previous === lineId ? null : lineId));
    setCandidateId(null);
    setLookup(null);
    setSubmitError('');
    if (isSelecting) {
      setMobileTab(activeSourceDir === 'IN' ? 'OUT' : 'IN');
    }
  }
  async function confirm() {
    if (!canConfirm || !selection.source || !selection.candidate || submittingRef.current) return;
    submittingRef.current = true; setSubmitting(true); setSubmitError('');
    try { await onConfirm(selection.source.lineId, selection.candidate.lineId, reason.trim()); }
    catch (err) { setSubmitError(err instanceof Error ? err.message : 'หักล้างรายการไม่สำเร็จ'); }
    finally { submittingRef.current = false; setSubmitting(false); }
  }

  function renderColumn(direction: 'IN' | 'OUT') {
    const isSource = direction === activeSourceDir;
    const list: DisplayLine[] = isSource ? sources.map((line) => ({ ...line,
      isPeriodClosed: line.lineId === selection.source?.lineId && selection.source.isPeriodClosed,
      closedReason: line.lineId === selection.source?.lineId ? selection.source.closedReason : null,
    })) : candidates.map((line) => ({ ...line, ref: line.chequeNo ? `Chq ${line.chequeNo}` : `L-${line.lineId}` }));
    const selectedId = isSource ? currentSourceId : selection.candidate?.lineId;
    const visible = list.filter((line) => line.lineId === selectedId || !search ||
      [line.ref, `L-${line.lineId}`, line.description, line.date, formatDMY(line.date), String(line.amount), formatAmount(line.amount),
        line.senderBank, line.senderAccountNo, line.senderAccountName, line.offsetRemark, line.offsetCounterpartRef].some((value) => value?.toLowerCase().includes(search)));
    const title = direction === 'IN' ? 'เงินเข้า (AR)' : 'เงินออก (AP)';
    const subtitle = direction === 'IN' ? 'Credit' : 'Debit';
    const isGreen = direction === 'IN';
    return <section aria-label={title} className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-3 py-2.5">
        <h3 className="flex items-center gap-2 text-xs font-semibold text-gray-700">
          <DirectionBadge direction={direction} />
          {title} <span className="text-[10px] font-normal text-gray-400">({subtitle})</span>
        </h3>
        <span className="text-[11px] text-gray-400">{visible.length} รายการ · เลือก {selectedId ? 1 : 0}</span>
      </div>
      <p className="border-b border-gray-100 px-3 py-2 text-[11px] text-gray-500">{isSource
        ? 'เลือกรายการจากฝั่งที่กำลังทำงาน'
        : 'คู่ยอดเท่ากันในบัญชีเดียวกัน · วันที่ต่างกันได้'}</p>
      <div className="max-h-[32vh] overflow-y-auto md:max-h-[42vh]">
        {!isSource && loading ? <p role="status" className="flex items-center justify-center gap-2 px-3 py-8 text-xs text-gray-500"><Loader2 size={14} className="animate-spin" />กำลังค้นหาคู่หักล้าง…</p>
          : !isSource && selection.current?.error ? <div role="alert" className="space-y-2 p-3 text-xs text-red-600"><p>{selection.current.error}</p><button type="button" disabled={locked} onClick={() => { setLookup(null); setCandidateId(null); setRetry((n) => n + 1); }} className="min-h-10 rounded-lg border border-red-200 px-3 disabled:opacity-40">ลองใหม่</button></div>
          : visible.length === 0 ? <p className="px-3 py-8 text-center text-xs text-gray-400">{!isSource && !selectedSource
            ? `เลือกรายการ${activeSourceDir === 'IN' ? 'เงินเข้า' : 'เงินออก'}ก่อน เพื่อค้นหาอีกฝั่ง`
            : search ? 'ไม่มีรายการตรงกับคำค้น' : isSource ? 'ไม่มีรายการในฝั่งนี้' : 'ไม่พบคู่หักล้างที่ยอดเท่ากัน'}</p>
          : visible.map((line) => {
            const isOffset = Boolean(line.isOffset);
            const picked = !isOffset && selectedId === line.lineId;
            const blocked = Boolean(line.isPeriodClosed) || isOffset;
            const sender = [line.senderBank, line.senderAccountNo, line.senderAccountName].filter(Boolean).join(' · ');
            return <label key={line.lineId} className={`flex items-start gap-2.5 border-t border-gray-50 px-3 py-3 transition-colors first:border-t-0 ${isOffset ? 'cursor-not-allowed bg-slate-100/90 text-slate-400' : blocked ? 'cursor-not-allowed bg-gray-50 opacity-60' : picked ? (isGreen ? 'bg-emerald-50/70' : 'bg-red-50/70') : (isGreen ? 'cursor-pointer hover:bg-emerald-50/30' : 'cursor-pointer hover:bg-red-50/30')}`}>
              <input type="checkbox" checked={picked} disabled={locked || blocked}
                aria-label={`เลือก${title} ${line.ref}`}
                onChange={() => { if (blocked) return; if (isSource) pickSource(line.lineId); else { setCandidateId(picked ? null : line.lineId); setSubmitError(''); } }}
                className={`mt-1 h-4 w-4 shrink-0 rounded border-gray-300 ${isOffset ? 'opacity-40 cursor-not-allowed' : isGreen ? 'accent-emerald-600' : 'accent-red-600'}`} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] tabular-nums text-gray-400">{formatDMY(line.date.slice(0, 10))}</span>
                    {isOffset && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-slate-200/80 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                        หักล้างแล้ว{line.offsetMatchId ? ` #${line.offsetMatchId}` : ''}
                      </span>
                    )}
                  </div>
                  <span className={`text-sm font-semibold tabular-nums ${isOffset ? 'text-slate-400 line-through decoration-slate-300' : 'text-gray-900'}`}>{formatAmount(line.amount)}</span>
                </div>
                <p className={`mt-0.5 break-words text-sm font-medium ${isOffset ? 'text-slate-500' : 'text-gray-800'}`}>{line.ref}</p>
                <p className={`break-words text-xs ${isOffset ? 'text-slate-400' : 'text-gray-600'}`}>{line.description || 'ไม่มีคำอธิบาย'}</p>
                {sender && <p className="mt-1 break-words text-[11px] text-gray-500">{sender}</p>}
                {isOffset && (
                  <div className="mt-1.5 rounded-lg border border-slate-200 bg-white/80 px-2.5 py-1.5 text-[11px] text-slate-600">
                    <p className="font-medium text-slate-700">
                      หมายเหตุที่หักล้าง: <span className="font-semibold text-slate-800">&ldquo;{line.offsetRemark || 'ไม่ได้ระบุเหตุผล'}&rdquo;</span>
                    </p>
                    <div className="mt-0.5 flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-500">
                      <span>
                        {line.offsetCounterpartRef ? `คู่กับ ${line.offsetCounterpartRef}${line.offsetCounterpartDate ? ` (${formatDMY(line.offsetCounterpartDate.slice(0, 10))})` : ''}` : 'หักล้างรายการธนาคาร'}
                        {line.offsetBy ? ` · โดย ${line.offsetBy}` : ''}
                      </span>
                      {onRequestUndoOffset && line.offsetMatchId && (
                        <button
                          type="button"
                          disabled={locked}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onRequestUndoOffset({
                              matchId: line.offsetMatchId!,
                              num: line.offsetNum ?? 1,
                              ref: line.ref,
                              amount: line.amount,
                              remark: line.offsetRemark ?? null,
                            });
                          }}
                          className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          ยกเลิกหักล้าง
                        </button>
                      )}
                    </div>
                  </div>
                )}
                {!isOffset && blocked && <p className="mt-1 flex items-start gap-1 text-[11px] text-red-600"><Lock size={12} className="mt-0.5 shrink-0" />{line.closedReason || 'งวดปิดแล้ว'}</p>}
              </div>
            </label>;
          })}
      </div>
    </section>;
  }

  if (!isOpen) return null;
  return createPortal(<motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-3 py-4 backdrop-blur-md sm:px-4 sm:py-6"
    onClick={() => { if (!locked) onClose(); }}>
    <motion.div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="bank-offset-title"
      initial={{ opacity: 0, scale: 0.94, y: 14 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 8 }}
      className="flex max-h-[92dvh] w-full min-w-0 max-w-4xl flex-col overflow-hidden rounded-2xl border border-white/70 bg-white/95 shadow-2xl backdrop-blur-2xl outline-none"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'Escape') { event.stopPropagation(); if (!locked) onClose(); }
        if (event.key === 'Tab') {
          const nodes = dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex="0"]');
          const first = nodes?.[0], last = nodes?.[nodes.length - 1];
          if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }}>
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-gray-100 px-4 py-4 sm:px-5">
        <div className="flex min-w-0 items-start gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-teal-50 text-teal-600"><Scale size={18} /></span>
          <div className="min-w-0"><h2 id="bank-offset-title" className="text-base font-semibold text-gray-900">หักล้างรายการธนาคาร</h2><p className="mt-1 text-xs text-gray-500">เลือกเงินเข้าและเงินออกอย่างละ 1 รายการ</p></div>
        </div>
        <button type="button" onClick={onClose} disabled={locked} aria-label="ปิดหน้าต่าง" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 disabled:opacity-40"><X size={18} /></button>
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-gray-50/60 px-3 py-4 sm:px-5">
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"><AlertCircle size={14} className="mt-0.5 shrink-0" /><span>ยอดเงินเข้าและเงินออกต้องเท่ากันและอยู่ในบัญชีเดียวกัน<HelpTooltip label="เมื่อใดควรหักล้างรายการธนาคาร">ใช้กับเช็คเด้งหรือรายการธนาคารตัดคืน ไม่ใช่การจับคู่กับ BC365 ต้องระบุเหตุผล และห้ามหักล้างรายการในงวดปิด</HelpTooltip></span></div>
        {/* แถบสลับฝั่งเริ่มต้น (เฉพาะ MASTER ที่มีสิทธิ์ทั้งสองฝั่ง) */}
        {isMaster && (
          <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600">
            <span className="font-medium text-gray-700">ฝั่งเริ่มต้น:</span>
            <button
              type="button"
              disabled={locked}
              onClick={() => switchSourceDir("IN")}
              className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                activeSourceDir === "IN"
                  ? "bg-emerald-600 text-white shadow-sm hover:bg-emerald-700"
                  : "bg-gray-100 text-gray-600 hover:bg-emerald-50 hover:text-emerald-700"
              }`}
            >
              เงินเข้า (AR · Credit)
            </button>
            <button
              type="button"
              disabled={locked}
              onClick={() => switchSourceDir("OUT")}
              className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                activeSourceDir === "OUT"
                  ? "bg-red-600 text-white shadow-sm hover:bg-red-700"
                  : "bg-gray-100 text-gray-600 hover:bg-red-50 hover:text-red-700"
              }`}
            >
              เงินออก (AP · Debit)
            </button>
          </div>
        )}
        <div className="relative min-w-0"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" /><input aria-label="ค้นหารายการหักล้างธนาคาร" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นหาเลขอ้างอิง ชื่อผู้โอน วันที่ หรือยอดเงิน" className="min-h-11 w-full min-w-0 rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm text-gray-700" /></div>
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
            <span>เงินเข้า (AR · Credit)</span>
            {(activeSourceDir === "IN" ? currentSourceId !== null : candidateId !== null) && (
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
            <span>เงินออก (AP · Debit)</span>
            {(activeSourceDir === "OUT" ? currentSourceId !== null : candidateId !== null) && (
              <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-800">
                เลือก 1
              </span>
            )}
          </button>
        </div>
        <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2">
          <div className={mobileTab === "IN" ? "block" : "hidden md:block"}>
            {renderColumn('IN')}
          </div>
          <div className={mobileTab === "OUT" ? "block" : "hidden md:block"}>
            {renderColumn('OUT')}
          </div>
        </div>
        <div><label htmlFor="bank-offset-reason" className="mb-1.5 block text-xs font-medium text-gray-700">เหตุผลในการหักล้าง <span className="text-red-600">*</span></label><textarea id="bank-offset-reason" rows={2} value={reason} disabled={locked} maxLength={REMARK_MAX_LENGTH} onChange={(event) => setReason(event.target.value)} placeholder={`เช่น เช็คเด้ง หรือธนาคารตัดคืน (อย่างน้อย ${REMARK_MIN_LENGTH} ตัวอักษร)`} className="w-full resize-y rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 disabled:opacity-50" /></div>
        {submitError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-600">{submitError}</p>}
      </div>
      <footer className="flex shrink-0 flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 border-t border-gray-100 bg-white px-4 py-3 sm:px-5">
        <div aria-live="polite" className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 sm:gap-x-4 gap-y-1 text-xs text-gray-500">
            <span>ขาเข้า <b className="tabular-nums text-gray-900">{formatAmount(inTotal)}</b></span>
            <span>ขาออก <b className="tabular-nums text-gray-900">{formatAmount(outTotal)}</b></span>
            <span>สุทธิ <b className={`tabular-nums ${selection.source && selection.candidate && Math.abs(inTotal - outTotal) < 0.005 ? 'text-teal-700' : 'text-red-600'}`}>{formatAmount(Math.abs(inTotal - outTotal))}</b></span>
          </div>
          <p className="mt-1 text-[11px] text-amber-700">{loading ? 'กำลังตรวจสอบคู่หักล้าง' : selection.problem}</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {currentSourceId !== null && <button type="button" onClick={clearSelection} disabled={locked} className="min-h-10 px-2 text-xs text-gray-500 hover:text-gray-800 disabled:opacity-40">ล้างที่เลือก</button>}
          <button type="button" onClick={onClose} disabled={locked} className="min-h-10 rounded-full border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40">ปิด</button>
          <button type="button" onClick={() => void confirm()} disabled={!canConfirm} title={selection.problem ?? undefined} className="flex min-h-10 items-center justify-center gap-1.5 rounded-full bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-40">{locked ? <Loader2 size={14} className="animate-spin" /> : <Scale size={14} />}ยืนยันหักล้าง{selection.candidate ? ' 2 รายการ' : ''}</button>
        </div>
      </footer>
    </motion.div>
  </motion.div>, document.body);
}
