"use client";

import { WandSparkles } from "lucide-react";

// สีออร่าของผู้ช่วยหาคู่ — ใช้ร่วมกันทั้งลูกแก้ว ขอบ modal และปุ่มเปิดในหน้า workspace
export const AURA_GRADIENT = "conic-gradient(from 0deg, #8b5cf6, #3b82f6, #22d3ee, #e879f9, #8b5cf6)";

// ลูกแก้วออร่า: size="lg" ตอนกำลังค้นหา / size="sm" เป็นไอคอนหัว modal
// เป็น CSS animation ล้วน (globals.css: animate-aura-*) — ผู้ใช้ที่ตั้ง reduced motion จะเห็นเป็นภาพนิ่ง
export default function AuraOrb({ size = "lg", active = true }: { size?: "sm" | "lg"; active?: boolean }) {
  if (size === "sm") {
    return (
      <span className="relative inline-flex size-9 shrink-0 items-center justify-center" aria-hidden>
        <span
          className={`absolute inset-0 rounded-full opacity-60 blur-md ${active ? "animate-aura-spin" : ""}`}
          style={{ background: AURA_GRADIENT }}
        />
        <span
          className={`absolute inset-0 rounded-full p-[2px] ${active ? "animate-aura-spin-fast" : ""}`}
          style={{ background: AURA_GRADIENT }}
        >
          <span className="block size-full rounded-full bg-white" />
        </span>
        <WandSparkles size={16} className="relative text-violet-600" />
      </span>
    );
  }

  return (
    // shrink-0: บนจอเตี้ย flex column จะบีบความสูงลงแต่ไม่บีบความกว้าง ลูกแก้วเลยกลายเป็นวงรีเบี้ยว
    <div className="relative size-44 shrink-0" aria-hidden>
      {/* หมอกแสงรอบนอก */}
      <div
        className="absolute -inset-12 rounded-full opacity-45 blur-3xl animate-aura-spin"
        style={{ background: AURA_GRADIENT }}
      />
      {/* คลื่นสแกนขยายออก 3 ชั้น */}
      <span className="absolute inset-3 rounded-full border-2 border-violet-400/60 animate-aura-ping" />
      <span className="absolute inset-3 rounded-full border-2 border-cyan-400/60 animate-aura-ping [animation-delay:0.8s]" />
      <span className="absolute inset-3 rounded-full border-2 border-fuchsia-400/50 animate-aura-ping [animation-delay:1.6s]" />
      {/* วงแหวนไล่สีหมุน */}
      <div
        className="absolute inset-6 rounded-full p-[3px] shadow-[0_0_40px_rgba(139,92,246,0.45)] animate-aura-spin-fast"
        style={{ background: AURA_GRADIENT }}
      >
        <div className="size-full rounded-full bg-white/90 backdrop-blur-xl" />
      </div>
      {/* จุดแสงโคจร */}
      <div className="absolute inset-2 animate-aura-spin">
        <span className="absolute left-1/2 top-0 size-2 -translate-x-1/2 rounded-full bg-cyan-400 shadow-[0_0_12px_#22d3ee]" />
      </div>
      <div className="absolute inset-4 animate-aura-spin-fast [animation-direction:reverse]">
        <span className="absolute bottom-0 left-1/2 size-1.5 -translate-x-1/2 rounded-full bg-fuchsia-400 shadow-[0_0_10px_#e879f9]" />
      </div>
      {/* แกนกลาง */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="animate-aura-breathe">
          <WandSparkles size={40} className="text-violet-600 drop-shadow-[0_0_12px_rgba(139,92,246,0.6)]" />
        </div>
      </div>
    </div>
  );
}
