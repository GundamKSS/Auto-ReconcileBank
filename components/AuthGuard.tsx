'use client';

import { useEffect } from 'react';
import { useInactivityLogout } from '../hooks/useInactivityLogout';
import { useApiSessionGuard } from '../hooks/useApiSessionGuard';
import { stripRetiredSessionFields } from '../lib/tabWorkspace';

// การเช็คสิทธิ์รายหน้า (RouteGuard) ย้ายไปอยู่ใน AppShell แล้ว เพื่อให้ Sidebar ไม่ต้องหายไประหว่างเปลี่ยนหน้า
export default function AuthGuard({ children }: { children: React.ReactNode }) {
  useInactivityLogout();
  // session ที่ login ค้างไว้ก่อนหน้ายังมี accessToken เก่าอยู่ใน localStorage — ลบทิ้งตั้งแต่เปิดหน้า
  useEffect(() => {
    stripRetiredSessionFields();
  }, []);
  // เตะกลับหน้า login ถ้า session cookie ฝั่ง server หมดอายุระหว่างใช้งาน
  useApiSessionGuard();
  return <>{children}</>;
}
