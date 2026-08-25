'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { canAccessPath, firstAllowedPath, getCurrentRole } from '../lib/menu';

// หน้าที่เข้าได้โดยไม่ต้องมี session — ไม่ต้องเช็คสิทธิ์เมนู
const PUBLIC_PATHS = ['/', '/login'];

// ซ่อนเมนูใน Sidebar อย่างเดียวไม่พอ เพราะพิมพ์ URL เข้าตรงๆ ได้
// ตัวนี้เช็ค path ปัจจุบันกับ auth ของเมนูใน lib/menu แล้วเด้งออกถ้าไม่มีสิทธิ์
export default function RouteGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    // role อ่านจาก localStorage ได้เฉพาะหลัง mount — sync เข้า state ตรงๆ ไม่ได้
    /* eslint-disable react-hooks/set-state-in-effect */
    if (PUBLIC_PATHS.includes(pathname)) {
      setDenied(false);
      return;
    }

    const role = getCurrentRole();
    // ยังไม่ได้ login — ปล่อยให้ Sidebar เด้งไป /login ตามเดิม
    if (!role) return;

    if (canAccessPath(pathname, role)) {
      setDenied(false);
      return;
    }

    setDenied(true);
    router.replace(firstAllowedPath(role) ?? '/login');
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [pathname, router]);

  if (denied) return null;

  return <>{children}</>;
}
