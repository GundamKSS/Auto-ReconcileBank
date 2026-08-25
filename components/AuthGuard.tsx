'use client';

import { useInactivityLogout } from '../hooks/useInactivityLogout';
import RouteGuard from './RouteGuard';

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  useInactivityLogout();
  return <RouteGuard>{children}</RouteGuard>;
}