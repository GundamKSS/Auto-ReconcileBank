"use client";

import { CheckCircle2 } from "lucide-react";

// ผลต่างที่ถือว่า "ตรงกัน" — ครึ่งสตางค์ ให้ตรงกับ AMOUNT_TOLERANCE ของ ActiveWorkspace
// และเกณฑ์ฝั่ง server (app/api/reconcile/match/route.ts) ไม่งั้นป้ายนี้จะบอกว่าตรงแต่กด Match ไม่ผ่าน
const BALANCED_TOLERANCE = 0.005;

function formatAmount(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// สีพื้นหลังของ workspace — วงแหวนรอบกล่องใช้สีนี้เพื่อ "กัด" มุมตารางให้เป็นรอยแหว่ง
// ต้องตรงกับ bg-gray-50 ของ ReconcileWorkspace ถ้าเปลี่ยนสีพื้นต้องแก้ตรงนี้ด้วย
const WORKSPACE_BG = "#f9fafb";

/**
 * ป้ายผลต่าง Bank − GL
 *
 * floating = true (จอ lg): ลอยคร่อมรอยต่อของสองตารางที่ "มุมบนด้านใน" โดยมีวงแหวนสีพื้นหลัง
 *   รอบตัวทำหน้าที่กัดมุมตารางทั้งสองให้แหว่งเป็นรอยเว้ารับกล่องพอดี — ไม่ได้ใช้ mask/clip-path
 *   กับตัวตาราง เพราะ mask จะกินเส้นขอบและ border-radius ของตารางไปด้วยจนขอบรอยเว้าดูไม่เก็บงาน
 *   พื้นที่ใต้วงแหวนว่างอยู่แล้วโดยตั้งใจ (Panel เว้น padding ไว้ให้ ดู notchSide) จึงไม่บังข้อมูล
 *
 * floating = false (จอเล็ก): ตารางเรียงซ้อนกัน ไม่มีรอยต่อให้คร่อม จึงแทรกเป็นชิ้นปกติคั่นกลาง
 */
export default function DifferenceBadge({
  bankTotal,
  glTotal,
  loading,
  floating,
}: {
  bankTotal: number;
  glTotal: number;
  loading: boolean;
  floating: boolean;
}) {
  const diff = bankTotal - glTotal;
  const balanced = Math.abs(diff) < BALANCED_TOLERANCE;

  // แสงเรืองหลังแผ่นแก้ว — เขียวเมื่อยอดตรง แดงเมื่อยังต่างกัน ให้สีเดียวกับตัวเลขข้างใน
  // นอกจากบอกสถานะแล้วยังเป็น "ของให้ backdrop-blur ได้เบลอ" ด้วย ไม่งั้นวางบนพื้นเทาเรียบๆ
  // แล้วผิวแก้วจะไม่มีอะไรให้หักเห กลายเป็นกล่องขาวจืดๆ
  const glow = balanced
    ? "radial-gradient(ellipse at center, rgba(16,185,129,0.32), transparent 68%)"
    : "radial-gradient(ellipse at center, rgba(244,63,94,0.28), transparent 68%)";
  const accent = balanced ? "#10b981" : "#f43f5e";

  return (
    <div
      className={
        floating
          ? "pointer-events-none absolute left-1/2 top-0 z-20 hidden -translate-x-1/2 -translate-y-[13px] lg:block"
          : "flex items-center justify-center py-1 lg:hidden"
      }
    >
      <div className="relative" aria-live="polite">
        <div aria-hidden className="absolute -inset-x-8 -inset-y-5 rounded-full blur-2xl" style={{ background: glow }} />

        <div
          className="relative rounded-[1.7rem] p-[1px]"
          style={{
            background:
              "linear-gradient(135deg, rgba(255,255,255,0.98) 0%, rgba(255,255,255,0.42) 38%, rgba(148,163,184,0.20) 68%, rgba(255,255,255,0.82) 100%)",
            boxShadow: floating
              ? `0 0 0 11px ${WORKSPACE_BG}, 0 16px 38px rgba(15,23,42,0.13), 0 3px 9px rgba(15,23,42,0.07)`
              : "0 16px 38px rgba(15,23,42,0.13), 0 3px 9px rgba(15,23,42,0.07)",
          }}
        >
          <div
            className="relative w-[204px] overflow-hidden rounded-[1.64rem] px-3.5 py-2.5 backdrop-blur-[28px] backdrop-saturate-[1.8]"
            style={{
              background:
                "linear-gradient(150deg, rgba(255,255,255,0.78) 0%, rgba(255,255,255,0.48) 48%, rgba(241,245,249,0.64) 100%)",
              boxShadow:
                "inset 0 1px 0 rgba(255,255,255,1), inset 1px 0 0 rgba(255,255,255,0.66), inset 0 -1px 0 rgba(148,163,184,0.16)",
            }}
          >
          {/* ก้อนแสงในเนื้อแก้ว ช่วยให้ผิวดูเหมือนของเหลวและไม่แบนเป็นกระจกฝ้า */}
          <div aria-hidden className="pointer-events-none absolute -left-6 -top-8 h-20 w-24 rounded-full bg-white/75 blur-xl" />
          <div
            aria-hidden
            className="pointer-events-none absolute -bottom-8 -right-5 h-16 w-24 rounded-full blur-2xl"
            style={{ backgroundColor: `${accent}24` }}
          />
          <div aria-hidden className="pointer-events-none absolute inset-x-5 top-0 h-px bg-white/90" />
          {/* แสงกวาดผ่านช้าๆ — ปิดเองเมื่อผู้ใช้ตั้ง reduced motion (ดู globals.css) */}
          <div
            aria-hidden
            className="animate-glass-sheen pointer-events-none absolute inset-0"
            style={{
              background: "linear-gradient(105deg, transparent 42%, rgba(255,255,255,0.75) 50%, transparent 58%)",
              backgroundSize: "300% 100%",
            }}
          />

          <div className="relative flex items-center gap-3 text-left">
            {/* status lens: ทำหน้าที่เป็นจุดยึดสายตา แทนการย้อมทั้งกล่องด้วยสีแดง */}
            <div
              className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/80 bg-white/45 shadow-[inset_0_1px_0_rgba(255,255,255,1),0_5px_14px_rgba(15,23,42,0.08)] backdrop-blur-xl"
              style={{ color: accent }}
            >
              <span
                aria-hidden
                className="absolute inset-1 rounded-full opacity-15 blur-[5px]"
                style={{ backgroundColor: accent }}
              />
              {balanced ? (
                <CheckCircle2 className="relative" size={17} strokeWidth={2.4} />
              ) : (
                <span className="relative text-[17px] font-semibold leading-none">−</span>
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span
                  className="h-1.5 w-1.5 rounded-full shadow-[0_0_8px_currentColor]"
                  style={{ color: accent, backgroundColor: accent }}
                />
                <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-slate-500">Difference</p>
              </div>

              {loading ? (
                <p className="mt-1 text-lg font-semibold leading-none tabular-nums text-slate-300">—</p>
              ) : balanced ? (
                <p className="mt-1 text-[14px] font-semibold leading-tight text-emerald-600 drop-shadow-[0_1px_0_rgba(255,255,255,0.9)]">
                  ยอดตรงกัน
                </p>
              ) : (
                <>
                  <p className="mt-1 text-[18px] font-semibold leading-none tracking-[-0.025em] tabular-nums text-rose-600 drop-shadow-[0_1px_0_rgba(255,255,255,0.9)]">
                    {diff > 0 ? "+" : "−"}
                    {formatAmount(Math.abs(diff))}
                  </p>
                  <p className="mt-1 text-[9px] font-medium text-slate-500">
                    บาท · <span className="text-rose-500">{diff > 0 ? "Bank สูงกว่า" : "GL สูงกว่า"}</span>
                  </p>
                </>
              )}
            </div>
          </div>
          </div>
        </div>
      </div>
    </div>
  );
}
