"use client";
import React, { useRef, useState } from "react";
import {
  FileText, UploadCloud, CheckCircle2,
  AlertTriangle, ArrowRight, ArrowLeft, Loader2, Menu
} from "lucide-react";
import { useSidebar } from "@/components/SidebarContext";

type PreviewLine = {
  tranDate: string;
  description: string;
  debit: number | null;
  credit: number | null;
  balance: number | null;
};

type PreviewResponse = {
  bankCode: string;
  fileName: string;
  fileSizeKb: number;
  totalRows: number;
  periodStart: string | null;
  periodEnd: string | null;
  previewRows: PreviewLine[];
  warnings: {
    missingDate: number;
    possibleDuplicates: number;
    alreadyImported: { fileName: string; importedAt: string } | null;
  };
};

const BANKS = [
  { code: "BBL", label: "BBL", enabled: true },
  { code: "KBANK", label: "KBank", enabled: true },
  { code: "SCB", label: "SCB", enabled: true },
  { code: "KTB", label: "KTB", enabled: false },
  { code: "TTB", label: "TTB", enabled: false },
  { code: "BAY", label: "BAY", enabled: false },
];

export default function ImportFlow() {
  const { toggleMobileOpen } = useSidebar();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedSource, setSelectedSource] = useState<"gl" | "bank">("bank");
  const [selectedBank, setSelectedBank] = useState<string>("BBL");

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState("");

  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
  const [importSuccess, setImportSuccess] = useState<{ rowCount: number } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFileSelected(selected: File) {
    setFile(selected);
    setPreview(null);
    setPreviewError("");
    setLoadingPreview(true);

    try {
      const formData = new FormData();
      formData.append("file", selected);
      formData.append("bankCode", selectedBank);

      const res = await fetch("/api/bank-statement/preview", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();

      if (!res.ok) {
        setPreviewError(data.error || "อ่านไฟล์ไม่สำเร็จ");
        return;
      }
      setPreview(data);
    } catch {
      setPreviewError("เกิดข้อผิดพลาดในการเชื่อมต่อ");
    } finally {
      setLoadingPreview(false);
    }
  }

  async function handleConfirmImport() {
    if (!file) return;
    setImporting(true);
    setImportError("");

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("bankCode", selectedBank);

      const res = await fetch("/api/bank-statement/import", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();

      if (!res.ok) {
        setImportError(data.error || "นำเข้าไม่สำเร็จ");
        return;
      }
      setImportSuccess({ rowCount: data.rowCount });
    } catch {
      setImportError("เกิดข้อผิดพลาดในการเชื่อมต่อ");
    } finally {
      setImporting(false);
    }
  }

  function resetAll() {
    setStep(1);
    setFile(null);
    setPreview(null);
    setPreviewError("");
    setImportError("");
    setImportSuccess(null);
  }

  return (
    <div className="min-h-screen bg-slate-50 p-8 font-sans text-slate-800">
      {/* Header Section */}
      <div className="mb-8 flex justify-between items-start">
        <div className="flex items-start gap-3">
          <button
            onClick={toggleMobileOpen}
            className="mt-1 text-slate-500 hover:text-slate-700 lg:hidden"
            aria-label="Toggle sidebar"
          >
            <Menu size={22} />
          </button>
          <div>
            <h1 className="text-3xl font-bold mb-1">Import</h1>
            <p className="text-slate-500">Upload Excel files — GL journal or bank statement</p>
          </div>
        </div>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-3 text-sm font-medium text-slate-500 mb-6">
        <div className={`flex items-center gap-2 ${step >= 1 ? "text-blue-600" : ""}`}>
          <span className={`flex items-center justify-center w-6 h-6 rounded-full text-white text-xs ${step >= 1 ? "bg-blue-600" : "bg-slate-300"}`}>1</span>
          Source
        </div>
        <ArrowRight size={14} className="text-slate-300" />
        <div className={`flex items-center gap-2 ${step >= 2 ? "text-blue-600" : ""}`}>
          <span className={`flex items-center justify-center w-6 h-6 rounded-full text-white text-xs ${step >= 2 ? "bg-blue-600" : "bg-slate-300"}`}>2</span>
          Upload & preview
        </div>
        <ArrowRight size={14} className="text-slate-300" />
        <div className={`flex items-center gap-2 ${step === 3 ? "text-blue-600" : ""}`}>
          <span className={`flex items-center justify-center w-6 h-6 rounded-full text-white text-xs ${step === 3 ? "bg-blue-600" : "bg-slate-300"}`}>3</span>
          Validate & import
        </div>
      </div>

      <div className="bg-white/80 backdrop-blur-xl border border-white rounded-3xl shadow-sm p-8 min-h-[500px] flex flex-col">

        {/* ================= STEP 1: SOURCE ================= */}
        {step === 1 && (
          <div className="flex-1 flex flex-col">
            <h2 className="text-lg font-semibold mb-6">What are you importing?</h2>

            <div className="grid grid-cols-2 gap-4 mb-8">
              <div
                onClick={() => {}}
                className="p-5 rounded-xl border-2 border-slate-200 opacity-50 cursor-not-allowed"
                title="ยังไม่รองรับ เร็วๆ นี้"
              >
                <div className="flex items-start gap-3">
                  <FileText className="text-slate-400" />
                  <div>
                    <h3 className="font-semibold text-slate-800">General Ledger (GL)</h3>
                    <p className="text-sm text-slate-500 mt-1">ยังไม่รองรับ เร็วๆ นี้</p>
                  </div>
                </div>
              </div>

              <div
                onClick={() => setSelectedSource("bank")}
                className={`p-5 rounded-xl border-2 cursor-pointer transition-all ${
                  selectedSource === "bank" ? "border-blue-300 bg-blue-50/50" : "border-slate-200 hover:border-blue-200"
                }`}
              >
                <div className="flex items-start gap-3">
                  <FileText className={selectedSource === "bank" ? "text-blue-600" : "text-slate-400"} />
                  <div>
                    <h3 className="font-semibold text-slate-800">Bank statement</h3>
                    <p className="text-sm text-slate-500 mt-1">Monthly statement from bank</p>
                  </div>
                </div>
              </div>
            </div>

            {selectedSource === "bank" && (
              <div className="mb-auto">
                <p className="text-xs font-bold text-slate-400 mb-3 uppercase tracking-wider">BANK</p>
                <div className="flex flex-wrap gap-2">
                  {BANKS.map((bank) => (
                    <button
                      key={bank.code}
                      onClick={() => bank.enabled && setSelectedBank(bank.code)}
                      disabled={!bank.enabled}
                      title={!bank.enabled ? "ยังไม่รองรับ เร็วๆ นี้" : undefined}
                      className={`px-5 py-2 rounded-full text-sm font-medium transition-colors ${
                        !bank.enabled
                          ? "bg-slate-50 text-slate-300 cursor-not-allowed"
                          : selectedBank === bank.code
                          ? "bg-blue-500 text-white shadow-md shadow-blue-200"
                          : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                      }`}
                    >
                      {bank.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-auto flex justify-end">
              <button
                onClick={() => setStep(2)}
                className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-full font-medium flex items-center gap-2 transition-colors"
              >
                Continue <ArrowRight size={16} />
              </button>
            </div>
          </div>
        )}

        {/* ================= STEP 2: UPLOAD & PREVIEW ================= */}
        {step === 2 && (
          <div className="flex-1 flex flex-col">
            <div className="grid grid-cols-12 gap-8 h-full flex-1">
              <div className="col-span-4 flex flex-col gap-4">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFileSelected(f);
                  }}
                />
                <div
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const f = e.dataTransfer.files?.[0];
                    if (f) handleFileSelected(f);
                  }}
                  className="flex-1 border-2 border-dashed border-slate-300 rounded-2xl flex flex-col items-center justify-center p-6 text-center hover:border-blue-400 hover:bg-blue-50/30 transition-colors cursor-pointer bg-slate-50/50"
                >
                  {loadingPreview ? (
                    <Loader2 size={40} className="text-blue-500 mb-4 animate-spin" />
                  ) : (
                    <UploadCloud size={40} className="text-blue-500 mb-4" />
                  )}
                  <p className="font-semibold text-slate-700">
                    {loadingPreview ? "กำลังอ่านไฟล์..." : "Drag & drop Excel here"}
                  </p>
                  <p className="text-sm text-slate-500 mt-1">or click to browse - .xlsx, .xls, .csv</p>
                </div>

                {previewError && (
                  <div className="p-3 bg-red-50 border border-red-100 rounded-xl text-sm text-red-700">
                    {previewError}
                  </div>
                )}

                {preview && (
                  <div className="p-4 bg-white border border-slate-200 rounded-xl flex items-center justify-between shadow-sm">
                    <div className="flex items-center gap-3">
                      <FileText size={20} className="text-green-500" />
                      <div>
                        <p className="text-sm font-semibold text-slate-800">{preview.fileName}</p>
                        <p className="text-xs text-slate-500">
                          {preview.fileSizeKb} KB · {preview.totalRows.toLocaleString()} rows
                        </p>
                      </div>
                    </div>
                    <CheckCircle2 size={20} className="text-green-500" />
                  </div>
                )}
              </div>

              <div className="col-span-8 flex flex-col">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="font-semibold">Preview · first 5 rows</h2>
                  {preview && (
                    <span className="text-xs text-slate-400">
                      {preview.periodStart} ถึง {preview.periodEnd}
                    </span>
                  )}
                </div>

                <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm flex-1">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 text-xs font-semibold uppercase">
                      <tr>
                        <th className="px-4 py-3">Date</th>
                        <th className="px-4 py-3">Description</th>
                        <th className="px-4 py-3 text-right">Debit</th>
                        <th className="px-4 py-3 text-right">Credit</th>
                        <th className="px-4 py-3 text-right">Balance</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {!preview && (
                        <tr>
                          <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                            อัปโหลดไฟล์เพื่อดู preview
                          </td>
                        </tr>
                      )}
                      {preview?.previewRows.map((row, i) => (
                        <tr key={i} className="hover:bg-slate-50">
                          <td className="px-4 py-3 text-slate-600">{row.tranDate}</td>
                          <td className="px-4 py-3 text-slate-800">{row.description}</td>
                          <td className="px-4 py-3 text-right text-slate-800 tabular-nums">
                            {row.debit?.toLocaleString() ?? "-"}
                          </td>
                          <td className="px-4 py-3 text-right text-slate-800 tabular-nums">
                            {row.credit?.toLocaleString() ?? "-"}
                          </td>
                          <td className="px-4 py-3 text-right text-slate-800 tabular-nums">
                            {row.balance?.toLocaleString() ?? "-"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="mt-6 flex justify-end gap-3">
                  <button
                    onClick={() => setStep(1)}
                    className="px-5 py-2.5 text-slate-600 hover:bg-slate-100 rounded-full font-medium transition-colors"
                  >
                    Back
                  </button>
                  <button
                    onClick={() => preview && setStep(3)}
                    disabled={!preview}
                    className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-full font-medium flex items-center gap-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Map columns <ArrowRight size={16} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ================= STEP 3: VALIDATE & IMPORT ================= */}
        {step === 3 && preview && (
          <div className="flex-1 flex flex-col">
            <div className="grid grid-cols-12 gap-8 h-full">
              <div className="col-span-8 flex flex-col">
                <h2 className="font-semibold text-lg">Column mapping</h2>
                <p className="text-sm text-slate-500 mb-4">
                  โครงสร้างคอลัมน์ของ {preview.bankCode} ถูกกำหนดไว้ตายตัวแล้ว (fixed mapping)
                </p>

                <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-2 flex flex-col gap-1">
                  {[
                    { source: "Tran Date", target: "Date" },
                    { source: "Description", target: "Description" },
                    { source: "Debit", target: "Debit" },
                    { source: "Credit", target: "Credit" },
                    { source: "Balance", target: "Balance" },
                  ].map((row, i) => (
                    <div key={i} className="flex items-center justify-between p-3 rounded-lg hover:bg-slate-50">
                      <span className="w-1/3 text-sm text-slate-600">{row.source}</span>
                      <ArrowRight size={14} className="text-slate-300" />
                      <span className="w-1/3 text-sm font-semibold text-slate-800 pl-4">{row.target}</span>
                      <span className="w-16 text-right text-sm font-medium text-green-600">100%</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="col-span-4 flex flex-col gap-6">
                <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6">
                  <h2 className="font-semibold mb-4 text-slate-800">Validation</h2>

                  <div className="flex flex-col gap-3">
                    <div className="flex items-start gap-2">
                      <CheckCircle2 size={18} className="text-green-500 mt-0.5" />
                      <span className="text-sm text-slate-700">
                        {preview.totalRows.toLocaleString()} rows parsed
                      </span>
                    </div>
                    <div className="flex items-start gap-2">
                      <CheckCircle2 size={18} className="text-green-500 mt-0.5" />
                      <span className="text-sm text-slate-700">
                        Dates within {preview.periodStart} – {preview.periodEnd}
                      </span>
                    </div>
                    {preview.warnings.possibleDuplicates > 0 && (
                      <div className="flex items-start gap-2">
                        <AlertTriangle size={18} className="text-yellow-500 mt-0.5" />
                        <span className="text-sm text-slate-700">
                          {preview.warnings.possibleDuplicates} possible duplicate rows
                        </span>
                      </div>
                    )}
                    {preview.warnings.alreadyImported && (
                      <div className="flex items-start gap-2">
                        <AlertTriangle size={18} className="text-red-500 mt-0.5" />
                        <span className="text-sm text-red-700">
                          ไฟล์นี้เคยนำเข้าไปแล้ว ({preview.warnings.alreadyImported.fileName} เมื่อ{" "}
                          {new Date(preview.warnings.alreadyImported.importedAt).toLocaleString("th-TH", {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })}
                          )
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {importError && (
                  <div className="p-3 bg-red-50 border border-red-100 rounded-xl text-sm text-red-700">
                    {importError}
                  </div>
                )}

                {importSuccess ? (
                  <div className="p-4 bg-green-50 border border-green-100 rounded-xl text-sm text-green-700">
                    นำเข้าสำเร็จ {importSuccess.rowCount.toLocaleString()} รายการ
                  </div>
                ) : (
                  <div className="mt-auto flex flex-col gap-3">
                    <button
                      onClick={handleConfirmImport}
                      disabled={importing || Boolean(preview.warnings.alreadyImported)}
                      className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium shadow-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {importing && <Loader2 size={16} className="animate-spin" />}
                      {preview.warnings.alreadyImported
                        ? "ไฟล์นี้ถูกนำเข้าไปแล้ว"
                        : importing
                        ? "กำลังนำเข้า..."
                        : `Import ${preview.totalRows.toLocaleString()} rows`}
                    </button>
                    <button
                      onClick={() => setStep(2)}
                      className="w-full py-2.5 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-xl font-medium transition-colors"
                    >
                      Back
                    </button>
                  </div>
                )}

                {importSuccess && (
                  <button
                    onClick={resetAll}
                    className="w-full py-2.5 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-xl font-medium transition-colors flex items-center justify-center gap-2"
                  >
                    <ArrowLeft size={16} /> นำเข้าไฟล์อื่นต่อ
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}