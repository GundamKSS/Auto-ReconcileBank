'use client';

import { useEffect, useState } from 'react';
import { loadReconcileSession } from '../lib/reconcileSession';

/**
 * งวดที่ควรเปิดมาเจอเป็นค่าเริ่มต้น ของหน้าภาพรวม / รายงาน / ประวัติการจับคู่
 *
 * เดิมทั้งสามหน้าตั้งค่าเริ่มต้นเป็นเดือนปัจจุบัน (ประวัติใช้เดือนก่อนหน้า) ซึ่งมักยังไม่มีข้อมูล
 * ผู้ใช้จึงเปิดมาเจอจอว่างทุกครั้งแล้วต้องไล่เปลี่ยนวันที่เองก่อน ทั้งที่งานกระทบยอด
 * คือการปิดงวดที่ผ่านมา ไม่ใช่เดือนที่กำลังเดินอยู่
 *
 * ลำดับการเลือก:
 *   1. งวดที่หน้ากระทบยอดกำลังทำอยู่ (อ่านจาก localStorage ได้ทันที ไม่ต้องรอ API)
 *      — ตรงกับที่หน้ารายการพักทำอยู่แล้ว และเป็นสิ่งที่ผู้ใช้กำลังสนใจจริงๆ
 *   2. งวดล่าสุดที่มีข้อมูลในระบบ (ถาม API)
 *   3. เดือนปัจจุบัน (ยังไม่มีข้อมูลเลยในระบบ)
 *
 * คืน ready = false จนกว่าจะรู้คำตอบ เพื่อให้หน้าที่เรียกใช้ยังไม่ต้องยิงโหลดข้อมูล
 * ด้วยงวดที่กำลังจะถูกเปลี่ยนทิ้ง (กันยิง API ซ้ำซ้อนและกันตัวเลขกระพริบ)
 * กรณีมี session อยู่แล้วจะ ready ตั้งแต่ render แรก ไม่มีการหน่วงเลย
 */

export type PeriodRange = { from: string; to: string };
export type PeriodSource = 'session' | 'latest' | 'fallback';

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

export function monthRangeOf(anchor: Date): PeriodRange {
  const y = anchor.getFullYear();
  const m = anchor.getMonth();
  const last = new Date(y, m + 1, 0);
  return { from: `${y}-${pad2(m + 1)}-01`, to: `${y}-${pad2(m + 1)}-${pad2(last.getDate())}` };
}

/** งวดจากหน้ากระทบยอด — อ่านจาก localStorage จึงได้คำตอบทันทีแบบ sync */
function periodFromSession(): PeriodRange | null {
  if (typeof window === 'undefined') return null;
  const session = loadReconcileSession();
  if (!session?.periodStart || !session.periodEnd) return null;
  return { from: session.periodStart, to: session.periodEnd };
}

export function useInitialPeriod(): { range: PeriodRange; source: PeriodSource; ready: boolean } {
  const fallback = monthRangeOf(new Date());
  const [resolved, setResolved] = useState<{ range: PeriodRange; source: PeriodSource } | null>(() => {
    const fromSession = periodFromSession();
    return fromSession ? { range: fromSession, source: 'session' } : null;
  });

  useEffect(() => {
    if (resolved) return; // มี session อยู่แล้ว ไม่ต้องถาม API
    let cancelled = false;

    fetch('/api/master/latest-period')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return;
        const p = d?.period;
        setResolved(
          p?.from && p?.to
            ? { range: { from: p.from, to: p.to }, source: 'latest' }
            : { range: monthRangeOf(new Date()), source: 'fallback' }
        );
      })
      .catch(() => {
        // ต่อ API ไม่ได้ก็ยังต้องให้หน้าทำงานต่อได้ ใช้เดือนปัจจุบันไปก่อน
        if (!cancelled) setResolved({ range: monthRangeOf(new Date()), source: 'fallback' });
      });

    return () => {
      cancelled = true;
    };
  }, [resolved]);

  return {
    range: resolved?.range ?? fallback,
    source: resolved?.source ?? 'fallback',
    ready: resolved !== null,
  };
}
