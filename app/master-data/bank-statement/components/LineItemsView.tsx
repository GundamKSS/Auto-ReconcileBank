"use client";

import { useMemo } from "react";
import { ArrowLeft, Trash2, X, Lock, SlidersHorizontal, ArrowDownLeft, ArrowUpRight, Scale } from "lucide-react";
import { ImportBatch, formatDate } from "./ImportBatchList";
import BankDayDetail from "./BankDayDetail";
import StickySummaryBar from "../../components/StickySummaryBar";
import DayTable, { type DaySummary } from "../../components/DayTable";
import { useOffsetList } from "../../components/useOffsetList";
import { STICKY_VARS, stickyTop } from "../../components/useSticky";
import { useSessionState } from "../../../../hooks/useSessionState";

type Summary = {
  lineCount: number;
  inCount: number;
  inAmount: number;
  outCount: number;
  outAmount: number;
};

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

// รายการในไฟล์เป็นแบบอ่านอย่างเดียว — Bank Statement เป็นเอกสารต้นฉบับจากธนาคาร แก้ไข/เพิ่ม/ลบทีละรายการไม่ได้
// ถ้าไฟล์ผิดต้องลบทั้งไฟล์ (เก็บประวัติผู้ลบ/เหตุผล/เวลา) แล้วนำเข้าไฟล์ที่ถูกต้องใหม่
//
// แสดงเป็นรายวัน (ยอดรวมของวัน) แล้วกดกางดูรายการของวันนั้น — ไล่เช็คกับ statement ทีละวันได้ง่ายกว่ารายการยาวๆ
// ทั้งตารางวันและรายการในวันโหลดทีละ 50 (วันละเป็นร้อยรายการก็มี เช่นวันสิ้นเดือน)
export default function LineItemsView({
  batch,
  onBack,
  onDelete,
}: {
  batch: ImportBatch;
  onBack: () => void;
  onDelete: (batch: ImportBatch) => void;
}) {
  // ตัวกรองจำแยกรายไฟล์ — ช่วงวันที่ของไฟล์หนึ่งไม่ควรติดไปซ่อนรายการของอีกไฟล์
  // (parent ใส่ key={ImportId} ไว้ เปลี่ยนไฟล์แล้ว component นี้ mount ใหม่พร้อม key ของ storage ชุดใหม่)
  const storageKey = `master-data:bank:lines:${batch.ImportId}`;
  const [filterFrom, setFilterFrom] = useSessionState(`${storageKey}:from`, "");
  const [filterTo, setFilterTo] = useSessionState(`${storageKey}:to`, "");
  const [filterChannel, setFilterChannel] = useSessionState(`${storageKey}:channel`, "");
  const [filterStatus, setFilterStatus] = useSessionState(`${storageKey}:status`, "");

  // วันที่กางดูอยู่ จำไว้พร้อมตัวกรองของไฟล์นี้ — สลับหน้าไปแล้วกลับมาเจอวันเดิมกางอยู่
  const [openDays, setOpenDays] = useSessionState<string[]>(`${storageKey}:openDays`, [], isStringArray);

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

  const {
    items: days,
    total: totalDays,
    firstPage,
    loading,
    loadingMore,
    error,
    hasMore,
    loadMore,
  } = useOffsetList<DaySummary>(`/api/master/bank-statement/days?${params}`, "days");
  const summary = (firstPage?.summary as Summary | undefined) ?? null;
  const channelOptions = (firstPage?.channels as string[] | undefined) ?? [];

  const locked = batch.LockedCount > 0;
  const net = summary ? summary.inAmount - summary.outAmount : 0;
  const lineCount = summary?.lineCount ?? 0;

  return (
    <div>
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-4 -ml-1 px-1 py-0.5 rounded-md hover:bg-gray-50 transition-colors">
        <ArrowLeft size={14} /> กลับไปเลือกไฟล์
      </button>

      <div className="flex items-start justify-between mb-2 flex-wrap gap-3 pb-5 border-b border-gray-100">
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-gray-900 break-all">{batch.FileName}</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            {formatDate(batch.PeriodStart)} – {formatDate(batch.PeriodEnd)} ·{" "}
            <span className="text-gray-500 font-medium">
              {lineCount.toLocaleString()} รายการ{hasActiveFilters ? "ที่ตรงกับตัวกรอง" : ""} · {totalDays.toLocaleString()} วัน
            </span>
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

      <StickySummaryBar
        className="mb-2"
        loading={loading}
        items={[
          { key: "in", icon: <ArrowDownLeft size={16} />, label: "ฝากเข้า · Credit", tone: "in", amount: summary?.inAmount, count: summary?.inCount },
          { key: "out", icon: <ArrowUpRight size={16} />, label: "ถอนออก · Debit", tone: "out", amount: summary?.outAmount, count: summary?.outCount },
          {
            key: "net",
            icon: <Scale size={16} />,
            label: "สุทธิ (ฝาก − ถอน)",
            tone: net < 0 ? "out" : "net",
            amount: summary ? net : undefined,
            count: summary ? lineCount : undefined,
          },
        ]}
      />

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

      <DayTable
        days={days}
        totalDays={totalDays}
        loading={loading}
        loadingMore={loadingMore}
        hasMore={hasMore}
        loadMore={loadMore}
        error={error}
        amountColumns={[
          { key: "out", label: "ถอน/Debit" },
          { key: "in", label: "ฝาก/Credit" },
        ]}
        showUnmatched={!filterStatus}
        openDays={openDays}
        onOpenDaysChange={setOpenDays}
        tableClassName="w-full text-sm min-w-[880px]"
        top={stickyTop(STICKY_VARS.nav, STICKY_VARS.cards)}
        emptyState={
          hasActiveFilters ? (
            <>
              ไม่พบรายการที่ตรงกับตัวกรอง —{" "}
              <button onClick={clearFilters} className="text-blue-600 hover:underline font-medium">
                ล้างตัวกรอง
              </button>
            </>
          ) : (
            "ไม่มีรายการในไฟล์นี้"
          )
        }
        renderDetail={(day) => <BankDayDetail params={params} day={day} />}
      />
    </div>
  );
}
