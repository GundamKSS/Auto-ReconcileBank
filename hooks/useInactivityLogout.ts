'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { clearReconcileSession } from '../lib/reconcileSession';

const TIMEOUT_MS = 30 * 60 * 1000; // 30 นาที

export function useInactivityLogout() {
  const router = useRouter();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function logout() {
      // ล้าง session cookie ฝั่ง server ด้วย ไม่งั้นหมดเวลาแล้ว cookie ยังเรียก API ได้อยู่
      // (ยิงแบบไม่รอผล เพราะต้องพาผู้ใช้ออกจากหน้าจอทันทีอยู่แล้ว)
      fetch('/api/logout', { method: 'POST' }).catch(() => {});
      localStorage.removeItem('user');
      localStorage.removeItem('lastActivity');
      clearReconcileSession();
      router.push('/login');
    }

    function resetTimer() {
      localStorage.setItem('lastActivity', Date.now().toString());
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(logout, TIMEOUT_MS);
    }

    // เช็คตอนโหลดหน้าว่า idle เกินเวลาที่ตั้งไว้หรือยัง (เผื่อปิด-เปิดแท็บใหม่)
    const last = localStorage.getItem('lastActivity');
    if (last && Date.now() - Number(last) > TIMEOUT_MS) {
      logout();
      return;
    }

    const events = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'];
    events.forEach((e) => window.addEventListener(e, resetTimer));
    resetTimer();

    return () => {
      events.forEach((e) => window.removeEventListener(e, resetTimer));
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [router]);
}