"use client";

import { useEffect, useMemo, useState } from "react";
import { X, Loader2 } from "lucide-react";
import { ReconcileSession, BankStatementImportSummary } from "./types";
import { BankAccountOption, fullAccountLabel } from "../../../lib/bankAccounts";

const BANKS = [
  { code: "BBL", label: "ธนาคารกรุงเทพ (BBL)" },
  { code: "KBANK", label: "ธนาคารกสิกรไทย (KBank)" },
  { code: "SCB", label: "ธนาคารไทยพาณิชย์ (SCB)" },
];

const BANK_LABEL = new Map(BANKS.map((b) => [b.code, b.label]));

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
  // ใช้เมื่อโหลดรายชื่อบัญชีไม่ได้ หรือธนาคารนั้นยังไม่มีบัญชีใน BankAccountMapping
  const [fallbackBankCode, setFallbackBankCode] = useState(initialSession?.bankCode ?? "BBL");

  // เลือก "บัญชี" ไม่ใช่ "ธนาคาร" — ธนาคารหนึ่งมีได้หลายบัญชี (SCB 6 บัญชี) ถ้าล็อกแค่ธนาคาร
  // หน้า workspace จะเอา statement ของบัญชีเดียวไปเทียบกับ GL ของทุกบัญชีในธนาคารนั้นรวมกัน
  // ธนาคารจึงเป็นค่าที่อนุมานจากบัญชีที่เลือก ไม่ใช่ค่าที่ผู้ใช้เลือกเองอีกต่อไป
  const [accounts, setAccounts] = useState<BankAccountOption[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [accountDimensionReady, setAccountDimensionReady] = useState(true);
  const [bankAccountNo, setBankAccountNo] = useState(initialSession?.bankAccountNo ?? "");

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
    async function loadAccounts() {
      try {
        const res = await fetch("/api/master/bank-accounts");
        const data = await res.json();
        if (cancelled || !res.ok) return;
        // เฉพาะธนาคารที่ระบบอ่านไฟล์ statement ได้ — บัญชี KTB มีใน mapping แต่ยังไม่มี parser
        const usable: BankAccountOption[] = (data.accounts ?? []).filter((a: BankAccountOption) =>
          BANK_LABEL.has(a.bankCode ?? "")
        );
        setAccounts(usable);
        setAccountDimensionReady(Boolean(data.accountDimensionReady));
      } catch {
        // โหลดไม่ได้ก็ถอยไปใช้ dropdown ธนาคารแบบเดิม (ดู accounts.length === 0 ข้างล่าง)
      } finally {
        if (!cancelled) setLoadingAccounts(false);
      }
    }
    loadAccounts();
    return () => {
      cancelled = true;
    };
  }, []);

  // จัดกลุ่มบัญชีตามธนาคารไว้ทำ <optgroup> เรียงตามลำดับใน BANKS ไม่ใช่ตามตัวอักษร
  const accountsByBank = useMemo(() => {
    return BANKS.map((b) => ({
      ...b,
      accounts: accounts.filter((a) => a.bankCode === b.code),
    })).filter((g) => g.accounts.length > 0);
  }, [accounts]);

  const selectedAccount = accounts.find((a) => a.bankAccountNo === bankAccountNo) ?? null;
  // ธนาคารที่ใช้จริง = ของบัญชีที่เลือก ถ้ายังไม่มีบัญชี (โหลดไม่ได้) ค่อยใช้ค่าที่ผู้ใช้เลือกเอง
  const bankCode = selectedAccount?.bankCode ?? fallbackBankCode;

  // เลือกบัญชีตั้งต้นให้เมื่อโหลดรายชื่อเสร็จและยังไม่มีค่า (เช่นกด "New reconciliation" ครั้งแรก)
  useEffect(() => {
    if (bankAccountNo || accounts.length === 0) return;
    const firstOfBank = accounts.find((a) => a.bankCode === fallbackBankCode) ?? accounts[0];
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBankAccountNo(firstOfBank.bankAccountNo);
  }, [accounts, bankAccountNo, fallbackBankCode]);

  useEffect(() => {
    let cancelled = false;
    async function loadImports() {
      setLoadingImports(true);
      try {
        const query = new URLSearchParams({ bankCode });
        if (bankAccountNo) query.set("bankAccountNo", bankAccountNo);
        const res = await fetch(`/api/master/bank-statement/imports?${query}`);
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
  }, [bankCode, bankAccountNo]);

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
    setFallbackBankCode(value);
    setBankAccountNo("");
    setSelectedImportId(CUSTOM_RANGE);
  }

  function handleAccountChange(value: string) {
    setBankAccountNo(value);
    // ไฟล์ที่เลือกไว้เป็นของบัญชีเดิม ต้องปล่อยแล้วให้ผู้ใช้เลือกใหม่จากรายการของบัญชีใหม่
    setSelectedImportId(CUSTOM_RANGE);
  }

  // เดิมตรวจแค่ว่ากรอกครบไหม ทำให้ใส่ "ถึงวันที่" ก่อน "จากวันที่" แล้วกด Start ได้
  // ผลคือเข้าไปเจอ workspace ว่างเปล่าพร้อมข้อความ "ไม่มีรายการค้างอยู่ในช่วงที่เลือก"
  // ซึ่งชวนให้เข้าใจผิดว่ากระทบยอดครบแล้ว ทั้งที่จริงแค่กรอกวันที่กลับด้าน
  const rangeError =
    periodStart && periodEnd && periodStart > periodEnd
      ? 'ช่วงวันที่ไม่ถูกต้อง — "ถึงวันที่" ต้องไม่มาก่อน "จากวันที่"'
      : null;
  const canStart = Boolean(
    bankCode && periodStart && periodEnd && !rangeError && (accounts.length === 0 || bankAccountNo)
  );

  function handleStart() {
    if (!canStart) return;
    const imp = imports.find((i) => String(i.ImportId) === selectedImportId);
    const session: ReconcileSession = {
      bankCode,
      bankAccountNo: bankAccountNo || null,
      accountName: selectedAccount ? fullAccountLabel(selectedAccount) : null,
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-md px-4 transition-opacity ease-out"
      style={{ opacity: visible ? 1 : 0, transitionDuration: `${ANIM_MS}ms` }}
      onClick={() => !closing && closeWith(onCancel)}
    >
      <div
        className="w-full max-w-md bg-white/80 backdrop-blur-2xl backdrop-saturate-150 border border-white/70 rounded-2xl shadow-2xl transition-all ease-out"
        style={{
          opacity: visible ? 1 : 0,
          transform: visible ? "scale(1) translateY(0)" : "scale(0.92) translateY(12px)",
          // เปิด: เด้งเกินนิดแล้วเข้าที่ / ปิด: หดออกเร็วๆ ให้ทันจังหวะ closeWith
          transitionDuration: visible ? "380ms" : `${ANIM_MS}ms`,
          transitionTimingFunction: visible ? "cubic-bezier(0.34, 1.56, 0.64, 1)" : "ease-in",
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
            <label className="block text-xs font-medium text-gray-500 mb-1.5">บัญชีธนาคาร</label>
            {accounts.length > 0 ? (
              <select
                value={bankAccountNo}
                onChange={(e) => handleAccountChange(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm transition-colors focus:border-blue-400 focus:outline-none"
              >
                {accountsByBank.map((group) => (
                  <optgroup key={group.code} label={group.label}>
                    {group.accounts.map((a) => (
                      <option key={a.bankAccountNo} value={a.bankAccountNo}>
                        {fullAccountLabel(a)}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            ) : (
              // โหลดรายชื่อบัญชีไม่สำเร็จ — ถอยไปเลือกทั้งธนาคารแบบเดิมดีกว่าเปิดหน้าไม่ได้เลย
              <select
                value={bankCode}
                onChange={(e) => handleBankChange(e.target.value)}
                disabled={loadingAccounts}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm disabled:opacity-50 transition-colors focus:border-blue-400 focus:outline-none"
              >
                {BANKS.map((b) => (
                  <option key={b.code} value={b.code}>
                    {b.label}
                  </option>
                ))}
              </select>
            )}
            {loadingAccounts && (
              <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
                <Loader2 size={12} className="animate-spin" /> กำลังโหลดรายชื่อบัญชี...
              </p>
            )}
            {!loadingAccounts && accounts.length === 0 && (
              <p className="text-xs text-amber-700 mt-1">
                โหลดรายชื่อบัญชีไม่สำเร็จ — จะกระทบยอดรวมทุกบัญชีของธนาคารที่เลือก
              </p>
            )}
            {!loadingAccounts && accounts.length > 0 && !accountDimensionReady && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2">
                ระบบยังไม่ได้แยกข้อมูลตามเลขบัญชี — ต้องรัน{" "}
                <span className="font-mono">sql/006_bank_statement_bank_account.sql</span> ก่อน
                ระหว่างนี้หน้ากระทบยอดจะยังรวมทุกบัญชีของธนาคารเดียวกันไว้ด้วยกัน
              </p>
            )}
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
                max={periodEnd || undefined}
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
                min={periodStart || undefined}
                onChange={(e) => {
                  setPeriodEnd(e.target.value);
                  setSelectedImportId(CUSTOM_RANGE);
                }}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm transition-colors focus:border-blue-400 focus:outline-none"
              />
            </div>
          </div>

          {rangeError && (
            <p className="text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              {rangeError}
            </p>
          )}

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