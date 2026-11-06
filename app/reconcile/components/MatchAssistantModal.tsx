"use client";

import HelpTooltip from '../../../components/HelpTooltip';
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { CircleCheck, Loader2, RefreshCw, ScanSearch, Sparkles, TriangleAlert, X } from "lucide-react";
import {
  ASSISTANT_WINDOW_OPTIONS,
  DEFAULT_ASSISTANT_WINDOW,
  confidenceLevel,
  type AssistantResult,
  type AssistantSuggestion,
  type Direction,
} from "../../../lib/matchAssistant";
import AuraOrb from "./AuraOrb";
import AssistantSuggestionCard, { type CardStatus } from "./AssistantSuggestionCard";

import { formatAmount } from '../../../lib/formatAmount';
const SEARCH_STEPS = [
  "รวบรวมรายการธนาคาร ที่ยังไม่มีคู่",
  "ค้นหารายการ BC365 ในช่วงวันที่ใกล้เคียง",
  "เทียบยอดเงินทีละรายการ",
  "ให้คะแนนความน่าจะเป็น",
];

// API ตอบเร็วมาก (<200ms) — ถ้าตัดออร่าทิ้งทันทีจะดูเหมือนหน้าจอกระพริบ เลยเล่นให้ครบอย่างน้อยเท่านี้
const FIRST_SEARCH_MS = 2200;
const RESEARCH_MS = 1200;

type CardState = { status: CardStatus; matchId?: number; error?: string };

function formatDMY(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function SearchingView({ step, windowDays, amount }: { step: number; windowDays: number; amount: number | null }) {
  return (
    <div className="flex h-full min-h-[380px] flex-col items-center justify-center gap-6 overflow-hidden px-6 py-8">
      <AuraOrb />
      <div className="text-center">
        <p className="text-base font-semibold tracking-tight text-slate-900">
          กำลังค้นหารายการที่น่าจะเป็นคู่กัน…
        </p>
        <p className="mt-1.5 h-5 text-sm text-slate-500 tabular-nums">
          {amount !== null ? (
            <>
              กำลังเทียบยอด <span className="font-semibold text-indigo-700">{formatAmount(amount)}</span>
            </>
          ) : (
            `ช่วงวันที่ ±${windowDays} วัน`
          )}
        </p>
      </div>
      <ul className="w-full max-w-xs space-y-2.5 rounded-2xl border border-slate-200/80 bg-white/90 px-4 py-3.5 text-sm shadow-xs">
        {SEARCH_STEPS.map((label, i) => {
          const done = i < step;
          const current = i === step;
          return (
            <li
              key={label}
              className={`flex items-center gap-2.5 transition-colors duration-300 ${
                done ? "text-slate-700" : current ? "font-semibold text-indigo-700" : "text-slate-400"
              }`}
            >
              {done ? (
                <CircleCheck size={16} className="shrink-0 text-emerald-500" />
              ) : current ? (
                <Loader2 size={16} className="shrink-0 animate-spin text-indigo-600" />
              ) : (
                <span className="size-4 shrink-0 rounded-full border-2 border-slate-200" />
              )}
              <span className="truncate">{i === 1 ? `${label} ±${windowDays} วัน` : label}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ผู้ช่วยหาคู่ — popup หาคู่ Bank ↔ GL ที่ยอดตรงกันแต่ลงคนละวัน แล้วให้ผู้ใช้กด Match เองทีละคู่
// ไม่บันทึกอะไรเองเด็ดขาด (requirements ข้อ 27) — กติกาการให้คะแนนอยู่ใน lib/matchAssistant.ts
// คีย์ประจำคำแนะนำแต่ละใบ — ต้องรวม "ทุก" รายการธนาคารในกลุ่ม ไม่ใช่แค่รายการแรก
// เพราะคำแนะนำแบบ 1:1 กับแบบรวมยอด N:1 ใช้รายการธนาคารตัวแรกร่วมกันได้
// (เช่น ธนาคาร 2,500 จับเดี่ยวกับ GL 2,500 หรือจะรวมกับ 100 ไปจับ GL 2,600 ก็ได้)
// ถ้าคีย์ด้วย banks[0].lineId ตัวเดียว สองใบนี้จะใช้สถานะก้อนเดียวกัน พอยืนยันใบหนึ่ง
// อีกใบจะขึ้นว่า "จับคู่แล้ว" พร้อม MatchId เดียวกันทั้งที่ยังไม่ได้บันทึกอะไรเลย
function suggestionKey(s: AssistantSuggestion) {
  return `${s.kind}:${s.banks.map((bank) => bank.lineId).join("-")}`;
}

export default function MatchAssistantModal({
  bankCode,
  bankAccountNo,
  periodStart,
  periodEnd,
  direction,
  previewAmounts,
  onClose,
}: {
  bankCode: string;
  // ต้องเป็นบัญชีเดียวกับที่ตารางหลังจอกำลังแสดงอยู่ ไม่งั้นผู้ช่วยจะเสนอคู่ข้ามบัญชี
  // ที่ผู้ใช้มองไม่เห็นในตาราง แล้ว /api/reconcile/match ก็จะปฏิเสธตอนกดจับคู่อยู่ดี
  bankAccountNo: string | null;
  periodStart: string;
  periodEnd: string;
  // ค้นหาเฉพาะฝั่งที่แท็บในตารางกำลังเปิดอยู่ — IN/OUT มักเป็นคนละคนดูแล ไม่ให้สลับข้ามฝั่งใน popup
  direction: Direction;
  previewAmounts: number[]; // ยอดที่ยังไม่มีคู่ในตาราง — เอามาวิ่งโชว์ระหว่างออร่ากำลังค้นหา
  onClose: (matchedPairs: number) => void; // บอก workspace ว่าจับคู่ไปกี่คู่ จะได้โหลดตารางใหม่
}) {
  const [windowDays, setWindowDays] = useState(DEFAULT_ASSISTANT_WINDOW);
  const [phase, setPhase] = useState<"searching" | "results" | "error">("searching");
  const [result, setResult] = useState<AssistantResult | null>(null);
  const [error, setError] = useState("");
  const [step, setStep] = useState(0);
  const [tick, setTick] = useState(0);
  const [selection, setSelection] = useState<Record<string, number>>({});
  const [cards, setCards] = useState<Record<string, CardState>>({});
  const [consumedGl, setConsumedGl] = useState<Set<number>>(new Set());
  const [consumedBank, setConsumedBank] = useState<Set<number>>(new Set());
  const [matchedPairs, setMatchedPairs] = useState(0);
  const [filterTab, setFilterTab] = useState<"all" | "matchable" | "crossAccount" | "crossDirection">("all");
  const [recalculating, setRecalculating] = useState(false);
  const [skippedKeys, setSkippedKeys] = useState<Set<string>>(new Set());
  const abortRef = useRef<AbortController | null>(null);

  const busy = Object.values(cards).some((c) => c.status === "matching") || recalculating;

  const runSearch = useCallback(
    async (win: number, minDurationMs: number) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setPhase("searching");
      setError("");
      setStep(0);
      const startedAt = Date.now();
      try {
        const qs = new URLSearchParams({
          bankCode,
          from: periodStart,
          to: periodEnd,
          windowDays: String(win),
          direction,
        });
        if (bankAccountNo) qs.set("bankAccountNo", bankAccountNo);
        const res = await fetch(`/api/reconcile/assistant?${qs.toString()}`, { signal: controller.signal });
        const data = await res.json();
        const wait = minDurationMs - (Date.now() - startedAt);
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
        if (controller.signal.aborted) return;
        if (!res.ok) {
          setError(data.error || "ผู้ช่วยจับคู่ทำงานไม่สำเร็จ");
          setPhase("error");
          return;
        }
        const next = data as AssistantResult;
        setResult(next);
        setSelection(
          Object.fromEntries(
            next.suggestions.map((s) => [suggestionKey(s), s.suggestedEntryNo ?? s.candidates[0].gl.entryNo])
          )
        );
        // ผลใหม่มาจาก DB แล้ว — คู่ที่จับไปก่อนหน้าหายไปจากผลเอง ไม่ต้องจำ GL ที่ใช้ไปแล้วอีก
        setCards({});
        setConsumedGl(new Set());
        setConsumedBank(new Set());
        setSkippedKeys(new Set());
        setFilterTab("all");
        setPhase("results");
      } catch {
        if (controller.signal.aborted) return;
        setError("ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาตรวจสอบการเชื่อมต่อ");
        setPhase("error");
      }
    },
    [bankCode, bankAccountNo, periodStart, periodEnd, direction]
  );

  useEffect(() => {
    // ค้นหาทันทีที่เปิด popup — fetch-on-mount ปกติ เลี่ยง setState ในนี้ไม่ได้
    // eslint-disable-next-line react-hooks/set-state-in-effect
    runSearch(DEFAULT_ASSISTANT_WINDOW, FIRST_SEARCH_MS);
    const abort = abortRef;
    return () => abort.current?.abort();
  }, [runSearch]);

  useEffect(() => {
    if (phase !== "searching") return;
    const stepTimer = setInterval(() => setStep((s) => Math.min(s + 1, SEARCH_STEPS.length - 1)), 520);
    const tickTimer = setInterval(() => setTick((t) => t + 1), 110);
    return () => {
      clearInterval(stepTimer);
      clearInterval(tickTimer);
    };
  }, [phase]);

  const close = useCallback(() => {
    if (!busy) onClose(matchedPairs);
  }, [busy, onClose, matchedPairs]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  function searchWith(win: number) {
    setWindowDays(win);
    setSkippedKeys(new Set());
    runSearch(win, RESEARCH_MS);
  }

  function setCard(key: string, state: CardState) {
    setCards((prev) => ({ ...prev, [key]: state }));
  }

  const silentRecalculate = useCallback(async () => {
    setRecalculating(true);
    try {
      const qs = new URLSearchParams({
        bankCode,
        from: periodStart,
        to: periodEnd,
        windowDays: String(windowDays),
        direction,
      });
      if (bankAccountNo) qs.set("bankAccountNo", bankAccountNo);
      const res = await fetch(`/api/reconcile/assistant?${qs.toString()}`);
      if (!res.ok) return;
      const next = (await res.json()) as AssistantResult;
      setResult(next);
      setSelection((prev) => ({
        ...Object.fromEntries(
          next.suggestions.map((s) => [suggestionKey(s), s.suggestedEntryNo ?? s.candidates[0].gl.entryNo])
        ),
        ...prev,
      }));
      setCards({});
      setConsumedGl(new Set());
      setConsumedBank(new Set());
    } catch {
      // ละเว้น error ของการคำนวณเบื้องหลัง และคงการ์ดเดิมไว้
    } finally {
      setRecalculating(false);
    }
  }, [bankCode, bankAccountNo, periodStart, periodEnd, windowDays, direction]);

  async function handleMatch(s: AssistantSuggestion, entryNo: number) {
    if (busy || recalculating) return;
    const key = suggestionKey(s);
    setCard(key, { status: "matching" });
    try {
      const res = await fetch("/api/reconcile/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bankCode,
          bankAccountNo,
          matchType: "MATCHED",
          groups: [{ bankLineIds: s.banks.map((bank) => bank.lineId), glEntryNos: [entryNo] }],
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCard(key, { status: "open", error: data.error || "จับคู่ไม่สำเร็จ" });
        return;
      }
      setSelection((prev) => ({ ...prev, [key]: entryNo }));
      setCard(key, { status: "matched", matchId: data.matchId });
      setConsumedGl((prev) => new Set(prev).add(entryNo));
      setConsumedBank((prev) => {
        const next = new Set(prev);
        s.banks.forEach((bank) => next.add(bank.lineId));
        return next;
      });
      setMatchedPairs((n) => n + 1);

      // หน่วงเวลาสั้นๆ ~650ms เพื่อให้ผู้ใช้เห็นสถานะ "จับคู่แล้ว" บนการ์ดอย่างชัดเจน
      await new Promise((resolve) => setTimeout(resolve, 650));

      // คำนวณหาคู่รอบใหม่ในเบื้องหลังทันที (Auto-Recalculate)
      await silentRecalculate();
    } catch {
      setCard(key, { status: "open", error: "ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาตรวจสอบการเชื่อมต่อ" });
    }
  }

  const allSuggestions = useMemo(() => result?.suggestions ?? [], [result]);

  const { matchableCount, crossAccountCount, crossDirectionCount } = useMemo(() => {
    let matchable = 0;
    let crossAccount = 0;
    let crossDirection = 0;
    for (const s of allSuggestions) {
      const key = suggestionKey(s);
      const selEntry = selection[key];
      const chosen = s.candidates.find((c) => c.gl.entryNo === selEntry) ?? s.candidates[0];
      if (chosen?.crossDirection) {
        crossDirection += 1;
      } else if (chosen?.crossAccount || s.crossAccountBank) {
        crossAccount += 1;
      } else {
        matchable += 1;
      }
    }
    return { matchableCount: matchable, crossAccountCount: crossAccount, crossDirectionCount: crossDirection };
  }, [allSuggestions, selection]);

  const visible = useMemo(() => {
    if (filterTab === "all") return allSuggestions;
    return allSuggestions.filter((s) => {
      const key = suggestionKey(s);
      const selEntry = selection[key];
      const chosen = s.candidates.find((c) => c.gl.entryNo === selEntry) ?? s.candidates[0];
      const isCrossDirection = Boolean(chosen?.crossDirection);
      const isCrossAccount = Boolean(chosen?.crossAccount || s.crossAccountBank);
      if (filterTab === "matchable") return !isCrossDirection && !isCrossAccount;
      if (filterTab === "crossAccount") return isCrossAccount;
      if (filterTab === "crossDirection") return isCrossDirection;
      return true;
    });
  }, [allSuggestions, filterTab, selection]);

  const levels = useMemo(() => {
    const counts = { high: 0, medium: 0, low: 0 };
    for (const s of visible) counts[confidenceLevel(s.candidates[0].score)] += 1;
    return counts;
  }, [visible]);

  const searching = phase === "searching";
  const widerWindow = ASSISTANT_WINDOW_OPTIONS.find((w) => w > windowDays);
  const tickerAmount = previewAmounts.length > 0 ? previewAmounts[tick % previewAmounts.length] : null;

  const modal = (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4 py-6 backdrop-blur-md"
      onClick={close}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="match-assistant-title"
        initial={{ opacity: 0, scale: 0.92, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8, transition: { duration: 0.15 } }}
        transition={{ type: "spring", stiffness: 380, damping: 28 }}
        className="relative h-[90vh] w-full max-w-4xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* แสงเงารอบ popup แบบสุขุม */}
        <div
          aria-hidden
          className={`pointer-events-none absolute -inset-4 rounded-[28px] bg-indigo-500/10 blur-2xl transition-opacity duration-700 ${
            searching ? "opacity-80" : "opacity-30"
          }`}
        />

        <div className="relative flex h-full flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white/95 shadow-2xl backdrop-blur-2xl">
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-gray-100 px-5 py-4">
            <div className="flex min-w-0 items-center gap-3">
              <AuraOrb size="sm" active={searching} />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <h2 id="match-assistant-title" className="text-base font-semibold text-gray-900">ผู้ช่วยจับคู่</h2>
                  <HelpTooltip label="วิธีแนะนำคู่">ค้นหารายการเดี่ยวหรือหลายรายการที่ยอดรวมตรงกัน ทิศทางเดียวกัน และวันที่อยู่ในช่วงที่เลือก ระบบไม่บันทึกให้จนกว่าจะกดจับคู่</HelpTooltip>
                </div>
                <p className="text-xs text-gray-500">
                  {bankCode} {formatDMY(periodStart)} -{" "}
                  {formatDMY(periodEnd)}
                </p>
              </div>
            </div>
            <button
              onClick={close}
              disabled={busy}
              aria-label="ปิด"
              className="text-gray-400 transition-transform hover:text-gray-600 active:scale-90 disabled:opacity-40"
            >
              <X size={18} />
            </button>
          </div>

          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-5 py-3">
            <span className="flex items-center gap-2 text-xs text-gray-500">
              ค้นหาเฉพาะฝั่ง
              <span
                className={`rounded-full px-3 py-1 text-xs font-medium text-white ${
                  direction === "IN" ? "bg-purple-600" : "bg-red-500"
                }`}
              >
                {direction}
                {result && !searching ? ` · ${visible.length}` : ""}
              </span>
              {recalculating && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 border border-indigo-200/80 px-2.5 py-0.5 text-[11px] font-medium text-indigo-700 animate-pulse">
                  <Sparkles size={12} className="text-indigo-600 animate-spin" />
                  กำลังคำนวณคู่ที่เหลือใหม่…
                </span>
              )}
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-xs text-gray-500">วันที่ห่างกันได้</span>
              {ASSISTANT_WINDOW_OPTIONS.map((w) => (
                <button
                  key={w}
                  onClick={() => searchWith(w)}
                  disabled={searching || busy}
                  className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
                    windowDays === w
                      ? "border-violet-300 bg-violet-50 text-violet-700"
                      : "border-gray-200 text-gray-500 hover:bg-gray-50"
                  }`}
                >
                  ±{w} วัน
                </button>
              ))}
              <button
                onClick={() => searchWith(windowDays)}
                disabled={searching || busy}
                title="ค้นหาใหม่"
                aria-label="ค้นหาใหม่"
                className="rounded-full border border-gray-200 p-1.5 text-gray-500 hover:bg-gray-50 disabled:opacity-50"
              >
                <RefreshCw size={13} className={searching || recalculating ? "animate-spin" : ""} />
              </button>
            </div>
          </div>

          <div className="relative min-h-0 flex-1 overflow-y-auto bg-gray-50/60">
            {searching && <SearchingView step={step} windowDays={windowDays} amount={tickerAmount} />}

            {phase === "error" && (
              <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-3 px-6 text-center">
                <TriangleAlert size={28} className="text-amber-500" />
                <p className="text-sm text-gray-700">{error}</p>
                <button
                  onClick={() => searchWith(windowDays)}
                  className="rounded-full bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                  ลองใหม่
                </button>
              </div>
            )}

            {phase === "results" && result && allSuggestions.length === 0 && (
              <div className="flex h-full min-h-[360px] flex-col items-center justify-center gap-3 px-6 text-center">
                <span
                  className={`flex size-14 items-center justify-center rounded-full ${
                    matchedPairs > 0 ? "bg-emerald-50 text-emerald-600" : "bg-violet-50 text-violet-500"
                  }`}
                >
                  {matchedPairs > 0 ? <CircleCheck size={28} /> : <ScanSearch size={26} />}
                </span>
                <p className="text-sm font-semibold text-gray-800">
                  {matchedPairs > 0
                    ? `จับคู่สำเร็จทั้งหมด ${matchedPairs} คู่แล้ว!`
                    : `ไม่พบคู่ที่น่าจะเป็นฝั่ง ${direction} ในช่วง ±${windowDays} วัน`}
                </p>
                <p className="max-w-sm text-xs text-gray-500">
                  {matchedPairs > 0
                    ? "ไม่พบคู่เพิ่มเติมในช่วงวันที่ที่เลือก"
                    : "ลองขยายช่วงวันที่หรือจับคู่เองในตาราง"}
                </p>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  {matchedPairs > 0 ? (
                    <button
                      onClick={close}
                      className="rounded-full bg-emerald-600 px-5 py-2 text-sm font-semibold text-white shadow-xs hover:bg-emerald-700 transition-colors"
                    >
                      เสร็จสิ้นและกลับสู่ตาราง
                    </button>
                  ) : (
                    widerWindow && (
                      <button
                        onClick={() => searchWith(widerWindow)}
                        className="rounded-full border border-violet-200 bg-violet-50 px-4 py-2 text-sm font-medium text-violet-700 hover:bg-violet-100"
                      >
                        ลองขยายเป็น ±{widerWindow} วัน
                      </button>
                    )
                  )}
                </div>
              </div>
            )}

            {phase === "results" && result && allSuggestions.length > 0 && (
              <div className="flex flex-col gap-3 px-4 py-4 sm:px-5">
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs text-gray-500">
                  <p>
                    <span className="font-semibold text-gray-900">พบ {allSuggestions.length} คู่แนะนำ</span>
                    {" · "}
                    <span className="text-green-700">สูง {levels.high}</span>
                    {" · "}
                    <span className="text-amber-700">ปานกลาง {levels.medium}</span>
                    {" · "}
                    <span>ต่ำ {levels.low}</span>
                  </p>
                  <p>
                    รายการธนาคาร{direction === "IN" ? "เงินเข้า" : "เงินออก"}ที่ยังไม่มีคู่ {result.scannedBank} รายการ · พบคู่แนะนำวันเดียวกัน {result.explainedSameDay}{" "}
                    (เลือกไว้ในตารางแล้ว ยังไม่บันทึกการจับคู่)
                  </p>
                </div>

                {(crossAccountCount > 0 || crossDirectionCount > 0) && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50/70 px-3.5 py-2">
                    <span className="flex items-center gap-1.5 text-xs font-medium text-amber-900">
                      <TriangleAlert size={14} className="shrink-0 text-amber-600" />
                      {crossDirectionCount > 0 && crossAccountCount > 0
                        ? `พบ ${crossDirectionCount} รายการอาจบันทึกผิดฝั่ง (IN/OUT) และ ${crossAccountCount} รายการต่างบัญชี (ระบบล็อกไม่ให้จับคู่ เพื่อความปลอดภัย)`
                        : crossDirectionCount > 0
                        ? `พบ ${crossDirectionCount} รายการที่ยอดตรงกันแต่บันทึกผิดฝั่ง (Statement กับ BC365 สลับด้าน)`
                        : `พบ ${crossAccountCount} รายการที่ยอดตรงกันแต่อยู่คนละบัญชี (อาจลงผิดบัญชี)`}
                    </span>
                    <div className="flex items-center gap-1 flex-wrap">
                      <button
                        type="button"
                        onClick={() => setFilterTab("all")}
                        className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                          filterTab === "all"
                            ? "bg-slate-800 text-white"
                            : "bg-white/80 text-slate-700 hover:bg-white"
                        }`}
                      >
                        ทั้งหมด ({allSuggestions.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setFilterTab("matchable")}
                        className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                          filterTab === "matchable"
                            ? "bg-slate-800 text-white"
                            : "bg-white/80 text-slate-700 hover:bg-white"
                        }`}
                      >
                        จับคู่ได้ ({matchableCount})
                      </button>
                      {crossAccountCount > 0 && (
                        <button
                          type="button"
                          onClick={() => setFilterTab("crossAccount")}
                          className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                            filterTab === "crossAccount"
                              ? "bg-amber-800 text-white"
                              : "bg-white/80 text-amber-900 hover:bg-white"
                          }`}
                        >
                          ต่างบัญชี ({crossAccountCount})
                        </button>
                      )}
                      {crossDirectionCount > 0 && (
                        <button
                          type="button"
                          onClick={() => setFilterTab("crossDirection")}
                          className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                            filterTab === "crossDirection"
                              ? "bg-rose-800 text-white"
                              : "bg-white/80 text-rose-900 hover:bg-white"
                          }`}
                        >
                          บันทึกผิดฝั่ง ({crossDirectionCount})
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {visible.map((s, i) => {
                  const cardKey = suggestionKey(s);
                  const card = cards[cardKey] ?? {
                    status: (skippedKeys.has(cardKey) ? "skipped" : "open") as CardStatus,
                  };
                  return (
                    <AssistantSuggestionCard
                      key={cardKey}
                      suggestion={s}
                      index={i}
                      bankCode={bankCode}
                      bankAccountNo={bankAccountNo}
                      selectedEntryNo={selection[cardKey] ?? null}
                      consumedGl={consumedGl}
                      consumedBank={consumedBank}
                      status={card.status}
                      matchId={card.matchId}
                      error={card.error}
                      busy={busy}
                      onSelect={(entryNo) => setSelection((prev) => ({ ...prev, [cardKey]: entryNo }))}
                      onMatch={(entryNo) => handleMatch(s, entryNo)}
                      onSkip={() => {
                        setSkippedKeys((prev) => new Set(prev).add(cardKey));
                        setCard(cardKey, { status: "skipped" });
                      }}
                      onUndoSkip={() => {
                        setSkippedKeys((prev) => {
                          const next = new Set(prev);
                          next.delete(cardKey);
                          return next;
                        });
                        setCard(cardKey, { status: "open" });
                      }}
                    />
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-gray-100 bg-white px-5 py-3">
            <p className="max-w-lg text-[11px] text-gray-400">
ตรวจรายละเอียดก่อนยืนยันจับคู่
            </p>
            <div className="flex items-center gap-3">
              {matchedPairs > 0 && (
                <span className="inline-flex items-center gap-1 text-sm font-medium text-green-700">
                  <CircleCheck size={15} /> จับคู่แล้ว {matchedPairs} คู่
                </span>
              )}
              <button
                onClick={close}
                disabled={busy}
                className="rounded-full border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
              >
                ปิด
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );

  // portal ออกไปที่ body — กัน transform ของ workspace ที่ครอบอยู่ทำให้ fixed overlay ไม่เต็มจอ
  return createPortal(modal, document.body);
}
