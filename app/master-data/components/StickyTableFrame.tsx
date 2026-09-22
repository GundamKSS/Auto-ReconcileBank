"use client";

import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

const HEAD_CLASS = "border-b border-gray-200 bg-gray-50 text-xs uppercase tracking-wide text-gray-500";

type HeadLayout = { widths: number[]; tableWidth: number };

// กรอบตารางที่หัวตารางตรึงไว้ตอนเลื่อนลง
//
// ใส่ position: sticky ที่ <thead> ตรงๆ ไม่ได้ เพราะตารางอยู่ในกล่อง overflow-x-auto (ไว้เลื่อนแนวนอนตอนจอแคบ)
// ซึ่งทำให้ sticky ยึดกับกล่องนั้นแทนหน้าจอ แล้วไม่ตรึงเลย — จึงวาดหัวตารางชุดที่สองลอยทับไว้เมื่อหัวจริง
// เลื่อนพ้นขึ้นไป ความกว้างคอลัมน์วัดจากหัวจริง และเลื่อนแนวนอนตามตัวตาราง
export default function StickyTableFrame({
  head,
  tableClassName,
  top,
  children,
}: {
  /** แถว <tr> ของหัวตาราง — ใช้ทั้งหัวจริงและหัวที่ลอย */
  head: ReactNode;
  tableClassName: string;
  /** ระยะจากขอบบนจอที่ให้หัวตารางตรึง (ต่อท้ายแถบที่ตรึงอยู่ด้านบน) */
  top: string;
  children: ReactNode;
}) {
  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [table, setTable] = useState<HTMLTableElement | null>(null);
  const [stuck, setStuck] = useState(false);
  const [layout, setLayout] = useState<HeadLayout>({ widths: [], tableWidth: 0 });
  const floatingTableRef = useRef<HTMLTableElement | null>(null);

  const measure = useCallback(() => {
    const cells = table?.tHead?.rows[0]?.cells;
    if (!table || !cells) return;
    const widths = Array.from(cells, (c) => c.getBoundingClientRect().width);
    const tableWidth = table.getBoundingClientRect().width;
    setLayout((prev) =>
      prev.tableWidth === tableWidth && prev.widths.length === widths.length && prev.widths.every((w, i) => w === widths[i])
        ? prev
        : { widths, tableWidth }
    );
  }, [table]);

  // ความกว้างคอลัมน์เปลี่ยนได้ทั้งตอนย่อขยายจอ ตอนโหลดแถวเพิ่ม และตอนคอลัมน์ถูกเพิ่ม/เอาออก
  useEffect(() => {
    if (!table) return;
    const observer = new ResizeObserver(() => {
      // ช่องหัวตารางที่เพิ่งเกิดใหม่ (เช่นคอลัมน์บัญชีโผล่มา) ต้องเริ่มสังเกตด้วย — observe ซ้ำตัวเดิมไม่มีผล
      for (const cell of Array.from(table.tHead?.rows[0]?.cells ?? [])) observer.observe(cell);
      measure();
    });
    observer.observe(table);
    for (const cell of Array.from(table.tHead?.rows[0]?.cells ?? [])) observer.observe(cell);
    return () => observer.disconnect();
  }, [table, measure]);

  useEffect(() => {
    if (!anchor || !table) return;

    let frame = 0;
    const check = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const head = table.tHead;
        if (!head) return;
        const anchorTop = anchor.getBoundingClientRect().top;
        // ยังไม่ตรึง: anchor อยู่ชิดเหนือหัวจริงพอดี / ตรึงแล้ว: หัวจริงเลื่อนขึ้นไปเหนือ anchor
        // และต้องยังเหลือตารางใต้หัวลอยอยู่ ไม่งั้นท้ายตารางหัวลอยจะล้นลงไปทับข้อความด้านล่าง
        const next =
          head.getBoundingClientRect().top < anchorTop - 0.5 &&
          table.getBoundingClientRect().bottom > anchorTop + head.offsetHeight;
        setStuck(next);
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
  }, [anchor, table]);

  // หัวลอยต้องเลื่อนแนวนอนตามตาราง — ตั้ง transform ตรงๆ ไม่ผ่าน state จะได้ไม่ re-render ทุกพิกเซลที่เลื่อน
  useEffect(() => {
    if (!scroller) return;
    const sync = () => {
      if (floatingTableRef.current) floatingTableRef.current.style.transform = `translateX(${-scroller.scrollLeft}px)`;
    };
    sync();
    scroller.addEventListener("scroll", sync, { passive: true });
    return () => scroller.removeEventListener("scroll", sync);
  }, [scroller, stuck]);

  // วัดใหม่ทุกครั้งที่หัวลอยโผล่ — ระหว่างที่ซ่อนอยู่คอลัมน์อาจเปลี่ยนไปแล้ว
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (stuck) measure();
  }, [stuck, measure]);

  const showFloating = stuck && layout.widths.length > 0;

  return (
    <div className="rounded-2xl border border-gray-200 bg-white">
      <div ref={setAnchor} className="sticky z-20 h-0" style={{ top }}>
        {showFloating && (
          <div
            aria-hidden
            className="absolute inset-x-0 top-0 overflow-hidden bg-gray-50 shadow-[0_10px_18px_-12px_rgba(15,23,42,0.35)]"
          >
            <table
              ref={floatingTableRef}
              className={tableClassName}
              style={{ width: layout.tableWidth, minWidth: 0, tableLayout: "fixed" }}
            >
              <colgroup>
                {layout.widths.map((w, i) => (
                  <col key={i} style={{ width: w }} />
                ))}
              </colgroup>
              <thead className={HEAD_CLASS}>{head}</thead>
            </table>
          </div>
        )}
      </div>

      <div ref={setScroller} className="table-scroll overflow-x-auto rounded-2xl">
        <table ref={setTable} className={tableClassName}>
          <thead className={HEAD_CLASS}>{head}</thead>
          {children}
        </table>
      </div>

      <style jsx>{`
        .table-scroll {
          scrollbar-width: thin;
          scrollbar-color: #cbd5e1 #f1f5f9;
        }
        .table-scroll::-webkit-scrollbar {
          height: 10px;
        }
        .table-scroll::-webkit-scrollbar-track {
          background: #f1f5f9;
        }
        .table-scroll::-webkit-scrollbar-thumb {
          background-color: #cbd5e1;
          border-radius: 999px;
          border: 2px solid #f1f5f9;
        }
        .table-scroll::-webkit-scrollbar-thumb:hover {
          background-color: #94a3b8;
        }
      `}</style>
    </div>
  );
}
