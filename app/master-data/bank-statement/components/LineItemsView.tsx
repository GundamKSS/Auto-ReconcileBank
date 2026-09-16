"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Trash2, X, Loader2, Lock, SlidersHorizontal } from "lucide-react";
import { ImportBatch, formatDate } from "./ImportBatchList";

type Line = {
  LineId: number;
  ImportId: number;
  BankCode: string;
  TranDate: string;
  Description: string | null;
  Debit: number | null;
  Credit: number | null;
  Balance: number | null;
  ChequeNo: string | null;
  Channel: string | null;
  MatchStatus: "UNMATCHED" | "MATCHED" | "SUSPENSE";
};

function formatAmount(n: number | null) {
  if (n === null || n === undefined) return "-";
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function toDateInput(iso: string) {
  return iso ? iso.slice(0, 10) : "";
}

function StatusBadge({ status }: { status: Line["MatchStatus"] }) {
  const map = {
    UNMATCHED: "bg-gray-100 text-gray-500",
    MATCHED: "bg-green-100 text-green-700",
    SUSPENSE: "bg-amber-100 text-amber-700",
  };
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${map[status] ?? map.UNMATCHED}`}>
      {status}
    </span>
  );
}

// รายการในไฟล์เป็นแบบอ่านอย่างเดียว — Bank Statement เป็นเอกสารต้นฉบับจากธนาคาร แก้ไข/เพิ่ม/ลบทีละรายการไม่ได้
// ถ้าไฟล์ผิดต้องลบทั้งไฟล์ (เก็บประวัติผู้ลบ/เหตุผล/เวลา) แล้วนำเข้าไฟล์ที่ถูกต้องใหม่
//
// โหลดทีละ 50 รายการแบบ infinite scroll (เหมือนหน้า Match History/Reports) แทนการดึงทั้งไฟล์มาไว้
// ในเครื่องแล้วค่อยแบ่งหน้าเอง — ไฟล์ statement บางไฟล์มีเป็นพันแถว ดึงทั้งหมดมาทุกครั้งที่เปิดดูจะช้าโดยไม่จำเป็น
export default function LineItemsView({
  batch,
  onBack,
  onDelete,
}: {
  batch: ImportBatch;
  onBack: () => void;
  onDelete: (batch: ImportBatch) => void;
}) {
  const [lines, setLines] = useState<Line[]>([]);
  const [total, setTotal] = useState(0);
  const [channelOptions, setChannelOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [filterChannel, setFilterChannel] = useState("");
  const [filterStatus, setFilterStatus] = useState("");

  const requestIdRef = useRef(0);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // กันยิงซ้ำในเฟรมเดียวกัน — state loadingMore อัปเดตแบบ async เลยเช็คไม่ทันถ้ามีสองสัญญาณมาพร้อมกัน
  const inFlightRef = useRef(false);

  const hasActiveFilters = Boolean(filterFrom || filterTo || filterChannel || filterStatus);
  function clearFilters() {
    setFilterFrom("");
    setFilterTo("");
    setFilterChannel("");
    setFilterStatus("");
  }

  const params = useMemo(() => {
    const p = new URLSearchParams({ importId: String(batch.ImportId) });
    if (filterFrom) p.set("from", filterFrom);
    if (filterTo) p.set("to", filterTo);
    if (filterChannel) p.set("channel", filterChannel);
    if (filterStatus) p.set("status", filterStatus);
    return p.toString();
  }, [batch.ImportId, filterFrom, filterTo, filterChannel, filterStatus]);

  // โหลดหน้าแรกใหม่ทุกครั้งที่เปลี่ยนไฟล์ที่เลือกดูหรือเปลี่ยนตัวกรอง
  useEffect(() => {
    const reqId = ++requestIdRef.current;
    let cancelled = false;

    async function loadFirstPage() {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`/api/master/bank-statement/lines?${params}&offset=0`);
        const data = await res.json();
        if (cancelled || reqId !== requestIdRef.current) return;
        if (!res.ok) {
          setError(data.error || "โหลดรายการไม่สำเร็จ");
          setLines([]);
          setTotal(0);
          return;
        }
        setLines(data.lines);
        setTotal(data.total ?? data.lines.length);
        if (Array.isArray(data.channels)) setChannelOptions(data.channels);
      } catch {
        if (!cancelled && reqId === requestIdRef.current) {
          setError("เชื่อมต่อ server ไม่ได้");
          setLines([]);
          setTotal(0);
        }
      } finally {
        if (!cancelled && reqId === requestIdRef.current) setLoading(false);
      }
    }

    loadFirstPage();
    return () => {
      cancelled = true;
    };
  }, [params]);

  const hasMore = lines.length < total;

  const loadMore = useCallback(async () => {
    if (loading || inFlightRef.current || !hasMore) return;
    const reqId = requestIdRef.current;
    inFlightRef.current = true;
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/master/bank-statement/lines?${params}&offset=${lines.length}`);
      const data = await res.json();
      // filter เปลี่ยนระหว่างรอ response — ทิ้งผลลัพธ์ชุดนี้ไป ไม่งั้นแถวจะปนกันคนละ filter
      if (reqId !== requestIdRef.current) return;
      if (!res.ok) {
        setError(data.error || "โหลดเพิ่มไม่สำเร็จ");
        return;
      }
      setLines((prev) => [...prev, ...data.lines]);
    } catch {
      if (reqId === requestIdRef.current) setError("เชื่อมต่อ server ไม่ได้");
    } finally {
      inFlightRef.current = false;
      if (reqId === requestIdRef.current) setLoadingMore(false);
    }
  }, [loading, hasMore, params, lines.length]);

  // infinite scroll: โหลดชุดถัดไปเมื่อท้ายรายการใกล้เข้ามาในจอ (เหมือนหน้า Match History/Reports)
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;

    const nearViewport = () => el.getBoundingClientRect().top < window.innerHeight + 300;
    // อ่าน layout แค่เฟรมละครั้ง — scroll event ยิงถี่กว่าเฟรม ถ้าเรียก getBoundingClientRect ทุกครั้งจะบังคับ reflow ซ้ำจนเลื่อนกระตุก
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

  const locked = batch.LockedCount > 0;

  return (
    <div>
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-4 -ml-1 px-1 py-0.5 rounded-md hover:bg-gray-50 transition-colors">
        <ArrowLeft size={14} /> กลับไปเลือกไฟล์
      </button>

      <div className="flex items-start justify-between mb-5 flex-wrap gap-3 pb-5 border-b border-gray-100">
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-gray-900 break-all">{batch.FileName}</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            {formatDate(batch.PeriodStart)} – {formatDate(batch.PeriodEnd)} ·{" "}
            {hasActiveFilters ? (
              <span className="text-gray-500 font-medium">{total.toLocaleString()} รายการที่ตรงกับตัวกรอง</span>
            ) : (
              <span className="text-gray-500 font-medium">{total.toLocaleString()} รายการ</span>
            )}
          </p>
          <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-500">
            <Lock size={12} className="shrink-0" />
            อ่านอย่างเดียว — แก้ไข เพิ่ม หรือลบทีละรายการไม่ได้ ถ้าไฟล์ผิดให้ลบทั้งไฟล์แล้วนำเข้าใหม่
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <button
            onClick={() => onDelete(batch)}
            disabled={locked}
            className="flex items-center gap-1.5 text-sm font-medium text-red-600 border border-red-200 bg-white hover:bg-red-50 px-4 py-2 rounded-full transition-colors disabled:text-gray-400 disabled:border-gray-200 disabled:bg-gray-50 disabled:cursor-not-allowed"
          >
            {locked ? <Lock size={14} /> : <Trash2 size={14} />} ลบไฟล์นี้
          </button>
          {locked && (
            <p className="text-[11px] text-amber-600">
              มี {batch.LockedCount.toLocaleString()} รายการจับคู่แล้ว — ต้องยกเลิกการจับคู่ก่อนจึงลบได้
            </p>
          )}
        </div>
      </div>

      <div className="mb-5 flex flex-wrap items-end gap-3 rounded-xl border border-gray-100 bg-gray-50/60 p-3.5">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wide pb-1.5">
          <SlidersHorizontal size={13} /> กรอง
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-gray-500">จากวันที่</label>
          <input
            type="date"
            value={filterFrom}
            onChange={(e) => setFilterFrom(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white text-gray-700"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-gray-500">ถึงวันที่</label>
          <input
            type="date"
            value={filterTo}
            onChange={(e) => setFilterTo(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white text-gray-700"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-gray-500">ช่องทาง</label>
          <select
            value={filterChannel}
            onChange={(e) => setFilterChannel(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white text-gray-700 min-w-[120px]"
          >
            <option value="">ทั้งหมด</option>
            {channelOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-gray-500">สถานะ</label>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white text-gray-700 min-w-[120px]"
          >
            <option value="">ทั้งหมด</option>
            <option value="UNMATCHED">UNMATCHED</option>
            <option value="MATCHED">MATCHED</option>
            <option value="SUSPENSE">SUSPENSE</option>
          </select>
        </div>
        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 hover:bg-blue-50 px-2.5 py-1.5 rounded-lg transition-colors"
          >
            <X size={12} /> ล้างตัวกรอง
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      <div className="table-scroll border border-gray-200 rounded-2xl overflow-x-auto">
        <table className="w-full text-sm min-w-[820px]">
          <thead className="bg-gray-50 border-b border-gray-200 text-gray-500 text-xs uppercase tracking-wide">
            <tr>
              <th className="px-3 py-3 text-left">วันที่</th>
              <th className="px-3 py-3 text-left">รายละเอียด</th>
              <th className="px-3 py-3 text-right">ถอน/Debit</th>
              <th className="px-3 py-3 text-right">ฝาก/Credit</th>
              <th className="px-3 py-3 text-right">คงเหลือ</th>
              <th className="px-3 py-3 text-left">เลขเช็ค</th>
              <th className="px-3 py-3 text-left">ช่องทาง</th>
              <th className="px-3 py-3 text-center">สถานะ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading && (
              <tr>
                <td colSpan={8} className="px-3 py-10 text-center text-gray-400">
                  <Loader2 size={16} className="animate-spin inline mr-2" /> กำลังโหลด...
                </td>
              </tr>
            )}

            {!loading &&
              lines.map((l) => (
                <tr
                  key={l.LineId}
                  className="relative bg-white transition-all duration-200 ease-out hover:z-10 hover:-translate-y-[3px] hover:bg-white hover:shadow-[0_16px_30px_-10px_rgba(15,23,42,0.3)] hover:ring-1 hover:ring-blue-200"
                >
                  <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{toDateInput(l.TranDate)}</td>
                  <td className="px-3 py-2 text-gray-800 max-w-[260px] truncate">{l.Description}</td>
                  <td className="px-3 py-2 text-right text-red-600 tabular-nums">{formatAmount(l.Debit)}</td>
                  <td className="px-3 py-2 text-right text-teal-700 tabular-nums">{formatAmount(l.Credit)}</td>
                  <td className="px-3 py-2 text-right text-gray-500 tabular-nums">{formatAmount(l.Balance)}</td>
                  <td className="px-3 py-2 text-gray-500">{l.ChequeNo || "-"}</td>
                  <td className="px-3 py-2 text-gray-500">{l.Channel || "-"}</td>
                  <td className="px-3 py-2 text-center">
                    <StatusBadge status={l.MatchStatus} />
                  </td>
                </tr>
              ))}

            {!loading && lines.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-10 text-center text-gray-400">
                  {hasActiveFilters ? (
                    <>
                      ไม่พบรายการที่ตรงกับตัวกรอง —{" "}
                      <button onClick={clearFilters} className="text-blue-600 hover:underline font-medium">
                        ล้างตัวกรอง
                      </button>
                    </>
                  ) : (
                    "ไม่มีรายการในไฟล์นี้"
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {!loading && lines.length > 0 && (
        <div ref={sentinelRef} className="py-4 text-center text-xs text-gray-400">
          {loadingMore ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" /> กำลังโหลดเพิ่ม...
            </span>
          ) : hasMore ? (
            <span className="inline-flex items-center gap-2">
              แสดง {lines.length.toLocaleString()} จาก {total.toLocaleString()} รายการ
              <button onClick={loadMore} className="font-medium text-gray-600 underline underline-offset-2 hover:text-gray-900">
                โหลดเพิ่ม
              </button>
            </span>
          ) : (
            `ครบทั้งหมด ${total.toLocaleString()} รายการ`
          )}
        </div>
      )}

      <style jsx>{`
        .table-scroll {
          scrollbar-width: thin;
          scrollbar-color: #cbd5e1 #f1f5f9;
        }
        .table-scroll::-webkit-scrollbar {
          height: 10px;
        }
        .table-scroll::-webkit-scrollbar-track {
          background: #f1f5f9;
        }
        .table-scroll::-webkit-scrollbar-thumb {
          background-color: #cbd5e1;
          border-radius: 999px;
          border: 2px solid #f1f5f9;
        }
        .table-scroll::-webkit-scrollbar-thumb:hover {
          background-color: #94a3b8;
        }
      `}</style>
    </div>
  );
}
