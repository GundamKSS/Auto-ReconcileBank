import { GL_SYNC_ENDPOINT, runGlSync } from '../../../../lib/bc365Sync';

import { requireRole } from '../../../../lib/session';
import { VIEWER_ROLES } from '../../../../lib/roles';
// กัน Next.js cache response ของ route นี้ไว้ (เป็น action ที่ต้อง trigger จริงทุกครั้ง ไม่ใช่ข้อมูลอ่านอย่างเดียว)
export const dynamic = 'force-dynamic';

// เรียก TRW Data Center sync service ให้ดึงรายการ GL (BankAccountLedgerEntries) ล่าสุด 40 วัน
// จาก Business Central (BC365) มาอัปเดตตาราง SQL — ใช้ทั้งตอนซิงค์เบื้องหลังหลังเข้าสู่ระบบ
// ปุ่มซิงค์ที่ Sidebar และปุ่มดึงข้อมูลในหน้า Reconcile (อนุญาตทุก role ที่ล็อกอินผ่านแล้ว)
export async function POST() {
  const auth = await requireRole(VIEWER_ROLES);
  if (!auth.ok) return auth.response;

  return runGlSync(GL_SYNC_ENDPOINT.RECENT, 120_000);
}
