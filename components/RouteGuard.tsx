'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useSyncExternalStore } from 'react';
import { canAccessPath, firstAllowedPath, roleFromStoredUser } from '../lib/menu';

// หน้าที่เข้าได้โดยไม่ต้องมี session — ไม่ต้องเช็คสิทธิ์เมนู และไม่แสดง Sidebar
export const PUBLIC_PATHS = ['/', '/login'];

// ซ่อนเมนูใน Sidebar อย่างเดียวไม่พอ เพราะพิมพ์ URL เข้าตรงๆ ได้
// ตัวนี้เช็ค path ปัจจุบันกับ auth ของเมนูใน lib/menu แล้วเด้งออกถ้าไม่มีสิทธิ์
//
// สำคัญ: ต้องไม่ render children จนกว่าจะรู้ว่า "path ปัจจุบัน" เข้าได้
// (เคยทดสอบเจอจริง: role User เปิด /suspense แล้ว GET /api/history?matchType=SUSPENSE ตอบ 200
// เพราะหน้าถูก render และยิง API ออกไปก่อนจะ redirect)
//
// ผลตรวจคำนวณระหว่าง render จากค่า localStorage โดยตรง — เดิมเก็บผลไว้ใน state แล้วตั้งค่าใน effect
// ทำให้ทุกครั้งที่เปลี่ยนหน้ามีหนึ่งเฟรมที่หน้าจอว่างเปล่า (เห็นเป็นรอยกระพริบระหว่างหน้า)
function subscribe(onChange: () => void) {
  // เปลี่ยนใน tab เดียวกันไม่ต้องฟัง — getSnapshot ถูกอ่านใหม่ทุก render อยู่แล้ว
  window.addEventListener('storage', onChange);
  return () => window.removeEventListener('storage', onChange);
}

function readStoredUser() {
  try {
    return localStorage.getItem('user');
  } catch {
    return null;
  }
}

const noSubscribe = () => () => {};

export default function RouteGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  // ฝั่ง server และตอน hydrate ยังอ่าน localStorage ไม่ได้ → ได้ null ทั้งคู่
  const storedUser = useSyncExternalStore(subscribe, readStoredUser, () => null);
  const hydrated = useSyncExternalStore(noSubscribe, () => true, () => false);

  const isPublic = PUBLIC_PATHS.includes(pathname);
  const role = roleFromStoredUser(storedUser);
  const allowed = isPublic || (role !== null && canAccessPath(pathname, role));

  useEffect(() => {
    // ระหว่าง hydrate ค่า role ยังเป็น null เสมอ — ถ้า redirect ตอนนี้จะเตะคนที่ login อยู่แล้วออกไปหน้า login
    if (!hydrated || allowed) return;
    router.replace(role ? (firstAllowedPath(role) ?? '/login') : '/login');
  }, [hydrated, allowed, role, router]);

  if (!allowed) return null;

  return <>{children}</>;
}
