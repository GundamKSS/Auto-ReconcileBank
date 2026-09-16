"use client";

import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { Loader2, TriangleAlert, X } from "lucide-react";

type SuspenseLine = { id: string; date: string; ref: string; amount: number };

function formatAmount(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatDMY(iso: string) {
  const [y, m, d] = new Date(iso).toISOString().slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

// ยืนยันก่อนย้าย GL เข้าบัญชีพัก — เปิดหน้ามาระบบติ๊กคู่ที่จับได้ไว้ให้แล้ว (เช่น BBL พ.ค. GL IN 248 รายการ)
// ปุ่ม Move to suspense ใช้รายการที่ติ๊กชุดเดียวกับปุ่ม Match เดิมกดพลาดครั้งเดียวก็พักหมดทันที
export default function SuspenseConfirmModal({
  lines,
  direction,
  autoMatchedCount,
  busy,
  onCancel,
  onConfirm,
}: {
  lines: SuspenseLine[]; // เฉพาะฝั่ง GL — Bank Statement พักไม่ได้
  direction: "IN" | "OUT";
  autoMatchedCount: number; // ในนั้นมีกี่รายการที่ระบบจับคู่กับ Bank ได้อยู่แล้ว
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const total = lines.reduce((s, l) => s + l.amount, 0);

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
        aria-labelledby="suspense-confirm-title"
        initial={{ opacity: 0, scale: 0.9, y: 14 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 6, transition: { duration: 0.15 } }}
        transition={{ type: "spring", stiffness: 420, damping: 26 }}
        className="w-full max-w-lg bg-white/90 backdrop-blur-2xl border border-white/70 rounded-2xl shadow-2xl flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-gray-100 shrink-0">
          <div>
            <h2 id="suspense-confirm-title" className="text-base font-semibold text-gray-900">
              ยืนยันย้ายเข้าบัญชีพัก
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              GL (BC365) {lines.length} รายการ · ฝั่ง {direction} — รายการ Bank ที่เลือกไว้จะไม่ถูกพัก
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

        {autoMatchedCount > 0 && (
          <div className="mx-5 mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <TriangleAlert size={14} className="mt-0.5 shrink-0" />
            <span>
              มี <b>{autoMatchedCount}</b> รายการที่ระบบจับคู่กับ Bank ได้แล้ว (ติ๊กให้อัตโนมัติ) — ถ้าตั้งใจจับคู่
              ให้กดยกเลิกแล้วใช้ปุ่ม Match แทน
            </span>
          </div>
        )}

        <div className="overflow-y-auto px-5 py-3 flex-1">
          <table className="w-full text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-gray-400">
              <tr>
                <th className="text-left font-medium pb-2">วันที่</th>
                <th className="text-left font-medium pb-2">เลขที่เอกสาร</th>
                <th className="text-right font-medium pb-2">จำนวนเงิน</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {lines.map((l) => (
                <tr key={l.id}>
                  <td className="py-2 text-gray-500 whitespace-nowrap">{formatDMY(l.date)}</td>
                  <td className="py-2 text-gray-700 max-w-[220px] truncate" title={l.ref}>
                    {l.ref}
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
              className="flex items-center gap-1.5 text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 active:scale-95 px-5 py-2 rounded-full transition-all disabled:opacity-50 disabled:active:scale-100"
            >
              {busy && <Loader2 size={14} className="animate-spin" />}
              ยืนยันย้ายเข้าบัญชีพัก
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );

  // portal ออกไปที่ body — กัน transform ของ workspace ที่ครอบอยู่ทำให้ overlay ไม่เต็มจอ
  return createPortal(modal, document.body);
}
