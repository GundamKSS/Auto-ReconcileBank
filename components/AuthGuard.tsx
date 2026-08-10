'use client';

import { useInactivityLogout } from '../hooks/useInactivityLogout';

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  useInactivityLogout();
  return <>{children}</>;
}