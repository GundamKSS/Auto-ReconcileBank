"use client";

import { motion } from "framer-motion";
import { ArrowDownLeft, ArrowUpRight, Loader2, Undo2, X } from "lucide-react";

export type ConfirmLine = {
  key: string;
  matchId: number;
  sourceType: "BANK" | "GL";
  refId: number;
  date: string;
  detail: string;
  direction: "IN" | "OUT";
  amount: number;
};

function formatAmount(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatDate(iso: string) {
  return new Date(iso).toISOString().slice(0, 10);
}

function SourceTag({ sourceType }: { sourceType: "BANK" | "GL" }) {
  return (
    <span
      className={`text-[10px] font-semibold px-1.5 py-0.5 rounded whitespace-nowrap ${
        sourceType === "BANK" ? "bg-sky-100 text-sky-700" : "bg-violet-100 text-violet-700"
      }`}
    >
      {sourceType}
    </span>
  );
}

export default function UnsuspendConfirmModal({
  lines,
  busy,
  onCancel,
  onConfirm,
}: {
  lines: ConfirmLine[];
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const total = lines.reduce((s, l) => s + l.amount, 0);
  const matchCount = new Set(lines.map((l) => l.matchId)).size;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm px-4"
      onClick={() => !busy && onCancel()}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 6 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 6 }}
        transition={{ duration: 0.15 }}
        className="w-full max-w-lg bg-white rounded-2xl shadow-xl flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <div>
            <h2 className="text-base font-semibold text-gray-900">ยืนยันดึงกลับไป Reconcile</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {lines.length} รายการ · {matchCount} match — จะคืนสถานะเป็น UNMATCHED แล้วนำไปจับคู่ใหม่ได้ในหน้า Reconcile
            </p>
          </div>
          <button
            onClick={() => !busy && onCancel()}
            disabled={busy}
            className="text-gray-400 hover:text-gray-600 active:scale-90 transition-transform disabled:opacity-40"
          >
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-3 flex-1">
          <table className="w-full text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-gray-400">
              <tr>
                <th className="text-left font-medium pb-2">วันที่</th>
                <th className="text-left font-medium pb-2">ฝั่ง</th>
                <th className="text-left font-medium pb-2">รายละเอียด</th>
                <th className="text-right font-medium pb-2">จำนวนเงิน</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {lines.map((l) => (
                <tr key={l.key}>
                  <td className="py-2 text-gray-500 whitespace-nowrap">{formatDate(l.date)}</td>
                  <td className="py-2">
                    <SourceTag sourceType={l.sourceType} />
                  </td>
                  <td className="py-2 text-gray-700 max-w-[220px] truncate" title={l.detail}>
                    <span className="inline-flex items-center gap-1">
                      {l.direction === "IN" ? (
                        <ArrowDownLeft size={11} className="text-teal-600 shrink-0" />
                      ) : (
                        <ArrowUpRight size={11} className="text-red-500 shrink-0" />
                      )}
                      {l.detail}
                    </span>
                  </td>
                  <td className="py-2 text-right text-gray-900 tabular-nums">{formatAmount(l.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between px-5 py-4 border-t border-gray-100 shrink-0 bg-gray-50/60 rounded-b-2xl">
          <div>
            <p className="text-[11px] text-gray-400">ยอดรวม</p>
            <p className="text-base font-semibold text-gray-900 tabular-nums">{formatAmount(total)} บาท</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onCancel}
              disabled={busy}
              className="text-sm text-gray-600 hover:bg-gray-100 active:scale-95 px-4 py-2 rounded-full transition-all disabled:opacity-40"
            >
              ยกเลิก
            </button>
            <button
              onClick={onConfirm}
              disabled={busy}
              className="flex items-center gap-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 active:scale-95 px-5 py-2 rounded-full transition-all disabled:opacity-50 disabled:active:scale-100"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Undo2 size={14} />}
              ยืนยันดึงกลับ
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
