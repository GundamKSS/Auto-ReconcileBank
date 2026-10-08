"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, Loader2, Undo2, X } from "lucide-react";

import { formatAmount } from '../../../../lib/formatAmount';
// สรุปแบบย่อของแต่ละ "กลุ่มย่อย (Num)" ที่เลือกไว้ — ไม่ลงรายละเอียดถึงระดับบรรทัด เพราะอาจเลือกมาทีละหลายสิบกลุ่ม
// รายละเอียดเต็มแสดงในตารางประวัติ ก่อนติ๊กเลือกส่งกลับ
export type UnmatchTarget = {
  key: string;
  matchId: number;
  num: number;
  bankCode: string;
  bankCount: number;
  glCount: number;
  bankTotal: number;
  glTotal: number;
};
// variant "offset" = ยกเลิกหักล้างกันเอง: ไม่มีฝั่ง Bank — ใช้ bankTotal/glTotal เป็นยอดรวม "ขาเข้า/ขาออก" ของกลุ่มแทน
export type UnmatchVariant = "match" | "offset";

export default function UnmatchConfirmModal({
  targets,
  variant = "match",
  busy,
  onCancel,
  onConfirm,
}: {
  targets: UnmatchTarget[];
  variant?: UnmatchVariant;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const canConfirm = reason.trim().length > 0 && !busy && targets.length > 0;
  const bankTotal = targets.reduce((s, t) => s + t.bankTotal, 0);
  const glTotal = targets.reduce((s, t) => s + t.glTotal, 0);
  const matchCount = new Set(targets.map((t) => t.matchId)).size;
  const isBulk = targets.length > 1;
  const isOffset = variant === "offset";

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-md px-4"
      onClick={() => !busy && onCancel()}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 14 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 6, transition: { duration: 0.15 } }}
        transition={{ type: "spring", stiffness: 420, damping: 26 }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="unmatch-title"
        className="w-full max-w-lg bg-white/80 backdrop-blur-2xl backdrop-saturate-150 border border-white/70 rounded-2xl shadow-2xl flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-2">
            <AlertTriangle size={18} className="text-amber-500" />
            <div>
              <h2 id="unmatch-title" className="text-base font-semibold text-gray-900">
                {isBulk ? `ส่งกลับ ${targets.length} แถว?` : "ส่งรายการกลับ?"}
              </h2>
              <p className="text-xs text-gray-400 mt-0.5">
                {isBulk ? `${targets.length} แถว จาก ${matchCount} ชุด` : `#${targets[0]?.matchId} · กลุ่ม ${targets[0]?.num} · ${targets[0]?.bankCode}`}
                <span className="mt-1 block">{isOffset ? "รายการ BC365 จะกลับไปรอเลือกในหน้ากระทบยอด" : "แถวที่เลือกจะกลับไปรอจับคู่ในหน้ากระทบยอด"} ประวัติเดิมยังเก็บไว้</span>
              </p>
            </div>
          </div>
          <button
            onClick={() => !busy && onCancel()}
            aria-label="ปิดหน้าต่างส่งกลับ"
            disabled={busy}
            className="text-gray-400 hover:text-gray-600 active:scale-90 transition-transform disabled:opacity-40 shrink-0"
          >
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-3 flex-1">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            <div className="border border-gray-200 rounded-xl p-3">
              <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-1.5">
                {isOffset ? "ยอดเงินเข้ารวม" : "ยอดธนาคารรวม"} · {formatAmount(bankTotal)}
              </p>
            </div>
            <div className="border border-gray-200 rounded-xl p-3">
              <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-1.5">
                {isOffset ? "ยอดเงินออกรวม" : "ยอด BC365 รวม"} · {formatAmount(glTotal)}
              </p>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100 mb-4 max-h-40 overflow-y-auto">
            {targets.map((t) => (
              <div key={t.key} className="flex items-center gap-2 text-xs px-3 py-2">
                <span className="font-medium text-gray-900 shrink-0">#{t.matchId}</span>
                <span className="text-gray-500 shrink-0">กลุ่ม {t.num}</span>
                <span className="text-gray-400 shrink-0">{t.bankCode}</span>
                <span className="text-gray-400 flex-1 min-w-0 truncate">
                  {isOffset ? `BC ${t.bankCount + t.glCount} รายการ` : `Bank ${t.bankCount} · GL ${t.glCount}`}
                </span>
                <span className="tabular-nums text-gray-700 shrink-0">{formatAmount(t.bankTotal)}</span>
              </div>
            ))}
          </div>

          <label htmlFor="unmatch-reason" className="block text-xs font-medium text-gray-600 mb-1.5">
            เหตุผลที่ส่งกลับ <span className="text-red-500">*</span>
            {isBulk && <span className="text-gray-400 font-normal"> (ใช้ร่วมกันทุกกลุ่มย่อยที่เลือก)</span>}
          </label>
          <textarea
            id="unmatch-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={busy}
            rows={3}
            placeholder="เช่น เลือกรายการผิด ยอดเงินไม่ตรง หรือเลือกบัญชีธนาคารผิด"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none transition-colors focus:border-blue-400 focus:outline-none disabled:opacity-50"
          />
          <p className="text-[11px] text-gray-400 mt-1">เหตุผลจะบันทึกไว้ในประวัติ</p>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100 shrink-0 bg-gray-50/60 rounded-b-2xl">
          <button
            onClick={onCancel}
            disabled={busy}
            className="text-sm text-gray-600 hover:bg-gray-100 active:scale-95 px-4 py-2 rounded-full transition-all disabled:opacity-40"
          >
            กลับไปตรวจสอบ
          </button>
          <button
            onClick={() => canConfirm && onConfirm(reason.trim())}
            disabled={!canConfirm}
            className="flex items-center gap-1.5 text-sm font-medium text-white bg-red-600 hover:bg-red-700 active:scale-95 px-5 py-2 rounded-full transition-all disabled:opacity-50 disabled:active:scale-100"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Undo2 size={14} />}
            {isBulk ? `ยืนยันส่งกลับ (${targets.length})` : "ยืนยันส่งกลับ"}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
