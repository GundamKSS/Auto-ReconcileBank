// Base URL ของ TRW Data Center API — service เดียวกันทั้ง /auth/login และ /sync/*
// (ชื่อ env ยังเป็น BC365_SYNC_API_URL ตามของเดิมที่ตั้งไว้บนเครื่อง deploy แล้ว)
export const TRW_API_BASE = process.env.BC365_SYNC_API_URL || 'http://192.168.2.109:8000';

// รูปแบบ session ที่ route /api/login ส่งกลับให้ client แล้วเก็บลง localStorage คีย์ 'user'
// (มาจาก response ของ /auth/login แต่แปลงชื่อฟิลด์เป็น camelCase ให้เข้ากับฝั่ง client)
export type UserSession = {
  username: string;
  displayName: string;
  employeeNo: string | null;
  role: string | null;
  accessToken: string | null;
};
