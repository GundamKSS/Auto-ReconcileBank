"use client";

import { useMemo } from "react";
import { DetailFooter, dayKey, formatAmount } from "../../components/DayTable";
import { useOffsetList } from "../../components/useOffsetList";
import { type GlEntry, STATUS_BADGE, STATUS_LABEL, entryAccountLabel, sourceLabel } from "./glDisplay";

// รายการ GL ของวันเดียว — ใช้ตัวกรองชุดเดียวกับตารางวัน แค่บีบช่วงวันที่ให้เหลือวันนั้น
// จำนวน/ยอดที่เห็นจึงรวมได้เท่ากับแถวสรุปของวันพอดี
export default function GlDayDetail({
  params,
  day,
  showAccount,
}: {
  params: string;
  day: string;
  /** ดูทุกบัญชีของธนาคารอยู่ — ต้องบอกว่าแต่ละรายการเป็นของบัญชีไหน */
  showAccount: boolean;
}) {
  const url = useMemo(() => {
    const p = new URLSearchParams(params);
    p.set("from", day);
    p.set("to", day);
    return `/api/master/gl/entries?${p}`;
  }, [params, day]);
  const { items, total, loading, loadingMore, error, hasMore, loadMore } = useOffsetList<GlEntry>(url, "entries");

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      {!loading && !error && items.length > 0 && (
        <table className="w-full text-sm">
          <thead className="bg-gray-50/80 text-[11px] uppercase tracking-wide text-gray-400">
            <tr>
              <th className="px-3 py-2 text-left font-medium">เลขที่เอกสาร</th>
              <th className="px-3 py-2 text-left font-medium">สมุดรายวัน</th>
              {showAccount && <th className="px-3 py-2 text-left font-medium">บัญชี</th>}
              <th className="px-3 py-2 text-right font-medium">รับ/Debit</th>
              <th className="px-3 py-2 text-right font-medium">จ่าย/Credit</th>
              <th className="px-3 py-2 text-center font-medium">สถานะ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {items.map((e) => {
              const documentDate = dayKey(e.documentDate ?? "");
              return (
                <tr key={e.entryNo} className="hover:bg-blue-50/40">
                  <td className="px-3 py-1.5">
                    <span className="font-medium text-gray-800">{e.documentNo || "-"}</span>
                    <span className="block text-[11px] tabular-nums text-gray-400">
                      เลขรายการ {e.entryNo}
                      {documentDate && documentDate !== day && ` · เอกสาร ${documentDate}`}
                    </span>
                  </td>
                  <td className="px-3 py-1.5">
                    <span
                      title={e.sourceCode ?? undefined}
                      className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        e.sourceCode === "REVERSAL" ? "bg-rose-50 text-rose-600" : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {sourceLabel(e.sourceCode)}
                    </span>
                    {e.documentType && <span className="mt-0.5 block text-[11px] text-gray-400">{e.documentType}</span>}
                  </td>
                  {showAccount && (
                    <td className="whitespace-nowrap px-3 py-1.5 tabular-nums text-gray-500" title={e.accountName ?? e.accountNo}>
                      {entryAccountLabel(e)}
                    </td>
                  )}
                  <td className="px-3 py-1.5 text-right tabular-nums text-teal-700">
                    {e.direction === "IN" ? formatAmount(e.amount) : "-"}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-red-600">
                    {e.direction === "OUT" ? formatAmount(e.amount) : "-"}
                  </td>
                  <td className="px-3 py-1.5 text-center">
                    <span
                      className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_BADGE[e.status] ?? STATUS_BADGE.UNMATCHED}`}
                    >
                      {STATUS_LABEL[e.status] ?? e.status}
                    </span>
                    {e.matchId !== null && (
                      <span className="mt-0.5 block text-[10px] tabular-nums text-gray-400">เลขอ้างอิง #{e.matchId}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {!loading && !error && items.length === 0 && (
        <p className="px-3 py-3 text-center text-xs text-gray-400">ไม่พบรายการในวันนี้ ข้อมูลอาจมีการเปลี่ยนแปลง กรุณาโหลดข้อมูลใหม่</p>
      )}
      <DetailFooter
        shown={items.length}
        total={total}
        loading={loading}
        loadingMore={loadingMore}
        hasMore={hasMore}
        error={error}
        onLoadMore={loadMore}
      />
    </div>
  );
}
