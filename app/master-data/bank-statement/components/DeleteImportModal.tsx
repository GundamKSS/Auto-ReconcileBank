"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, FileSpreadsheet, Loader2, Trash2, X } from "lucide-react";
import { ImportBatch, formatDate, formatDateTime } from "./ImportBatchList";

// ยาวได้ไม่เกินคอลัมน์ DeletedReason NVARCHAR(500) — API ตรวจซ้ำอีกชั้น
const MAX_REASON_LENGTH = 500;

export default function DeleteImportModal({
  batch,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  batch: ImportBatch;
  busy: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const canConfirm = reason.trim().length > 0 && !busy;

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
        aria-labelledby="delete-import-title"
        className="w-full max-w-lg bg-white/80 backdrop-blur-2xl backdrop-saturate-150 border border-white/70 rounded-2xl shadow-2xl flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-2">
            <AlertTriangle size={18} className="text-red-500 shrink-0" />
            <div>
              <h2 id="delete-import-title" className="text-base font-semibold text-gray-900">
                ยืนยันลบไฟล์ Bank Statement
              </h2>
              <p className="text-xs text-gray-400 mt-0.5">
                ลบทั้งไฟล์ — ทุกรายการในไฟล์นี้จะหายจากหน้า Reconcile, Reports และ Dashboard ทันที
              </p>
            </div>
          </div>
          <button
            onClick={() => !busy && onCancel()}
            disabled={busy}
            aria-label="ปิด"
            className="text-gray-400 hover:text-gray-600 active:scale-90 transition-transform disabled:opacity-40 shrink-0"
          >
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4 flex-1">
          <div className="flex items-start gap-3 border border-gray-200 bg-white rounded-xl p-3 mb-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-500">
              <FileSpreadsheet size={17} />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-900 break-all">{batch.FileName}</p>
              <p className="text-xs text-gray-500 mt-0.5">
                {batch.BankCode} · {formatDate(batch.PeriodStart)} – {formatDate(batch.PeriodEnd)} ·{" "}
                {batch.ImportedRowCount.toLocaleString()} รายการ
              </p>
              <p className="text-xs text-gray-400 mt-0.5">นำเข้าเมื่อ {formatDateTime(batch.ImportedAt)}</p>
            </div>
          </div>

          <p className="text-xs text-gray-500 mb-4 leading-relaxed">
            ข้อมูลเดิมยังเก็บไว้ในฐานข้อมูลเพื่อตรวจสอบย้อนหลัง และนำเข้าไฟล์ที่ถูกต้อง (หรือไฟล์เดิม) ใหม่ได้ที่หน้า Import
          </p>

          <label htmlFor="delete-import-reason" className="block text-xs font-medium text-gray-600 mb-1.5">
            เหตุผลที่ลบ <span className="text-red-500">*</span>
          </label>
          <textarea
            id="delete-import-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={busy}
            maxLength={MAX_REASON_LENGTH}
            rows={3}
            placeholder="เช่น นำเข้าไฟล์ผิดเดือน, ไฟล์จากธนาคารไม่ครบ, วันที่ในไฟล์เพี้ยน ฯลฯ"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none transition-colors focus:border-blue-400 focus:outline-none disabled:opacity-50"
          />
          <div className="flex justify-between gap-3 text-[11px] text-gray-400 mt-1">
            <span>จำเป็นต้องระบุ — บันทึกไว้ในประวัติการลบพร้อมชื่อผู้ลบ วันที่ และเวลา</span>
            <span className="tabular-nums shrink-0">
              {reason.length}/{MAX_REASON_LENGTH}
            </span>
          </div>

          {error && (
            <div className="mt-3 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
          )}
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
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
            ยืนยันลบทั้งไฟล์
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
