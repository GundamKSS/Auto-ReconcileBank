"use client";

import { useEffect, useState } from "react";
import { History, Loader2 } from "lucide-react";
import { formatDate, formatDateTime } from "./ImportBatchList";

type DeletedImport = {
  ImportId: number;
  BankCode: string;
  FileName: string;
  PeriodStart: string | null;
  PeriodEnd: string | null;
  ImportedRowCount: number;
  ImportedAt: string;
  DeletedAt: string;
  DeletedBy: string;
  DeletedReason: string;
};

// ประวัติการลบไฟล์ของธนาคารที่เลือก — ใครลบ ลบเมื่อไร เหตุผลอะไร (อ่านอย่างเดียว ล่าสุดก่อน)
export default function DeleteHistoryList({ bankCode }: { bankCode: string }) {
  const [deletions, setDeletions] = useState<DeletedImport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadDeletions() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/master/bank-statement/delete-history?bankCode=${bankCode}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "โหลดประวัติการลบไม่สำเร็จ");
        return;
      }
      setDeletions(data.deletions);
    } catch {
      setError("เชื่อมต่อ server ไม่ได้");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // โหลดใหม่ทุกครั้งที่เปลี่ยนธนาคาร — fetch-on-param-change ปกติ
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadDeletions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bankCode]);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 text-sm text-gray-400 py-16">
        <Loader2 size={16} className="animate-spin" /> กำลังโหลด...
      </div>
    );
  }

  if (error) {
    return <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>;
  }

  if (deletions.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-50 text-gray-300">
          <History size={22} />
        </div>
        <p className="text-sm text-gray-400">ยังไม่มีไฟล์ที่ถูกลบสำหรับธนาคารนี้</p>
      </div>
    );
  }

  return (
    <div>
      <p className="mb-3 text-xs text-gray-400">
        ไฟล์ที่ถูกลบ {deletions.length.toLocaleString()} ไฟล์ — บันทึกผู้ลบ วันเวลา และเหตุผลไว้ทุกครั้ง
      </p>
      <div className="overflow-x-auto border border-gray-200 rounded-2xl">
        <table className="w-full text-sm min-w-[860px]">
          <thead className="bg-gray-50 border-b border-gray-200 text-gray-500 text-xs uppercase tracking-wide">
            <tr>
              <th className="px-3 py-3 text-left whitespace-nowrap">ลบเมื่อ</th>
              <th className="px-3 py-3 text-left">ไฟล์ที่ลบ</th>
              <th className="px-3 py-3 text-left whitespace-nowrap">ผู้ลบ</th>
              <th className="px-3 py-3 text-left">เหตุผลที่ลบ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {deletions.map((d) => (
              <tr key={d.ImportId} className="align-top">
                <td className="px-3 py-3 text-gray-700 whitespace-nowrap tabular-nums">{formatDateTime(d.DeletedAt)}</td>
                <td className="px-3 py-3 max-w-[320px]">
                  <p className="font-medium text-gray-900 break-all">{d.FileName}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {formatDate(d.PeriodStart)} – {formatDate(d.PeriodEnd)} · {d.ImportedRowCount.toLocaleString()} รายการ
                  </p>
                  <p className="text-xs text-gray-400">นำเข้าเมื่อ {formatDateTime(d.ImportedAt)}</p>
                </td>
                <td className="px-3 py-3 text-gray-700 whitespace-nowrap">{d.DeletedBy}</td>
                <td className="px-3 py-3 text-gray-700 whitespace-pre-wrap break-words min-w-[240px]">{d.DeletedReason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
