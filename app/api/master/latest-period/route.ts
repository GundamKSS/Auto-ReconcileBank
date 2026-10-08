import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '../../../../lib/session';
import { VIEWER_ROLES } from '../../../../lib/roles';
import { loadLatestPeriod } from '../../../../lib/latestPeriod';

// ต้องสดเสมอ — นำเข้าไฟล์ใหม่แล้วงวดล่าสุดต้องขยับตามทันที
export const dynamic = 'force-dynamic';

/**
 * GET /api/master/latest-period
 *
 * งวดล่าสุดที่มีข้อมูลให้ดู — หน้าภาพรวม/รายงาน/ประวัติการจับคู่ ใช้ตั้งค่าเริ่มต้น
 * แทนที่จะเปิดมาที่เดือนปัจจุบันซึ่งมักยังว่าง
 *
 * Query params:
 *   bankAccountNo - optional, ดูเฉพาะบัญชีนั้น
 *
 * ตอบ { period: null } เมื่อยังไม่มีข้อมูลเลยในระบบ — ฝั่งหน้าจอค่อยถอยไปใช้เดือนปัจจุบันเอง
 */
export async function GET(req: NextRequest) {
  const auth = await requireRole(VIEWER_ROLES);
  if (!auth.ok) return auth.response;

  try {
    const bankAccountNo = req.nextUrl.searchParams.get('bankAccountNo');
    const period = await loadLatestPeriod(bankAccountNo && bankAccountNo !== 'ALL' ? bankAccountNo : null);
    return NextResponse.json({ period });
  } catch (err) {
    console.error('Latest period API error:', err);
    return NextResponse.json({ error: 'หางวดล่าสุดไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' }, { status: 500 });
  }
}
