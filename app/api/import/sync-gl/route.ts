import { GL_SYNC_ENDPOINT, runGlSync } from '../../../../lib/bc365Sync';

import { requireRole } from '../../../../lib/session';
import { RECONCILE_ROLES } from '../../../../lib/roles';
// กัน Next.js cache response ของ route นี้ไว้ (เป็น action ที่ต้อง trigger จริงทุกครั้ง ไม่ใช่ข้อมูลอ่านอย่างเดียว)
export const dynamic = 'force-dynamic';

// full sync ของหน้า import — ดึง BankAccountLedgerEntries ทั้งหมดจาก BC365 มาลง SQL ใหม่
// ต่างจาก /api/reconcile/sync-gl ที่ดึงแค่ 40 วันล่าสุด จึงเผื่อ timeout ไว้ยาวกว่า
export async function POST() {
  const auth = await requireRole(RECONCILE_ROLES);
  if (!auth.ok) return auth.response;

  return runGlSync(GL_SYNC_ENDPOINT.FULL, 900_000);
}
