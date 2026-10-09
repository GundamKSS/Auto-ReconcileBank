'use client';

import { useEffect, useState } from 'react';
import { readTabValue, tabStorageKey, writeTabValue } from '../lib/tabWorkspace';

/**
 * useState ที่จำค่าไว้ใน sessionStorage — สลับหน้าไปมาแล้วกลับมาเจอธนาคาร/ไฟล์/ตัวกรองเดิม
 *
 * ใช้ sessionStorage ไม่ใช่ localStorage: จำเฉพาะแท็บเบราว์เซอร์นั้นจนกว่าจะปิดแท็บ
 * แยกค่าตาม username และไม่ล้างตอน logout เพื่อกลับมาทำงานต่อหลัง login ด้วยบัญชีเดิม
 * เป็นแค่ความสะดวก — อ่าน/เขียนไม่ได้ (โหมดส่วนตัว, storage เต็ม) ก็ทำงานต่อด้วยค่าเริ่มต้นตามปกติ
 *
 * อ่านค่าตอนสร้าง state ได้เลยโดยไม่กลัว hydrate ไม่ตรง เพราะ RouteGuard ไม่ render หน้าเนื้อหา
 * จนกว่าจะอยู่ฝั่ง client แล้ว (ฝั่ง server ได้ null เสมอ) — ถ้าจะใช้นอกหน้าที่ผ่าน RouteGuard ต้องคิดเรื่องนี้ใหม่
 *
 * key ต้องคงที่ตลอดอายุ component — ถ้า key เปลี่ยนได้ (เช่นผูกกับ id ของไฟล์) ให้ใส่ key ที่ตัว component
 * ให้ mount ใหม่ ไม่งั้นค่าของ key เก่าจะถูกเขียนลง key ใหม่
 *
 * isValid ใช้กันค่าที่เก็บไว้แต่ใช้ไม่ได้แล้ว เช่นสถานะที่ถูกเอาออกจากตัวเลือก
 */
export function useSessionState<T>(key: string, initial: T | (() => T), isValid?: (value: unknown) => value is T) {
  // Capture the owner at mount so a late effect after logout cannot write the
  // old user's filters into the next user's workspace. RouteGuard remounts on
  // identity changes; callers must also remount when their logical key changes.
  const [storageKey] = useState(() => tabStorageKey(key));
  const [value, setValue] = useState<T>(() => {
    const fallback = typeof initial === 'function' ? (initial as () => T)() : initial;
    const parsed = readTabValue(storageKey);
    if (parsed === undefined) return fallback;
    const ok = isValid ? isValid(parsed) : parsed === null ? fallback === null : typeof parsed === typeof fallback;
    return ok ? (parsed as T) : fallback;
  });

  useEffect(() => {
    writeTabValue(storageKey, value);
  }, [storageKey, value]);

  return [value, setValue] as const;
}
