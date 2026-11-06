"use client";

import { Sparkles } from "lucide-react";

// สีเกรเดียนต์ของระบบผู้ช่วยจับคู่ — ใช้โทน Indigo / Blue สุขุม น่าเชื่อถือ
export const AURA_GRADIENT = "linear-gradient(135deg, #4f46e5, #2563eb, #6366f1)";

// ดาว 4 แฉกทรงคมชัด สำหรับกะพริบจังหวะสลับกัน
function FourPointStar({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12 2C12.7 7.6 16.4 11.3 22 12C16.4 12.7 12.7 16.4 12 22C11.3 16.4 7.6 12.7 2 12C7.6 11.3 11.3 7.6 12 2Z" />
    </svg>
  );
}

// ไอคอนผู้ช่วยจับคู่: size="lg" ตอนกำลังค้นหา (ดวงดาว Sparkles กะพริบเล็ก-ใหญ่สลับจังหวะ)
// size="sm" เป็นไอคอนหัว modal
export default function AuraOrb({ size = "lg", active = true }: { size?: "sm" | "lg"; active?: boolean }) {
  if (size === "sm") {
    return (
      <span
        className="relative inline-flex size-9 shrink-0 items-center justify-center rounded-xl border border-indigo-200/80 bg-gradient-to-br from-indigo-50 via-white to-blue-50 shadow-xs"
        aria-hidden
      >
        <Sparkles
          size={17}
          className={`text-indigo-600 ${active ? "animate-sparkle-main" : ""}`}
        />
      </span>
    );
  }

  return (
    <div className="relative flex size-28 shrink-0 items-center justify-center" aria-hidden>
      {/* แสงเรืองรองด้านหลังแบบนุ่มนวล สุขุม */}
      <div className="absolute inset-1 rounded-full bg-indigo-500/10 blur-xl animate-aura-breathe" />

      {/* วงแหวนบางเบา */}
      <div className="absolute inset-3 rounded-full border border-indigo-200/60 bg-gradient-to-b from-white via-indigo-50/40 to-blue-50/50 shadow-[0_8px_30px_rgba(79,70,229,0.12)]" />

      {/* ดวงดาวหลักตรงกลาง + ดาวดวงเล็กกะพริบสลับจังหวะเล็ก-ใหญ่ */}
      <div className="relative flex size-16 items-center justify-center">
        {/* ดวงหลักตรงกลาง */}
        <FourPointStar className="size-10 text-indigo-600 drop-shadow-[0_2px_10px_rgba(79,70,229,0.28)] animate-sparkle-main" />
        {/* ดวงรองมุมขวาบน */}
        <FourPointStar className="absolute right-0.5 top-0.5 size-4 text-blue-500 animate-sparkle-twinkle-1" />
        {/* ดวงรองมุมซ้ายล่าง */}
        <FourPointStar className="absolute bottom-1 left-0.5 size-3.5 text-violet-500 animate-sparkle-twinkle-2" />
        {/* ดวงเล็กมุมซ้ายบน */}
        <FourPointStar className="absolute left-2 top-2 size-2.5 text-indigo-400 animate-sparkle-twinkle-3" />
      </div>
    </div>
  );
}
