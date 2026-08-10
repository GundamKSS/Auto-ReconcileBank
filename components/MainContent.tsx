'use client';

import type { ReactNode } from 'react';
import { useSidebar } from './SidebarContext';

/**
 * ครอบ content หลักของแต่ละหน้า (คู่กับ <Sidebar />)
 * - Mobile/tablet (<lg): ไม่เว้น padding ซ้าย เพราะ sidebar เป็น off-canvas drawer ลอยทับ ไม่ได้เบียดพื้นที่
 * - Desktop (lg+): เว้น padding ซ้ายเท่าความกว้าง sidebar ปัจจุบัน (300px ปกติ / 82px ตอนพับ)
 *   ทำให้เนื้อหาขยายเต็มจออัตโนมัติเมื่อกดพับ/ซ่อน sidebar
 */
export default function MainContent({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  const { collapsed } = useSidebar();

  return (
    <div
      className={`min-w-0 transition-all duration-300 ${
        collapsed ? 'lg:pl-[82px]' : 'lg:pl-[300px]'
      } ${className}`}
    >
      {children}
    </div>
  );
}
