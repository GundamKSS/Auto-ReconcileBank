'use client';

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { CircleHelp } from 'lucide-react';

/** Native popovers stay above dialogs and scroll containers, and support tap and Escape. */
export default function HelpTooltip({ children, label = 'คำอธิบายเพิ่มเติม' }: {
  children: ReactNode;
  label?: string;
}) {
  const id = useId();
  const wrapper = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLSpanElement>(null);
  const pinned = useRef(false);
  const [open, setOpen] = useState(false);

  const position = useCallback(() => {
    if (!trigger.current || !panel.current) return;
    const anchor = trigger.current.getBoundingClientRect();
    const tooltip = panel.current.getBoundingClientRect();
    const left = Math.max(12, Math.min(anchor.left, window.innerWidth - tooltip.width - 12));
    const below = anchor.bottom + 8;
    const top = below + tooltip.height <= window.innerHeight - 12 ? below : Math.max(12, anchor.top - tooltip.height - 8);
    panel.current.style.left = `${left}px`;
    panel.current.style.top = `${top}px`;
  }, []);

  function show() {
    panel.current?.showPopover();
    position();
  }
  const hide = useCallback(() => {
    pinned.current = false;
    panel.current?.hidePopover();
  }, []);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !wrapper.current?.contains(event.target)) hide();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); hide(); }
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape, true);
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape, true);
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
    };
  }, [open, position, hide]);

  return <span ref={wrapper} className="inline-flex shrink-0 align-middle font-normal normal-case tracking-normal"
    onMouseEnter={show}
    onMouseLeave={() => { if (!pinned.current && !wrapper.current?.contains(document.activeElement)) hide(); }}
    onFocus={show}
    onBlur={(event) => { if (!wrapper.current?.contains(event.relatedTarget)) hide(); }}>
    <button ref={trigger} type="button" aria-label={label} aria-describedby={id} aria-controls={id} aria-expanded={open}
      onClick={(event) => {
        event.preventDefault(); event.stopPropagation();
        if (pinned.current) hide();
        else { pinned.current = true; show(); }
      }}
      className="inline-flex size-7 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-blue-50 hover:text-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400">
      <CircleHelp size={15} aria-hidden="true" />
    </button>
    <span ref={panel} id={id} role="tooltip" popover="manual"
      onToggle={(event) => { setOpen(event.newState === 'open'); if (event.newState === 'closed') pinned.current = false; }}
      onClick={(event) => event.stopPropagation()}
      className="fixed inset-auto m-0 max-h-[70dvh] w-max max-w-[min(20rem,calc(100vw-1.5rem))] overflow-y-auto whitespace-normal break-words rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-left text-xs font-normal leading-relaxed text-slate-600 shadow-xl">
      {children}
    </span>
  </span>;
}
