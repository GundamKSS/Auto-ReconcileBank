import { NextRequest, NextResponse } from 'next/server';
import sql from 'mssql';
import { getPool } from '../../../../lib/db';
import { auditWorkActor as auditActor, requireRole } from '../../../../lib/session';
import { RECONCILE_ROLES } from '../../../../lib/roles';
import { badRequest, parseIsoDateParam } from '../../../../lib/apiInput';
import { resolveBankAccount } from '../../../../lib/bankAccountDb';
import { remarkProblem } from '../../../../lib/matchRemark';
import { isoDate, reconcilePeriodCloseReady } from '../../../../lib/periodClose';
import { approvalsComplete, workLabel } from '../../../../lib/periodWorkflow';
import { closePeriodInTransaction } from '../../../../lib/periodCloseDb';
import { directionWorkRole } from '../../../../lib/workRoles';
import { assertWorkRole, WorkPermissionError } from '../../../../lib/workRolesDb';
import { lockReconciliationAccount, readWorkApprovals, recordPeriodEvent, workApprovalReady,
  workFingerprint, WORK_APPROVAL_MIGRATION_HINT } from '../../../../lib/periodWorkflowDb';

async function updateApproval(req: NextRequest, reopen: boolean) {
  const auth = await requireRole(RECONCILE_ROLES);
  if (!auth.ok) return auth.response;
  try {
    const body = await req.json().catch(() => null);
    const accountNo = typeof body?.bankAccountNo === 'string' ? body.bankAccountNo : '';
    const from = parseIsoDateParam(typeof body?.periodStart === 'string' ? body.periodStart : null);
    const to = parseIsoDateParam(typeof body?.periodEnd === 'string' ? body.periodEnd : null);
    const direction = body?.direction;
    const note = typeof body?.note === 'string' ? body.note.trim() : '';
    if (!accountNo || !from || !to || from > to) return badRequest('กรุณาระบุบัญชีและช่วงวันที่ให้ถูกต้อง');
    if (direction !== 'IN' && direction !== 'OUT') return badRequest('กรุณาเลือก AP หรือ AR');
    const problem = remarkProblem(note);
    if (problem) return badRequest(problem);
    if (!reopen && body?.acknowledged !== true) return badRequest('กรุณายืนยันว่าตรวจสอบรายการและรายการค้างของฝั่งนี้แล้ว');
    const account = await resolveBankAccount(accountNo);
    if (!account) return badRequest('ไม่พบบัญชีธนาคารนี้');
    const pool = await getPool();
    if (!(await reconcilePeriodCloseReady()) || !(await workApprovalReady(pool))) {
      return NextResponse.json({ error: WORK_APPROVAL_MIGRATION_HINT }, { status: 409 });
    }
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      await assertWorkRole(auth.session, directionWorkRole(direction), tx);
      await lockReconciliationAccount(tx, account.bankAccountNo);
      const closed = await new sql.Request(tx).input('acc', sql.NVarChar, account.bankAccountNo)
        .input('from', sql.Date, from).input('to', sql.Date, to).query(`
          SELECT TOP 1 PeriodStart FROM ReconciliationPeriodClose
          WHERE BankAccountNo=@acc AND Status='CLOSED' AND PeriodStart<=@to AND PeriodEnd>=@from
        `);
      if (closed.recordset.length) throw new Error('ช่วงวันที่นี้มีงวดที่ปิดแล้ว ต้องเปิดงวดรวมอีกครั้งก่อน');
      const approvals = await readWorkApprovals(tx, account.bankAccountNo);
      const fromIso = isoDate(from), toIso = isoDate(to);
      const existing = approvals.find((a) => a.direction === direction && a.periodStart === fromIso && a.periodEnd === toIso);
      if (reopen && !existing) throw new Error('ไม่พบงานที่ยืนยันสำหรับช่วงวันที่นี้ กรุณาโหลดข้อมูลใหม่');
      if (!reopen && approvals.some((a) => a.periodStart <= toIso && a.periodEnd >= fromIso &&
        (a.direction === direction || a.periodStart !== fromIso || a.periodEnd !== toIso))) {
        throw new Error('ช่วงวันที่ทับซ้อนกับงานที่ยืนยันแล้ว กรุณาใช้ช่วงวันที่เดียวกันทั้ง AP/AR หรือเปิดงานเดิมก่อน');
      }
      const actor = auditActor(auth.session);
      const request = new sql.Request(tx).input('acc', sql.NVarChar, account.bankAccountNo)
        .input('from', sql.Date, from).input('to', sql.Date, to).input('direction', sql.NVarChar, direction);
      if (reopen) {
        await request.query(`DELETE FROM ReconciliationWorkApproval
          WHERE BankAccountNo=@acc AND PeriodStart=@from AND PeriodEnd=@to AND Direction=@direction`);
      } else {
        const fingerprint = await workFingerprint(tx, account.bankAccountNo, account.bankCode, from, to, direction);
        await request.input('actor', sql.NVarChar, actor).input('note', sql.NVarChar(500), note)
          .input('fingerprint', sql.VarChar(64), fingerprint).query(`
            INSERT INTO ReconciliationWorkApproval
              (BankAccountNo, PeriodStart, PeriodEnd, Direction, ConfirmedBy, Note, DataFingerprint)
            VALUES (@acc, @from, @to, @direction, @actor, @note, @fingerprint)
          `);
      }
      await recordPeriodEvent(tx, account.bankAccountNo, from, to,
        reopen ? 'REOPEN_WORK' : 'CONFIRM', direction, actor, note);
      // AP และ AR ยืนยันครบช่วงเดียวกัน = ปิดงวดทันที (ไม่มีขั้นปิดงวดแยกแล้ว) ถ้าด่านปิดงวดไม่ผ่าน
      // (ยอดยังไม่ลงตัว / ข้อมูลเปลี่ยน) การยืนยันนี้ถูกยกเลิกทั้งหมด จึงไม่มีสถานะ "ยืนยันครบแต่ยังไม่ปิด"
      let periodClosed = false;
      if (!reopen && approvalsComplete(await readWorkApprovals(tx, account.bankAccountNo), fromIso, toIso)) {
        try {
          await closePeriodInTransaction(tx, pool, account, from, to, actor,
            `ปิดอัตโนมัติ: AP และ AR ยืนยันครบ (ยืนยันล่าสุด ${workLabel(direction)})`);
        } catch (err) {
          if (err instanceof Error && !(err instanceof sql.RequestError)) {
            throw new Error(`ยืนยัน ${workLabel(direction)} ไม่สำเร็จ — อีกฝั่งยืนยันแล้ว การยืนยันนี้จะปิดงวดทันที แต่${err.message}`);
          }
          throw err;
        }
        periodClosed = true;
      }
      await tx.commit();
      return NextResponse.json({ success: true, closed: periodClosed, message: periodClosed
        ? `${workLabel(direction)} ยืนยันงานแล้ว — AP และ AR ยืนยันครบ ปิดงวดรวมแล้ว`
        : `${workLabel(direction)} ${reopen ? 'เปิดงานอีกครั้งแล้ว' : 'ยืนยันงานแล้ว'}` });
    } catch (err) {
      await tx.rollback();
      if (err instanceof WorkPermissionError) return NextResponse.json({ error: err.message }, { status: err.status });
      if (err instanceof Error && !(err instanceof sql.RequestError)) {
        return NextResponse.json({ error: err.message }, { status: 409 });
      }
      throw err;
    }
  } catch (err) {
    console.error('Work approval error:', err);
    return NextResponse.json({ error: 'บันทึกสถานะงานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' }, { status: 500 });
  }
}

export const POST = (req: NextRequest) => updateApproval(req, false);
export const PATCH = (req: NextRequest) => updateApproval(req, true);
