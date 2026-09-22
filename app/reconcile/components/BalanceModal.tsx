"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Loader2, Pencil, Undo2, X } from "lucide-react";
import type { BalanceData } from "./balanceTypes";
import OpeningBalanceInput, { parseAmountInput } from "./OpeningBalanceInput";

const EPS = 0.005;

function formatAmount(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatSigned(n: number) {
  if (Math.abs(n) < EPS) return "0.00";
  return `${n > 0 ? "+" : "−"}${formatAmount(Math.abs(n))}`;
}
function formatDMY(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}
function amountOrDash(n: number | null) {
  return n === null ? "—" : formatAmount(n);
}

type Tab = "summary" | "daily";

/**
 * สรุปยอดคงเหลือ Bank เทียบ GL เรียงแบบกระดาษที่ทีมบัญชีทำมือ:
 *   Bank ปลายงวด − GL ก่อนปรับปรุง = ยอดพักโอน → ต้องมี JV ปรับปรุงพักโอนใน BC ยอดเท่ากัน
 * แท็บรายวันเลียนแบบ pivot ที่ทีมทำมือ: รับ/จ่าย/คงเหลือสะสมทั้งสองฝั่ง จะเห็นทันทีว่าเริ่มไม่ตรงวันไหน
 */
export default function BalanceModal({
  data,
  loading,
  error,
  accountLabel,
  onClose,
  onSaveOpening,
  onUndoExcluded,
}: {
  data: BalanceData | null;
  loading: boolean;
  error: string;
  accountLabel: string;
  onClose: () => void;
  onSaveOpening: (amount: number) => Promise<string | null>;
  onUndoExcluded: (matchId: number, num: number, reason: string) => Promise<string | null>;
}) {
  const [tab, setTab] = useState<Tab>("summary");
  const [editingOpening, setEditingOpening] = useState(false);
  const [openingText, setOpeningText] = useState("");
  const [savingOpening, setSavingOpening] = useState(false);
  const [actionError, setActionError] = useState("");
  const [undoKey, setUndoKey] = useState<string | null>(null);
  const [undoReason, setUndoReason] = useState("");
  const [undoing, setUndoing] = useState(false);

  const needsOpening = data !== null && data.extrasReady && data.gl.opening === null;
  const showOpeningInput = needsOpening || editingOpening;

  async function saveOpening() {
    const amount = parseAmountInput(openingText);
    if (amount === null) return;
    setSavingOpening(true);
    setActionError("");
    const problem = await onSaveOpening(amount);
    setSavingOpening(false);
    if (problem) setActionError(problem);
    else setEditingOpening(false);
  }

  async function undo(matchId: number, num: number) {
    if (!undoReason.trim()) return;
    setUndoing(true);
    setActionError("");
    const problem = await onUndoExcluded(matchId, num, undoReason.trim());
    setUndoing(false);
    if (problem) setActionError(problem);
    else {
      setUndoKey(null);
      setUndoReason("");
    }
  }

  // ปรับปรุงครบ = ยอดพักโอนมี JV ปรับปรุงรองรับเต็มจำนวน (หรือไม่มียอดพักโอนเลย) → GL หลังปรับปรุงเท่ากับ Bank
  const remaining = data?.adjustment.remaining ?? null;
  const settled = remaining !== null && Math.abs(remaining) < EPS;
  const hasSuspense = data?.difference !== null && data?.difference !== undefined && Math.abs(data.difference) >= EPS;

  const breakdownRows = data
    ? [
        {
          label: "ผลต่างยอดยกมาต้นงวด",
          hint: "ยอดที่ค้างมาจากงวดก่อน (Bank ยกมา − GL ยกมา)",
          value: data.breakdown.openingDifference,
        },
        {
          label: `Bank ยังไม่จับคู่ (${data.breakdown.bankUnmatched.count} รายการ)`,
          hint: "เงินเข้า/ออกในธนาคารที่ยังไม่มีรายการใน BC เช่น เงินโอนที่ยังไม่ทราบผู้โอน",
          value: data.breakdown.bankUnmatched.net,
        },
        {
          label: `GL ยังไม่จับคู่ (${data.breakdown.glUnmatched.count} รายการ)`,
          hint: "รายการใน BC ที่ยังไม่ได้จับคู่ ไม่ได้พัก",
          value: -data.breakdown.glUnmatched.net,
        },
        {
          label: `GL พักไว้ (${data.breakdown.glSuspense.count} รายการ)`,
          hint: "ย้ายเข้าบัญชีพักแล้ว",
          value: -data.breakdown.glSuspense.net,
        },
        {
          label: `พักโอนส่วนต่างอัตโนมัติ (${data.differenceMatches.length} คู่)`,
          hint: "ผลต่างของคู่ที่ยอด Bank และ BC ไม่เท่ากัน",
          value: data.breakdown.suspenseDifference,
        },
        {
          label: "จับคู่ข้ามงวด",
          hint: "คู่ที่อีกฝั่งอยู่นอกช่วงวันที่นี้",
          value: data.breakdown.crossPeriodMatched,
        },
      ]
    : [];

  const modal = (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-md px-3 sm:px-4"
      onClick={onClose}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="balance-title"
        initial={{ opacity: 0, scale: 0.94, y: 14 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 6, transition: { duration: 0.15 } }}
        transition={{ type: "spring", stiffness: 420, damping: 28 }}
        className="w-full max-w-5xl bg-white/95 backdrop-blur-2xl border border-white/70 rounded-2xl shadow-2xl flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-gray-100 shrink-0">
          <div className="min-w-0">
            <h2 id="balance-title" className="text-base font-semibold text-gray-900">
              ยอดคงเหลือ Bank เทียบ GL
            </h2>
            <p className="text-xs text-gray-500 mt-0.5 truncate">
              {accountLabel}
              {data && ` · ${formatDMY(data.period.from)} – ${formatDMY(data.period.to)}`}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex rounded-full bg-gray-100 p-0.5 text-xs font-medium">
              {(["summary", "daily"] as Tab[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`rounded-full px-3 py-1 transition-colors ${
                    tab === t ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  {t === "summary" ? "สรุป" : "รายวัน"}
                </button>
              ))}
            </div>
            <button onClick={onClose} aria-label="ปิด" className="text-gray-400 hover:text-gray-600">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto px-5 py-4 flex-1 min-h-0">
          {loading && !data && (
            <div className="py-12 flex items-center justify-center gap-2 text-sm text-gray-400">
              <Loader2 size={16} className="animate-spin" /> กำลังคำนวณยอดคงเหลือ...
            </div>
          )}
          {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
          {actionError && <p className="mb-3 text-sm text-red-600">{actionError}</p>}

          {data && (
            <>
              {!data.extrasReady && (
                <Notice>
                  ยังบันทึกยอดยกมา GL ไม่ได้ — ต้องรัน <span className="font-mono">sql/007_match_remark_opening_balance.sql</span>{" "}
                  กับฐานข้อมูลก่อน
                </Notice>
              )}
              {data.bank.lineCount === 0 && <Notice>ไม่มีรายการ Bank statement ในช่วงวันที่นี้ — ยังไม่ได้นำเข้าไฟล์?</Notice>}
              {data.bank.lineCount > 0 && !data.bank.chainOk && (
                <Notice>
                  ยอดคงเหลือในไฟล์ statement ต่อกันไม่ครบทุกบรรทัด (ไฟล์อาจขาดบางรายการ หรือธนาคารไม่ส่งยอดคงเหลือมา) —
                  ยอดยกมาฝั่ง Bank อาจไม่ถูกต้อง
                </Notice>
              )}

              {tab === "summary" && (
                <>
                  <div className="grid gap-3 md:grid-cols-3">
                    <SideCard
                      title="Bank statement"
                      opening={data.bank.opening}
                      totalIn={data.bank.totalIn}
                      totalOut={data.bank.totalOut}
                      closing={data.bank.closing}
                      openingNote="คำนวณจากยอดคงเหลือในไฟล์"
                    />
                    <SideCard
                      title="GL (BC365) ก่อนปรับปรุง"
                      opening={data.gl.opening}
                      totalIn={data.gl.totalIn}
                      totalOut={data.gl.totalOut}
                      closing={data.gl.closing}
                      openingNote={
                        data.gl.opening !== null && data.gl.openingSavedBy
                          ? `กรอกโดย ${data.gl.openingSavedBy}`
                          : "ต้องกรอกเอง"
                      }
                      openingAction={
                        data.extrasReady && data.gl.opening !== null && !editingOpening ? (
                          <button
                            onClick={() => {
                              setOpeningText(formatAmount(data.gl.opening as number));
                              setEditingOpening(true);
                            }}
                            className="text-gray-400 hover:text-blue-600"
                            title="แก้ไขยอดยกมา GL"
                            aria-label="แก้ไขยอดยกมา GL"
                          >
                            <Pencil size={12} />
                          </button>
                        ) : null
                      }
                    >
                      {data.extrasReady && showOpeningInput && (
                        <div className="mt-2">
                          <p className="mb-1 text-[11px] text-gray-500">
                            ยอดยกมา GL ณ ต้นวันที่ {formatDMY(data.period.from)} (ยอดคงเหลือใน BC สิ้นวันก่อนหน้า)
                          </p>
                          <OpeningBalanceInput
                            value={openingText}
                            onChange={setOpeningText}
                            suggestion={data.gl.suggestedOpening}
                            suggestionFrom={data.gl.suggestedFromPeriod ? formatDMY(data.gl.suggestedFromPeriod) : null}
                            saving={savingOpening}
                            onSave={saveOpening}
                          />
                        </div>
                      )}
                    </SideCard>

                    <div
                      className={`rounded-xl border p-4 ${
                        data.difference === null
                          ? "border-gray-200 bg-gray-50"
                          : settled
                            ? "border-emerald-200 bg-emerald-50"
                            : "border-amber-200 bg-amber-50"
                      }`}
                    >
                      <p className="text-xs font-semibold text-gray-500">ยอดพักโอน (Bank − GL ก่อนปรับปรุง)</p>
                      {data.difference === null ? (
                        <p className="mt-2 text-sm text-gray-500">กรอกยอดยกมา GL ก่อน จึงจะคำนวณยอดพักโอนได้</p>
                      ) : (
                        <>
                          <p className="mt-1 text-2xl font-semibold tabular-nums text-gray-900">
                            {formatSigned(data.difference)}
                          </p>
                          <dl className="mt-2 space-y-1 text-sm">
                            <div className="flex justify-between gap-2">
                              <dt className="text-gray-500">JV ปรับปรุงพักโอน ({data.adjustment.count})</dt>
                              <dd className="tabular-nums text-gray-900">{formatSigned(data.adjustment.net)}</dd>
                            </div>
                            <div className="flex justify-between gap-2">
                              <dt className="text-gray-500">GL หลังปรับปรุง</dt>
                              <dd className="tabular-nums text-gray-900">{amountOrDash(data.adjustment.glClosingAfter)}</dd>
                            </div>
                          </dl>
                          {settled ? (
                            <p className="mt-2 flex items-center gap-1.5 text-sm font-semibold text-emerald-700">
                              <CheckCircle2 size={16} />
                              {hasSuspense ? "ปรับปรุงครบ GL เท่ากับ Bank" : "ยอดคงเหลือเท่ากัน ไม่มียอดพักโอน"}
                            </p>
                          ) : data.adjustment.count === 0 ? (
                            <p className="mt-2 text-xs text-amber-800">
                              ต้องบันทึก JV ปรับปรุงพักโอน {formatAmount(Math.abs(data.difference))} ใน BC แล้วซิงค์
                              จากนั้นติ๊ก JV นั้นในตาราง GL กดปุ่ม &quot;ปรับปรุงพักโอน&quot;
                            </p>
                          ) : (
                            <p className="mt-2 text-xs font-medium text-rose-700">
                              JV ปรับปรุงยังไม่เท่ายอดพักโอน ขาดอีก {formatSigned(remaining as number)}
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  {hasSuspense && (
                    <div className="mt-5">
                      <h3 className="text-sm font-semibold text-gray-800">ยอดพักโอนประกอบด้วย</h3>
                      <table className="mt-2 w-full text-sm">
                        <tbody className="divide-y divide-gray-100">
                          {breakdownRows
                            .filter((r) => r.value !== null && Math.abs(r.value) >= EPS)
                            .map((r) => (
                              <tr key={r.label}>
                                <td className="py-2 pr-3">
                                  <p className="text-gray-800">{r.label}</p>
                                  <p className="text-[11px] text-gray-400">{r.hint}</p>
                                </td>
                                <td className="py-2 text-right tabular-nums text-gray-900 whitespace-nowrap">
                                  {formatSigned(r.value as number)}
                                </td>
                              </tr>
                            ))}
                          <tr className="font-semibold">
                            <td className="py-2">รวมยอดพักโอน</td>
                            <td className="py-2 text-right tabular-nums">{formatSigned(data.difference as number)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}

                  {data.differenceMatches.length > 0 && (
                    <div className="mt-5">
                      <h3 className="text-sm font-semibold text-gray-800">พักโอนส่วนต่างจากการจับคู่</h3>
                      <ul className="mt-2 divide-y divide-gray-100 rounded-xl border border-gray-100">
                        {data.differenceMatches.map((m) => (
                          <li key={m.matchId} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
                            <div className="min-w-0">
                              <p className="text-gray-800">{m.remark}</p>
                              <p className="text-[11px] text-gray-400">
                                MatchId {m.matchId} · Bank {formatAmount(m.bankAmount)} / GL {formatAmount(m.glAmount)} ·{" "}
                                {m.createdBy}
                              </p>
                            </div>
                            <span className="shrink-0 rounded-full bg-amber-50 px-2.5 py-1 tabular-nums font-semibold text-amber-700">
                              พักโอน {formatSigned(m.difference)}
                            </span>
                          </li>
                        ))}
                      </ul>
                      <p className="mt-1 text-[11px] text-gray-400">ยกเลิกคู่เหล่านี้ได้ที่หน้าประวัติการจับคู่</p>
                    </div>
                  )}

                  {data.excluded.length > 0 && (
                    <div className="mt-5">
                      <h3 className="text-sm font-semibold text-gray-800">JV ปรับปรุงพักโอน</h3>
                      <ul className="mt-2 divide-y divide-gray-100 rounded-xl border border-gray-100">
                        {data.excluded.map((g) => {
                          const key = `${g.matchId}-${g.num}`;
                          const total = g.entries.reduce((s, e) => s + e.amount, 0);
                          return (
                            <li key={key} className="px-3 py-2 text-sm">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="text-gray-800">{g.remark ?? "—"}</p>
                                  <p className="text-[11px] text-gray-400">
                                    {g.entries
                                      .map((e) => `${formatDMY(e.date)} ${e.documentNo ?? `#${e.entryNo}`} ${formatAmount(Math.abs(e.amount))}`)
                                      .join(" · ")}
                                  </p>
                                </div>
                                <div className="flex shrink-0 items-center gap-2">
                                  <span className="tabular-nums font-medium text-gray-900">{formatSigned(total)}</span>
                                  {undoKey !== key && (
                                    <button
                                      onClick={() => {
                                        setUndoKey(key);
                                        setUndoReason("");
                                      }}
                                      className="flex items-center gap-1 rounded-full border border-gray-200 px-2 py-0.5 text-[11px] text-gray-600 hover:bg-gray-50"
                                    >
                                      <Undo2 size={11} /> ยกเลิก
                                    </button>
                                  )}
                                </div>
                              </div>
                              {undoKey === key && (
                                <div className="mt-2 flex items-center gap-2">
                                  <input
                                    value={undoReason}
                                    onChange={(e) => setUndoReason(e.target.value)}
                                    placeholder="เหตุผลที่ยกเลิก"
                                    autoFocus
                                    className="flex-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs focus:border-blue-400 focus:outline-none"
                                  />
                                  <button
                                    onClick={() => undo(g.matchId, g.num)}
                                    disabled={undoing || !undoReason.trim()}
                                    className="flex items-center gap-1 rounded-lg bg-slate-700 px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                                  >
                                    {undoing && <Loader2 size={11} className="animate-spin" />}
                                    ยืนยัน
                                  </button>
                                  <button onClick={() => setUndoKey(null)} className="text-xs text-gray-500 px-1">
                                    ปิด
                                  </button>
                                </div>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                </>
              )}

              {tab === "daily" && <DailyTable data={data} />}
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  );

  return createPortal(modal, document.body);
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

function SideCard({
  title,
  opening,
  totalIn,
  totalOut,
  closing,
  openingNote,
  openingAction,
  children,
}: {
  title: string;
  opening: number | null;
  totalIn: number;
  totalOut: number;
  closing: number | null;
  openingNote: string;
  openingAction?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-xs font-semibold text-gray-500">{title}</p>
      <dl className="mt-2 space-y-1 text-sm">
        <div className="flex justify-between gap-2">
          <dt className="text-gray-500">
            <span className="flex items-center gap-1">ยอดยกมา {openingAction}</span>
            <span className="block text-[10px] text-gray-400">{openingNote}</span>
          </dt>
          <dd className="tabular-nums text-gray-900">{amountOrDash(opening)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-gray-500">+ รับ</dt>
          <dd className="tabular-nums text-gray-900">{formatAmount(totalIn)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-gray-500">− จ่าย</dt>
          <dd className="tabular-nums text-gray-900">{formatAmount(totalOut)}</dd>
        </div>
        <div className="flex justify-between gap-2 border-t border-gray-100 pt-1 font-semibold">
          <dt className="text-gray-700">ยอดคงเหลือ</dt>
          <dd className="tabular-nums text-gray-900">{amountOrDash(closing)}</dd>
        </div>
      </dl>
      {children}
    </div>
  );
}

function DailyTable({ data }: { data: BalanceData }) {
  if (data.daily.length === 0) {
    return <p className="py-10 text-center text-sm text-gray-400">ไม่มีรายการเคลื่อนไหวในช่วงวันที่นี้</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] text-xs">
        <thead className="sticky top-0 bg-white text-[11px] text-gray-500">
          <tr>
            <th rowSpan={2} className="border-b border-gray-200 py-2 pr-2 text-left font-medium">
              วันที่
            </th>
            <th colSpan={3} className="border-b border-gray-100 py-1 text-center font-semibold text-gray-700">
              Bank statement
            </th>
            <th colSpan={3} className="border-b border-gray-100 py-1 text-center font-semibold text-gray-700">
              GL (BC365) ก่อนปรับปรุง
            </th>
            <th rowSpan={2} className="border-b border-gray-200 py-2 pl-2 text-right font-medium">
              ผลต่างคงเหลือ
            </th>
          </tr>
          <tr>
            {["รับ", "จ่าย", "คงเหลือ", "รับ", "จ่าย", "คงเหลือ"].map((h, i) => (
              <th key={i} className="border-b border-gray-200 py-1.5 px-2 text-right font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          <tr className="text-gray-500">
            <td className="py-1.5 pr-2">ยกมา</td>
            <td colSpan={2} />
            <td className="px-2 text-right tabular-nums">{amountOrDash(data.bank.opening)}</td>
            <td colSpan={2} />
            <td className="px-2 text-right tabular-nums">{amountOrDash(data.gl.opening)}</td>
            <td className="pl-2 text-right tabular-nums">
              {data.breakdown.openingDifference === null ? "—" : formatSigned(data.breakdown.openingDifference)}
            </td>
          </tr>
          {data.daily.map((d) => {
            const inDiff = Math.abs(d.dayDiffIn) >= EPS;
            const outDiff = Math.abs(d.dayDiffOut) >= EPS;
            const gap = d.bankBalance !== null && d.glBalance !== null ? d.bankBalance - d.glBalance : null;
            return (
              <tr key={d.date} className={inDiff || outDiff ? "bg-amber-50/50" : ""}>
                <td className="py-1.5 pr-2 whitespace-nowrap text-gray-700">{formatDMY(d.date)}</td>
                <td className={`px-2 text-right tabular-nums ${inDiff ? "font-semibold text-amber-800" : ""}`}>
                  {formatAmount(d.bankIn)}
                </td>
                <td className={`px-2 text-right tabular-nums ${outDiff ? "font-semibold text-amber-800" : ""}`}>
                  {formatAmount(d.bankOut)}
                </td>
                <td
                  className={`px-2 text-right tabular-nums ${d.bankStatementMismatch ? "text-red-600" : "text-gray-900"}`}
                  title={d.bankStatementMismatch ? "ไม่ตรงกับยอดคงเหลือในไฟล์ statement" : undefined}
                >
                  {amountOrDash(d.bankBalance)}
                </td>
                <td className={`px-2 text-right tabular-nums ${inDiff ? "font-semibold text-amber-800" : ""}`}>
                  {formatAmount(d.glIn)}
                </td>
                <td className={`px-2 text-right tabular-nums ${outDiff ? "font-semibold text-amber-800" : ""}`}>
                  {formatAmount(d.glOut)}
                </td>
                <td className="px-2 text-right tabular-nums text-gray-900">{amountOrDash(d.glBalance)}</td>
                <td
                  className={`pl-2 text-right tabular-nums ${
                    gap === null ? "text-gray-400" : Math.abs(gap) < EPS ? "text-emerald-700" : "text-rose-700"
                  }`}
                >
                  {gap === null ? "—" : formatSigned(gap)}
                </td>
              </tr>
            );
          })}
          {data.difference !== null && (
            <tr className="border-t border-gray-200 font-semibold">
              <td className="py-1.5 pr-2 whitespace-nowrap text-gray-700">ยอดพักโอน</td>
              <td colSpan={6} className="px-2 text-right text-[11px] font-normal text-gray-500">
                JV ปรับปรุงพักโอน {formatSigned(data.adjustment.net)} · GL หลังปรับปรุง{" "}
                {amountOrDash(data.adjustment.glClosingAfter)}
              </td>
              <td className="pl-2 text-right tabular-nums text-gray-900">{formatSigned(data.difference)}</td>
            </tr>
          )}
        </tbody>
      </table>
      <p className="mt-2 text-[11px] text-gray-400">แถวสีเหลือง = วันที่ยอดรับหรือจ่ายของสองฝั่งไม่เท่ากัน</p>
    </div>
  );
}
