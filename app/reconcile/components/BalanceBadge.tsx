"use client";

// ผลต่างที่ถือว่า "เท่ากัน" — ครึ่งสตางค์ ให้ตรงกับเกณฑ์ฝั่ง server (app/api/reconcile/balance/route.ts)
const BALANCED_TOLERANCE = 0.005;

function formatAmount(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * ป้ายยอดพักโอน = Bank ปลายงวด − GL ก่อนปรับปรุง (ไม่รวม JV ปรับปรุงพักโอน) ของทั้งงวด (แทนป้าย Difference เดิมที่เทียบแค่ยอดค้างจับคู่ของแท็บ IN/OUT)
 *
 * ประชุมกับทีมบัญชี 17 ก.ย. 2026: ป้ายเดิมขึ้น "Difference 3.4 ล้าน" ทำให้งง เพราะทีมตัดสินว่ากระทบยอดเสร็จ
 * จากยอดคงเหลือสองฝั่งที่ต้องเท่ากัน กดป้ายเพื่อเปิดหน้าสรุปยอดคงเหลือและตารางรายวัน
 *
 * floating = true (จอ lg): compact อยู่กลางแถบเครื่องมือด้านบน
 * floating = false (จอเล็ก): แทรกเป็นชิ้นปกติคั่นระหว่างสองตาราง
 */
export default function BalanceBadge({
  difference,
  remaining,
  needsOpening,
  unavailable,
  loading,
  floating,
  onOpen,
}: {
  /** ยอดพักโอน — null = ยังคำนวณไม่ได้ (ยังไม่มียอดยกมา GL หรือไม่มี statement) */
  difference: number | null;
  /** ยอดพักโอนที่ยังไม่มี JV ปรับปรุงรองรับ — 0 = ปรับปรุงครบ GL เท่ากับ Bank */
  remaining: number | null;
  needsOpening: boolean;
  /** เหตุผลที่คำนวณไม่ได้เลย เช่น งานเดิมที่ไม่ได้ระบุบัญชี */
  unavailable: string | null;
  loading: boolean;
  floating: boolean;
  onOpen: () => void;
}) {
  const balanced = remaining !== null && Math.abs(remaining) < BALANCED_TOLERANCE;
  const tone =
    loading || unavailable || difference === null
      ? "border-slate-200/80 bg-white/95"
      : balanced
        ? "border-emerald-200/80 bg-emerald-50/95 shadow-[0_4px_14px_rgba(16,185,129,0.10)]"
        : "border-amber-200/80 bg-amber-50/95 shadow-[0_4px_14px_rgba(245,158,11,0.12)]";
  const dot =
    loading || unavailable || difference === null ? "bg-slate-300" : balanced ? "bg-emerald-500" : "bg-amber-500";

  return (
    <div
      className={
        floating
          ? "absolute left-1/2 top-1/2 z-10 hidden -translate-x-1/2 -translate-y-1/2 lg:block"
          : "flex items-center justify-center py-1.5 lg:hidden"
      }
    >
      <button
        type="button"
        onClick={onOpen}
        disabled={Boolean(unavailable)}
        title={unavailable ?? "ดูยอดคงเหลือ ยอดพักโอน และตารางรายวัน"}
        className={`relative flex items-center overflow-hidden rounded-xl border text-center backdrop-blur-xl transition-transform hover:scale-[1.02] active:scale-[0.98] disabled:cursor-default disabled:hover:scale-100 ${
          floating ? "min-h-10 w-[188px] px-3 py-1.5" : "min-h-[58px] w-[196px] px-3.5 py-2"
        } ${tone}`}
        aria-live="polite"
      >
        <div aria-hidden className="absolute inset-x-6 top-0 h-px bg-white" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-center gap-1.5">
            <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
            <p className="text-[9px] font-bold tracking-[0.12em] text-slate-500">ยอดพักโอน</p>
          </div>

          {loading ? (
            <p className="mt-1 text-base font-semibold leading-none tabular-nums text-slate-300">—</p>
          ) : unavailable ? (
            <p className="mt-1 text-[11px] font-medium leading-none text-slate-400">ต้องเลือกบัญชี</p>
          ) : difference === null ? (
            <p className="mt-1 text-xs font-semibold leading-none text-blue-700">
              {needsOpening ? "กรอกยอดยกมา BC365" : "ดูรายละเอียด"}
            </p>
          ) : Math.abs(difference) < BALANCED_TOLERANCE ? (
            <p className="mt-1 text-sm font-semibold leading-none text-emerald-700">ไม่มี · ยอดเท่ากัน</p>
          ) : (
            <div className="mt-1 flex items-end justify-center gap-1.5">
              <p
                className={`text-[17px] font-semibold leading-none tracking-[-0.025em] tabular-nums ${
                  balanced ? "text-emerald-700" : "text-amber-800"
                }`}
              >
                {difference > 0 ? "" : "−"}
                {formatAmount(Math.abs(difference))}
              </p>
              <p className={`pb-px text-[9px] font-medium leading-none ${balanced ? "text-emerald-600" : "text-amber-600"}`}>
                {balanced ? "ปรับปรุงแล้ว" : "ยังไม่ปรับปรุง"}
              </p>
            </div>
          )}
        </div>
      </button>
    </div>
  );
}
