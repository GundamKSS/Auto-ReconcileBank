"use client";

import { useMemo } from "react";
import { DetailFooter, formatAmount } from "../../components/DayTable";
import { useOffsetList } from "../../components/useOffsetList";

type Line = {
  LineId: number;
  Description: string | null;
  Debit: number | null;
  Credit: number | null;
  Balance: number | null;
  ChequeNo: string | null;
  Channel: string | null;
  MatchStatus: "UNMATCHED" | "MATCHED" | "SUSPENSE";
};

function amountOrDash(n: number | null) {
  return n === null || n === undefined ? "-" : formatAmount(n);
}

function StatusBadge({ status }: { status: Line["MatchStatus"] }) {
  const map = {
    UNMATCHED: "bg-gray-100 text-gray-500",
    MATCHED: "bg-green-100 text-green-700",
    SUSPENSE: "bg-amber-100 text-amber-700",
  };
  return (
    <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold ${map[status] ?? map.UNMATCHED}`}>
      {status}
    </span>
  );
}

// รายการของวันเดียวในไฟล์ statement — ใช้ตัวกรองชุดเดียวกับตารางวัน แค่บีบช่วงวันที่ให้เหลือวันนั้น
// จำนวน/ยอดที่เห็นจึงรวมได้เท่ากับแถวสรุปของวันพอดี
export default function BankDayDetail({ params, day }: { params: string; day: string }) {
  const url = useMemo(() => {
    const p = new URLSearchParams(params);
    p.set("from", day);
    p.set("to", day);
    return `/api/master/bank-statement/lines?${p}`;
  }, [params, day]);
  const { items, total, loading, loadingMore, error, hasMore, loadMore } = useOffsetList<Line>(url, "lines");

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      {!loading && !error && items.length > 0 && (
        <table className="w-full text-sm">
          <thead className="bg-gray-50/80 text-[11px] uppercase tracking-wide text-gray-400">
            <tr>
              <th className="px-3 py-2 text-left font-medium">รายละเอียด</th>
              <th className="px-3 py-2 text-right font-medium">ถอน/Debit</th>
              <th className="px-3 py-2 text-right font-medium">ฝาก/Credit</th>
              <th className="px-3 py-2 text-right font-medium">คงเหลือ</th>
              <th className="px-3 py-2 text-left font-medium">เลขเช็ค</th>
              <th className="px-3 py-2 text-left font-medium">ช่องทาง</th>
              <th className="px-3 py-2 text-center font-medium">สถานะ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {items.map((l) => (
              <tr key={l.LineId} className="hover:bg-blue-50/40">
                <td className="max-w-[280px] truncate px-3 py-1.5 text-gray-800" title={l.Description ?? undefined}>
                  {l.Description}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums text-red-600">{amountOrDash(l.Debit)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-teal-700">{amountOrDash(l.Credit)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-gray-500">{amountOrDash(l.Balance)}</td>
                <td className="px-3 py-1.5 text-gray-500">{l.ChequeNo || "-"}</td>
                <td className="px-3 py-1.5 text-gray-500">{l.Channel || "-"}</td>
                <td className="px-3 py-1.5 text-center">
                  <StatusBadge status={l.MatchStatus} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {!loading && !error && items.length === 0 && (
        <p className="px-3 py-3 text-center text-xs text-gray-400">ไม่พบรายการของวันนี้แล้ว — ข้อมูลอาจเพิ่งเปลี่ยน ลองรีเฟรชหน้า</p>
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
