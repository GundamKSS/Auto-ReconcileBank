'use client';

import { useInactivityLogout } from '../hooks/useInactivityLogout';
import { useApiSessionGuard } from '../hooks/useApiSessionGuard';
import RouteGuard from './RouteGuard';

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  useInactivityLogout();
  // เตะกลับหน้า login ถ้า session cookie ฝั่ง server หมดอายุระหว่างใช้งาน
  useApiSessionGuard();
  return <RouteGuard>{children}</RouteGuard>;
}
