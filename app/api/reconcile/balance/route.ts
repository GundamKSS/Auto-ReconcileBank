import { NextRequest, NextResponse } from 'next/server';
import sql from 'mssql';
import { getPool } from '../../../../lib/db';
import { auditActor, requireRole } from '../../../../lib/session';
import { RECONCILE_ROLES } from '../../../../lib/roles';
import { badRequest, parseIsoDateParam } from '../../../../lib/apiInput';
import { bankAccountColumnsReady, MIGRATION_HINT, resolveBankAccount } from '../../../../lib/bankAccountDb';
import { EXTRAS_MIGRATION_HINT, reconcileExtrasReady } from '../../../../lib/reconcileExtrasDb';
import { computeBalanceProof } from '../../../../lib/balanceProof';
import { evaluatePeriodChecks } from '../../../../lib/periodCloseChecks';
import { assertDatesOpen, isoDate, reconcilePeriodCloseReady, PeriodClosedError } from '../../../../lib/periodClose';
import { readWorkApprovals, workApprovalReady } from '../../../../lib/periodWorkflowDb';
import { readWorkPermissions } from '../../../../lib/workRolesDb';

export const dynamic = 'force-dynamic';

/**
 * ยอดคงเหลือ Bank เทียบ GL ของงวดที่กำลังกระทบยอด — สิ่งที่ทีมบัญชีใช้ตัดสินว่ากระทบยอดเสร็จแล้ว
 * (ประชุม 17 ก.ย. 2026: "ไม่เอาคำว่า Difference" ให้ดูยอดคงเหลือสองฝั่ง ถ้าเท่ากันแปลว่าถูก)
 *
 * GET  ?bankAccountNo=&from=&to=   ยอดยกมา/เคลื่อนไหว/คงเหลือ ทั้งสองฝั่ง + รายวัน + รายการที่อธิบายผลต่าง
 * PUT  { bankAccountNo, periodStart, glOpeningBalance }   บันทึกยอดยกมาฝั่ง GL ของงวดนั้น
 *
 * วิธีเดียวกับกระดาษที่ทีมบัญชีทำมือ (BBL #4633 ส.ค. 2026):
 *   GL "ก่อนปรับปรุง" ไม่รวม JV ปรับปรุงพักโอน (MatchType EXCLUDED) → 3,409,206.00
 *   ยอดพักโอน = Bank ปลายงวด − GL ก่อนปรับปรุง → 3,670,891.82 − 3,409,206.00 = 261,685.82
 *   JV ปรับปรุงพักโอนใน BC ต้องเท่ากับยอดพักโอน แล้ว GL หลังปรับปรุงจะเท่ากับ Bank
 *
 * ยอดพักโอนแตกเป็นส่วนๆ ได้พอดีเสมอ:
 *   = (Bank ยกมา − GL ยกมา) + Bank ยังไม่จับคู่ − GL ยังไม่จับคู่ − GL พักไว้ − GL หักล้างกันเอง
 *     + (Bank ที่จับคู่แล้ว − GL ที่จับคู่แล้ว ภายในงวด)
 * ส่วนสุดท้ายคือยอดพักโอนส่วนต่างที่ผูกกับ Match + คู่ที่อีกฝั่งอยู่นอกงวด
 */

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export async function GET(req: NextRequest) {
  const auth = await requireRole(RECONCILE_ROLES);
  if (!auth.ok) return auth.response;

  try {
    const params = req.nextUrl.searchParams;
    const bankAccountNo = params.get('bankAccountNo');
    const from = parseIsoDateParam(params.get('from'));
    const to = parseIsoDateParam(params.get('to'));
    if (!bankAccountNo) return badRequest('ต้องระบุบัญชีธนาคาร');
    if (!from || !to) return badRequest('ต้องระบุช่วงวันที่ (YYYY-MM-DD)');
    if (from.getTime() > to.getTime()) return badRequest('ช่วงวันที่ไม่ถูกต้อง');

    if (!(await bankAccountColumnsReady())) {
      return NextResponse.json({ error: MIGRATION_HINT }, { status: 409 });
    }
    const account = await resolveBankAccount(bankAccountNo);
    if (!account) return badRequest('ไม่พบบัญชีธนาคารนี้');

    const pool = await getPool();
    const proof = await computeBalanceProof(pool, account, from, to);

    // สถานะปิดงวด — คีย์เดียวกับ ReconciliationOpeningBalance คือ PeriodStart ตรงกับ from เป๊ะ
    let periodClose: {
      status: 'OPEN' | 'CLOSED' | 'REOPENED';
      closedBy: string | null;
      closedAt: Date | null;
      reopenedBy: string | null;
      reopenedAt: Date | null;
      reopenReason: string | null;
      periodStart: string | null;
      periodEnd: string | null;
    } | null = null;
    // งวดก่อนที่ปิดแล้ว — ใช้ตรวจความต่อเนื่องของยอดยกมา (สเปกข้อ 27 กับ 28) ในโหมดเตือน
    let previousClose: { periodEnd: string; bankClosing: number | null; glClosing: number | null } | null = null;
    if (await reconcilePeriodCloseReady()) {
      const previousResult = await pool
        .request()
        .input('acc', sql.NVarChar, account.bankAccountNo)
        .input('from', sql.Date, from)
        .query(`
          SELECT TOP 1 PeriodEnd, BankClosingBalance, GlClosingBalance
          FROM ReconciliationPeriodClose
          WHERE BankAccountNo = @acc AND Status = 'CLOSED' AND PeriodEnd < @from
          ORDER BY PeriodEnd DESC
        `);
      const previousRow = previousResult.recordset[0];
      if (previousRow) {
        previousClose = {
          periodEnd: isoDate(previousRow.PeriodEnd),
          bankClosing: previousRow.BankClosingBalance === null ? null : Number(previousRow.BankClosingBalance),
          glClosing: previousRow.GlClosingBalance === null ? null : Number(previousRow.GlClosingBalance),
        };
      }
      const closeResult = await pool
        .request()
        .input('acc', sql.NVarChar, account.bankAccountNo)
        .input('from', sql.Date, from)
        .input('to', sql.Date, to)
        .query(`
          SELECT TOP 1 Status, ClosedBy, ClosedAt, ReopenedBy, ReopenedAt, ReopenReason, PeriodStart, PeriodEnd
          FROM ReconciliationPeriodClose WHERE BankAccountNo = @acc
            AND ((Status='CLOSED' AND PeriodStart<=@to AND PeriodEnd>=@from)
              OR (PeriodStart=@from AND PeriodEnd=@to))
          ORDER BY CASE WHEN Status='CLOSED' THEN 0 ELSE 1 END, PeriodStart
        `);
      const row = closeResult.recordset[0];
      periodClose = {
        status: (row?.Status as 'CLOSED' | 'REOPENED') ?? 'OPEN',
        closedBy: row?.ClosedBy ?? null,
        closedAt: row?.ClosedAt ?? null,
        reopenedBy: row?.ReopenedBy ?? null,
        reopenedAt: row?.ReopenedAt ?? null,
        reopenReason: row?.ReopenReason ?? null,
        periodStart: row ? isoDate(row.PeriodStart) : null,
        periodEnd: row ? isoDate(row.PeriodEnd) : null,
      };
    }

    const workflowReady = Boolean(periodClose) && await workApprovalReady(pool);
    const approvals = workflowReady ? await readWorkApprovals(pool, account.bankAccountNo) : [];
    const workApproval = {
      ready: workflowReady,
      permissions: await readWorkPermissions(auth.session, pool),
      approvals: approvals.filter((a) => a.periodStart <= isoDate(to) && a.periodEnd >= isoDate(from))
        .map((a) => ({ direction: a.direction, periodStart: a.periodStart, periodEnd: a.periodEnd,
          confirmedBy: a.confirmedBy, confirmedAt: a.confirmedAt, note: a.note })),
    };
    // เงื่อนไขปิดงวดตามสเปกใหม่ — โหมดเตือนอย่างเดียว ไม่ได้บล็อกการยืนยันงานหรือการปิดงวด
    const checks = evaluatePeriodChecks({
      period: proof.period,
      bank: {
        opening: proof.bank.opening,
        closing: proof.bank.closing,
        statementClosing: proof.bank.statementClosing,
        chainOk: proof.bank.chainOk,
        lineCount: proof.bank.lineCount,
        lastDateIn: proof.bank.lastDateIn,
        lastDateOut: proof.bank.lastDateOut,
      },
      gl: { opening: proof.gl.opening },
      bankUnmatched: proof.breakdown.bankUnmatchedByDirection,
      previousClose,
    });
    return NextResponse.json({ ...proof, periodClose, workApproval, checks });
  } catch (err) {
    console.error('Balance API error:', err);
    return NextResponse.json({ error: 'คำนวณยอดคงเหลือไม่สำเร็จ' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const auth = await requireRole(RECONCILE_ROLES);
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json().catch(() => null);
    const bankAccountNo = typeof body?.bankAccountNo === 'string' ? body.bankAccountNo : '';
    const periodStart = parseIsoDateParam(typeof body?.periodStart === 'string' ? body.periodStart : null);
    const amount = typeof body?.glOpeningBalance === 'number' ? body.glOpeningBalance : Number.NaN;
    if (!bankAccountNo) return badRequest('ต้องระบุบัญชีธนาคาร');
    if (!periodStart) return badRequest('วันที่เริ่มงวดไม่ถูกต้อง');
    // DECIMAL(18,2) รับได้ไม่เกิน 10^16 — กันค่าเพี้ยนก่อนถึง driver
    if (!Number.isFinite(amount) || Math.abs(amount) >= 1e15) return badRequest('ยอดยกมาไม่ถูกต้อง');

    if (!(await reconcileExtrasReady())) {
      return NextResponse.json({ error: EXTRAS_MIGRATION_HINT }, { status: 409 });
    }
    const account = await resolveBankAccount(bankAccountNo);
    if (!account) return badRequest('ไม่พบบัญชีธนาคารนี้');

    const pool = await getPool();
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
      if (await reconcilePeriodCloseReady()) {
        await assertDatesOpen(transaction, account.bankAccountNo, [isoDate(periodStart)]);
      }
      await new sql.Request(transaction)
        .input('acc', sql.NVarChar, account.bankAccountNo)
        .input('periodStart', sql.Date, periodStart)
        .input('amount', sql.Decimal(18, 2), round2(amount))
        .input('by', sql.NVarChar(100), auditActor(auth.session))
        .query(`
          MERGE ReconciliationOpeningBalance WITH (HOLDLOCK) AS t
          USING (SELECT @acc AS BankAccountNo, @periodStart AS PeriodStart) AS s
            ON t.BankAccountNo = s.BankAccountNo AND t.PeriodStart = s.PeriodStart
          WHEN MATCHED THEN
            UPDATE SET GlOpeningBalance = @amount, UpdatedBy = @by, UpdatedAt = SYSDATETIMEOFFSET()
          WHEN NOT MATCHED THEN
            INSERT (BankAccountNo, PeriodStart, GlOpeningBalance, CreatedBy)
            VALUES (@acc, @periodStart, @amount, @by);
        `);

      await transaction.commit();
      return NextResponse.json({ success: true });
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  } catch (err) {
    if (err instanceof PeriodClosedError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    console.error('Opening balance PUT error:', err);
    return NextResponse.json({ error: 'บันทึกยอดยกมาไม่สำเร็จ' }, { status: 500 });
  }
}
