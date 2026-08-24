'use client';

import { Check, ChevronDown, SlidersHorizontal } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { WIDGETS, type WidgetId } from './shared';

/** เมนูเลือกว่าจะให้หน้า Dashboard แสดงส่วนไหนบ้าง */
export default function ViewPicker({
  selected,
  onChange,
}: {
  selected: WidgetId[];
  onChange: (next: WidgetId[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // ปิดเมนูเมื่อคลิกนอกกรอบหรือกด Esc
  useEffect(() => {
    if (!open) return;

    function onPointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  function toggle(id: WidgetId) {
    // เรียงตาม WIDGETS เสมอ ไม่ใช่ตามลำดับที่กด เพื่อให้ลำดับบนหน้าจอคงที่
    const next = selected.includes(id) ? selected.filter((w) => w !== id) : [...selected, id];
    onChange(WIDGETS.map((w) => w.id).filter((w) => next.includes(w)));
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
      >
        <SlidersHorizontal size={15} />
        ปรับมุมมอง
        <span className="rounded-full bg-slate-100 px-1.5 text-xs tabular-nums text-slate-500">
          {selected.length}/{WIDGETS.length}
        </span>
        <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-2 w-[290px] rounded-2xl border border-slate-200 bg-white p-2 shadow-xl shadow-slate-900/10">
          <div className="flex items-center justify-between px-2 py-1.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">ส่วนที่แสดง</span>
            <div className="flex gap-2 text-xs font-medium">
              <button onClick={() => onChange(WIDGETS.map((w) => w.id))} className="text-blue-600 hover:text-blue-700">
                ทั้งหมด
              </button>
              <span className="text-slate-200">|</span>
              <button onClick={() => onChange([])} className="text-slate-400 hover:text-slate-600">
                ล้าง
              </button>
            </div>
          </div>

          {WIDGETS.map((w) => {
            const on = selected.includes(w.id);
            return (
              <button
                key={w.id}
                onClick={() => toggle(w.id)}
                role="menuitemcheckbox"
                aria-checked={on}
                className="flex w-full items-start gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-slate-50"
              >
                <span
                  className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                    on ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white'
                  }`}
                >
                  {on && <Check size={11} strokeWidth={3} />}
                </span>

                <span className="min-w-0">
                  <span className="block text-sm font-medium text-slate-800">{w.label}</span>
                  <span className="block text-xs text-slate-400">{w.hint}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
