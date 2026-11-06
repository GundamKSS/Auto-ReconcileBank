"use client";

import HelpTooltip from "../../../../components/HelpTooltip";
import { useEffect, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import { fullAccountLabel } from "../../../../lib/bankAccounts";
import type { AccountRow } from "./MasterBankAccounts";

// ยืนยันก่อนเปิด/ปิดบัญชี — การปิดทำให้ทีมนำเข้า statement ของบัญชีนี้ไม่ได้ทันที
export default function AccountStatusModal({ account, onDismiss, onSaved }: {
  account: AccountRow;
  onDismiss: () => void;
  onSaved: (active: boolean) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const closing = account.isActive !== false;

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  async function confirm() {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/master/bank-accounts/manage", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bankAccountNo: account.bankAccountNo, isActive: !closing }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "เปลี่ยนสถานะไม่สำเร็จ");
      onSaved(!closing);
    } catch (err) {
      setError(err instanceof Error ? err.message : "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้");
    } finally {
      setSaving(false);
    }
  }

  return (
    <dialog ref={dialog} aria-labelledby="account-status-title"
      onCancel={(event) => { event.preventDefault(); if (!saving) onDismiss(); }}
      className="fixed m-auto w-[calc(100%-2rem)] max-w-md flex-col overflow-hidden rounded-3xl border border-white/80 bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-900/30 backdrop:backdrop-blur-sm open:flex">
      <div className="flex items-start justify-between gap-3 px-6 pt-5">
        <h2 id="account-status-title" className="text-lg font-semibold">{closing ? "ปิดบัญชีนี้?" : "เปิดบัญชีนี้อีกครั้ง?"}</h2>
        <button type="button" onClick={onDismiss} disabled={saving} aria-label="ปิดหน้าต่าง"
          className="flex size-9 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"><X size={20} /></button>
      </div>
      <div className="space-y-3 px-6 py-4 text-sm leading-relaxed text-slate-600">
        <p className="rounded-xl bg-slate-50 px-3 py-2.5">
          <span className="block font-medium text-slate-800">{fullAccountLabel(account)}</span>
          <span className="font-mono text-xs text-slate-400">{account.bankAccountNo}</span>
        </p>
        {closing ? (
          <div className="flex items-center gap-1">
            <p>ปิดบัญชีแล้วจะ<strong className="text-rose-600">นำเข้าไฟล์ใหม่ไม่ได้</strong> ข้อมูลเดิมยังใช้งานได้</p>
            <HelpTooltip label="ผลของการปิดบัญชี">บัญชีจะไม่แสดงในหน้านำเข้าข้อมูล แต่ข้อมูลเดิมยังกระทบยอดและดูรายงานได้ สามารถเปิดบัญชีกลับได้ภายหลัง</HelpTooltip>
          </div>
        ) : (
          <p>หลังเปิดแล้ว ทีมจะนำเข้า statement ของบัญชีนี้ได้ตามปกติ</p>
        )}
        {error && <p role="alert" className="rounded-xl border border-red-100 bg-red-50 p-3 text-red-700">{error}</p>}
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-6 py-4">
        <button type="button" onClick={onDismiss} disabled={saving}
          className="min-h-11 rounded-full px-5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40">ยกเลิก</button>
        <button type="button" onClick={() => void confirm()} disabled={saving}
          className={`flex min-h-11 items-center gap-2 rounded-full px-5 py-2 text-sm font-semibold text-white shadow-md disabled:opacity-40 ${
            closing ? "bg-rose-500 shadow-rose-200 hover:bg-rose-600" : "bg-emerald-500 shadow-emerald-200 hover:bg-emerald-600"
          }`}>
          {saving && <Loader2 size={16} className="animate-spin" />}{closing ? "ปิดบัญชี" : "เปิดบัญชี"}
        </button>
      </div>
    </dialog>
  );
}
