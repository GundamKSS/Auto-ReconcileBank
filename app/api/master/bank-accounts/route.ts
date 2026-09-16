import { NextResponse } from 'next/server';
import { requireRole } from '../../../../lib/session';
import { VIEWER_ROLES } from '../../../../lib/roles';
import { bankAccountColumnsReady, loadBankAccounts } from '../../../../lib/bankAccountDb';

// ต้องสดเสมอ — เพิ่งรัน sql/006 หรือเพิ่งเพิ่มบัญชีใน BankAccountMapping แล้วต้องเห็นทันที
export const dynamic = 'force-dynamic';

// GET /api/master/bank-accounts
// รายชื่อบัญชีธนาคารทั้งหมดที่ mapping ไว้ ใช้เติม dropdown "เลือกบัญชี" ของหน้า Import และหน้า Reconcile
// ให้ VIEWER_ROLES เข้าถึงได้ เพราะเป็นข้อมูล master ที่หน้าแสดงผลอย่างเดียวก็ต้องใช้แปลรหัสบัญชีเป็นชื่อ
export async function GET() {
  const auth = await requireRole(VIEWER_ROLES);
  if (!auth.ok) return auth.response;

  try {
    const [accounts, ready] = await Promise.all([loadBankAccounts(), bankAccountColumnsReady()]);
    return NextResponse.json({ accounts, accountDimensionReady: ready });
  } catch (err) {
    console.error('Bank accounts GET error:', err);
    return NextResponse.json({ error: 'โหลดรายชื่อบัญชีธนาคารไม่สำเร็จ' }, { status: 500 });
  }
}
