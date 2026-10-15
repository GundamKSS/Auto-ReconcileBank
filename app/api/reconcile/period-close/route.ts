import { NextRequest, NextResponse } from 'next/server';
import sql from 'mssql';
import { getPool } from '../../../../lib/db';
import { auditActor, requireRole } from '../../../../lib/session';
import { RECONCILE_ROLES } from '../../../../lib/roles';
import { badRequest, parseIsoDateParam } from '../../../../lib/apiInput';
import { resolveBankAccount } from '../../../../lib/bankAccountDb';
import { computeBalanceProof } from '../../../../lib/balanceProof';
import { PERIOD_CLOSE_MIGRATION_HINT, reconcilePeriodCloseReady } from '../../../../lib/periodClose';
import { remarkProblem } from '../../../../lib/matchRemark';

/**
 * ปิด/เปิดงวดการกระทบยอด — เงื่อนไขเดียวกับที่หน้า "ยอดคงเหลือ" ใช้ตัดสิน (settled = remaining ≈ 0)
 * ปิดแล้วห้ามแก้ไขรายการของงวดนั้นอีก (ดู lib/periodClose.ts: assertDatesOpen ที่ Match/Unmatch/
 * Un-suspend/แก้ยอดยกมา/ลบไฟล์ Bank Statement เรียกก่อนเขียนจริงทุกจุด)
 *
 * สิทธิ์ปิด/เปิดงวดใช้ RECONCILE_ROLES เดียวกับทุกจุดที่แก้ข้อมูลกระทบยอด — ไม่มีการแยกสิทธิ์ใหม่
 * (ทีมยืนยันว่า Dev ต้องทำได้ทุกจุดเพื่อทดสอบระบบ)
 */

const EPS = 0.005;

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
    const proof = await computeBalanceProof(pool, account, periodStart, periodEnd);
    const remaining = proof.adjustment.remaining;
    if (remaining === null || Math.abs(remaining) >= EPS) {
      return NextResponse.json(
        {
          error:
            remaining === null
              ? 'ยังไม่รู้ยอดคงเหลือครบทั้งสองฝั่ง (ขาดยอดยกมา) — ปิดงวดไม่ได้'
              : `ยอดคงเหลือยังไม่เท่ากัน (เหลือ ${remaining.toFixed(2)}) — ปิดงวดไม่ได้`,
        },
        { status: 409 }
      );
    }

    await pool
      .request()
      .input('acc', sql.NVarChar, account.bankAccountNo)
      .input('periodStart', sql.Date, periodStart)
      .input('periodEnd', sql.Date, periodEnd)
      .input('bankClosing', sql.Decimal(18, 2), proof.bank.closing)
      .input('glClosing', sql.Decimal(18, 2), proof.gl.closing)
      .input('by', sql.NVarChar(100), auditActor(auth.session))
      .query(`
        MERGE ReconciliationPeriodClose WITH (HOLDLOCK) AS t
        USING (SELECT @acc AS BankAccountNo, @periodStart AS PeriodStart) AS s
          ON t.BankAccountNo = s.BankAccountNo AND t.PeriodStart = s.PeriodStart
        WHEN MATCHED THEN
          UPDATE SET PeriodEnd = @periodEnd, Status = 'CLOSED',
                     BankClosingBalance = @bankClosing, GlClosingBalance = @glClosing,
                     ClosedBy = @by, ClosedAt = SYSDATETIMEOFFSET()
        WHEN NOT MATCHED THEN
          INSERT (BankAccountNo, PeriodStart, PeriodEnd, BankClosingBalance, GlClosingBalance, ClosedBy)
          VALUES (@acc, @periodStart, @periodEnd, @bankClosing, @glClosing, @by);
      `);

    return NextResponse.json({ success: true, closedBy: auditActor(auth.session) });
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
    const result = await pool
      .request()
      .input('acc', sql.NVarChar, account.bankAccountNo)
      .input('periodStart', sql.Date, periodStart)
      .input('by', sql.NVarChar(100), auditActor(auth.session))
      .input('reason', sql.NVarChar(500), reason)
      .query(`
        UPDATE ReconciliationPeriodClose
        SET Status = 'REOPENED', ReopenedBy = @by, ReopenedAt = SYSDATETIMEOFFSET(), ReopenReason = @reason
        WHERE BankAccountNo = @acc AND PeriodStart = @periodStart AND Status = 'CLOSED'
      `);
    if ((result.rowsAffected[0] ?? 0) === 0) {
      return NextResponse.json({ error: 'งวดนี้ไม่ได้ปิดอยู่ กรุณารีเฟรชหน้าใหม่' }, { status: 409 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Period close PATCH error:', err);
    return NextResponse.json({ error: 'เปิดงวดคืนไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' }, { status: 500 });
  }
}
