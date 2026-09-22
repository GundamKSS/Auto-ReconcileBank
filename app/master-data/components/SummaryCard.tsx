"use client";

import type { ReactNode } from "react";

function formatAmount(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// การ์ดสรุปยอดด้านบนตาราง ใช้ร่วมกันทั้งหน้า Master Data · Bank Statement และ GL
// สีเงินเข้า/ออกตรงกับคอลัมน์ยอดในตาราง: เข้า = teal, ออก = red
export default function SummaryCard({
  icon,
  label,
  tone,
  amount,
  count,
  loading,
  compact = false,
}: {
  icon: ReactNode;
  label: string;
  tone: "in" | "out" | "net";
  amount: number | undefined;
  count: number | undefined;
  loading: boolean;
  /** แบบย่อบรรทัดเดียว ใช้ตอนการ์ดถูกตรึงไว้ด้านบน */
  compact?: boolean;
}) {
  const toneClass = {
    in: { icon: "bg-teal-50 text-teal-600", amount: "text-teal-700" },
    out: { icon: "bg-red-50 text-red-500", amount: "text-red-600" },
    net: { icon: "bg-blue-50 text-blue-600", amount: "text-slate-900" },
  }[tone];
  const amountText = loading || amount === undefined ? "…" : formatAmount(amount);

  if (compact) {
    return (
      <div className="flex min-w-0 items-baseline justify-between gap-2 rounded-xl border border-gray-100 bg-white px-3 py-1 sm:py-1.5">
        <p className="truncate text-[11px] font-medium text-gray-500">{label}</p>
        <p className={`shrink-0 text-sm font-bold tabular-nums ${amount === undefined || loading ? "text-gray-300" : toneClass.amount}`}>
          {amountText}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-gray-100 bg-white px-4 py-3.5">
      <div className="flex items-center gap-2 text-xs font-medium text-gray-500">
        <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${toneClass.icon}`}>{icon}</span>
        {label}
      </div>
      <p className={`mt-2 text-xl font-bold tabular-nums ${toneClass.amount}`}>
        {loading || amount === undefined ? <span className="text-gray-300">…</span> : formatAmount(amount)}
      </p>
      <p className="mt-0.5 text-[11px] text-gray-400">
        {loading || count === undefined ? " " : `${count.toLocaleString()} รายการ`}
      </p>
    </div>
  );
}
