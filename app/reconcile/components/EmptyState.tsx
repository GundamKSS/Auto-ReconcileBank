"use client";

import { useEffect, useState } from "react";
import { Plus, GitCompareArrows } from "lucide-react";

export default function EmptyState({ onStart }: { onStart: () => void }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setShow(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="flex-1 flex items-center justify-center px-4">
      <div
        className={`w-full max-w-sm text-center bg-white/70 backdrop-blur-xl border border-white shadow-sm rounded-3xl px-8 py-10 transition-all duration-500 ease-out ${
          show ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3"
        }`}
      >
        <div className="w-12 h-12 rounded-2xl bg-blue-50 flex items-center justify-center mx-auto mb-4">
          <GitCompareArrows size={22} className="text-blue-600" />
        </div>
        <h2 className="text-base font-semibold text-gray-900 mb-1.5">ยังไม่ได้เลือกรายการกระทบยอด</h2>
        <p className="text-sm text-gray-500 mb-6">
          เลือกธนาคารและช่วงวันที่ที่ต้องการ ระบบจะดึงเฉพาะข้อมูลที่จำเป็นมาให้ ไม่ต้องโหลดทุกอย่างพร้อมกัน
        </p>
        <button
          onClick={onStart}
          className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-5 py-2.5 rounded-full transition-colors"
        >
          <Plus size={16} /> New reconciliation
        </button>
      </div>
    </div>
  );
}