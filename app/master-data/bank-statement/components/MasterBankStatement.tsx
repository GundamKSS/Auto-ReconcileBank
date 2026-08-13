"use client";

import { useEffect, useState } from "react";
import { Menu, Database } from "lucide-react";
import { useSidebar } from "@/components/SidebarContext";
import BankTabs from "./BankTabs";
import ImportBatchList, { ImportBatch } from "./ImportBatchList";
import LineItemsView from "./LineItemsView";

export default function MasterBankStatement() {
  const { toggleMobileOpen } = useSidebar();
  const [bankCode, setBankCode] = useState("BBL");
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedBatch, setSelectedBatch] = useState<ImportBatch | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

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
    loadBatches();
    /* eslint-enable react-hooks/set-state-in-effect */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bankCode]);

  async function handleDeleteBatch(batch: ImportBatch) {
    if (
      !confirm(
        `ลบไฟล์ "${batch.FileName}" ทั้งหมด (${batch.ImportedRowCount} รายการ) ใช่ไหม?\nการลบนี้ย้อนกลับไม่ได้`
      )
    )
      return;
    setDeletingId(batch.ImportId);
    setError("");
    try {
      const res = await fetch(`/api/master/bank-statement/imports/${batch.ImportId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "ลบไม่สำเร็จ");
        return;
      }
      await loadBatches();
    } catch {
      setError("เชื่อมต่อ server ไม่ได้");
    } finally {
      setDeletingId(null);
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
              จัดการไฟล์ Bank Statement ที่นำเข้าไว้ — ดู แก้ไข ลบ หรือเพิ่มรายการด้วยมือ
            </p>
          </div>
        </div>
      </div>

      <section className="rounded-[20px] border border-white/80 bg-white p-6 shadow-[0_10px_35px_rgba(30,64,175,0.06)]">
        <div className="mb-6">
          <BankTabs selected={bankCode} onSelect={setBankCode} />
        </div>

        {error && (
          <div className="mb-5 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        {!selectedBatch ? (
          <ImportBatchList
            batches={batches}
            loading={loading}
            onSelect={setSelectedBatch}
            onDelete={handleDeleteBatch}
            deletingId={deletingId}
          />
        ) : (
          <LineItemsView batch={selectedBatch} onBack={() => setSelectedBatch(null)} />
        )}
      </section>
    </div>
  );
}