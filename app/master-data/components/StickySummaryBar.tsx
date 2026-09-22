"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import SummaryCard from "./SummaryCard";
import { STICKY_VARS, readStickyVar, stickyTop, useStickyHeight } from "./useSticky";

export type SummaryItem = {
  key: string;
  icon: ReactNode;
  label: string;
  tone: "in" | "out" | "net";
  amount: number | undefined;
  count: number | undefined;
};

// การ์ดสรุปยอดที่ตรึงไว้ใต้แท็บสลับหน้าตอนเลื่อน — พอตรึงแล้วย่อเหลือบรรทัดเดียว
// ไม่งั้นแถบที่ตรึงรวมกันกินจอเกือบครึ่ง (มือถือการ์ดเรียงลงมา 3 ใบ กินเกือบทั้งจอ)
export default function StickySummaryBar({
  items,
  loading,
  className = "",
}: {
  items: SummaryItem[];
  loading: boolean;
  className?: string;
}) {
  const [bar, setBar] = useState<HTMLDivElement | null>(null);
  const [sentinel, setSentinel] = useState<HTMLDivElement | null>(null);
  const [compact, setCompact] = useState(false);
  const compactRef = useRef(false);
  const heights = useRef({ full: 0, compact: 0 });

  useStickyHeight(bar, STICKY_VARS.cards);

  useEffect(() => {
    if (!bar || !sentinel) return;

    let frame = 0;
    const check = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (compactRef.current) heights.current.compact = bar.offsetHeight;
        else heights.current.full = bar.offsetHeight;

        const offset = readStickyVar(STICKY_VARS.nav);
        const top = sentinel.getBoundingClientRect().top;
        // ย่อแล้วเนื้อหาด้านล่างเลื่อนขึ้นเท่าความสูงที่หายไป — ต้องเลื่อนกลับขึ้นไปเกินระยะนั้นก่อนค่อยขยาย
        // ไม่งั้นหน้าที่สั้นพอดีจะถูกเบราว์เซอร์ดึง scroll กลับแล้วสลับย่อ/ขยายกระพริบไปมา
        const collapsedBy = heights.current.compact ? Math.max(0, heights.current.full - heights.current.compact) : 0;
        const next = compactRef.current ? top < offset + collapsedBy + 4 : top < offset;
        if (next !== compactRef.current) {
          compactRef.current = next;
          setCompact(next);
        }
      });
    };

    check();
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    return () => {
      window.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
      cancelAnimationFrame(frame);
    };
  }, [bar, sentinel]);

  return (
    <>
      <div ref={setSentinel} aria-hidden className="h-0" />
      <div
        ref={setBar}
        className={`sticky z-20 bg-white ${compact ? "py-2" : "py-3"} ${className}`}
        style={{ top: stickyTop(STICKY_VARS.nav) }}
      >
        {/* จอแคบการ์ดย่อเรียงเป็นบรรทัดละใบ — วางเรียงสามใบตัวเลขหลักร้อยล้านจะโดนตัดจนอ่านไม่ออก */}
        <div className={compact ? "grid grid-cols-1 gap-1 sm:grid-cols-3 sm:gap-2" : "grid grid-cols-1 gap-3 sm:grid-cols-3"}>
          {items.map(({ key, ...item }) => (
            <SummaryCard key={key} {...item} loading={loading} compact={compact} />
          ))}
        </div>
      </div>
    </>
  );
}
