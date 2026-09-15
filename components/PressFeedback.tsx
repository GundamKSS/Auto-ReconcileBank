'use client';

import { useEffect } from 'react';

// สิ่งที่กดได้ทั้งหมดในแอป — ครอบคลุมปุ่มกว่าร้อยจุดโดยไม่ต้องไปแก้ทีละไฟล์
const PRESSABLE = 'button, a[href], [role="button"], [role="tab"], summary, label[for], .cursor-pointer';
// ของที่ใหญ่กว่านี้ (แถวตาราง, การ์ดเต็มความกว้าง) ไม่ย่อ — ย่อแล้วดูเหมือนทั้งหน้ากระตุก
const MAX_WIDTH = 560;

/**
 * เอฟเฟกต์ "กดแล้วยุบ ปล่อยแล้วเด้ง" ให้ทุกปุ่ม
 *
 * ใช้ Web Animations API กับ property `scale` (ไม่ใช่ `transform`) เพื่อไม่ไปทับ
 * translate / rotate ที่ Tailwind ใส่ไว้ และไม่ต้องยุ่งกับ transition-property ของแต่ละปุ่ม
 * ปิดเฉพาะจุดได้ด้วย data-press="off"
 */
export default function PressFeedback() {
  useEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let pressed: { el: HTMLElement; anim: Animation } | null = null;

    function release() {
      if (!pressed) return;
      const { el, anim } = pressed;
      pressed = null;

      // ปล่อยก่อนยุบสุด → เด้งกลับจากขนาดที่ยุบไปจริง ไม่กระโดด
      const current = parseFloat(getComputedStyle(el).scale) || 1;
      anim.cancel();
      const depth = 1 - current;
      if (depth <= 0) return;

      el.animate(
        [
          { scale: String(current) },
          { scale: String(1 + depth * 0.55), offset: 0.4 },
          { scale: String(1 - depth * 0.15), offset: 0.72 },
          { scale: '1' },
        ],
        { duration: 440, easing: 'ease-out' },
      );
    }

    function onPointerDown(e: PointerEvent) {
      if (reducedMotion.matches || e.button !== 0) return;
      const target = e.target as Element | null;
      if (!target || target.closest('input, textarea, select, [contenteditable="true"], [data-press="off"]')) return;

      const el = target.closest<HTMLElement>(PRESSABLE);
      if (!el || el.matches(':disabled, [aria-disabled="true"]')) return;

      const { width } = el.getBoundingClientRect();
      if (width === 0 || width > MAX_WIDTH) return;

      release();
      // ปุ่มเล็กยุบมาก ปุ่มใหญ่ยุบน้อย — ขอบเข้ามาไม่เกินราว 2px จะได้ไม่หลุดจุดที่นิ้ว/เมาส์กดอยู่
      const scale = Math.min(0.985, Math.max(0.94, 1 - 6 / width));
      const anim = el.animate([{ scale: '1' }, { scale: String(scale) }], {
        duration: 110,
        easing: 'cubic-bezier(0.2, 0, 0, 1)',
        fill: 'forwards',
      });
      pressed = { el, anim };
    }

    document.addEventListener('pointerdown', onPointerDown, { capture: true, passive: true });
    window.addEventListener('pointerup', release, { passive: true });
    window.addEventListener('pointercancel', release, { passive: true });
    window.addEventListener('dragstart', release);
    window.addEventListener('blur', release);

    return () => {
      document.removeEventListener('pointerdown', onPointerDown, { capture: true });
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
      window.removeEventListener('dragstart', release);
      window.removeEventListener('blur', release);
    };
  }, []);

  return null;
}
