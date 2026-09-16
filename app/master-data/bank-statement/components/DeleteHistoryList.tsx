"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
// โหลดทีละ 50 แบบ infinite scroll — จำนวนไฟล์ที่ถูกลบยังน้อยตอนนี้ แต่สะสมไปเรื่อยๆ ไม่มีวันหาย (soft delete)
export default function DeleteHistoryList({ bankCode }: { bankCode: string }) {
  const [deletions, setDeletions] = useState<DeletedImport[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  const requestIdRef = useRef(0);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const inFlightRef = useRef(false);

  useEffect(() => {
    const reqId = ++requestIdRef.current;
    let cancelled = false;

    async function loadFirstPage() {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`/api/master/bank-statement/delete-history?bankCode=${bankCode}&offset=0`);
        const data = await res.json();
        if (cancelled || reqId !== requestIdRef.current) return;
        if (!res.ok) {
          setError(data.error || "โหลดประวัติการลบไม่สำเร็จ");
          setDeletions([]);
          setTotal(0);
          return;
        }
        setDeletions(data.deletions);
        setTotal(data.total ?? data.deletions.length);
      } catch {
        if (!cancelled && reqId === requestIdRef.current) {
          setError("เชื่อมต่อ server ไม่ได้");
          setDeletions([]);
          setTotal(0);
        }
      } finally {
        if (!cancelled && reqId === requestIdRef.current) setLoading(false);
      }
    }

    // โหลดใหม่ทุกครั้งที่เปลี่ยนธนาคาร — fetch-on-param-change ปกติ
    loadFirstPage();
    return () => {
      cancelled = true;
    };
  }, [bankCode]);

  const hasMore = deletions.length < total;

  const loadMore = useCallback(async () => {
    if (loading || inFlightRef.current || !hasMore) return;
    const reqId = requestIdRef.current;
    inFlightRef.current = true;
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/master/bank-statement/delete-history?bankCode=${bankCode}&offset=${deletions.length}`);
      const data = await res.json();
      if (reqId !== requestIdRef.current) return;
      if (!res.ok) {
        setError(data.error || "โหลดเพิ่มไม่สำเร็จ");
        return;
      }
      setDeletions((prev) => [...prev, ...data.deletions]);
    } catch {
      if (reqId === requestIdRef.current) setError("เชื่อมต่อ server ไม่ได้");
    } finally {
      inFlightRef.current = false;
      if (reqId === requestIdRef.current) setLoadingMore(false);
    }
  }, [loading, hasMore, bankCode, deletions.length]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;

    const nearViewport = () => el.getBoundingClientRect().top < window.innerHeight + 300;
    let frame = 0;
    const check = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (nearViewport()) loadMore();
      });
    };

    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) loadMore();
    });
    io.observe(el);
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    check();

    return () => {
      io.disconnect();
      window.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
      cancelAnimationFrame(frame);
    };
  }, [loadMore, hasMore]);

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
      <p className="mb-3 text-xs text-gray-400">ไฟล์ที่ถูกลบทั้งหมด {total.toLocaleString()} ไฟล์ — บันทึกผู้ลบ วันเวลา และเหตุผลไว้ทุกครั้ง</p>
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

      <div ref={sentinelRef} className="py-4 text-center text-xs text-gray-400">
        {loadingMore ? (
          <span className="inline-flex items-center gap-2">
            <Loader2 size={14} className="animate-spin" /> กำลังโหลดเพิ่ม...
          </span>
        ) : hasMore ? (
          <span className="inline-flex items-center gap-2">
            แสดง {deletions.length.toLocaleString()} จาก {total.toLocaleString()} รายการ
            <button onClick={loadMore} className="font-medium text-gray-600 underline underline-offset-2 hover:text-gray-900">
              โหลดเพิ่ม
            </button>
          </span>
        ) : (
          `ครบทั้งหมด ${total.toLocaleString()} รายการ`
        )}
      </div>
    </div>
  );
}
