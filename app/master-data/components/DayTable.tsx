"use client";

import { Fragment, type ReactNode, useState } from "react";
import { ChevronRight, Loader2, ChevronsDownUp, CircleCheck } from "lucide-react";
import StickyTableFrame from "./StickyTableFrame";
import { useInfiniteScroll } from "./useOffsetList";

export type DaySummary = {
  date: string;
  count: number;
  inCount: number;
  inAmount: number;
  outCount: number;
  outAmount: number;
  unmatchedCount: number;
};

export function formatAmount(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function dayKey(iso: string) {
  return iso ? iso.slice(0, 10) : "";
}

// วันในสัปดาห์ช่วยให้ไล่เช็คกับ statement ได้เร็ว (เช่นเห็นว่าวันเสาร์-อาทิตย์ไม่มีรายการ)
// วันที่จาก API เป็นเที่ยงคืน UTC ต้องอ่านเป็น UTC ไม่งั้นเครื่องที่อยู่ต่าง time zone จะได้วันเพี้ยน
function weekday(key: string) {
  return new Date(`${key}T00:00:00Z`).toLocaleDateString("th-TH", { weekday: "short", timeZone: "UTC" });
}

/**
 * ตารางสรุปรายวัน ใช้ร่วมกันทั้งหน้า Master Data · Bank Statement และ GL
 * 1 แถว = 1 วัน: จำนวนรายการ ยอดเข้า ยอดออก สุทธิ และจำนวนที่ยังไม่จับคู่ — กดแถวเพื่อกางรายการของวันนั้น
 * (renderDetail ของแต่ละหน้าโหลดรายการเองทีละ 50)
 */
export default function DayTable({
  days,
  totalDays,
  loading,
  loadingMore,
  hasMore,
  loadMore,
  error = "",
  amountColumns,
  showUnmatched,
  openDays,
  onOpenDaysChange,
  tableClassName,
  top,
  emptyState,
  renderDetail,
}: {
  days: DaySummary[];
  totalDays: number;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  loadMore: () => void;
  /** โหลดไม่สำเร็จ — หน้าแสดงข้อความ error เองแล้ว ตารางไม่ต้องขึ้น "ไม่พบรายการ" ซ้อน */
  error?: string;
  /** ลำดับและหัวคอลัมน์ยอดเงิน — ให้ตรงกับตารางรายการของหน้านั้น (Bank: ถอน แล้ว ฝาก / GL: รับ แล้ว จ่าย) */
  amountColumns: { key: "in" | "out"; label: string }[];
  /** ซ่อนคอลัมน์ "ยังไม่จับคู่" ตอนกรองสถานะอยู่ — ค่าจะเป็น 0 หรือเท่าจำนวนรายการเสมอ ไม่มีประโยชน์ */
  showUnmatched: boolean;
  openDays: string[];
  onOpenDaysChange: (next: string[]) => void;
  tableClassName: string;
  top: string;
  emptyState: ReactNode;
  renderDetail: (dayKey: string) => ReactNode;
}) {
  const [sentinel, setSentinel] = useState<HTMLDivElement | null>(null);
  useInfiniteScroll(sentinel, hasMore, loadMore);

  const open = new Set(openDays);
  const columnCount = 3 + amountColumns.length + (showUnmatched ? 1 : 0);
  const openVisible = days.some((d) => open.has(dayKey(d.date)));

  function toggle(key: string) {
    onOpenDaysChange(open.has(key) ? openDays.filter((d) => d !== key) : [...openDays, key]);
  }

  return (
    <div>
      <div className="mb-2 flex min-h-7 items-center justify-between gap-3 text-xs text-gray-400">
        <span>กดที่วันเพื่อดูรายการของวันนั้น</span>
        {openVisible && (
          <button
            onClick={() => onOpenDaysChange([])}
            className="flex items-center gap-1 rounded-lg px-2 py-1 font-medium text-blue-600 transition-colors hover:bg-blue-50"
          >
            <ChevronsDownUp size={13} /> ย่อทั้งหมด
          </button>
        )}
      </div>

      <StickyTableFrame
        tableClassName={tableClassName}
        top={top}
        head={
          <tr>
            <th className="px-3 py-3 text-left">วันที่</th>
            <th className="px-3 py-3 text-right">รายการ</th>
            {amountColumns.map((c) => (
              <th key={c.key} className="px-3 py-3 text-right">
                {c.label}
              </th>
            ))}
            <th className="px-3 py-3 text-right">สุทธิ</th>
            {showUnmatched && <th className="px-3 py-3 text-center">รอจับคู่</th>}
          </tr>
        }
      >
        <tbody className="divide-y divide-gray-100">
          {loading && (
            <tr>
              <td colSpan={columnCount} className="px-3 py-10 text-center text-gray-400">
                <Loader2 size={16} className="mr-2 inline animate-spin" /> กำลังโหลด...
              </td>
            </tr>
          )}

          {!loading &&
            days.map((d) => {
              const key = dayKey(d.date);
              const isOpen = open.has(key);
              const net = d.inAmount - d.outAmount;
              return (
                <Fragment key={key}>
                  <tr
                    onClick={() => toggle(key)}
                    className={`relative cursor-pointer transition-all duration-200 ease-out hover:z-10 hover:-translate-y-[2px] hover:shadow-[0_12px_24px_-12px_rgba(15,23,42,0.3)] hover:ring-1 hover:ring-blue-200 ${
                      isOpen ? "bg-blue-50/60" : "bg-white hover:bg-white"
                    }`}
                  >
                    <td className="whitespace-nowrap px-3 py-2.5">
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggle(key);
                        }}
                        className="flex items-center gap-2 text-left font-semibold text-gray-800"
                      >
                        <ChevronRight
                          size={15}
                          className={`shrink-0 text-gray-400 transition-transform ${isOpen ? "rotate-90 text-blue-500" : ""}`}
                        />
                        <span className="tabular-nums">{key}</span>
                        <span className="text-xs font-normal text-gray-400">{weekday(key)}</span>
                      </button>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-gray-600">{d.count.toLocaleString()}</td>
                    {amountColumns.map((c) => {
                      const amount = c.key === "in" ? d.inAmount : d.outAmount;
                      const count = c.key === "in" ? d.inCount : d.outCount;
                      return (
                        <td
                          key={c.key}
                          className={`px-3 py-2.5 text-right tabular-nums ${c.key === "in" ? "text-teal-700" : "text-red-600"}`}
                        >
                          {count > 0 ? (
                            <>
                              {formatAmount(amount)}
                              <span className="block text-[11px] text-gray-400">{count.toLocaleString()} รายการ</span>
                            </>
                          ) : (
                            <span className="text-gray-300">-</span>
                          )}
                        </td>
                      );
                    })}
                    <td className={`px-3 py-2.5 text-right font-semibold tabular-nums ${net < 0 ? "text-red-600" : "text-slate-800"}`}>
                      {formatAmount(net)}
                    </td>
                    {showUnmatched && (
                      <td className="px-3 py-2.5 text-center">
                        {d.unmatchedCount > 0 ? (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-amber-700">
                            {d.unmatchedCount.toLocaleString()}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-700">
                            <CircleCheck size={11} /> ครบ
                          </span>
                        )}
                      </td>
                    )}
                  </tr>
                  {isOpen && (
                    <tr className="bg-slate-50/80">
                      <td colSpan={columnCount} className="px-3 pb-3 pt-1">
                        {renderDetail(key)}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}

          {!loading && !error && days.length === 0 && (
            <tr>
              <td colSpan={columnCount} className="px-3 py-10 text-center text-gray-400">
                {emptyState}
              </td>
            </tr>
          )}
        </tbody>
      </StickyTableFrame>

      {!loading && days.length > 0 && (
        <div ref={setSentinel} className="py-4 text-center text-xs text-gray-400">
          {loadingMore ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" /> กำลังโหลดเพิ่ม...
            </span>
          ) : hasMore ? (
            <span className="inline-flex items-center gap-2">
              แสดง {days.length.toLocaleString()} จาก {totalDays.toLocaleString()} วัน
              <button onClick={loadMore} className="font-medium text-gray-600 underline underline-offset-2 hover:text-gray-900">
                โหลดเพิ่ม
              </button>
            </span>
          ) : (
            `ครบทั้งหมด ${totalDays.toLocaleString()} วัน`
          )}
        </div>
      )}
    </div>
  );
}

/** ท้ายตารางรายการของวัน — โหลดทีละ 50 ด้วยปุ่ม (เลื่อนอัตโนมัติซ้อนในตารางวันจะไปแย่งกับของตารางวัน) */
export function DetailFooter({
  shown,
  total,
  loading,
  loadingMore,
  hasMore,
  error,
  onLoadMore,
}: {
  shown: number;
  total: number;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: string;
  onLoadMore: () => void;
}) {
  if (error) return <p className="px-2 py-2 text-xs text-red-600">{error}</p>;
  if (loading) {
    return (
      <p className="px-2 py-3 text-center text-xs text-gray-400">
        <Loader2 size={13} className="mr-1.5 inline animate-spin" /> กำลังโหลดรายการ...
      </p>
    );
  }
  if (!hasMore) return null;
  return (
    <div className="px-2 pt-2 text-center text-xs text-gray-400">
      แสดง {shown.toLocaleString()} จาก {total.toLocaleString()} รายการ ·{" "}
      <button
        onClick={onLoadMore}
        disabled={loadingMore}
        className="font-medium text-blue-600 hover:underline disabled:text-gray-400 disabled:no-underline"
      >
        {loadingMore ? "กำลังโหลด..." : `โหลดเพิ่มอีก ${Math.min(50, total - shown).toLocaleString()} รายการ`}
      </button>
    </div>
  );
}
