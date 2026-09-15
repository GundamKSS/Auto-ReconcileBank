"use client";

import { useEffect, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { Menu, Database, FileSpreadsheet, History, CircleCheck, X } from "lucide-react";
import { useSidebar } from "@/components/SidebarContext";
import BankTabs from "./BankTabs";
import ImportBatchList, { ImportBatch } from "./ImportBatchList";
import LineItemsView from "./LineItemsView";
import DeleteImportModal from "./DeleteImportModal";
import DeleteHistoryList from "./DeleteHistoryList";

type View = "files" | "history";

const VIEWS = [
  { key: "files", label: "ไฟล์ที่นำเข้า", icon: FileSpreadsheet },
  { key: "history", label: "ประวัติการลบ", icon: History },
] as const;

export default function MasterBankStatement() {
  const { toggleMobileOpen } = useSidebar();
  const [bankCode, setBankCode] = useState("BBL");
  const [view, setView] = useState<View>("files");
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedBatch, setSelectedBatch] = useState<ImportBatch | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ImportBatch | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  async function loadBatches() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/master/bank-statement/imports?bankCode=${bankCode}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "โหลดรายการไฟล์ไม่สำเร็จ");
        return;
      }
      setBatches(data.imports);
    } catch {
      setError("เชื่อมต่อ server ไม่ได้");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // เปลี่ยนธนาคารแล้วต้องเคลียร์ไฟล์ที่เลือกไว้ + โหลดรายการไฟล์ใหม่ — fetch-on-param-change ปกติ
    /* eslint-disable react-hooks/set-state-in-effect */
    setSelectedBatch(null);
    setNotice("");
    loadBatches();
    /* eslint-enable react-hooks/set-state-in-effect */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bankCode]);

  function switchView(next: View) {
    setView(next);
    setSelectedBatch(null);
    setNotice("");
  }

  function openDelete(batch: ImportBatch) {
    setDeleteTarget(batch);
    setDeleteError("");
    setNotice("");
  }

  // ลบได้ทีละทั้งไฟล์เท่านั้น และต้องมีเหตุผล — ผู้ลบ/เวลา ฝั่ง server บันทึกเองจาก session
  async function confirmDelete(reason: string) {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleting(true);
    setDeleteError("");
    try {
      const res = await fetch(`/api/master/bank-statement/imports/${target.ImportId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const data = await res.json();
      if (!res.ok) {
        setDeleteError(data.error || "ลบไม่สำเร็จ");
        return;
      }
      setDeleteTarget(null);
      setSelectedBatch(null);
      setNotice(`ลบไฟล์ "${target.FileName}" แล้ว — ดูผู้ลบ วันเวลา และเหตุผลได้ที่แท็บ "ประวัติการลบ"`);
      await loadBatches();
    } catch {
      setDeleteError("เชื่อมต่อ server ไม่ได้");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#f8fafc] p-8">
      <div className="mb-7 flex items-start gap-3">
        <button
          onClick={toggleMobileOpen}
          className="mt-1 text-slate-500 hover:text-slate-700 lg:hidden"
          aria-label="Toggle sidebar"
        >
          <Menu size={22} />
        </button>
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-blue-600 shadow-lg shadow-blue-500/20">
            <Database size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">Master Data · Bank Statement</h1>
            <p className="mt-1 text-[15px] text-slate-500">
              ไฟล์ Bank Statement ที่นำเข้าไว้ — ดูรายการได้ ลบได้ทีละทั้งไฟล์เท่านั้น และทุกการลบเก็บประวัติไว้
            </p>
          </div>
        </div>
      </div>

      <section className="rounded-[20px] border border-white/80 bg-white p-6 shadow-[0_10px_35px_rgba(30,64,175,0.06)]">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <BankTabs selected={bankCode} onSelect={setBankCode} />
          <div role="tablist" aria-label="มุมมอง" className="inline-flex rounded-full bg-slate-100 p-1">
            {VIEWS.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                role="tab"
                aria-selected={view === key}
                onClick={() => switchView(key)}
                className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                  view === key ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                <Icon size={14} /> {label}
              </button>
            ))}
          </div>
        </div>

        {view === "files" && error && (
          <div className="mb-5 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        {view === "files" && notice && (
          <div className="mb-5 flex items-start gap-2 rounded-xl border border-green-100 bg-green-50 px-4 py-3 text-sm text-green-700">
            <CircleCheck size={16} className="mt-0.5 shrink-0" />
            <span className="flex-1">{notice}</span>
            <button onClick={() => setNotice("")} aria-label="ปิดข้อความ" className="text-green-600/70 hover:text-green-800">
              <X size={14} />
            </button>
          </div>
        )}

        {view === "history" ? (
          <DeleteHistoryList key={bankCode} bankCode={bankCode} />
        ) : !selectedBatch ? (
          <ImportBatchList batches={batches} loading={loading} onSelect={setSelectedBatch} onDelete={openDelete} />
        ) : (
          <LineItemsView batch={selectedBatch} onBack={() => setSelectedBatch(null)} onDelete={openDelete} />
        )}
      </section>

      {/* ต้องครอบ AnimatePresence ไม่งั้น exit animation ของ modal จะไม่เล่น — ปิดแล้วหายฉับ */}
      <AnimatePresence>
        {deleteTarget && (
          <DeleteImportModal
            batch={deleteTarget}
            busy={deleting}
            error={deleteError}
            onCancel={() => setDeleteTarget(null)}
            onConfirm={confirmDelete}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
