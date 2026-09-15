'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { MotionConfig } from 'framer-motion';
import Sidebar from './Sidebar';
import RouteGuard, { PUBLIC_PATHS } from './RouteGuard';

/**
 * โครงหลักของทุกหน้า — Sidebar อยู่ตรงนี้ที่เดียว ไม่ได้อยู่ในแต่ละ page แล้ว
 * เดิมทุกหน้า render <Sidebar /> เอง พอเปลี่ยนหน้า Sidebar ถูกทิ้งแล้วสร้างใหม่ ทำให้เมนูหายวับแล้วโผล่
 * ตอนนี้ Sidebar คงอยู่ตลอด เปลี่ยนเฉพาะเนื้อหาด้านขวา
 *
 * div ที่ key ด้วย pathname ทำให้เนื้อหาหน้าใหม่เล่นแอนิเมชันเข้า (.page-enter) ทุกครั้งที่เปลี่ยนหน้า
 * รวมถึงหน้าลูกในเมนูเดียวกัน เช่น /reconcile → /reconcile/history
 */
export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const showSidebar = !PUBLIC_PATHS.includes(pathname);

  return (
    // ปิดแอนิเมชันของ framer-motion ให้คนที่ตั้งค่าเครื่องไว้ว่า "ลดการเคลื่อนไหว"
    <MotionConfig reducedMotion="user">
      {showSidebar && <Sidebar />}
      <RouteGuard>
        <div key={pathname} className="page-enter">
          {children}
        </div>
      </RouteGuard>
    </MotionConfig>
  );
}
