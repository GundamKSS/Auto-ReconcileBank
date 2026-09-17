"use client";

// ผลต่างที่ถือว่า "ตรงกัน" — ครึ่งสตางค์ ให้ตรงกับ AMOUNT_TOLERANCE ของ ActiveWorkspace
// และเกณฑ์ฝั่ง server (app/api/reconcile/match/route.ts) ไม่งั้นป้ายนี้จะบอกว่าตรงแต่กด Match ไม่ผ่าน
const BALANCED_TOLERANCE = 0.005;

function formatAmount(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * ป้ายผลต่าง Bank − GL
 *
 * floating = true (จอ lg): แสดงแบบ compact อยู่ในแถบเครื่องมือด้านบน
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

  return (
    <div
      className={
        floating
          ? "pointer-events-none absolute left-1/2 top-1/2 z-10 hidden -translate-x-1/2 -translate-y-1/2 lg:block"
          : "flex items-center justify-center py-1.5 lg:hidden"
      }
    >
      <div
        className={`relative flex items-center overflow-hidden rounded-xl border text-center backdrop-blur-xl ${
          floating ? "min-h-10 w-[176px] px-3 py-1.5" : "min-h-[58px] w-[184px] px-3.5 py-2"
        } ${
          balanced
            ? "border-emerald-200/80 bg-emerald-50/95 shadow-[0_4px_14px_rgba(16,185,129,0.10)]"
            : "border-rose-200/80 bg-rose-50/95 shadow-[0_4px_14px_rgba(244,63,94,0.10)]"
        }`}
        aria-live="polite"
      >
        <div aria-hidden className="absolute inset-x-6 top-0 h-px bg-white" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-center gap-1.5">
            <span className={`h-1.5 w-1.5 rounded-full ${balanced ? "bg-emerald-500" : "bg-rose-500"}`} />
            <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-slate-500">Difference</p>
          </div>

          {loading ? (
            <p className="mt-1 text-base font-semibold leading-none tabular-nums text-slate-300">—</p>
          ) : balanced ? (
            <p className="mt-1 text-sm font-semibold leading-none text-emerald-700">ยอดตรงกัน</p>
          ) : (
            <div className="mt-1 flex items-end justify-center gap-1.5">
              <p className="text-[17px] font-semibold leading-none tracking-[-0.025em] tabular-nums text-rose-700">
                {diff > 0 ? "+" : "−"}
                {formatAmount(Math.abs(diff))}
              </p>
              <p className="pb-px text-[9px] font-medium leading-none text-rose-500">
                {diff > 0 ? "Bank สูง" : "GL สูง"}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
