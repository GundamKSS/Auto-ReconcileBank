"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileSpreadsheet, BookOpen } from "lucide-react";
import { STICKY_VARS, useStickyHeight } from "./useSticky";

// สลับระหว่างข้อมูลต้นทางสองฝั่งของการกระทบยอด — เมนู Master Data ใน sidebar มีอันเดียว (guardPath '/master-data')
// จึงต้องมีแท็บในหน้าให้ไปอีกฝั่งได้
const TABS = [
  { href: "/master-data/bank-statement", label: "รายการธนาคาร", hint: "ไฟล์ที่นำเข้า", icon: FileSpreadsheet },
  { href: "/master-data/gl", label: "รายการบัญชี", hint: "BC365", icon: BookOpen },
] as const;

export default function MasterDataTabs() {
  const pathname = usePathname();
  const [bar, setBar] = useState<HTMLDivElement | null>(null);
  useStickyHeight(bar, STICKY_VARS.nav);

  // ตรึงไว้บนสุดตอนเลื่อน — แถบเต็มความกว้าง (-mx-8 ชดเชย padding ของหน้า) พื้นสีเดียวกับหน้า
  // เนื้อหาที่เลื่อนผ่านใต้แถบจะได้ไม่โผล่ข้างๆ ปุ่ม
  return (
    <div ref={setBar} className="sticky top-0 z-30 -mx-8 mb-2 bg-[#f8fafc] px-8 py-3">
      <nav aria-label="ประเภทข้อมูล" className="inline-flex rounded-2xl border border-slate-200 bg-white p-1 shadow-sm">
        {TABS.map(({ href, label, hint, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${
                active ? "bg-blue-500 text-white shadow-md shadow-blue-200" : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"
              }`}
            >
              <Icon size={15} />
              {label}
              <span className={`hidden text-xs font-normal sm:inline ${active ? "text-blue-100" : "text-slate-400"}`}>{hint}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
