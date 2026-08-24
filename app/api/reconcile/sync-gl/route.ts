import { GL_SYNC_ENDPOINT, runGlSync } from '../../../../lib/bc365Sync';

// กัน Next.js cache response ของ route นี้ไว้ (เป็น action ที่ต้อง trigger จริงทุกครั้ง ไม่ใช่ข้อมูลอ่านอย่างเดียว)
export const dynamic = 'force-dynamic';

// เรียก TRW Data Center sync service ให้ดึงรายการ GL (BankAccountLedgerEntries) ล่าสุด 40 วัน
// จาก Business Central (BC365) มาอัปเดตตาราง SQL ที่หน้า reconcile อ่านอยู่ — ใช้ตอนบัญชีแก้ไขข้อมูลใน ERP
// เสร็จแล้วอยากดึงของจริงมาเทียบใหม่ทันที โดยไม่ต้องรอ sync job รอบถัดไป
// หน้า reconcile ทำงานทีละเดือน เลยใช้แบบ 40 วันก็พอ (ถ้าต้องการทั้งหมดให้ใช้ /api/import/sync-gl)
export async function POST() {
  return runGlSync(GL_SYNC_ENDPOINT.RECENT, 120_000);
}
