import { NextRequest, NextResponse } from 'next/server';
import { auditWorkActor as auditActor, requireRole } from '../../../../../lib/session';
import { ADMIN_ROLES, RECONCILE_ROLES } from '../../../../../lib/roles';
import { badRequest } from '../../../../../lib/apiInput';
import { ACCOUNT_BANK_CODES } from '../../../../../lib/bankAccounts';
import {
  BankAccountInputError,
  bankAccountStatusReady,
  createBankAccount,
  loadBankAccountAdminList,
  loadUnmappedGlAccounts,
  setBankAccountActive,
  STATUS_MIGRATION_HINT,
} from '../../../../../lib/bankAccountDb';

export const dynamic = 'force-dynamic';

// หน้า /master-data/bank-accounts — เพิ่มบัญชีใหม่และเปิด/ปิดบัญชี (แก้ไขได้เฉพาะ Admin/Dev/MASTER)
// ส่วนรายชื่อบัญชีสำหรับ dropdown ทั่วไปยังอยู่ที่ GET /api/master/bank-accounts ตามเดิม

function inputErrorResponse(err: unknown, fallback: string) {
  if (err instanceof BankAccountInputError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error(`${fallback}:`, err);
  return NextResponse.json({ error: fallback }, { status: 500 });
}

// GET เปิดให้ทุกคนที่เข้าเมนูจัดการข้อมูลได้ (AP/AR ดูอย่างเดียว) — canManage บอกหน้าจอว่าจะแสดงปุ่มแก้ไขไหม
export async function GET() {
  const auth = await requireRole(RECONCILE_ROLES);
  if (!auth.ok) return auth.response;
  const canManage = ADMIN_ROLES.includes(auth.session.role);

  try {
    const [accounts, candidates, statusReady] = await Promise.all([
      loadBankAccountAdminList(),
      canManage ? loadUnmappedGlAccounts() : Promise.resolve([]),
      bankAccountStatusReady(),
    ]);
    return NextResponse.json({ accounts, candidates, canManage, statusReady, statusHint: statusReady ? null : STATUS_MIGRATION_HINT });
  } catch (err) {
    return inputErrorResponse(err, 'โหลดรายชื่อบัญชีธนาคารไม่สำเร็จ');
  }
}

// POST { bankAccountNo, bankCode } — ผูกรหัสบัญชีจาก GL เข้ากับธนาคาร
export async function POST(req: NextRequest) {
  const auth = await requireRole(ADMIN_ROLES);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const bankAccountNo = typeof body?.bankAccountNo === 'string' ? body.bankAccountNo.trim() : '';
  const bankCode = typeof body?.bankCode === 'string' ? body.bankCode.trim() : '';
  if (!bankAccountNo) return badRequest('กรุณาเลือกรหัสบัญชี');
  if (!(ACCOUNT_BANK_CODES as readonly string[]).includes(bankCode)) return badRequest('กรุณาเลือกธนาคาร');

  try {
    await createBankAccount(bankAccountNo, bankCode, auditActor(auth.session));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return inputErrorResponse(err, 'เพิ่มบัญชีธนาคารไม่สำเร็จ');
  }
}

// PATCH { bankAccountNo, isActive } — ปิดบัญชี = นำเข้า statement ใหม่ไม่ได้, เปิดคืนได้
export async function PATCH(req: NextRequest) {
  const auth = await requireRole(ADMIN_ROLES);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const bankAccountNo = typeof body?.bankAccountNo === 'string' ? body.bankAccountNo.trim() : '';
  if (!bankAccountNo) return badRequest('กรุณาระบุรหัสบัญชี');
  if (typeof body?.isActive !== 'boolean') return badRequest('สถานะไม่ถูกต้อง');

  try {
    const found = await setBankAccountActive(bankAccountNo, body.isActive, auditActor(auth.session));
    if (!found) return NextResponse.json({ error: `ไม่พบบัญชีธนาคาร ${bankAccountNo}` }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return inputErrorResponse(err, 'เปลี่ยนสถานะบัญชีไม่สำเร็จ');
  }
}
