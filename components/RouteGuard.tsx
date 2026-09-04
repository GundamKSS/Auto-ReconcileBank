'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { canAccessPath, firstAllowedPath, getCurrentRole } from '../lib/menu';

// หน้าที่เข้าได้โดยไม่ต้องมี session — ไม่ต้องเช็คสิทธิ์เมนู
const PUBLIC_PATHS = ['/', '/login'];

// ซ่อนเมนูใน Sidebar อย่างเดียวไม่พอ เพราะพิมพ์ URL เข้าตรงๆ ได้
// ตัวนี้เช็ค path ปัจจุบันกับ auth ของเมนูใน lib/menu แล้วเด้งออกถ้าไม่มีสิทธิ์
//
// สำคัญ: ต้องไม่ render children จนกว่าจะเช็คสิทธิ์ของ "path ปัจจุบัน" เสร็จ
// เดิม state เริ่มต้นเป็น "ผ่าน" ทำให้หน้าถูก render แล้ว effect ข้างในยิง API ออกไปก่อน
// กว่าจะ redirect ก็ได้ข้อมูลกลับมาถึงเบราว์เซอร์ของคนที่ไม่มีสิทธิ์เรียบร้อยแล้ว
// (ทดสอบแล้วเห็นจริง: role User เปิด /suspense แล้ว GET /api/history?matchType=SUSPENSE ตอบ 200)
//
// การจำ pathname ไว้คู่กับผลตรวจ ทำให้ตอนเปลี่ยนหน้าไม่เผลอใช้ผลตรวจของหน้าก่อนหน้าซ้ำ
export default function RouteGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [checked, setChecked] = useState<{ path: string; allowed: boolean } | null>(null);

  useEffect(() => {
    // role อ่านจาก localStorage ได้เฉพาะหลัง mount — sync เข้า state ตรงๆ ไม่ได้
    /* eslint-disable react-hooks/set-state-in-effect */
    if (PUBLIC_PATHS.includes(pathname)) {
      setChecked({ path: pathname, allowed: true });
      return;
    }

    const role = getCurrentRole();
    if (!role) {
      // ยังไม่ได้ login — ไม่ต้องรอ Sidebar เด้งให้ พาไปหน้า login เองเลย
      setChecked({ path: pathname, allowed: false });
      router.replace('/login');
      return;
    }

    if (canAccessPath(pathname, role)) {
      setChecked({ path: pathname, allowed: true });
      return;
    }

    setChecked({ path: pathname, allowed: false });
    router.replace(firstAllowedPath(role) ?? '/login');
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [pathname, router]);

  // ยังตรวจไม่เสร็จ หรือผลตรวจเป็นของ path เก่า = ยังไม่ปล่อยให้หน้าทำงาน
  if (checked?.path !== pathname || !checked.allowed) return null;

  return <>{children}</>;
}
