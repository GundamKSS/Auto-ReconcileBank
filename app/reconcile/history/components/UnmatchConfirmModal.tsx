"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, Loader2, Undo2, X } from "lucide-react";

// สรุปแบบย่อของแต่ละ "กลุ่มย่อย (Num)" ที่เลือกไว้ — ไม่ลงรายละเอียดถึงระดับบรรทัด เพราะอาจเลือกมาทีละหลายสิบกลุ่ม
// รายละเอียดเต็มดูได้จากการกด "คลี่" MatchCard ในหน้ารายการก่อนจะติ๊กเลือกอยู่แล้ว
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

function formatAmount(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function UnmatchConfirmModal({
  targets,
  busy,
  onCancel,
  onConfirm,
}: {
  targets: UnmatchTarget[];
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
          <div className="flex items-center gap-2">
            <AlertTriangle size={18} className="text-amber-500" />
            <div>
              <h2 className="text-base font-semibold text-gray-900">
                {isBulk ? `ยืนยันยกเลิกการจับคู่ (${targets.length} กลุ่มย่อย)` : "ยืนยันยกเลิกการจับคู่"}
              </h2>
              <p className="text-xs text-gray-400 mt-0.5">
                {isBulk
                  ? `กลุ่มย่อยที่เลือกทั้งหมดจาก ${matchCount} Match จะกลับไปเป็น UNMATCHED และไปจับคู่ใหม่ได้ในหน้า Reconcile`
                  : `Match #${targets[0]?.matchId} กลุ่ม ${targets[0]?.num} · ${targets[0]?.bankCode} — เฉพาะกลุ่มย่อยนี้จะกลับไปเป็น UNMATCHED และไปจับคู่ใหม่ได้ในหน้า Reconcile`}
                {" "}(กลุ่มย่อยอื่นใน Match เดียวกันยังจับคู่อยู่ตามเดิม และประวัติเดิมยังเก็บไว้ตรวจสอบย้อนหลังได้)
              </p>
            </div>
          </div>
          <button
            onClick={() => !busy && onCancel()}
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
                Bank statement รวม · {formatAmount(bankTotal)}
              </p>
            </div>
            <div className="border border-gray-200 rounded-xl p-3">
              <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-1.5">
                General Ledger รวม · {formatAmount(glTotal)}
              </p>
            </div>
          </div>

          <div className="border border-gray-200 rounded-xl divide-y divide-gray-100 mb-4 max-h-40 overflow-y-auto">
            {targets.map((t) => (
              <div key={t.key} className="flex items-center gap-2 text-xs px-3 py-2">
                <span className="font-medium text-gray-900 shrink-0">#{t.matchId}</span>
                <span className="text-gray-500 shrink-0">กลุ่ม {t.num}</span>
                <span className="text-gray-400 shrink-0">{t.bankCode}</span>
                <span className="text-gray-400 flex-1 min-w-0 truncate">
                  Bank {t.bankCount} · GL {t.glCount}
                </span>
                <span className="tabular-nums text-gray-700 shrink-0">{formatAmount(t.bankTotal)}</span>
              </div>
            ))}
          </div>

          <label className="block text-xs font-medium text-gray-600 mb-1.5">
            เหตุผลที่ยกเลิก <span className="text-red-500">*</span>
            {isBulk && <span className="text-gray-400 font-normal"> (ใช้ร่วมกันทุกกลุ่มย่อยที่เลือก)</span>}
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={busy}
            rows={3}
            placeholder="เช่น จับคู่ผิดรายการ, ยอดไม่ตรงที่แท้จริง, จับคู่ผิดธนาคาร ฯลฯ"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none transition-colors focus:border-blue-400 focus:outline-none disabled:opacity-50"
          />
          <p className="text-[11px] text-gray-400 mt-1">จำเป็นต้องระบุ — จะถูกบันทึกไว้ในประวัติพร้อมชื่อผู้ยกเลิกและเวลา</p>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100 shrink-0 bg-gray-50/60 rounded-b-2xl">
          <button
            onClick={onCancel}
            disabled={busy}
            className="text-sm text-gray-600 hover:bg-gray-100 active:scale-95 px-4 py-2 rounded-full transition-all disabled:opacity-40"
          >
            ยกเลิก
          </button>
          <button
            onClick={() => canConfirm && onConfirm(reason.trim())}
            disabled={!canConfirm}
            className="flex items-center gap-1.5 text-sm font-medium text-white bg-red-600 hover:bg-red-700 active:scale-95 px-5 py-2 rounded-full transition-all disabled:opacity-50 disabled:active:scale-100"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Undo2 size={14} />}
            {isBulk ? `ยืนยันยกเลิกทั้งหมด (${targets.length})` : "ยืนยันยกเลิกการจับคู่"}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
