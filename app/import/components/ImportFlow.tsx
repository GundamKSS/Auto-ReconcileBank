"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  FileText, UploadCloud, CheckCircle2,
  AlertTriangle, ArrowRight, ArrowLeft, Loader2, Menu, RefreshCw, WandSparkles
} from "lucide-react";
import { useSidebar } from "@/components/SidebarContext";
import {
  BankAccountOption,
  fullAccountLabel,
  guessAccountFromFileName,
  shortAccountLabel,
} from "../../../lib/bankAccounts";

type PreviewLine = {
  tranDate: string;
  description: string;
  debit: number | null;
  credit: number | null;
  balance: number | null;
};

type PreviewResponse = {
  bankCode: string;
  bankAccountNo: string | null;
  accountName: string | null;
  fileName: string;
  fileSizeKb: number;
  totalRows: number;
  periodStart: string | null;
  periodEnd: string | null;
  previewRows: PreviewLine[];
  warnings: {
    missingDate: number;
    possibleDuplicates: number;
    // รายการที่นำเข้าไว้แล้ว ตอนนำเข้าจะข้ามไปและบันทึกเฉพาะ newCount รายการ
    overlap: {
      overlapCount: number;
      newCount: number;
      newPeriodStart: string | null;
      newPeriodEnd: string | null;
      imports: { importId: number; fileName: string; importedAt: string; lineCount: number }[];
    } | null;
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
  // ฝั่ง bank มี 4 ขั้น: Source -> เลือกบัญชี -> Upload & preview -> Validate & import
  // "เลือกบัญชี" แยกเป็นขั้นของตัวเองเพราะเลือกผิด = กระทบยอดผิดทั้งงวด ต้องบังคับให้คนตัดสินใจ
  // ไม่ใช่ dropdown ที่กดผ่านไปโดยไม่อ่าน
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [selectedSource, setSelectedSource] = useState<"gl" | "bank">("bank");
  const [selectedBank, setSelectedBank] = useState<string>("BBL");

  // บัญชีธนาคาร: ไฟล์ statement 1 ใบ = 1 บัญชี ไม่ใช่ 1 ธนาคาร (ธนาคารเดียวมีได้หลายบัญชี)
  // accountDimensionReady = false แปลว่ายังไม่ได้รัน sql/006 ระบบจึงถอยไปทำงานระดับธนาคารแบบเดิม
  const [accounts, setAccounts] = useState<BankAccountOption[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [accountDimensionReady, setAccountDimensionReady] = useState(false);
  const [selectedAccountNo, setSelectedAccountNo] = useState<string>("");

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState("");

  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
  const [importSuccess, setImportSuccess] = useState<{ rowCount: number; skippedCount: number } | null>(null);

  const [syncingGl, setSyncingGl] = useState(false);
  const [glSyncError, setGlSyncError] = useState("");
  const [glSyncSuccess, setGlSyncSuccess] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  // ลำดับของคำขอ preview — กดสลับบัญชีรัวๆ ใน step 2 จะยิง preview หลายรอบซ้อนกัน
  // ถ้าไม่กันไว้ คำตอบของบัญชีที่กดก่อนอาจมาถึงทีหลังแล้วทับผลของบัญชีที่กดล่าสุด
  const previewSeqRef = useRef(0);

  // ขั้นตอนของฝั่ง GL มีแค่ 2 ขั้น (เลือก source แล้วกดซิงค์) ไม่มี upload/validate เหมือนฝั่ง bank
  const steps =
    selectedSource === "gl"
      ? ["ประเภทข้อมูล", "ดึงข้อมูลจาก BC365"]
      : ["ประเภทข้อมูล", "บัญชี", "เลือกไฟล์", "ตรวจสอบและนำเข้า"];
  const activeStep = selectedSource === "gl" ? (glSyncSuccess ? 2 : 1) : step;

  useEffect(() => {
    let cancelled = false;
    async function loadAccounts() {
      try {
        const res = await fetch("/api/master/bank-accounts");
        const data = await res.json();
        if (cancelled || !res.ok) return;
        setAccounts(data.accounts ?? []);
        setAccountDimensionReady(Boolean(data.accountDimensionReady));
      } catch {
        // โหลดรายชื่อบัญชีไม่ได้ก็ยังนำเข้าแบบเดิมได้ ไม่ต้องขัดจังหวะผู้ใช้ด้วย error
      } finally {
        if (!cancelled) setLoadingAccounts(false);
      }
    }
    loadAccounts();
    return () => {
      cancelled = true;
    };
  }, []);

  // เฉพาะบัญชีของธนาคารที่ parser รองรับ และของธนาคารที่เลือกอยู่
  const accountsOfBank = accounts.filter((a) => a.bankCode === selectedBank);

  // บัญชีที่เลือกอยู่ — ไม่มีค่า default ให้กดผ่าน ต้องกดเลือกเองใน step 2
  // (เดิม default เป็นบัญชีแรกของธนาคาร ซึ่งเสี่ยงให้คนกด Continue ผ่านไปโดยไม่ได้ดูว่าบัญชีไหน)
  const effectiveAccountNo =
    selectedAccountNo && accountsOfBank.some((a) => a.bankAccountNo === selectedAccountNo)
      ? selectedAccountNo
      : "";
  const selectedAccount = accountsOfBank.find((a) => a.bankAccountNo === effectiveAccountNo) ?? null;

  // ตรวจสอบไขว้: เลข 4 ตัวท้ายในชื่อไฟล์บอกบัญชีอะไร แล้วตรงกับที่ผู้ใช้เลือกไว้ไหม
  // ไม่เอาไปเปลี่ยนค่าให้เอง เพราะผู้ใช้ตัดสินใจไปแล้วใน step 2 — ทั้งสองทางยืนยันกันเองดีกว่า
  const fileNameGuess = useMemo(
    () => (file ? guessAccountFromFileName(file.name, accounts) : null),
    [file, accounts]
  );
  const fileNameMismatch =
    fileNameGuess && effectiveAccountNo && fileNameGuess.bankAccountNo !== effectiveAccountNo
      ? fileNameGuess
      : null;
  const fileNameConfirms = Boolean(
    fileNameGuess && effectiveAccountNo && fileNameGuess.bankAccountNo === effectiveAccountNo
  );

  // ข้ามขั้นเลือกบัญชีได้เฉพาะตอนที่ระบบไม่มีรายชื่อบัญชีให้เลือกจริงๆ (API ล่ม)
  // ถ้ามีรายชื่อแล้วต้องกดเลือก — ห้ามปล่อยผ่านด้วยค่า default
  const canLeaveAccountStep = accounts.length === 0 ? !loadingAccounts : Boolean(effectiveAccountNo);

  function handleBankChange(code: string) {
    setSelectedBank(code);
    setSelectedAccountNo("");
  }

  function handleAccountChange(accountNo: string) {
    setSelectedAccountNo(accountNo);
    // เปลี่ยนบัญชีหลังอ่านไฟล์ไปแล้ว = ผลตรวจซ้ำที่แสดงอยู่คำนวณจากบัญชีเดิม ต้องอ่านใหม่
    if (file) handleFileSelected(file, { accountNo, bankCode: selectedBank });
  }

  // ยอมรับข้อเสนอจากชื่อไฟล์ — บัญชีที่เดาได้อาจอยู่คนละธนาคารกับที่เลือกไว้ จึงสลับธนาคารให้ด้วย
  function applyFileNameGuess() {
    if (!fileNameMismatch) return;
    const bankCode = fileNameMismatch.bankCode ?? selectedBank;
    setSelectedBank(bankCode);
    setSelectedAccountNo(fileNameMismatch.bankAccountNo);
    if (file) handleFileSelected(file, { accountNo: fileNameMismatch.bankAccountNo, bankCode });
  }

  async function handleFileSelected(
    selected: File,
    override?: { accountNo: string; bankCode: string }
  ) {
    setFile(selected);
    setPreview(null);
    setPreviewError("");
    setLoadingPreview(true);

    // บัญชีมาจากที่ผู้ใช้กดเลือกไว้ใน step 2 เท่านั้น ไม่เดาทับให้เอง —
    // การเดาจากชื่อไฟล์ย้ายไปเป็น "ตัวตรวจสอบไขว้" หลัง preview แทน (ดู fileNameMismatch ข้างล่าง)
    const accountNo = override?.accountNo ?? effectiveAccountNo;
    const bankCode = override?.bankCode ?? selectedBank;
    const seq = ++previewSeqRef.current;

    try {
      const formData = new FormData();
      formData.append("file", selected);
      formData.append("bankCode", bankCode);
      if (accountNo) formData.append("bankAccountNo", accountNo);

      const res = await fetch("/api/bank-statement/preview", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (seq !== previewSeqRef.current) return; // มีคำขอใหม่กว่าแซงไปแล้ว ผลนี้ตกรุ่น

      if (!res.ok) {
        setPreviewError(data.error || "อ่านไฟล์ไม่สำเร็จ");
        return;
      }
      setPreview(data);
    } catch {
      if (seq === previewSeqRef.current) setPreviewError("เกิดข้อผิดพลาดในการเชื่อมต่อ");
    } finally {
      if (seq === previewSeqRef.current) setLoadingPreview(false);
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
      if (effectiveAccountNo) formData.append("bankAccountNo", effectiveAccountNo);

      const res = await fetch("/api/bank-statement/import", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();

      if (!res.ok) {
        setImportError(data.error || "นำเข้าไม่สำเร็จ");
        return;
      }
      setImportSuccess({ rowCount: data.rowCount, skippedCount: data.skippedCount ?? 0 });
    } catch {
      setImportError("เกิดข้อผิดพลาดในการเชื่อมต่อ");
    } finally {
      setImporting(false);
    }
  }

  // ซิงค์ GL ทั้งหมดจาก BC365 (ไม่ใช่แค่ 40 วันล่าสุดแบบที่หน้า reconcile ใช้)
  // ใช้ตอนต้องการให้ข้อมูล GL ครบทั้งชุด เช่น เพิ่งตั้งระบบ หรือย้อนไปกระทบยอดเดือนเก่า
  async function handleSyncGl() {
    if (syncingGl) return;
    setSyncingGl(true);
    setGlSyncError("");
    setGlSyncSuccess(false);

    try {
      const res = await fetch("/api/import/sync-gl", { method: "POST" });
      const data = await res.json();

      if (!res.ok) {
        setGlSyncError(data.error || "ซิงค์ข้อมูลจาก BC365 ไม่สำเร็จ");
        return;
      }
      setGlSyncSuccess(true);
    } catch {
      setGlSyncError("ไม่สามารถเชื่อมต่อบริการดึงข้อมูล BC365 ได้");
    } finally {
      setSyncingGl(false);
    }
  }

  function resetAll() {
    setStep(1);
    setFile(null);
    setPreview(null);
    setPreviewError("");
    setImportError("");
    setImportSuccess(null);
    setGlSyncError("");
    setGlSyncSuccess(false);
  }

  return (
    <div className="min-h-screen bg-slate-50 p-8 font-sans text-slate-800">
      {/* Header Section */}
      <div className="mb-8 flex justify-between items-start">
        <div className="flex items-start gap-3">
          <button
            onClick={toggleMobileOpen}
            className="mt-1 text-slate-500 hover:text-slate-700 lg:hidden"
            aria-label="เปิดหรือปิดเมนู"
          >
            <Menu size={22} />
          </button>
          <div>
            <h1 className="text-3xl font-bold mb-1">นำเข้าข้อมูล</h1>
            <p className="text-slate-500">นำเข้าไฟล์รายการเดินบัญชีธนาคาร หรือดึงข้อมูลบัญชีจาก BC365</p>
          </div>
        </div>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-3 text-sm font-medium text-slate-500 mb-6">
        {steps.map((label, i) => (
          <React.Fragment key={label}>
            {i > 0 && <ArrowRight size={14} className="text-slate-300" />}
            <div className={`flex items-center gap-2 ${activeStep >= i + 1 ? "text-blue-600" : ""}`}>
              <span className={`flex items-center justify-center w-6 h-6 rounded-full text-white text-xs ${activeStep >= i + 1 ? "bg-blue-600" : "bg-slate-300"}`}>
                {i + 1}
              </span>
              {label}
            </div>
          </React.Fragment>
        ))}
      </div>

      <div className="bg-white/80 backdrop-blur-xl border border-white rounded-3xl shadow-sm p-8 min-h-[500px] flex flex-col">

        {/* ================= STEP 1: SOURCE ================= */}
        {step === 1 && (
          <div className="flex-1 flex flex-col">
            <h2 className="text-lg font-semibold mb-6">เลือกข้อมูลที่ต้องการนำเข้า</h2>

            <div className="grid grid-cols-2 gap-4 mb-8">
              <div
                onClick={() => setSelectedSource("gl")}
                className={`p-5 rounded-xl border-2 cursor-pointer transition-all ${
                  selectedSource === "gl" ? "border-blue-300 bg-blue-50/50" : "border-slate-200 hover:border-blue-200"
                }`}
              >
                <div className="flex items-start gap-3">
                  <FileText className={selectedSource === "gl" ? "text-blue-600" : "text-slate-400"} />
                  <div>
                    <h3 className="font-semibold text-slate-800">รายการบัญชี (BC365)</h3>
                    <p className="text-sm text-slate-500 mt-1">ดึงข้อมูลจาก Business Central (BC365)</p>
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
                    <h3 className="font-semibold text-slate-800">รายการเดินบัญชีธนาคาร</h3>
                    <p className="text-sm text-slate-500 mt-1">นำเข้าจากไฟล์ที่ได้รับจากธนาคาร</p>
                  </div>
                </div>
              </div>
            </div>

            {selectedSource === "bank" && (
              <div className="mb-auto">
                <p className="text-xs font-bold text-slate-400 mb-3 uppercase tracking-wider">ธนาคาร</p>
                <div className="flex flex-wrap gap-2">
                  {BANKS.map((bank) => (
                    <button
                      key={bank.code}
                      onClick={() => bank.enabled && handleBankChange(bank.code)}
                      disabled={!bank.enabled}
                      title={!bank.enabled ? "ยังไม่รองรับธนาคารนี้" : undefined}
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

                {!accountDimensionReady && (
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-4 max-w-lg">
                    ระบบยังไม่พร้อมแยกข้อมูลตามเลขบัญชี กรุณาติดต่อผู้ดูแลระบบ
                    หากนำเข้าตอนนี้ ไฟล์จะผูกกับธนาคารโดยไม่ระบุบัญชี
                  </p>
                )}
              </div>
            )}

            {selectedSource === "gl" && (
              <div className="mb-auto flex flex-col gap-4">
                <div className="p-5 bg-slate-50 border border-slate-200 rounded-xl">
                  <p className="text-sm font-semibold text-slate-800 mb-1">ดึงข้อมูลบัญชีทั้งหมดจาก BC365</p>
                  <p className="text-sm text-slate-500">
                    ดึงรายการบัญชีธนาคาร <span className="font-medium text-slate-700">ทั้งหมด</span> จาก
                    Business Central (BC365) มาอัปเดตในระบบ โดยไม่ต้องอัปโหลดไฟล์
                  </p>
                  <p className="text-xs text-slate-400 mt-3">
                    การดึงข้อมูลทั้งหมดอาจใช้เวลาสักครู่ หากต้องการอัปเดตเฉพาะ 40 วันล่าสุด
                    ให้ใช้ปุ่ม &quot;ดึงข้อมูลใหม่จาก BC365&quot; ในหน้ากระทบยอด
                  </p>
                </div>

                {glSyncError && (
                  <div className="p-3 bg-red-50 border border-red-100 rounded-xl text-sm text-red-700">
                    {glSyncError}
                  </div>
                )}

                {glSyncSuccess && (
                  <div className="p-3 bg-green-50 border border-green-100 rounded-xl text-sm text-green-700 flex items-center gap-2">
                    <CheckCircle2 size={16} />
                    ดึงข้อมูลบัญชีทั้งหมดจาก BC365 สำเร็จแล้ว
                  </div>
                )}
              </div>
            )}

            <div className="mt-auto flex justify-end">
              {selectedSource === "gl" ? (
                <button
                  onClick={handleSyncGl}
                  disabled={syncingGl}
                  className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-full font-medium flex items-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {syncingGl ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <RefreshCw size={16} />
                  )}
                  {syncingGl ? "กำลังดึงข้อมูลทั้งหมด..." : "ดึงข้อมูลทั้งหมด"}
                </button>
              ) : (
                <button
                  onClick={() => setStep(2)}
                  className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-full font-medium flex items-center gap-2 transition-colors"
                >
                  ถัดไป <ArrowRight size={16} />
                </button>
              )}
            </div>
          </div>
        )}

        {/* ================= STEP 2: เลือกบัญชี ================= */}
        {step === 2 && (
          <div className="flex-1 flex flex-col">
            <div>
              <h2 className="font-semibold text-lg text-slate-800">เลือกบัญชีที่จะนำเข้า</h2>
              <p className="text-sm text-slate-500 mt-1">
                แต่ละไฟล์ต้องตรงกับบัญชีที่เลือก กรุณาตรวจสอบเลขบัญชีก่อนนำเข้า
              </p>
            </div>

            {accounts.length === 0 ? (
              // โหลดรายชื่อบัญชีไม่ได้เลย (API ล่ม) — ต้องยอมให้ข้ามขั้นนี้ ไม่งั้นนำเข้าไฟล์ไม่ได้ทั้งระบบ
              <p className="mt-6 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                {loadingAccounts
                  ? "กำลังโหลดรายชื่อบัญชี..."
                  : "ไม่พบรายชื่อบัญชี หากดำเนินการต่อ ไฟล์จะผูกกับธนาคารโดยไม่ระบุบัญชี กรุณาติดต่อผู้ดูแลระบบเพื่อตรวจสอบ"}
              </p>
            ) : accountsOfBank.length === 0 ? (
              <p className="mt-6 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                ยังไม่มีบัญชีของ {selectedBank} ให้เลือก กรุณาติดต่อผู้ดูแลระบบเพื่อเพิ่มบัญชี
                หรือย้อนกลับไปเลือกธนาคารอื่น
              </p>
            ) : (
              <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-3">
                {accountsOfBank.map((a) => {
                  const active = a.bankAccountNo === effectiveAccountNo;
                  return (
                    <button
                      key={a.bankAccountNo}
                      onClick={() => handleAccountChange(a.bankAccountNo)}
                      className={`text-left p-4 rounded-xl border-2 transition-all ${
                        active
                          ? "border-blue-400 bg-blue-50/60 shadow-sm"
                          : "border-slate-200 bg-white hover:border-blue-200"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-800 leading-snug">
                            {a.accountName ?? a.bankAccountNo}
                          </p>
                          <p className="text-xs text-slate-500 mt-1 font-mono">
                            {a.displayNo ?? a.bankAccountNo}
                          </p>
                        </div>
                        {active ? (
                          <CheckCircle2 size={18} className="text-blue-600 shrink-0" />
                        ) : (
                          <span className="w-[18px] h-[18px] rounded-full border-2 border-slate-300 shrink-0" />
                        )}
                      </div>
                      {/* บอกว่าบัญชีนี้เคยนำเข้าไฟล์มาแล้วกี่ไฟล์ — ช่วยจับกรณีเลือกบัญชีที่ไม่เคยใช้ */}
                      <p className="text-[11px] text-slate-400 mt-2">
                        {a.importCount ? `นำเข้าแล้ว ${a.importCount} ไฟล์` : "ยังไม่เคยนำเข้าไฟล์"}
                      </p>
                    </button>
                  );
                })}
              </div>
            )}

            <div className="mt-auto pt-6 flex justify-between">
              <button
                onClick={() => setStep(1)}
                className="px-5 py-2.5 text-slate-600 hover:bg-slate-100 rounded-full font-medium transition-colors"
              >
                ย้อนกลับ
              </button>
              <button
                onClick={() => canLeaveAccountStep && setStep(3)}
                disabled={!canLeaveAccountStep}
                className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-full font-medium flex items-center gap-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                ถัดไป <ArrowRight size={16} />
              </button>
            </div>
          </div>
        )}
        {/* ================= STEP 3: UPLOAD & PREVIEW ================= */}
        {step === 3 && (
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
                    {loadingPreview ? "กำลังอ่านไฟล์..." : "ลากไฟล์มาวางที่นี่"}
                  </p>
                  <p className="text-sm text-slate-500 mt-1">หรือคลิกเพื่อเลือกไฟล์ .xlsx, .xls, .csv</p>
                </div>

                {previewError && (
                  <div className="p-3 bg-red-50 border border-red-100 rounded-xl text-sm text-red-700">
                    {previewError}
                  </div>
                )}

                {preview && (
                  <div className="p-4 bg-white border border-slate-200 rounded-xl flex items-center justify-between shadow-sm">
                    <div className="flex items-center gap-3 min-w-0">
                      <FileText size={20} className="text-green-500 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-800 truncate">{preview.fileName}</p>
                        <p className="text-xs text-slate-500">
                          {preview.fileSizeKb} KB · {preview.totalRows.toLocaleString()} รายการ
                        </p>
                      </div>
                    </div>
                    <CheckCircle2 size={20} className="text-green-500 shrink-0" />
                  </div>
                )}

                {/* บัญชีปลายทาง — ตรงนี้อ่านอย่างเดียว การเลือกอยู่ที่ step ก่อนหน้า
                    ส่วนชื่อไฟล์เอามาตรวจไขว้ว่าตรงกับบัญชีที่เลือกไหม */}
                {preview && selectedAccount && (
                  <div className="p-4 bg-white border border-slate-200 rounded-xl shadow-sm">
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                      นำเข้าสู่บัญชี
                    </p>
                    <p className="text-sm font-medium text-slate-800">
                      {fullAccountLabel(selectedAccount)}
                    </p>
                    {fileNameConfirms && (
                      <p className="text-xs text-green-700 mt-2 flex items-center gap-1.5">
                        <CheckCircle2 size={12} /> เลขบัญชีในชื่อไฟล์ตรงกับบัญชีที่เลือก
                      </p>
                    )}
                  </div>
                )}

                {preview && fileNameMismatch && (
                  <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl">
                    <p className="text-sm font-semibold text-amber-900 flex items-center gap-2">
                      <AlertTriangle size={15} className="shrink-0" /> ชื่อไฟล์ไม่ตรงกับบัญชีที่เลือก
                    </p>
                    <p className="text-xs text-amber-800 mt-1.5 leading-relaxed">
                      เลขบัญชีในชื่อไฟล์ <span className="font-mono">{preview.fileName}</span> ชี้ไปที่{" "}
                      <strong>{fullAccountLabel(fileNameMismatch)}</strong> แต่คุณเลือกนำเข้าสู่{" "}
                      <strong>{selectedAccount ? fullAccountLabel(selectedAccount) : "-"}</strong>
                    </p>
                    <button
                      onClick={applyFileNameGuess}
                      disabled={loadingPreview}
                      className="mt-3 w-full py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
                    >
                      <WandSparkles size={12} /> เปลี่ยนเป็น {shortAccountLabel(fileNameMismatch)}
                    </button>
                    <p className="text-[11px] text-amber-700 mt-2">
                      หากตรวจสอบแล้วว่าบัญชีที่เลือกถูกต้อง สามารถนำเข้าต่อได้
                    </p>
                  </div>
                )}
              </div>

              <div className="col-span-8 flex flex-col">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="font-semibold">ตัวอย่างข้อมูล 5 รายการแรก</h2>
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
                        <th className="px-4 py-3">วันที่</th>
                        <th className="px-4 py-3">รายละเอียด</th>
                        <th className="px-4 py-3 text-right">ถอน (Debit)</th>
                        <th className="px-4 py-3 text-right">ฝาก (Credit)</th>
                        <th className="px-4 py-3 text-right">ยอดคงเหลือ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {!preview && (
                        <tr>
                          <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                            เลือกไฟล์เพื่อดูตัวอย่างข้อมูล
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
                    onClick={() => setStep(2)}
                    className="px-5 py-2.5 text-slate-600 hover:bg-slate-100 rounded-full font-medium transition-colors"
                  >
                    ย้อนกลับ
                  </button>
                  <button
                    onClick={() => preview && setStep(4)}
                    disabled={!preview}
                    className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-full font-medium flex items-center gap-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    ตรวจสอบก่อนนำเข้า <ArrowRight size={16} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ================= STEP 4: VALIDATE & IMPORT ================= */}
        {step === 4 && preview && (
          <div className="flex-1 flex flex-col">
            <div className="grid grid-cols-12 gap-8 h-full">
              <div className="col-span-8 flex flex-col">
                <h2 className="font-semibold text-lg">รูปแบบคอลัมน์ที่ระบบอ่าน</h2>
                <p className="text-sm text-slate-500 mb-4">
                  ระบบอ่านคอลัมน์ตามรูปแบบไฟล์ของ {preview.bankCode} โดยอัตโนมัติ ไม่ต้องตั้งค่าเพิ่มเติม
                </p>

                <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-2 flex flex-col gap-1">
                  {[
                    { source: "Tran Date", target: "วันที่" },
                    { source: "Description", target: "รายละเอียด" },
                    { source: "Debit", target: "ถอน (Debit)" },
                    { source: "Credit", target: "ฝาก (Credit)" },
                    { source: "Balance", target: "ยอดคงเหลือ" },
                  ].map((row, i) => (
                    <div key={i} className="flex items-center justify-between p-3 rounded-lg hover:bg-slate-50">
                      <span className="w-1/3 text-sm text-slate-600">{row.source}</span>
                      <ArrowRight size={14} className="text-slate-300" />
                      <span className="w-1/3 text-sm font-semibold text-slate-800 pl-4">{row.target}</span>
                      <span className="w-16 text-right text-sm font-medium text-green-600">อัตโนมัติ</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="col-span-4 flex flex-col gap-6">
                <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6">
                  <h2 className="font-semibold mb-4 text-slate-800">ผลการตรวจสอบไฟล์</h2>

                  <div className="flex flex-col gap-3">
                    <div className="flex items-start gap-2">
                      <CheckCircle2 size={18} className="text-green-500 mt-0.5" />
                      <span className="text-sm text-slate-700">
                        {preview.totalRows.toLocaleString()} รายการที่อ่านได้
                      </span>
                    </div>
                    <div className="flex items-start gap-2">
                      <CheckCircle2 size={18} className="text-green-500 mt-0.5" />
                      <span className="text-sm text-slate-700">
                        ช่วงวันที่ {preview.periodStart} – {preview.periodEnd}
                      </span>
                    </div>
                    {preview.warnings.possibleDuplicates > 0 && (
                      <div className="flex items-start gap-2">
                        <AlertTriangle size={18} className="text-yellow-500 mt-0.5" />
                        <span className="text-sm text-slate-700">
                          {preview.warnings.possibleDuplicates} รายการที่อาจซ้ำ
                        </span>
                      </div>
                    )}
                    {preview.warnings.overlap && preview.warnings.overlap.newCount === 0 && (
                      <div className="flex items-start gap-2">
                        <AlertTriangle size={18} className="text-red-500 mt-0.5 shrink-0" />
                        <span className="text-sm text-red-700">
                          ทุกรายการในไฟล์นี้นำเข้าไปแล้ว (
                          {preview.warnings.overlap.imports.map((i) => i.fileName).join(", ")}) ไม่มีรายการใหม่ให้นำเข้า
                        </span>
                      </div>
                    )}
                    {preview.warnings.overlap && preview.warnings.overlap.newCount > 0 && (
                      <div className="flex items-start gap-2">
                        <AlertTriangle size={18} className="text-yellow-500 mt-0.5 shrink-0" />
                        <span className="text-sm text-slate-700">
                          ข้าม {preview.warnings.overlap.overlapCount.toLocaleString()} รายการที่นำเข้าแล้ว (
                          {preview.warnings.overlap.imports.map((i) => i.fileName).join(", ")}) · จะนำเข้าเฉพาะ{" "}
                          <span className="font-semibold">
                            {preview.warnings.overlap.newCount.toLocaleString()} รายการใหม่
                          </span>{" "}
                          ({preview.warnings.overlap.newPeriodStart} – {preview.warnings.overlap.newPeriodEnd})
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
                    {importSuccess.skippedCount > 0 &&
                      ` · ข้ามรายการที่นำเข้าแล้ว ${importSuccess.skippedCount.toLocaleString()} รายการ`}
                  </div>
                ) : (
                  <div className="mt-auto flex flex-col gap-3">
                    <button
                      onClick={handleConfirmImport}
                      disabled={importing || preview.warnings.overlap?.newCount === 0}
                      className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium shadow-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {importing && <Loader2 size={16} className="animate-spin" />}
                      {preview.warnings.overlap?.newCount === 0
                        ? "ไม่มีรายการใหม่ให้นำเข้า"
                        : importing
                        ? "กำลังนำเข้า..."
                        : `ยืนยันนำเข้า ${(preview.warnings.overlap?.newCount ?? preview.totalRows).toLocaleString()} รายการ`}
                    </button>
                    <button
                      onClick={() => setStep(3)}
                      className="w-full py-2.5 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-xl font-medium transition-colors"
                    >
                      ย้อนกลับ
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
