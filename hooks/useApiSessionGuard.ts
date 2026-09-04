'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { clearReconcileSession } from '../lib/reconcileSession';

/**
 * พาผู้ใช้กลับไปหน้า login อัตโนมัติเมื่อ session ฝั่ง server หมดอายุ
 *
 * ตั้งแต่ย้ายการตรวจสิทธิ์ไปอยู่ที่ session cookie ฝั่ง server แล้ว จะมีช่วงที่
 * localStorage ยังมีข้อมูลผู้ใช้อยู่ (UI คิดว่ายัง login อยู่) แต่ cookie หมดอายุไปแล้ว
 * เช่น ทิ้งแท็บไว้ข้ามวัน หรือเซิร์ฟเวอร์ถูกรีสตาร์ต ถ้าไม่ดักไว้ ผู้ใช้จะกดอะไรก็ขึ้น
 * "กรุณาเข้าสู่ระบบก่อนใช้งาน" ทุกปุ่มโดยไม่มีทางกลับไปหน้า login นอกจากกด Logout เอง
 *
 * ครอบ window.fetch ไว้ชั้นเดียวแทนการไปแก้ทุกจุดที่เรียก API (มีหลายสิบจุด)
 * ดักเฉพาะ response 401 ของ /api/ เท่านั้น ที่เหลือส่งต่อตามปกติทุกประการ
 */
export function useApiSessionGuard() {
  const router = useRouter();

  useEffect(() => {
    const originalFetch = window.fetch;

    window.fetch = async function patchedFetch(...args: Parameters<typeof fetch>) {
      const response = await originalFetch.apply(this, args);

      if (response.status === 401) {
        const url = args[0];
        const path =
          typeof url === 'string' ? url : url instanceof URL ? url.pathname : (url as Request).url;
        // เฉพาะ API ของแอปนี้ — ไม่ยุ่งกับ 401 ที่มาจากปลายทางอื่น
        if (path.includes('/api/') && !path.includes('/api/login')) {
          localStorage.removeItem('user');
          localStorage.removeItem('lastActivity');
          clearReconcileSession();
          router.replace('/login');
        }
      }

      return response;
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, [router]);
}
