"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import {
  ArrowDownLeft,
  ArrowUpRight,
  CircleCheck,
  Loader2,
  Scale,
  Search,
  TriangleAlert,
  Undo2,
  X,
} from "lucide-react";
import { isReversalSource, offsetGroupProblem } from "../../../lib/glOffset";

export type OffsetTab = "auto" | "manual" | "done";

export type OffsetLine = {
  entryNo: number;
  date: string;
  ref: string;
  sourceCode: string | null;
  direction: "IN" | "OUT";
  amount: number;
};

export type OffsetPair = { key: string; original: OffsetLine; reversal: OffsetLine };

type ConfirmedGroup = {
  matchId: number;
  num: number;
  createdBy: string | null;
  createdAt: string;
  kind: "REVERSAL" | "MANUAL";
  lines: OffsetLine[];
};

function formatAmount(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function isoDay(value: string) {
  return new Date(value).toISOString().slice(0, 10);
}
function formatDMY(value: string) {
  const [y, m, d] = isoDay(value).split("-");
  return `${d}/${m}/${y}`;
}
const dateTimeFormatter = new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short" });
function signedOf(line: OffsetLine) {
  return line.direction === "IN" ? line.amount : -line.amount;
}
function cents(n: number) {
  return Math.round(n * 100);
}

function DirectionBadge({ direction }: { direction: "IN" | "OUT" }) {
  const isIn = direction === "IN";
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
        isIn ? "bg-purple-50 text-purple-700" : "bg-red-50 text-red-600"
      }`}
    >
      {isIn ? <ArrowDownLeft size={11} /> : <ArrowUpRight size={11} />}
      {direction}
    </span>
  );
}

function ReversalTag() {
  return (
    <span
      className="shrink-0 rounded border border-teal-200 bg-teal-50 px-1.5 py-0.5 text-[10px] font-semibold text-teal-700"
      title="แถวที่ BC สร้างตอนกด Reverse (Source Code = REVERSAL)"
    >
      REVERSAL
    </span>
  );
}

function LineRow({ label, line }: { label?: string; line: OffsetLine }) {
  return (
    <div className="flex min-w-0 items-center gap-2 py-1">
      {label && <span className="w-16 shrink-0 text-[11px] text-gray-400">{label}</span>}
      <span className="shrink-0 text-xs tabular-nums text-gray-400">{formatDMY(line.date)}</span>
      <DirectionBadge direction={line.direction} />
      <span className="min-w-0 truncate text-sm text-gray-800" title={line.ref}>
        {line.ref}
      </span>
      {isReversalSource(line.sourceCode) && <ReversalTag />}
      <span className="flex-1" />
      <span className="shrink-0 text-sm tabular-nums text-gray-900">{formatAmount(line.amount)}</span>
    </div>
  );
}

// หักล้างกันเอง — รายการฝั่ง BC365 ที่ยกเลิกกันเองจนยอดสุทธิเป็น 0 ไม่มีเงินผ่านธนาคาร (กติกาอยู่ใน lib/glOffset.ts)
//   แท็บ "กลับรายการใน BC" = คู่ที่ระบบเจอเอง (ถูกซ่อนจากตารางแล้ว) รอผู้ใช้กดยืนยันบันทึก
//   แท็บ "จับคู่เอง"        = กรณีแก้ด้วย JV ที่เลขเอกสารคนละใบ ระบบเดาให้ไม่ได้ ผู้ใช้เลือกขาเข้า/ขาออกเอง
//   แท็บ "ยืนยันแล้ว"       = ที่บันทึกไว้แล้วในงวดนี้ ยกเลิกได้ (ต้องใส่เหตุผล)
// บันทึกผ่าน /api/reconcile/match (matchType OFFSET) และยกเลิกผ่าน /api/reconcile/unmatch — ไม่มีทางลัดอื่น
export default function GlOffsetModal({
  bankCode,
  bankAccountNo,
  accountLabel,
  periodStart,
  periodEnd,
  glExtendDays,
  pairs,
  glLines,
  initialTab,
  focusEntryNo,
  onChanged,
  onClose,
}: {
  bankCode: string;
  bankAccountNo: string | null;
  accountLabel: string;
  periodStart: string;
  periodEnd: string;
  glExtendDays: number;
  pairs: OffsetPair[]; // คู่กลับรายการที่ยังไม่ได้ยืนยัน (จาก /api/reconcile/data)
  glLines: OffsetLine[]; // GL ที่ยังค้างอยู่ในตาราง ทั้ง IN และ OUT — ตัวเลือกของแท็บจับคู่เอง
  initialTab: OffsetTab;
  focusEntryNo: number | null; // เปิดจากปุ่มบนแถว GL — เลือกรายการนั้นไว้ให้ก่อน
  onChanged: () => void; // บันทึก/ยกเลิกสำเร็จ — ให้ตารางหลังจอโหลดใหม่
  onClose: () => void;
}) {
  const [tab, setTab] = useState<OffsetTab>(initialTab);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  // รายการที่เพิ่งบันทึกไป — ซ่อนทันที ระหว่างรอตารางหลังจอโหลดใหม่ส่ง props ชุดใหม่มา
  const [consumed, setConsumed] = useState<Set<number>>(new Set());

  // ── แท็บกลับรายการใน BC ──
  const visiblePairs = useMemo(
    () =>
      pairs
        .filter((p) => !consumed.has(p.original.entryNo) && !consumed.has(p.reversal.entryNo))
        .sort(
          (a, b) =>
            isoDay(a.original.date).localeCompare(isoDay(b.original.date)) || a.original.entryNo - b.original.entryNo
        ),
    [pairs, consumed]
  );
  // ค่าเริ่มต้นเลือกทุกคู่ — เก็บเฉพาะคู่ที่ผู้ใช้เอาติ๊กออก คู่ที่มาใหม่หลังโหลดจะถูกเลือกไว้เอง
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  const selectedPairs = visiblePairs.filter((p) => !unticked.has(p.key));

  // ── แท็บจับคู่เอง ──
  const [picked, setPicked] = useState<Set<number>>(() => new Set(focusEntryNo !== null ? [focusEntryNo] : []));
  // เปิดจากปุ่มบนแถว — ใส่ยอดของรายการนั้นเป็นคำค้น จะเห็นขาตรงข้ามที่ยอดเท่ากันทันที
  const [query, setQuery] = useState(() => {
    const focus = focusEntryNo !== null ? glLines.find((l) => l.entryNo === focusEntryNo) : undefined;
    return focus ? focus.amount.toFixed(2) : "";
  });
  const [onlyMirrored, setOnlyMirrored] = useState(true);

  const manualLines = useMemo(() => glLines.filter((l) => !consumed.has(l.entryNo)), [glLines, consumed]);
  const pickedLines = useMemo(() => manualLines.filter((l) => picked.has(l.entryNo)), [manualLines, picked]);

  const mirroredCents = useMemo(() => {
    const byDirection = { IN: new Set<number>(), OUT: new Set<number>() };
    for (const l of manualLines) byDirection[l.direction].add(cents(l.amount));
    return byDirection;
  }, [manualLines]);

  const pickedCents = useMemo(() => {
    const byDirection = { IN: new Set<number>(), OUT: new Set<number>() };
    for (const l of pickedLines) byDirection[l.direction].add(cents(l.amount));
    return byDirection;
  }, [pickedLines]);

  const columns = useMemo(() => {
    const q = query.trim().toLowerCase();
    const qAmount = q.replace(/,/g, "");
    const matchesQuery = (l: OffsetLine) =>
      !q || l.ref?.toLowerCase().includes(q) || (/^[\d.]+$/.test(qAmount) && l.amount.toFixed(2).includes(qAmount));
    const opposite = (d: "IN" | "OUT") => (d === "IN" ? "OUT" : "IN");
    const visible = manualLines.filter(
      (l) =>
        picked.has(l.entryNo) ||
        (matchesQuery(l) && (!onlyMirrored || mirroredCents[opposite(l.direction)].has(cents(l.amount))))
    );
    const sort = (list: OffsetLine[]) =>
      list.sort(
        (a, b) => b.amount - a.amount || isoDay(a.date).localeCompare(isoDay(b.date)) || a.entryNo - b.entryNo
      );
    return {
      IN: sort(visible.filter((l) => l.direction === "IN")),
      OUT: sort(visible.filter((l) => l.direction === "OUT")),
    };
  }, [manualLines, picked, query, onlyMirrored, mirroredCents]);

  const manualIn = pickedLines.filter((l) => l.direction === "IN").reduce((s, l) => s + l.amount, 0);
  const manualOut = pickedLines.filter((l) => l.direction === "OUT").reduce((s, l) => s + l.amount, 0);
  const manualProblem = pickedLines.length === 0 ? null : offsetGroupProblem(pickedLines.map(signedOf));
  const canConfirmManual = pickedLines.length >= 2 && manualProblem === null;

  // ── แท็บยืนยันแล้ว ──
  const [confirmed, setConfirmed] = useState<ConfirmedGroup[] | null>(null);
  const [confirmedError, setConfirmedError] = useState("");
  const [undoKey, setUndoKey] = useState<string | null>(null);
  const [undoReason, setUndoReason] = useState("");

  const loadConfirmed = useCallback(async () => {
    try {
      const qs = new URLSearchParams({
        bankCode,
        from: periodStart,
        to: periodEnd,
        glExtendDays: String(glExtendDays),
      });
      if (bankAccountNo) qs.set("bankAccountNo", bankAccountNo);
      const res = await fetch(`/api/reconcile/offsets?${qs.toString()}`);
      const data = await res.json();
      if (!res.ok) {
        setConfirmedError(data.error || "ดึงรายการที่ยืนยันแล้วไม่สำเร็จ");
        return;
      }
      setConfirmed(data.groups);
      setConfirmedError("");
    } catch {
      setConfirmedError("เชื่อมต่อ server ไม่ได้");
    }
  }, [bankCode, bankAccountNo, periodStart, periodEnd, glExtendDays]);

  useEffect(() => {
    // โหลดตอนเปิด popup เพื่อให้ป้ายจำนวนบนแท็บ "ยืนยันแล้ว" ขึ้นทันที — fetch-on-mount ปกติ
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadConfirmed();
  }, [loadConfirmed]);

  const close = useCallback(() => {
    if (!busy) onClose();
  }, [busy, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  function switchTab(next: OffsetTab) {
    setTab(next);
    setError("");
    setNotice("");
  }

  async function saveOffset(groups: number[][], onSaved: (matchId: number) => void) {
    if (busy || groups.length === 0) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/reconcile/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bankCode,
          bankAccountNo,
          matchType: "OFFSET",
          groups: groups.map((glEntryNos) => ({ bankLineIds: [], glEntryNos })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "บันทึกหักล้างกันเองไม่สำเร็จ");
        return;
      }
      setConsumed((prev) => {
        const next = new Set(prev);
        groups.flat().forEach((entryNo) => next.add(entryNo));
        return next;
      });
      onSaved(Number(data.matchId));
      onChanged();
      void loadConfirmed();
    } catch {
      setError("เชื่อมต่อ server ไม่ได้");
    } finally {
      setBusy(false);
    }
  }

  function confirmPairs() {
    const count = selectedPairs.length;
    void saveOffset(
      selectedPairs.map((p) => [p.original.entryNo, p.reversal.entryNo]),
      (matchId) => setNotice(`บันทึกหักล้างกันเองแล้ว ${count} คู่ (MatchId ${matchId})`)
    );
  }

  function confirmManual() {
    if (!canConfirmManual) return;
    void saveOffset([pickedLines.map((l) => l.entryNo)], (matchId) => {
      setNotice(`บันทึกหักล้างกันเองแล้ว ${pickedLines.length} รายการ (MatchId ${matchId})`);
      setPicked(new Set());
      setQuery("");
    });
  }

  async function undoGroup(group: ConfirmedGroup) {
    const reason = undoReason.trim();
    if (busy || !reason) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/reconcile/unmatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targets: [{ matchId: group.matchId, nums: [group.num] }], reason }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "ยกเลิกไม่สำเร็จ");
        return;
      }
      // รายการที่ยกเลิกต้องกลับมาให้เห็นได้อีก แม้จะเพิ่งบันทึกไปใน popup นี้เอง
      setConsumed((prev) => {
        const next = new Set(prev);
        group.lines.forEach((l) => next.delete(l.entryNo));
        return next;
      });
      setUndoKey(null);
      setUndoReason("");
      // คู่กลับรายการใน BC ไม่กลับเข้าตาราง — /api/reconcile/data แยกไปรอในแท็บ "กลับรายการใน BC" เสมอ
      setNotice(
        group.kind === "REVERSAL"
          ? `ยกเลิก Match #${group.matchId} กลุ่ม ${group.num} แล้ว — คู่กลับรายการกลับไปรอยืนยันในแท็บ "กลับรายการใน BC"`
          : `ยกเลิก Match #${group.matchId} กลุ่ม ${group.num} แล้ว — รายการกลับไปรอจับคู่ในตาราง`
      );
      onChanged();
      void loadConfirmed();
    } catch {
      setError("เชื่อมต่อ server ไม่ได้");
    } finally {
      setBusy(false);
    }
  }

  function togglePicked(entryNo: number) {
    // ข้อความผลลัพธ์ครั้งก่อนบังยอดรวมของชุดที่กำลังเลือกใหม่อยู่ — ล้างทิ้งทันทีที่เริ่มเลือก
    setNotice("");
    setError("");
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(entryNo)) next.delete(entryNo);
      else next.add(entryNo);
      return next;
    });
  }

  const allPairsTicked = visiblePairs.length > 0 && selectedPairs.length === visiblePairs.length;

  const tabs: { value: OffsetTab; label: string; count: number | null }[] = [
    { value: "auto", label: "กลับรายการใน BC", count: visiblePairs.length },
    { value: "manual", label: "จับคู่เอง", count: null },
    { value: "done", label: "ยืนยันแล้ว", count: confirmed?.length ?? null },
  ];

  function renderManualColumn(direction: "IN" | "OUT") {
    const list = columns[direction];
    const opposite = direction === "IN" ? "OUT" : "IN";
    return (
      <div className="flex min-h-0 flex-col rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-3 py-2">
          <span className="flex items-center gap-2 text-xs font-semibold text-gray-700">
            <DirectionBadge direction={direction} />
            {direction === "IN" ? "ขาเข้า" : "ขาออก"}
          </span>
          <span className="text-[11px] text-gray-400">{list.length} รายการ</span>
        </div>
        <div className="max-h-[42vh] overflow-y-auto">
          {list.length === 0 && <p className="px-3 py-8 text-center text-xs text-gray-400">ไม่มีรายการตามเงื่อนไข</p>}
          {list.map((l) => {
            const isPicked = picked.has(l.entryNo);
            // ยอดเท่ากับรายการที่เลือกไว้ฝั่งตรงข้าม — ชี้ให้เห็นว่าน่าจะเป็นคู่กัน
            const mirrorsPick = !isPicked && pickedCents[opposite].has(cents(l.amount));
            return (
              <label
                key={l.entryNo}
                className={`flex cursor-pointer items-center gap-2.5 border-t border-gray-50 px-3 py-2 first:border-t-0 transition-colors ${
                  isPicked ? "bg-teal-50/70" : mirrorsPick ? "bg-teal-50/30 hover:bg-teal-50/60" : "hover:bg-gray-50"
                }`}
              >
                <input
                  type="checkbox"
                  checked={isPicked}
                  onChange={() => togglePicked(l.entryNo)}
                  disabled={busy}
                  className="h-4 w-4 shrink-0 rounded border-gray-300"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-[11px] text-gray-400">
                    <span className="tabular-nums">{formatDMY(l.date)}</span>
                    {isReversalSource(l.sourceCode) && <ReversalTag />}
                    {mirrorsPick && <span className="font-medium text-teal-700">ยอดตรงกับที่เลือก</span>}
                  </div>
                  <p className="truncate text-sm text-gray-800" title={l.ref}>
                    {l.ref}
                  </p>
                </div>
                <span className="shrink-0 text-sm tabular-nums text-gray-900">{formatAmount(l.amount)}</span>
              </label>
            );
          })}
        </div>
      </div>
    );
  }

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
        aria-labelledby="gl-offset-title"
        initial={{ opacity: 0, scale: 0.94, y: 14 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8, transition: { duration: 0.15 } }}
        transition={{ type: "spring", stiffness: 400, damping: 28 }}
        className="flex h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-white/70 bg-white/95 shadow-2xl backdrop-blur-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-gray-100 px-5 py-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-teal-50 text-teal-600">
              <Scale size={18} />
            </span>
            <div className="min-w-0">
              <h2 id="gl-offset-title" className="text-base font-semibold text-gray-900">
                หักล้างกันเอง (ฝั่ง BC365)
              </h2>
              <p className="text-xs text-gray-500">
                รายการใน BC ที่ยกเลิกกันเองจนยอดสุทธิเป็น 0 ไม่มีเงินผ่านธนาคาร จึงไม่ต้องจับคู่กับ Bank Statement
              </p>
              <p className="mt-0.5 truncate text-[11px] text-gray-400" title={accountLabel}>
                {accountLabel} · {formatDMY(periodStart)} - {formatDMY(periodEnd)}
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

        <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-gray-100 px-5">
          {tabs.map((t) => {
            const active = tab === t.value;
            return (
              <button
                key={t.value}
                onClick={() => switchTab(t.value)}
                aria-pressed={active}
                className={`-mb-px inline-flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-semibold transition-colors ${
                  active ? "border-teal-600 text-teal-700" : "border-transparent text-gray-400 hover:text-gray-700"
                }`}
              >
                {t.label}
                {t.count !== null && (
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[11px] font-medium tabular-nums ${
                      active ? "bg-teal-600 text-white" : "bg-gray-100 text-gray-500"
                    }`}
                  >
                    {t.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto bg-gray-50/60 px-4 py-4 sm:px-5">
          {tab === "auto" && (
            <div className="flex flex-col gap-3">
              <p className="text-xs leading-relaxed text-gray-500">
                ระบบจับคู่แถวที่ BC กลับรายการ (Source Code = REVERSAL) กับใบเดิมที่<b>เลขเอกสารเดียวกัน</b>
                และยอดตรงข้ามกันพอดี — รายการเหล่านี้ถูกซ่อนจากตารางแล้ว กดยืนยันเพื่อบันทึกเก็บไว้ตรวจสอบย้อนหลัง
              </p>
              {visiblePairs.length === 0 ? (
                <div className="flex min-h-[260px] flex-col items-center justify-center gap-2 text-center">
                  <CircleCheck size={28} className="text-teal-500" />
                  <p className="text-sm font-medium text-gray-700">ไม่มีรายการกลับรายการที่รอยืนยันในงวดนี้</p>
                  <p className="max-w-sm text-xs text-gray-400">
                    ถ้าแก้รายการด้วย JV (เลขเอกสารคนละใบ) ระบบจะจับให้ไม่ได้ — ใช้แท็บ &ldquo;จับคู่เอง&rdquo;
                  </p>
                </div>
              ) : (
                <>
                  <label className="inline-flex cursor-pointer select-none items-center gap-2 text-xs font-medium text-gray-600">
                    <input
                      type="checkbox"
                      checked={allPairsTicked}
                      onChange={() =>
                        setUnticked(allPairsTicked ? new Set(visiblePairs.map((p) => p.key)) : new Set())
                      }
                      disabled={busy}
                      className="h-4 w-4 rounded border-gray-300"
                    />
                    เลือกทั้งหมด ({visiblePairs.length} คู่)
                  </label>
                  {visiblePairs.map((p) => {
                    const ticked = !unticked.has(p.key);
                    return (
                      <label
                        key={p.key}
                        className={`flex cursor-pointer gap-3 rounded-xl border bg-white p-3 transition-colors ${
                          ticked ? "border-teal-300 ring-1 ring-teal-100" : "border-gray-200 hover:border-gray-300"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={ticked}
                          disabled={busy}
                          onChange={() =>
                            setUnticked((prev) => {
                              const next = new Set(prev);
                              if (next.has(p.key)) next.delete(p.key);
                              else next.add(p.key);
                              return next;
                            })
                          }
                          className="mt-1.5 h-4 w-4 shrink-0 rounded border-gray-300"
                        />
                        <div className="min-w-0 flex-1">
                          <LineRow label="ใบเดิม" line={p.original} />
                          <LineRow label="กลับรายการ" line={p.reversal} />
                        </div>
                        <div className="shrink-0 border-l border-gray-100 pl-3 text-right">
                          <p className="text-[10px] text-gray-400">สุทธิ</p>
                          <p className="text-sm font-semibold tabular-nums text-teal-700">
                            {formatAmount(Math.abs(signedOf(p.original) + signedOf(p.reversal)))}
                          </p>
                        </div>
                      </label>
                    );
                  })}
                </>
              )}
            </div>
          )}

          {tab === "manual" && (
            <div className="flex flex-col gap-3">
              <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <TriangleAlert size={14} className="mt-0.5 shrink-0" />
                <span>
                  ใช้กับรายการที่ยกเลิกกันเองใน BC โดยไม่ได้กด Reverse เช่น แก้ด้วย JV — ถ้ามีเงินผ่านธนาคารจริง
                  ให้ปิดหน้าต่างนี้แล้วจับคู่กับ Bank ด้วยปุ่ม Match แทน ยอดขาเข้ากับขาออกที่เลือกต้องเท่ากันพอดี
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative min-w-[220px] flex-1">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="ค้นหาเลขเอกสาร หรือยอดเงิน"
                    className="w-full rounded-lg border border-gray-200 bg-white py-1.5 pl-8 pr-2.5 text-sm text-gray-700"
                  />
                </div>
                <label className="inline-flex cursor-pointer select-none items-center gap-2 text-xs font-medium text-gray-600">
                  <input
                    type="checkbox"
                    checked={onlyMirrored}
                    onChange={(e) => setOnlyMirrored(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300"
                  />
                  เฉพาะยอดที่มีขาตรงข้ามเท่ากัน
                </label>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {renderManualColumn("IN")}
                {renderManualColumn("OUT")}
              </div>
            </div>
          )}

          {tab === "done" && (
            <div className="flex flex-col gap-3">
              {confirmedError && <p className="text-sm text-red-600">{confirmedError}</p>}
              {confirmed === null && !confirmedError && (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-gray-400">
                  <Loader2 size={16} className="animate-spin" /> กำลังโหลด...
                </div>
              )}
              {confirmed !== null && confirmed.length === 0 && (
                <p className="py-10 text-center text-sm text-gray-400">ยังไม่มีรายการหักล้างกันเองที่ยืนยันไว้ในงวดนี้</p>
              )}
              {confirmed?.map((g) => {
                const key = `${g.matchId}:${g.num}`;
                const undoing = undoKey === key;
                return (
                  <div key={key} className="rounded-xl border border-gray-200 bg-white p-3">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-gray-900">
                        Match #{g.matchId} · กลุ่ม {g.num}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          g.kind === "REVERSAL" ? "bg-teal-100 text-teal-700" : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {g.kind === "REVERSAL" ? "กลับรายการใน BC" : "จับคู่เอง"}
                      </span>
                      <span className="text-[11px] text-gray-400">
                        {dateTimeFormatter.format(new Date(g.createdAt))}
                        {g.createdBy ? ` · โดย ${g.createdBy}` : ""}
                      </span>
                      <span className="flex-1" />
                      {!undoing && (
                        <button
                          onClick={() => {
                            setUndoKey(key);
                            setUndoReason("");
                          }}
                          disabled={busy}
                          className="flex items-center gap-1.5 rounded-full border border-red-200 px-2.5 py-1 text-[11px] font-medium text-red-600 transition-colors hover:border-red-600 hover:bg-red-600 hover:text-white disabled:opacity-40"
                        >
                          <Undo2 size={12} /> ยกเลิก
                        </button>
                      )}
                    </div>
                    {g.lines.map((l) => (
                      <LineRow key={l.entryNo} line={l} />
                    ))}
                    {undoing && (
                      <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-2">
                        <input
                          autoFocus
                          value={undoReason}
                          onChange={(e) => setUndoReason(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void undoGroup(g);
                          }}
                          placeholder="เหตุผลที่ยกเลิก (จำเป็น)"
                          className="min-w-[220px] flex-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm text-gray-700"
                        />
                        <button
                          onClick={() => setUndoKey(null)}
                          disabled={busy}
                          className="rounded-full px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 disabled:opacity-40"
                        >
                          ไม่ยกเลิก
                        </button>
                        <button
                          onClick={() => void undoGroup(g)}
                          disabled={busy || !undoReason.trim()}
                          className="flex items-center gap-1.5 rounded-full bg-red-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-40"
                        >
                          {busy && <Loader2 size={12} className="animate-spin" />}
                          ยืนยันยกเลิก
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-gray-100 bg-white px-5 py-3">
          <div className="min-w-0 flex-1">
            {error ? (
              <p className="text-xs font-medium text-red-600">{error}</p>
            ) : notice ? (
              <p className="inline-flex items-center gap-1 text-xs font-medium text-teal-700">
                <CircleCheck size={14} /> {notice}
              </p>
            ) : tab === "manual" ? (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
                <span>
                  ขาเข้า <b className="tabular-nums text-gray-900">{formatAmount(manualIn)}</b>
                </span>
                <span>
                  ขาออก <b className="tabular-nums text-gray-900">{formatAmount(manualOut)}</b>
                </span>
                <span>
                  สุทธิ{" "}
                  <b className={`tabular-nums ${manualProblem ? "text-red-600" : "text-teal-700"}`}>
                    {formatAmount(Math.abs(manualIn - manualOut))}
                  </b>
                </span>
                {manualProblem && <span className="text-amber-700">{manualProblem}</span>}
              </div>
            ) : (
              <p className="text-[11px] text-gray-400">
                {tab === "done"
                  ? "ยกเลิกแล้วรายการจะกลับไปรอในตาราง (คู่กลับรายการใน BC จะกลับมารอยืนยันในแท็บแรก)"
                  : "บันทึกเป็นประเภทหักล้างกันเอง พร้อมชื่อผู้ยืนยัน — ยกเลิกได้ภายหลังที่แท็บยืนยันแล้ว"}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {tab === "manual" && picked.size > 0 && (
              <button
                onClick={() => setPicked(new Set())}
                disabled={busy}
                className="px-2 text-xs text-gray-500 hover:text-gray-800 disabled:opacity-40"
              >
                ล้างที่เลือก
              </button>
            )}
            <button
              onClick={close}
              disabled={busy}
              className="rounded-full border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
            >
              ปิด
            </button>
            {tab === "auto" && visiblePairs.length > 0 && (
              <button
                onClick={confirmPairs}
                disabled={busy || selectedPairs.length === 0}
                className="flex items-center gap-1.5 rounded-full bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-40"
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Scale size={14} />}
                ยืนยันหักล้าง {selectedPairs.length} คู่
              </button>
            )}
            {tab === "manual" && (
              <button
                onClick={confirmManual}
                disabled={busy || !canConfirmManual}
                title={manualProblem ?? undefined}
                className="flex items-center gap-1.5 rounded-full bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-40"
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Scale size={14} />}
                ยืนยันหักล้าง {pickedLines.length > 0 ? `${pickedLines.length} รายการ` : ""}
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );

  // portal ออกไปที่ body — กัน transform ของ workspace ที่ครอบอยู่ทำให้ fixed overlay ไม่เต็มจอ
  return createPortal(modal, document.body);
}
