import { NextRequest, NextResponse } from 'next/server';
import sql from 'mssql';
import { getPool } from '../../../../lib/db';
import { auditWorkActor as auditActor, requireRole } from '../../../../lib/session';
import { RECONCILE_ROLES } from '../../../../lib/roles';
import { badRequest, parseIsoDateParam } from '../../../../lib/apiInput';
import { resolveBankAccount } from '../../../../lib/bankAccountDb';
import { closePeriodInTransaction } from '../../../../lib/periodCloseDb';
import { PERIOD_CLOSE_MIGRATION_HINT, reconcilePeriodCloseReady } from '../../../../lib/periodClose';
import { remarkProblem } from '../../../../lib/matchRemark';
import { assertWorkRole, WorkPermissionError } from '../../../../lib/workRolesDb';
import { lockReconciliationAccount, recordPeriodEvent, workApprovalReady,
  WORK_APPROVAL_MIGRATION_HINT } from '../../../../lib/periodWorkflowDb';

/**
 * ปิด/เปิดงวดการกระทบยอด — เงื่อนไขเดียวกับที่หน้า "ยอดคงเหลือ" ใช้ตัดสิน (settled = remaining ≈ 0)
 * ปิดแล้วห้ามแก้ไขรายการของงวดนั้นอีก (ดู lib/periodClose.ts: assertDatesOpen ที่ Match/Unmatch/
 * Un-suspend/แก้ยอดยกมา/ลบไฟล์ Bank Statement เรียกก่อนเขียนจริงทุกจุด)
 *
 * ปกติงวดปิดเองตอน AP และ AR ยืนยันครบ (ดู work-approval/route.ts) — POST ที่นี่เหลือไว้ให้ Master Admin
 * ปิดงวดที่ยืนยันครบไว้ก่อนเปลี่ยนมาปิดอัตโนมัติ ส่วน PATCH (เปิดงวดคืน) ใช้ได้เฉพาะ Master Admin
 * (Dev/Admin ระบบกลาง หรือ User ที่ได้ MASTER) — ตรวจใหม่ใน transaction ทุกครั้ง
 */

export async function POST(req: NextRequest) {
  const auth = await requireRole(RECONCILE_ROLES);
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json().catch(() => null);
    const bankAccountNo = typeof body?.bankAccountNo === 'string' ? body.bankAccountNo : '';
    const periodStart = parseIsoDateParam(typeof body?.periodStart === 'string' ? body.periodStart : null);
    const periodEnd = parseIsoDateParam(typeof body?.periodEnd === 'string' ? body.periodEnd : null);
    if (!bankAccountNo) return badRequest('ต้องระบุบัญชีธนาคาร');
    if (!periodStart || !periodEnd) return badRequest('ต้องระบุช่วงวันที่ของงวด (YYYY-MM-DD)');
    if (periodStart.getTime() > periodEnd.getTime()) return badRequest('ช่วงวันที่ไม่ถูกต้อง');

    if (!(await reconcilePeriodCloseReady())) {
      return NextResponse.json({ error: PERIOD_CLOSE_MIGRATION_HINT }, { status: 409 });
    }
    const account = await resolveBankAccount(bankAccountNo);
    if (!account) return badRequest('ไม่พบบัญชีธนาคารนี้');

    const pool = await getPool();
    if (!(await workApprovalReady(pool))) {
      return NextResponse.json({ error: WORK_APPROVAL_MIGRATION_HINT }, { status: 409 });
    }
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
      await assertWorkRole(auth.session, 'MASTER', transaction);
      await lockReconciliationAccount(transaction, account.bankAccountNo);
      await closePeriodInTransaction(transaction, pool, account, periodStart, periodEnd, auditActor(auth.session),
        'AP/AR ยืนยันครบและยอดผ่านการตรวจสอบ');
      await transaction.commit();
      return NextResponse.json({ success: true, closedBy: auditActor(auth.session) });
    } catch (err) {
      await transaction.rollback();
      if (err instanceof WorkPermissionError) return NextResponse.json({ error: err.message }, { status: err.status });
      if (err instanceof Error && !(err instanceof sql.RequestError)) {
        return NextResponse.json({ error: err.message }, { status: 409 });
      }
      throw err;
    }
  } catch (err) {
    console.error('Period close POST error:', err);
    return NextResponse.json({ error: 'ปิดงวดไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await requireRole(RECONCILE_ROLES);
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json().catch(() => null);
    const bankAccountNo = typeof body?.bankAccountNo === 'string' ? body.bankAccountNo : '';
    const periodStart = parseIsoDateParam(typeof body?.periodStart === 'string' ? body.periodStart : null);
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
    if (!bankAccountNo) return badRequest('ต้องระบุบัญชีธนาคาร');
    if (!periodStart) return badRequest('วันที่เริ่มงวดไม่ถูกต้อง');
    const reasonProblem = remarkProblem(reason);
    if (reasonProblem) return badRequest(reasonProblem);

    if (!(await reconcilePeriodCloseReady())) {
      return NextResponse.json({ error: PERIOD_CLOSE_MIGRATION_HINT }, { status: 409 });
    }
    const account = await resolveBankAccount(bankAccountNo);
    if (!account) return badRequest('ไม่พบบัญชีธนาคารนี้');

    const pool = await getPool();
    if (!(await workApprovalReady(pool))) {
      return NextResponse.json({ error: WORK_APPROVAL_MIGRATION_HINT }, { status: 409 });
    }
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
      await assertWorkRole(auth.session, 'MASTER', transaction);
      await lockReconciliationAccount(transaction, account.bankAccountNo);
      const existing = await new sql.Request(transaction).input('acc', sql.NVarChar, account.bankAccountNo)
        .input('from', sql.Date, periodStart).query(`SELECT PeriodEnd FROM ReconciliationPeriodClose
          WHERE BankAccountNo=@acc AND PeriodStart=@from AND Status='CLOSED'`);
      if (!existing.recordset.length) throw new Error('งวดนี้ไม่ได้ปิดอยู่ กรุณารีเฟรชหน้าใหม่');
      const periodEnd = new Date(existing.recordset[0].PeriodEnd);
      await new sql.Request(transaction)
        .input('acc', sql.NVarChar, account.bankAccountNo)
        .input('periodStart', sql.Date, periodStart)
        .input('by', sql.NVarChar(100), auditActor(auth.session))
        .input('reason', sql.NVarChar(500), reason)
        .query(`
          UPDATE ReconciliationPeriodClose
          SET Status = 'REOPENED', ReopenedBy = @by, ReopenedAt = SYSDATETIMEOFFSET(), ReopenReason = @reason
          WHERE BankAccountNo = @acc AND PeriodStart = @periodStart AND Status = 'CLOSED'
        `);
      // Final reopening requires fresh confirmation from both teams; retain old events for audit.
      await new sql.Request(transaction).input('acc', sql.NVarChar, account.bankAccountNo)
        .input('from', sql.Date, periodStart).input('to', sql.Date, periodEnd).query(`
          DELETE FROM ReconciliationWorkApproval WHERE BankAccountNo=@acc AND PeriodStart<=@to AND PeriodEnd>=@from
        `);
      await recordPeriodEvent(transaction, account.bankAccountNo, periodStart, periodEnd, 'REOPEN_PERIOD', null,
        auditActor(auth.session), reason);
      await transaction.commit();
      return NextResponse.json({ success: true });
    } catch (err) {
      await transaction.rollback();
      if (err instanceof WorkPermissionError) return NextResponse.json({ error: err.message }, { status: err.status });
      if (err instanceof Error && !(err instanceof sql.RequestError)) {
        return NextResponse.json({ error: err.message }, { status: 409 });
      }
      throw err;
    }
  } catch (err) {
    console.error('Period close PATCH error:', err);
    return NextResponse.json({ error: 'เปิดงวดคืนไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' }, { status: 500 });
  }
}
