"use client";

import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { Loader2, X } from "lucide-react";

import { formatAmount } from '../../../lib/formatAmount';

function formatDMY(iso: string) {
  if (!iso) return "-";
  const [y, m, d] = new Date(iso).toISOString().slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

export type MatchGroupSummary = {
  key: string;
  bankCount: number;
  glCount: number;
  amount: number;
  dateFrom: string;
  dateTo: string;
};

// ยืนยันก่อนบันทึกจับคู่เมื่อเป็นการจับคู่หลายกลุ่มในคลิกเดียว (เช่น กดเลือก "ตรงกันทั้งหมด" แล้วกด Match
// ได้ทีเดียวหลายร้อยกลุ่ม) กลุ่มเดี่ยวที่ผู้ใช้เลือกเองทีละคู่ยังจับคู่ได้ทันทีไม่ต้องผ่านหน้านี้
// เพราะเห็นรายการบนจออยู่แล้วชัดเจน ความเสี่ยงอยู่ที่การยืนยันทีเดียวจำนวนมากโดยไม่ได้เห็นรายละเอียด
export default function MatchConfirmModal({
  groups,
  totalBankCount,
  totalGlCount,
  totalAmount,
  busy,
  onCancel,
  onConfirm,
}: {
  groups: MatchGroupSummary[];
  totalBankCount: number;
  totalGlCount: number;
  totalAmount: number;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
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
        aria-labelledby="match-confirm-title"
        initial={{ opacity: 0, scale: 0.9, y: 14 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 6, transition: { duration: 0.15 } }}
        transition={{ type: "spring", stiffness: 420, damping: 26 }}
        className="w-full max-w-lg bg-white/90 backdrop-blur-2xl border border-white/70 rounded-2xl shadow-2xl flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-gray-100 shrink-0">
          <div>
            <h2 id="match-confirm-title" className="text-base font-semibold text-gray-900">
              ยืนยันการจับคู่ {groups.length} กลุ่ม
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Bank {totalBankCount} รายการ · BC365 {totalGlCount} รายการ · บันทึกแยก {groups.length} กลุ่ม
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

        <div className="overflow-y-auto px-5 py-3 flex-1">
          <table className="w-full text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-gray-400">
              <tr>
                <th className="text-left font-medium pb-2">กลุ่ม</th>
                <th className="text-left font-medium pb-2">วันที่</th>
                <th className="text-right font-medium pb-2">รายการ (Bank:BC365)</th>
                <th className="text-right font-medium pb-2">จำนวนเงิน</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {groups.map((g, i) => (
                <tr key={g.key}>
                  <td className="py-2 text-gray-400 tabular-nums">{i + 1}</td>
                  <td className="py-2 text-gray-500 whitespace-nowrap">
                    {g.dateFrom === g.dateTo ? formatDMY(g.dateFrom) : `${formatDMY(g.dateFrom)} - ${formatDMY(g.dateTo)}`}
                  </td>
                  <td className="py-2 text-right text-gray-600 tabular-nums">
                    {g.bankCount}:{g.glCount}
                  </td>
                  <td className="py-2 text-right text-gray-900 tabular-nums">{formatAmount(g.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between px-5 py-4 border-t border-gray-100 shrink-0 bg-gray-50/60 rounded-b-2xl">
          <div>
            <p className="text-[11px] text-gray-400">ยอดรวมทั้งหมด</p>
            <p className="text-base font-semibold text-gray-900 tabular-nums">{formatAmount(totalAmount)} บาท</p>
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
              {busy && <Loader2 size={14} className="animate-spin" />}
              ยืนยันจับคู่ {groups.length} กลุ่ม
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );

  return createPortal(modal, document.body);
}
