"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Landmark, Loader2, Save, X } from "lucide-react";
import { ACCOUNT_BANK_CODES, STATEMENT_BANK_CODES } from "../../../../lib/bankAccounts";

export type GlCandidate = { bankAccountNo: string; accountName: string | null; displayNo: string | null; entryCount: number };

// เดาธนาคารจากชื่อบัญชีของ BC365 เช่น 'TRW ออมทรัพย์ SCB เฉลิมนคร #037-...' -> SCB (ผู้ใช้เปลี่ยนได้)
function guessBank(name: string | null): string {
  if (!name) return "";
  return ACCOUNT_BANK_CODES.find((code) => new RegExp(`\\b${code}\\b`, "i").test(name)) ?? "";
}

export default function AddBankAccountModal({ candidates, onDismiss, onSaved }: {
  candidates: GlCandidate[];
  onDismiss: () => void;
  onSaved: (label: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [accountNo, setAccountNo] = useState("");
  const [bankCode, setBankCode] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  const selected = candidates.find((c) => c.bankAccountNo === accountNo) ?? null;

  function pick(no: string) {
    setAccountNo(no);
    setBankCode(guessBank(candidates.find((c) => c.bankAccountNo === no)?.accountName ?? null));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !bankCode || saving) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/master/bank-accounts/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bankAccountNo: selected.bankAccountNo, bankCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "เพิ่มบัญชีไม่สำเร็จ");
      onSaved(selected.accountName ?? selected.bankAccountNo);
    } catch (err) {
      setError(err instanceof Error ? err.message : "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้");
    } finally {
      setSaving(false);
    }
  }

  const inputClass = "mt-1.5 block min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100";

  return (
    <dialog ref={dialog} aria-labelledby="add-bank-account-title"
      onCancel={(event) => { event.preventDefault(); if (!saving) onDismiss(); }}
      className="fixed m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-xl flex-col overflow-hidden rounded-3xl border border-white/80 bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-900/30 backdrop:backdrop-blur-sm open:flex">
      <div className="flex shrink-0 items-start gap-3 border-b border-slate-100 px-6 py-5">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600"><Landmark size={20} /></div>
        <div className="min-w-0 flex-1">
          <h2 id="add-bank-account-title" className="text-lg font-semibold">เพิ่มบัญชีธนาคาร</h2>
          <p className="mt-0.5 text-xs text-slate-500">เลือกจากรหัสบัญชีที่มีรายการใน BC365 แล้ว แต่ยังไม่ได้ผูกกับระบบ</p>
        </div>
        <button type="button" onClick={onDismiss} disabled={saving} aria-label="ปิดหน้าต่าง"
          className="flex size-9 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"><X size={20} /></button>
      </div>

      <form onSubmit={(event) => void save(event)} aria-busy={saving} className="flex min-h-0 flex-col">
        <div className="min-h-0 space-y-5 overflow-y-auto px-6 py-5">
          {candidates.length === 0 ? (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-800">
              ไม่มีรหัสบัญชีใหม่ใน BC365 ให้เพิ่ม — ต้องสร้างบัญชีธนาคารใน BC365 (ชื่อบัญชีลงท้ายด้วย #เลขบัญชี)
              และมีรายการเคลื่อนไหวแล้วดึงข้อมูล GL ที่หน้านำเข้าข้อมูลก่อน
            </p>
          ) : (
            <fieldset disabled={saving} className="space-y-2">
              <legend className="text-sm font-medium text-slate-600">รหัสบัญชีจาก BC365 <span className="text-red-500">*</span></legend>
              {candidates.map((c) => {
                const active = c.bankAccountNo === accountNo;
                return (
                  <label key={c.bankAccountNo}
                    className={`flex cursor-pointer items-start gap-3 rounded-xl border-2 p-3 transition-colors ${active ? "border-blue-400 bg-blue-50/60" : "border-slate-200 hover:border-blue-200"}`}>
                    <input type="radio" name="bankAccountNo" value={c.bankAccountNo} checked={active} onChange={() => pick(c.bankAccountNo)}
                      className="mt-1 size-4 shrink-0 accent-blue-500" />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-slate-800">{c.accountName ?? c.bankAccountNo}</span>
                      <span className="mt-0.5 block font-mono text-xs text-slate-500">{c.bankAccountNo} · {c.displayNo}</span>
                      <span className="mt-0.5 block text-[11px] text-slate-400">รายการใน GL {c.entryCount.toLocaleString("th-TH")} รายการ</span>
                    </span>
                  </label>
                );
              })}
            </fieldset>
          )}

          {selected && (
            <label className="block text-sm font-medium text-slate-600">ธนาคาร <span className="text-red-500">*</span>
              <select value={bankCode} onChange={(event) => setBankCode(event.target.value)} disabled={saving} className={inputClass}>
                <option value="">— เลือกธนาคาร —</option>
                {ACCOUNT_BANK_CODES.map((code) => <option key={code} value={code}>{code}</option>)}
              </select>
              {bankCode && !STATEMENT_BANK_CODES.includes(bankCode) && (
                <span className="mt-1.5 block text-xs font-normal text-amber-700">
                  ระบบยังอ่านไฟล์ statement ของ {bankCode} ไม่ได้ — เพิ่มได้เพื่อดูฝั่ง GL แต่ยังนำเข้าไฟล์ไม่ได้
                </span>
              )}
            </label>
          )}

          {error && <p role="alert" className="rounded-xl border border-red-100 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-6 py-4">
          <button type="button" onClick={onDismiss} disabled={saving}
            className="min-h-11 rounded-full px-5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40">ยกเลิก</button>
          <button disabled={saving || !selected || !bankCode}
            className="flex min-h-11 items-center gap-2 rounded-full bg-blue-500 px-5 py-2 text-sm font-semibold text-white shadow-md shadow-blue-200 hover:bg-blue-600 disabled:opacity-40 disabled:shadow-none">
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}{saving ? "กำลังบันทึก…" : "เพิ่มบัญชี"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
