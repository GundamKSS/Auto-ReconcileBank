"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { Loader2, X } from "lucide-react";
import { remarkProblem, REMARK_MAX_LENGTH } from "../../../lib/matchRemark";

export type RemarkLine = { id: string; side: "Bank" | "GL"; date: string; ref: string; amount: number };

function formatAmount(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatDMY(iso: string) {
  const [y, m, d] = new Date(iso).toISOString().slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/**
 * ยืนยันการกระทำที่ต้องมีหมายเหตุ — ใช้ 2 แบบ
 *   mode "match":   จับคู่ยอดหลักและพักโอนเฉพาะส่วนต่างไว้กับ MatchId (เคส Bank 649,469.00 / BC 649,469.56)
 *   mode "exclude": JV ปรับปรุงพักโอนใน BC — ไม่นำมาจับคู่ ใช้ปิดยอดพักโอน
 * หมายเหตุบังคับทั้งสองแบบ เพราะอีกเดือนมาเปิดดูต้องรู้ว่าทำไมรายการนี้ไม่ดุล/ไม่มีคู่
 */
export default function RemarkActionModal({
  mode,
  lines,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  mode: "match" | "exclude";
  lines: RemarkLine[];
  busy: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: (remark: string) => void;
}) {
  // JV ปรับปรุงพักโอนมีเหตุผลเดียวกันเกือบทุกครั้ง — เติมให้ก่อน แก้ได้
  const [remark, setRemark] = useState(mode === "exclude" ? "JV ปรับปรุงพักโอน" : "");
  const [touched, setTouched] = useState(false);
  const problem = remarkProblem(remark);

  const bankTotal = lines.filter((l) => l.side === "Bank").reduce((s, l) => s + l.amount, 0);
  const glTotal = lines.filter((l) => l.side === "GL").reduce((s, l) => s + l.amount, 0);
  const diff = bankTotal - glTotal;
  const isMatch = mode === "match";

  function submit() {
    setTouched(true);
    if (problem || busy) return;
    onConfirm(remark.trim());
  }

  const modal = (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-md px-4"
      onClick={() => !busy && onCancel()}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="remark-action-title"
        initial={{ opacity: 0, scale: 0.9, y: 14 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 6, transition: { duration: 0.15 } }}
        transition={{ type: "spring", stiffness: 420, damping: 26 }}
        className="w-full max-w-lg bg-white/90 backdrop-blur-2xl border border-white/70 rounded-2xl shadow-2xl flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-gray-100 shrink-0">
          <div>
            <h2 id="remark-action-title" className="text-base font-semibold text-gray-900">
              {isMatch ? "จับคู่และพักโอนส่วนต่าง" : "JV ปรับปรุงพักโอน"}
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {isMatch
                ? "ระบบจะจับคู่รายการต้นทางตามจริง และพักเฉพาะส่วนต่างไว้กับ MatchId นี้โดยอัตโนมัติ"
                : "ไม่นำมาจับคู่กับ Bank — ใช้ปิดยอดพักโอน (Bank − GL ก่อนปรับปรุง) ยกเลิกได้ที่หน้าสรุปยอดคงเหลือ"}
            </p>
          </div>
          <button
            onClick={() => !busy && onCancel()}
            disabled={busy}
            aria-label="ปิด"
            className="text-gray-400 hover:text-gray-600 active:scale-90 transition-transform disabled:opacity-40"
          >
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-3 flex-1 min-h-0">
          <table className="w-full text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-gray-400">
              <tr>
                {isMatch && <th className="text-left font-medium pb-2">ฝั่ง</th>}
                <th className="text-left font-medium pb-2">วันที่</th>
                <th className="text-left font-medium pb-2">อ้างอิง</th>
                <th className="text-right font-medium pb-2">จำนวนเงิน</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {lines.map((l) => (
                <tr key={l.id}>
                  {isMatch && <td className="py-2 text-gray-500">{l.side}</td>}
                  <td className="py-2 text-gray-500 whitespace-nowrap">{formatDMY(l.date)}</td>
                  <td className="py-2 text-gray-700 max-w-[200px] truncate" title={l.ref}>
                    {l.ref}
                  </td>
                  <td className="py-2 text-right text-gray-900 tabular-nums">{formatAmount(l.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="px-5 pt-3 pb-4 border-t border-gray-100 shrink-0 bg-gray-50/60 rounded-b-2xl">
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-500 mb-3">
            {isMatch ? (
              <>
                <span>
                  Bank <b className="text-gray-900 tabular-nums">{formatAmount(bankTotal)}</b>
                </span>
                <span>
                  GL <b className="text-gray-900 tabular-nums">{formatAmount(glTotal)}</b>
                </span>
                <span>
                  พักโอนส่วนต่าง{" "}
                  <b className="text-rose-700 tabular-nums">
                    {diff > 0 ? "+" : diff < 0 ? "−" : ""}{formatAmount(Math.abs(diff))} ({diff > 0 ? "Bank มากกว่า" : "GL มากกว่า"})
                  </b>
                </span>
              </>
            ) : (
              <span>
                GL {lines.length} รายการ ยอดรวม <b className="text-gray-900 tabular-nums">{formatAmount(glTotal)}</b>
              </span>
            )}
          </div>

          <label htmlFor="remark-input" className="block text-xs font-medium text-gray-600 mb-1">
            หมายเหตุ (บังคับ)
          </label>
          <textarea
            id="remark-input"
            value={remark}
            maxLength={REMARK_MAX_LENGTH}
            onChange={(e) => setRemark(e.target.value)}
            onBlur={() => setTouched(true)}
            rows={2}
            autoFocus
            placeholder={
              isMatch
                ? "เช่น ธนาคารรวมยอด QR ทั้งวัน อีก 1,000 ยังไม่ทราบผู้โอน"
                : "เช่น JV ปรับปรุงพักโอนสิ้นเดือน ส.ค."
            }
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-blue-400 focus:outline-none resize-none bg-white"
          />
          {touched && problem && <p className="text-xs text-amber-700 mt-1">{problem}</p>}
          {error && <p className="text-xs text-red-600 mt-1">{error}</p>}

          <div className="flex items-center justify-end gap-2 mt-3">
            <button
              onClick={onCancel}
              disabled={busy}
              className="text-sm text-gray-600 hover:bg-gray-100 active:scale-95 px-4 py-2 rounded-full transition-all disabled:opacity-40"
            >
              ยกเลิก
            </button>
            <button
              onClick={submit}
              disabled={busy || (touched && Boolean(problem))}
              className={`flex items-center gap-1.5 text-sm font-medium text-white active:scale-95 px-5 py-2 rounded-full transition-all disabled:opacity-50 disabled:active:scale-100 ${
                isMatch ? "bg-blue-600 hover:bg-blue-700" : "bg-slate-700 hover:bg-slate-800"
              }`}
            >
              {busy && <Loader2 size={14} className="animate-spin" />}
              {isMatch ? "ยืนยันและพักส่วนต่าง" : "ยืนยันปรับปรุงพักโอน"}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );

  return createPortal(modal, document.body);
}
