import sql from 'mssql';
import { computeBalanceProof } from './balanceProof';
import { isoDate } from './periodClose';
import { approvalsComplete, workLabel } from './periodWorkflow';
import { readWorkApprovals, recordPeriodEvent, workFingerprint } from './periodWorkflowDb';

const EPS = 0.005;

type Account = Parameters<typeof computeBalanceProof>[1];

/**
 * ปิดงวดรวมใน transaction ที่ผู้เรียกเปิดไว้ (และล็อกบัญชีแล้ว) — ด่านเดียวกับที่หน้า "ยอดคงเหลือ" ใช้ตัดสิน
 *   1) ไม่มีงวดที่ปิดแล้วทับช่วงนี้  2) AP และ AR ยืนยันครบช่วงเดียวกัน
 *   3) ข้อมูลทั้งสองฝั่งไม่เปลี่ยนหลังยืนยัน (fingerprint)  4) ยอดคงเหลือหลังปรับปรุงเป็นศูนย์
 * ไม่ผ่านข้อไหนโยน Error พร้อมเหตุผล ผู้เรียก rollback ทั้ง transaction
 *
 * ปกติถูกเรียกจากการยืนยันงานฝั่งที่สอง (AP + AR ครบ = ปิดงวดทันที ดู work-approval/route.ts)
 * ยอดคงเหลืออ่านผ่าน pool นอก transaction ได้ เพราะการยืนยันงานไม่ได้แตะรายการที่ใช้คำนวณยอด
 */
export async function closePeriodInTransaction(
  transaction: sql.Transaction,
  pool: sql.ConnectionPool,
  account: Account,
  periodStart: Date,
  periodEnd: Date,
  actor: string,
  note: string
) {
  const overlap = await new sql.Request(transaction).input('acc', sql.NVarChar, account.bankAccountNo)
    .input('from', sql.Date, periodStart).input('to', sql.Date, periodEnd).query(`
      SELECT TOP 1 PeriodStart FROM ReconciliationPeriodClose
      WHERE BankAccountNo=@acc AND Status='CLOSED' AND PeriodStart<=@to AND PeriodEnd>=@from
    `);
  if (overlap.recordset.length) throw new Error('ช่วงวันที่นี้มีงวดที่ปิดแล้ว กรุณาโหลดข้อมูลใหม่');
  const approvals = await readWorkApprovals(transaction, account.bankAccountNo);
  if (!approvalsComplete(approvals, isoDate(periodStart), isoDate(periodEnd))) {
    throw new Error('ต้องยืนยันงาน AP และ AR ให้ครบสำหรับช่วงวันที่เดียวกันก่อนปิดงวดรวม');
  }
  for (const approval of approvals.filter((a) => a.periodStart === isoDate(periodStart) && a.periodEnd === isoDate(periodEnd))) {
    const current = await workFingerprint(transaction, account.bankAccountNo, account.bankCode, periodStart, periodEnd, approval.direction);
    if (current !== approval.fingerprint) {
      throw new Error(`ข้อมูล ${workLabel(approval.direction)} เปลี่ยนหลังยืนยัน กรุณาเปิดงานฝั่งนี้ ตรวจสอบ และยืนยันใหม่ก่อนปิดงวดรวม`);
    }
  }
  const proof = await computeBalanceProof(pool, account, periodStart, periodEnd);
  const remaining = proof.adjustment.remaining;
  if (remaining === null || !Number.isFinite(remaining) || Math.abs(remaining) >= EPS) {
    throw new Error(
      remaining === null
        ? 'ยังไม่รู้ยอดคงเหลือครบทั้งสองฝั่ง (ขาดยอดยกมา) — ปิดงวดไม่ได้'
        : `ยอดคงเหลือยังไม่เท่ากัน (เหลือ ${remaining.toFixed(2)}) — ปิดงวดไม่ได้`
    );
  }

  await new sql.Request(transaction)
    .input('acc', sql.NVarChar, account.bankAccountNo)
    .input('periodStart', sql.Date, periodStart)
    .input('periodEnd', sql.Date, periodEnd)
    .input('bankClosing', sql.Decimal(18, 2), proof.bank.closing)
    .input('glClosing', sql.Decimal(18, 2), proof.gl.closing)
    .input('by', sql.NVarChar(100), actor)
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
  await recordPeriodEvent(transaction, account.bankAccountNo, periodStart, periodEnd, 'CLOSE', null, actor, note);
}
