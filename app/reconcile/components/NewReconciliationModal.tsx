"use client";

import { useEffect, useState } from "react";
import { X, Loader2 } from "lucide-react";
import { ReconcileSession, BankStatementImportSummary } from "./types";

const BANKS = [
  { code: "BBL", label: "ธนาคารกรุงเทพ (BBL)" },
  { code: "KBANK", label: "ธนาคารกสิกรไทย (KBank)" },
  { code: "SCB", label: "ธนาคารไทยพาณิชย์ (SCB)" },
];

const CUSTOM_RANGE = "__custom__";
const ANIM_MS = 180;

function toDateInputValue(iso: string) {
  return iso ? iso.slice(0, 10) : "";
}

export default function NewReconciliationModal({
  initialSession,
  onCancel,
  onConfirm,
}: {
  initialSession: ReconcileSession | null;
  onCancel: () => void;
  onConfirm: (session: ReconcileSession) => void;
}) {
  const [bankCode, setBankCode] = useState(initialSession?.bankCode ?? "BBL");
  const [imports, setImports] = useState<BankStatementImportSummary[]>([]);
  const [loadingImports, setLoadingImports] = useState(false);
  const [selectedImportId, setSelectedImportId] = useState<string>(
    initialSession?.importId ? String(initialSession.importId) : CUSTOM_RANGE
  );
  const [periodStart, setPeriodStart] = useState(initialSession?.periodStart ?? "");
  const [periodEnd, setPeriodEnd] = useState(initialSession?.periodEnd ?? "");
  const [includeSuspenseBuffer, setIncludeSuspenseBuffer] = useState(
    initialSession?.includeSuspenseBuffer ?? false
  );

  // ควบคุม enter/exit animation เอง แทนที่จะ unmount ทันที กันความรู้สึก "ตัดฉับ"
  const [visible, setVisible] = useState(false);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  function closeWith(action: () => void) {
    setClosing(true);
    setVisible(false);
    setTimeout(action, ANIM_MS);
  }

  useEffect(() => {
    let cancelled = false;
    async function loadImports() {
      setLoadingImports(true);
      try {
        const res = await fetch(`/api/bank-statement/imports?bankCode=${bankCode}`);
        const data = await res.json();
        if (!cancelled && res.ok) setImports(data.imports);
      } finally {
        if (!cancelled) setLoadingImports(false);
      }
    }
    loadImports();
    return () => {
      cancelled = true;
    };
  }, [bankCode]);

  function handleImportChange(value: string) {
    setSelectedImportId(value);
    if (value === CUSTOM_RANGE) return;
    const imp = imports.find((i) => String(i.ImportId) === value);
    if (imp) {
      setPeriodStart(toDateInputValue(imp.PeriodStart));
      setPeriodEnd(toDateInputValue(imp.PeriodEnd));
    }
  }

  function handleBankChange(value: string) {
    setBankCode(value);
    setSelectedImportId(CUSTOM_RANGE);
  }

  const canStart = bankCode && periodStart && periodEnd;

  function handleStart() {
    if (!canStart) return;
    const imp = imports.find((i) => String(i.ImportId) === selectedImportId);
    const session: ReconcileSession = {
      bankCode,
      importId: imp ? imp.ImportId : null,
      fileName: imp ? imp.FileName : null,
      periodStart,
      periodEnd,
      includeSuspenseBuffer,
    };
    closeWith(() => onConfirm(session));
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm px-4 transition-opacity ease-out"
      style={{ opacity: visible ? 1 : 0, transitionDuration: `${ANIM_MS}ms` }}
      onClick={() => !closing && closeWith(onCancel)}
    >
      <div
        className="w-full max-w-md bg-white rounded-2xl shadow-xl transition-all ease-out"
        style={{
          opacity: visible ? 1 : 0,
          transform: visible ? "scale(1) translateY(0)" : "scale(0.96) translateY(6px)",
          transitionDuration: `${ANIM_MS}ms`,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">New reconciliation</h2>
          <button onClick={() => closeWith(onCancel)} className="text-gray-400 hover:text-gray-600 active:scale-90 transition-transform">
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-5 flex flex-col gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">ธนาคาร</label>
            <select
              value={bankCode}
              onChange={(e) => handleBankChange(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm transition-colors focus:border-blue-400 focus:outline-none"
            >
              {BANKS.map((b) => (
                <option key={b.code} value={b.code}>
                  {b.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">ไฟล์ Statement ที่นำเข้าไว้</label>
            <select
              value={selectedImportId}
              onChange={(e) => handleImportChange(e.target.value)}
              disabled={loadingImports}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm disabled:opacity-50 transition-colors focus:border-blue-400 focus:outline-none"
            >
              <option value={CUSTOM_RANGE}>-- กำหนดวันที่เอง / รวมทุกไฟล์ --</option>
              {imports.map((imp) => (
                <option key={imp.ImportId} value={imp.ImportId}>
                  {imp.FileName} ({toDateInputValue(imp.PeriodStart)} – {toDateInputValue(imp.PeriodEnd)}) ·{" "}
                  {imp.ImportedRowCount} รายการ
                </option>
              ))}
            </select>
            {loadingImports && (
              <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
                <Loader2 size={12} className="animate-spin" /> กำลังโหลดรายการไฟล์...
              </p>
            )}
            {!loadingImports && imports.length === 0 && (
              <p className="text-xs text-gray-400 mt-1">ยังไม่มีไฟล์ที่ import ไว้สำหรับธนาคารนี้</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">จากวันที่</label>
              <input
                type="date"
                value={periodStart}
                onChange={(e) => {
                  setPeriodStart(e.target.value);
                  setSelectedImportId(CUSTOM_RANGE);
                }}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm transition-colors focus:border-blue-400 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">ถึงวันที่</label>
              <input
                type="date"
                value={periodEnd}
                onChange={(e) => {
                  setPeriodEnd(e.target.value);
                  setSelectedImportId(CUSTOM_RANGE);
                }}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm transition-colors focus:border-blue-400 focus:outline-none"
              />
            </div>
          </div>

          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={includeSuspenseBuffer}
              onChange={(e) => setIncludeSuspenseBuffer(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 mt-0.5"
            />
            <span className="text-xs text-gray-600 leading-relaxed">
              ขยายวันที่ฝั่ง GL (BC365) ไปอีก 7 วันของเดือนถัดไป — ใช้ค้นหารายการบัญชีพักโอนที่บันทึกข้ามเดือน
              (ฝั่ง Bank statement ยังใช้ช่วงวันที่เดิมไม่เปลี่ยน)
            </span>
          </label>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100">
          <button
            onClick={() => closeWith(onCancel)}
            className="text-sm text-gray-600 hover:bg-gray-50 active:scale-95 px-4 py-2 rounded-full transition-all"
          >
            ยกเลิก
          </button>
          <button
            onClick={handleStart}
            disabled={!canStart}
            className="text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 active:scale-95 px-5 py-2 rounded-full transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100"
          >
            Start Reconcile
          </button>
        </div>
      </div>
    </div>
  );
}