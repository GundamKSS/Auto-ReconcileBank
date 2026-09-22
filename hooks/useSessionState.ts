'use client';

import { useEffect, useState } from 'react';

/**
 * useState ที่จำค่าไว้ใน sessionStorage — สลับหน้าไปมาแล้วกลับมาเจอธนาคาร/ไฟล์/ตัวกรองเดิม
 *
 * ใช้ sessionStorage ไม่ใช่ localStorage: จำเฉพาะแท็บเบราว์เซอร์นั้นจนกว่าจะปิดแท็บ
 * ไม่งั้นตัวกรองวันที่ของเมื่อวานจะค้างมาวันถัดไปแล้วเห็นข้อมูลไม่ครบโดยไม่รู้ตัว
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
export function useSessionState<T>(key: string, initial: T, isValid?: (value: unknown) => value is T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = sessionStorage.getItem(key);
      if (raw === null) return initial;
      const parsed: unknown = JSON.parse(raw);
      const ok = isValid ? isValid(parsed) : parsed === null ? initial === null : typeof parsed === typeof initial;
      return ok ? (parsed as T) : initial;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify(value));
    } catch {
      // จำไม่ได้ก็ไม่เป็นไร หน้ายังใช้งานได้ตามปกติ
    }
  }, [key, value]);

  return [value, setValue] as const;
}
