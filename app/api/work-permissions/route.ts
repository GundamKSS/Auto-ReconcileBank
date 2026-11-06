import { NextResponse } from 'next/server';
import { requireRole } from '../../../lib/session';
import { RECONCILE_ROLES } from '../../../lib/roles';
import { readWorkPermissions } from '../../../lib/workRolesDb';

// GET /api/work-permissions — สิทธิ์ AP/AR/MASTER ของผู้ใช้ปัจจุบัน (Admin/Dev ระบบกลางได้ครบทุกสิทธิ์)
// หน้าที่ต้องรู้สิทธิ์ก่อนผู้ใช้ทำอะไร (เช่นหน้านำเข้าที่ต้องเลือกฝั่งก่อนอัปไฟล์) ใช้ตัวนี้
// ส่วน API ที่แก้ข้อมูลยังตรวจสิทธิ์ซ้ำเองทุกครั้ง ค่านี้มีไว้ให้หน้าจอแสดงผลถูกเท่านั้น
export async function GET() {
  const auth = await requireRole(RECONCILE_ROLES);
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json({ permissions: await readWorkPermissions(auth.session) });
  } catch (err) {
    console.error('Work permissions GET error:', err);
    return NextResponse.json({ error: 'โหลดสิทธิ์ผู้ใช้ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' }, { status: 500 });
  }
}
