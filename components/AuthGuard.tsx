'use client';

import { useInactivityLogout } from '../hooks/useInactivityLogout';
import { useApiSessionGuard } from '../hooks/useApiSessionGuard';

// การเช็คสิทธิ์รายหน้า (RouteGuard) ย้ายไปอยู่ใน AppShell แล้ว เพื่อให้ Sidebar ไม่ต้องหายไประหว่างเปลี่ยนหน้า
export default function AuthGuard({ children }: { children: React.ReactNode }) {
  useInactivityLogout();
  // เตะกลับหน้า login ถ้า session cookie ฝั่ง server หมดอายุระหว่างใช้งาน
  useApiSessionGuard();
  return <>{children}</>;
}
