"use client";

import { useEffect } from "react";

// แถบที่ตรึงไว้ด้านบนตอนเลื่อนของหน้า Master Data ซ้อนกันเป็นชั้น: แท็บสลับหน้า → การ์ดสรุป → แท็บสถานะ → หัวตาราง
// แต่ละชั้นต้องรู้ว่าชั้นเหนือตัวเองสูงเท่าไรถึงจะตรึงต่อท้ายได้พอดี ความสูงเปลี่ยนตามความกว้างจอและตอนการ์ดย่อ
// จึงวัดจริงด้วย ResizeObserver แล้วเก็บเป็น CSS variable บน <html> ให้ชั้นถัดไปเอาไปคิด top
export const STICKY_VARS = {
  nav: "--md-sticky-nav",
  cards: "--md-sticky-cards",
  tabs: "--md-sticky-tabs",
} as const;

/** ค่า top ของชั้นที่ตรึงต่อจากชั้นที่ระบุ — ชั้นที่ไม่มีในหน้านั้นนับเป็น 0 */
export function stickyTop(...vars: string[]) {
  return `calc(${vars.map((v) => `var(${v}, 0px)`).join(" + ")})`;
}

export function readStickyVar(name: string) {
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || 0;
}

/** วัดความสูงของชั้นที่ตรึงไว้ลง CSS variable — รับ element (จาก callback ref) เพราะบางชั้น render ทีหลัง */
export function useStickyHeight(el: HTMLElement | null, varName: string) {
  useEffect(() => {
    if (!el) return;
    const root = document.documentElement;
    const update = () => root.style.setProperty(varName, `${el.offsetHeight}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.removeProperty(varName);
    };
  }, [el, varName]);
}
