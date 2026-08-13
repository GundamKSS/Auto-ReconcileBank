"use client";

import { FileSpreadsheet, ChevronRight, Trash2, Loader2, Inbox } from "lucide-react";

export type ImportBatch = {
  ImportId: number;
  BankCode: string;
  FileName: string;
  PeriodStart: string;
  PeriodEnd: string;
  ImportedRowCount: number;
  ImportedAt: string;
};

function formatDate(iso: string) {
  return new Date(iso).toISOString().slice(0, 10);
}
function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
}

export default function ImportBatchList({
  batches,
  loading,
  onSelect,
  onDelete,
  deletingId,
}: {
  batches: ImportBatch[];
  loading: boolean;
  onSelect: (batch: ImportBatch) => void;
  onDelete: (batch: ImportBatch) => void;
  deletingId: number | null;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 text-sm text-gray-400 py-16">
        <Loader2 size={16} className="animate-spin" /> กำลังโหลด...
      </div>
    );
  }

  if (batches.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-50 text-gray-300">
          <Inbox size={22} />
        </div>
        <p className="text-sm text-gray-400">ยังไม่มีไฟล์ที่นำเข้าสำหรับธนาคารนี้</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      {batches.map((b) => (
        <div
          key={b.ImportId}
          className="flex items-center gap-3 bg-white border border-gray-200 rounded-2xl px-4 py-3.5 hover:border-blue-200 hover:shadow-[0_6px_20px_rgba(30,64,175,0.06)] transition-all group"
        >
          <button onClick={() => onSelect(b)} className="flex items-center gap-3.5 flex-1 min-w-0 text-left">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-500 group-hover:bg-blue-100 transition-colors">
              <FileSpreadsheet size={19} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900 truncate">{b.FileName}</p>
              <p className="text-xs text-gray-400 mt-0.5">
                {formatDate(b.PeriodStart)} – {formatDate(b.PeriodEnd)} ·{" "}
                <span className="text-gray-500 font-medium">{b.ImportedRowCount.toLocaleString()} รายการ</span> ·
                นำเข้าเมื่อ {formatDateTime(b.ImportedAt)}
              </p>
            </div>
            <ChevronRight size={16} className="text-gray-300 group-hover:text-blue-500 group-hover:translate-x-0.5 transition-all shrink-0" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(b);
            }}
            disabled={deletingId === b.ImportId}
            className="p-2 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors shrink-0 disabled:opacity-50"
            title="ลบไฟล์นี้ทั้งหมด"
          >
            {deletingId === b.ImportId ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
          </button>
        </div>
      ))}
    </div>
  );
}