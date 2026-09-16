"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { CircleCheck, Loader2, RefreshCw, ScanSearch, TriangleAlert, X } from "lucide-react";
import {
  ASSISTANT_WINDOW_OPTIONS,
  DEFAULT_ASSISTANT_WINDOW,
  confidenceLevel,
  type AssistantResult,
  type AssistantSuggestion,
  type Direction,
} from "../../../lib/matchAssistant";
import AuraOrb, { AURA_GRADIENT } from "./AuraOrb";
import AssistantSuggestionCard, { type CardStatus } from "./AssistantSuggestionCard";

const SEARCH_STEPS = [
  "รวบรวมรายการ Bank ที่ยังไม่มีคู่",
  "สแกน GL ย้อนหน้า-หลัง",
  "เทียบยอดเงินทีละรายการ",
  "ให้คะแนนความน่าจะเป็น",
];

// API ตอบเร็วมาก (<200ms) — ถ้าตัดออร่าทิ้งทันทีจะดูเหมือนหน้าจอกระพริบ เลยเล่นให้ครบอย่างน้อยเท่านี้
const FIRST_SEARCH_MS = 2200;
const RESEARCH_MS = 1200;

type CardState = { status: CardStatus; matchId?: number; error?: string };

function formatAmount(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatDMY(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function SearchingView({ step, windowDays, amount }: { step: number; windowDays: number; amount: number | null }) {
  return (
    <div className="flex h-full min-h-[400px] flex-col items-center justify-center gap-7 overflow-hidden px-6 py-6">
      <AuraOrb />
      <div className="text-center">
        <p
          className="bg-clip-text text-base font-semibold text-transparent animate-aura-shimmer"
          style={{
            backgroundImage: "linear-gradient(90deg,#7c3aed,#2563eb,#06b6d4,#c026d3,#7c3aed)",
            backgroundSize: "200% 100%",
          }}
        >
          กำลังค้นหารายการที่น่าจะเป็นคู่กัน…
        </p>
        <p className="mt-1 h-5 text-sm text-gray-500 tabular-nums">
          {amount !== null ? (
            <>
              กำลังเทียบยอด <span className="font-semibold text-gray-800">{formatAmount(amount)}</span>
            </>
          ) : (
            `ช่วงวันที่ ±${windowDays} วัน`
          )}
        </p>
      </div>
      <ul className="flex flex-col gap-2 text-sm">
        {SEARCH_STEPS.map((label, i) => {
          const done = i < step;
          const current = i === step;
          return (
            <li
              key={label}
              className={`flex items-center gap-2 transition-colors duration-300 ${
                done ? "text-gray-700" : current ? "font-medium text-violet-700" : "text-gray-300"
              }`}
            >
              {done ? (
                <CircleCheck size={16} className="text-green-500" />
              ) : current ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <span className="size-4 rounded-full border-2 border-current" />
              )}
              {i === 1 ? `${label} ±${windowDays} วัน` : label}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ผู้ช่วยหาคู่ — popup หาคู่ Bank ↔ GL ที่ยอดตรงกันแต่ลงคนละวัน แล้วให้ผู้ใช้กด Match เองทีละคู่
// ไม่บันทึกอะไรเองเด็ดขาด (requirements ข้อ 27) — กติกาการให้คะแนนอยู่ใน lib/matchAssistant.ts
export default function MatchAssistantModal({
  bankCode,
  periodStart,
  periodEnd,
  direction,
  previewAmounts,
  onClose,
}: {
  bankCode: string;
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
  const [selection, setSelection] = useState<Record<number, number>>({});
  const [cards, setCards] = useState<Record<number, CardState>>({});
  const [consumedGl, setConsumedGl] = useState<Set<number>>(new Set());
  const [matchedPairs, setMatchedPairs] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const busy = Object.values(cards).some((c) => c.status === "matching");

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
        const res = await fetch(`/api/reconcile/assistant?${qs.toString()}`, { signal: controller.signal });
        const data = await res.json();
        const wait = minDurationMs - (Date.now() - startedAt);
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
        if (controller.signal.aborted) return;
        if (!res.ok) {
          setError(data.error || "ผู้ช่วยหาคู่ทำงานไม่สำเร็จ");
          setPhase("error");
          return;
        }
        const next = data as AssistantResult;
        setResult(next);
        setSelection(
          Object.fromEntries(
            next.suggestions.map((s) => [s.bank.lineId, s.suggestedEntryNo ?? s.candidates[0].gl.entryNo])
          )
        );
        // ผลใหม่มาจาก DB แล้ว — คู่ที่จับไปก่อนหน้าหายไปจากผลเอง ไม่ต้องจำ GL ที่ใช้ไปแล้วอีก
        setCards({});
        setConsumedGl(new Set());
        setPhase("results");
      } catch {
        if (controller.signal.aborted) return;
        setError("เชื่อมต่อ server ไม่ได้");
        setPhase("error");
      }
    },
    [bankCode, periodStart, periodEnd, direction]
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
    runSearch(win, RESEARCH_MS);
  }

  function setCard(lineId: number, state: CardState) {
    setCards((prev) => ({ ...prev, [lineId]: state }));
  }

  async function handleMatch(s: AssistantSuggestion, entryNo: number) {
    if (busy) return;
    const lineId = s.bank.lineId;
    setCard(lineId, { status: "matching" });
    try {
      const res = await fetch("/api/reconcile/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bankCode,
          matchType: "MATCHED",
          groups: [{ bankLineIds: [lineId], glEntryNos: [entryNo] }],
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCard(lineId, { status: "open", error: data.error || "Match ไม่สำเร็จ" });
        return;
      }
      setSelection((prev) => ({ ...prev, [lineId]: entryNo }));
      setCard(lineId, { status: "matched", matchId: data.matchId });
      setConsumedGl((prev) => new Set(prev).add(entryNo));
      setMatchedPairs((n) => n + 1);
    } catch {
      setCard(lineId, { status: "open", error: "เชื่อมต่อ server ไม่ได้" });
    }
  }

  const visible = useMemo(() => result?.suggestions ?? [], [result]);

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
        {/* แสงฟุ้งรอบ popup — สว่างตอนค้นหา แล้วค่อยหรี่ลงเมื่อได้ผล */}
        <div
          aria-hidden
          className={`pointer-events-none absolute -inset-6 rounded-[32px] blur-2xl transition-opacity duration-700 ${
            searching ? "opacity-50" : "opacity-15"
          }`}
          style={{ background: AURA_GRADIENT }}
        />
        {/* ขอบเรืองแสง: gradient สี่เหลี่ยมใหญ่หมุนอยู่หลังกรอบขาว เหลือโผล่ให้เห็นแค่เส้นขอบ 2px */}
        <div aria-hidden className="pointer-events-none absolute -inset-[2px] overflow-hidden rounded-[18px]">
          <div
            className={`absolute left-1/2 top-1/2 aspect-square w-[160%] -translate-x-1/2 -translate-y-1/2 transition-opacity duration-700 animate-aura-spin ${
              searching ? "opacity-100" : "opacity-40"
            }`}
            style={{ background: AURA_GRADIENT }}
          />
        </div>

        <div className="relative flex h-full flex-col overflow-hidden rounded-2xl bg-white/95 shadow-2xl backdrop-blur-2xl">
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-gray-100 px-5 py-4">
            <div className="flex min-w-0 items-center gap-3">
              <AuraOrb size="sm" active={searching} />
              <div className="min-w-0">
                <h2 id="match-assistant-title" className="text-base font-semibold text-gray-900">
                  ผู้ช่วยหาคู่
                </h2>
                <p className="text-xs text-gray-500">
                  หาคู่ที่ยอดเงินตรงกันพอดี แต่ Bank กับ GL ลงคนละวัน · {bankCode} {formatDMY(periodStart)} -{" "}
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
                <RefreshCw size={13} className={searching ? "animate-spin" : ""} />
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

            {phase === "results" && result && visible.length === 0 && (
              <div className="flex h-full min-h-[360px] flex-col items-center justify-center gap-3 px-6 text-center">
                <span className="flex size-14 items-center justify-center rounded-full bg-violet-50 text-violet-500">
                  <ScanSearch size={26} />
                </span>
                <p className="text-sm font-medium text-gray-800">
                  ไม่พบคู่ที่น่าจะเป็นฝั่ง {direction} ในช่วง ±{windowDays} วัน
                </p>
                <p className="max-w-sm text-xs text-gray-500">
                  รายการที่เหลืออาจยอดไม่ตรงกัน (เช่น ถูกหักค่าธรรมเนียม) หรือต้องรวมหลายรายการ — ลองขยายช่วงวันที่
                  หรือจับคู่เองในตาราง
                </p>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  {widerWindow && (
                    <button
                      onClick={() => searchWith(widerWindow)}
                      className="rounded-full border border-violet-200 bg-violet-50 px-4 py-2 text-sm font-medium text-violet-700 hover:bg-violet-100"
                    >
                      ลองขยายเป็น ±{widerWindow} วัน
                    </button>
                  )}
                </div>
              </div>
            )}

            {phase === "results" && result && visible.length > 0 && (
              <div className="flex flex-col gap-3 px-4 py-4 sm:px-5">
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-gray-500">
                  <p>
                    <span className="font-semibold text-gray-900">พบ {visible.length} คู่ที่น่าจะเป็น</span>
                    {" · "}
                    <span className="text-green-700">สูง {levels.high}</span>
                    {" · "}
                    <span className="text-amber-700">ปานกลาง {levels.medium}</span>
                    {" · "}
                    <span>ต่ำ {levels.low}</span>
                  </p>
                  <p>
                    Bank ฝั่ง {direction} ที่ยังไม่มีคู่ {result.scannedBank} รายการ · จับคู่วันเดียวกันได้ {result.explainedSameDay}{" "}
                    (ตารางติ๊กให้แล้ว)
                  </p>
                </div>
                {visible.map((s, i) => {
                  const card = cards[s.bank.lineId] ?? { status: "open" as const };
                  return (
                    <AssistantSuggestionCard
                      key={s.bank.lineId}
                      suggestion={s}
                      index={i}
                      selectedEntryNo={selection[s.bank.lineId] ?? null}
                      consumedGl={consumedGl}
                      status={card.status}
                      matchId={card.matchId}
                      error={card.error}
                      busy={busy}
                      onSelect={(entryNo) => setSelection((prev) => ({ ...prev, [s.bank.lineId]: entryNo }))}
                      onMatch={(entryNo) => handleMatch(s, entryNo)}
                      onSkip={() => setCard(s.bank.lineId, { status: "skipped" })}
                      onUndoSkip={() => setCard(s.bank.lineId, { status: "open" })}
                    />
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-gray-100 bg-white px-5 py-3">
            <p className="max-w-lg text-[11px] text-gray-400">
              แนะนำจากกติกา: ยอดตรงกันพอดี · ทิศทางเดียวกัน · วันที่ห่างไม่เกินช่วงที่เลือก — ระบบไม่บันทึกเอง
              ตรวจรายละเอียดก่อนกด Match ทุกครั้ง
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
