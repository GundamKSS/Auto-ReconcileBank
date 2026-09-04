// Base URL ของ TRW Data Center API — service เดียวกันทั้ง /auth/auth_permission_prog และ /sync/*
// (ชื่อ env ยังเป็น BC365_SYNC_API_URL ตามของเดิมที่ตั้งไว้บนเครื่อง deploy แล้ว)
export const TRW_API_BASE = process.env.BC365_SYNC_API_URL || 'http://192.168.2.109:8000';

// รหัสโปรแกรมของแอปนี้ในทะเบียนโปรแกรมของ TRW Data Center — ใช้หาแถวสิทธิ์ของเราใน programs[]
// ที่ /auth/auth_permission_prog ส่งมา (ผู้ใช้คนหนึ่งมีสิทธิ์ได้หลายโปรแกรม)
export const TRW_PROGRAM_CODE = process.env.TRW_PROGRAM_CODE || 'PRG001';

// สิทธิ์รายโปรแกรมที่ /auth/auth_permission_prog ส่งมาใน programs[]
export type ProgramAccess = {
  program_id: number;
  program_code: string;
  program_name: string;
  url: string | null;
  // สิทธิ์ในโปรแกรมนั้น (Admin/User/Dev) — คนละตัวกับ role ระดับบนสุดซึ่งเป็นตำแหน่งงาน
  role_prog: string | null;
  can_use: boolean;
  is_active: boolean;
  granted_at: string | null;
};

// รูปแบบ session ที่ route /api/login ส่งกลับให้ client แล้วเก็บลง localStorage คีย์ 'user'
// (มาจาก response ของ /auth/auth_permission_prog แต่แปลงชื่อฟิลด์เป็น camelCase ให้เข้ากับฝั่ง client)
export type UserSession = {
  username: string;
  displayName: string;
  employeeNo: string | null;
  email: string | null;
  // ตำแหน่งงานจาก API (เช่น "Accounting") — ใช้แสดงผลเท่านั้น ไม่ได้คุมสิทธิ์
  role: string | null;
  // สิทธิ์ในโปรแกรมนี้ (Admin/User/Dev) — ตัวที่คุมเมนูและ RouteGuard
  roleProg: string | null;
  // สิทธิ์ทุกโปรแกรมที่ผู้ใช้มี — เก็บไว้เผื่อทำเมนูสลับโปรแกรมภายหลัง
  programs: ProgramAccess[];
  accessToken: string | null;
};
