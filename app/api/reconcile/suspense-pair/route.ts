import { NextRequest, NextResponse } from 'next/server';
import sql from 'mssql';
import { getPool } from '../../../../lib/db';
import { auditActor, requireRole } from '../../../../lib/session';
import { RECONCILE_ROLES } from '../../../../lib/roles';
import { badRequest } from '../../../../lib/apiInput';
import { glAmount, glDirection, glSignedSql } from '../../../../lib/glAmount';
import { bankAccountColumnsReady } from '../../../../lib/bankAccountDb';
import { cancelledGlEntryNos } from '../../../../lib/cancelledGl';
import { assertWorkSides, readWorkPermissions, WorkPermissionError } from '../../../../lib/workRolesDb';
import { visibleWorkSides } from '../../../../lib/workRoles';
import {
  assertDatesOpen,
  findBlockingClosedPeriod,
  isoDate,
  reconcilePeriodCloseReady,
  type ClosedPeriodRange,
} from '../../../../lib/periodClose';
import {
  MAX_PAIR_CANDIDATES,
  MAX_PAIR_TARGETS,
  suggestStatementPairs,
  type OpenGlLine,
  type StatementLine,
  type SuspendedGlLine,
} from '../../../../lib/suspenseSuggest';

// ข้อมูลต้องสดทุกครั้ง — statement ที่เพิ่งจับคู่ไปต้องไม่โผล่เป็นคำแนะนำอีก
export const dynamic = 'force-dynamic';

// ผลต่างที่ยอมรับได้ — ต้องตรงกับ AMOUNT_TOLERANCE ใน api/reconcile/match
const AMOUNT_TOLERANCE = 0.005;

const ACCOUNT_MIGRATION_HINT =
  'ต้องรัน sql/006_bank_statement_bank_account.sql ก่อน จึงจะหาคู่ใน statement ตามบัญชีได้';

type ClosedPeriodRow = { PeriodStart: Date | string; PeriodEnd: Date | string; ClosedBy: string | null };

function toClosedRange(row: ClosedPeriodRow): ClosedPeriodRange {
  return { periodStart: isoDate(row.PeriodStart), periodEnd: isoDate(row.PeriodEnd), closedBy: String(row.ClosedBy ?? '') };
}

// งวดที่ปิดแล้ว (Status CLOSED) ของบัญชีนี้ที่ครอบวันที่นี้ หรือ null — ใช้หลังล็อกบัญชีแล้ว (ใน transaction เดียวกัน)
async function closedPeriodContaining(transaction: sql.Transaction, accountNo: string, date: string) {
  const result = await new sql.Request(transaction)
    .input('acc', sql.NVarChar, accountNo)
    .query(`SELECT PeriodStart, PeriodEnd, ClosedBy FROM ReconciliationPeriodClose WHERE BankAccountNo = @acc AND Status = 'CLOSED'`);
  return findBlockingClosedPeriod([date], (result.recordset as ClosedPeriodRow[]).map(toClosedRange));
}

function parseIdList(raw: string | null): number[] | null {
  if (!raw) return null;
  const ids = raw.split(',').map((v) => v.trim()).filter(Boolean).map(Number);
  if (ids.length === 0 || ids.some((n) => !Number.isInteger(n) || n <= 0 || n > Number.MAX_SAFE_INTEGER)) return null;
  return [...new Set(ids)];
}

/**
 * GET /api/reconcile/suspense-pair — หาคู่ใน statement ให้รายการพัก (อ่านอย่างเดียว ไม่บันทึกอะไร)
 *
 * Query params:
 *   entryNos - Entry No. ของรายการ BC365 ที่อยู่ในรายการพัก คั่นด้วย comma (ไม่เกิน 200 รายการต่อครั้ง)
 *   limit    - จำนวน statement ที่ส่งกลับต่อรายการพัก 1-50 (ค่าเริ่มต้น 1 = ตัวที่น่าจะใช่ที่สุด ใช้กับป้ายในตาราง)
 *
 * ตอบ items เฉพาะรายการที่ยังพักอยู่จริงและผู้ใช้มีสิทธิ์เห็นฝั่งนั้น (AP เห็นเงินออก AR เห็นเงินเข้า)
 * พร้อม closedPeriod = งวดที่ปิดแล้วซึ่งครอบวันที่ของรายการพัก (ถ้ามี) ให้หน้าจอเตือนก่อนยืนยัน
 * statement ที่หาให้ = ยังไม่จับคู่ บัญชีเดียวกัน ทิศทางเดียวกัน ยอดตรงกันพอดี ได้ทุกเดือน (กติกาใน lib/suspenseSuggest.ts)
 * ไม่รวมบรรทัด statement ที่ยังไม่ระบุบัญชี (ไฟล์เก่าก่อน sql/006) เพราะยืนยันไม่ได้ว่าเป็นบัญชีเดียวกัน
 */
export async function GET(req: NextRequest) {
  const auth = await requireRole(RECONCILE_ROLES);
  if (!auth.ok) return auth.response;

  try {
    const params = req.nextUrl.searchParams;
    const entryNos = parseIdList(params.get('entryNos'));
    if (!entryNos) return badRequest('ต้องระบุ entryNos เป็นเลขรายการ BC365 คั่นด้วย comma');
    if (entryNos.length > MAX_PAIR_TARGETS) return badRequest(`ขอได้ไม่เกิน ${MAX_PAIR_TARGETS} รายการต่อครั้ง`);
    const rawLimit = params.get('limit');
    const limit = rawLimit === null ? 1 : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAIR_CANDIDATES) {
      return badRequest(`limit ต้องเป็นจำนวนเต็ม 1 ถึง ${MAX_PAIR_CANDIDATES}`);
    }
    if (!(await bankAccountColumnsReady())) return NextResponse.json({ error: ACCOUNT_MIGRATION_HINT }, { status: 409 });

    const pool = await getPool();
    const [permissions, cancelled, targetResult] = await Promise.all([
      readWorkPermissions(auth.session, pool),
      cancelledGlEntryNos(pool),
      // entryNos ผ่าน Number.isInteger ครบทุกตัวแล้ว ต่อเข้า IN(...) ได้ปลอดภัย
      pool.request().query(`
        SELECT rml.MatchId, e.Entry_No, e.Posting_Date, e.Bank_Account_No, e.Debit_Amount_LCY, e.Credit_Amount_LCY
        FROM ReconciliationMatchLine rml
        JOIN ReconciliationMatch rm ON rm.MatchId = rml.MatchId AND rm.MatchType = 'SUSPENSE' AND rm.Status = 'ACTIVE'
        JOIN BankAccountLedgerEntries e ON e.Entry_No = rml.GLEntryNo
        WHERE rml.SourceType = 'GL' AND rml.Status = 'ACTIVE' AND rml.GLEntryNo IN (${entryNos.join(',')})
      `),
    ]);

    // สิทธิ์ฝั่งเดียวเห็นได้แค่รายการพักฝั่งของตัวเอง — กติกาเดียวกับ /api/history ของหน้ารายการพัก
    const visibleSides = visibleWorkSides(permissions);
    const targets: SuspendedGlLine[] = targetResult.recordset
      .map((r) => ({
        entryNo: Number(r.Entry_No),
        matchId: Number(r.MatchId),
        accountNo: String(r.Bank_Account_No ?? ''),
        date: isoDate(r.Posting_Date),
        direction: glDirection(r),
        amount: glAmount(r),
      }))
      .filter((t) => t.accountNo && t.amount > 0 && visibleSides.includes(t.direction) && !cancelled.has(t.entryNo));
    if (targets.length === 0) return NextResponse.json({ items: [] });

    // ดึงเฉพาะบัญชีและยอดที่เกี่ยวข้อง แล้วให้ lib คัดคีย์ บัญชี + ทิศทาง + ยอด ให้ตรงอีกชั้น
    const accounts = [...new Set(targets.map((t) => t.accountNo))];
    const centsList = [...new Set(targets.map((t) => Math.round(t.amount * 100)))].join(',');
    const accountParams = accounts.map((_, i) => `@acc${i}`).join(', ');
    const bindAccounts = (request: sql.Request) => {
      accounts.forEach((acc, i) => request.input(`acc${i}`, sql.NVarChar, acc));
      return request;
    };

    const periodCloseReady = await reconcilePeriodCloseReady();
    const [bankResult, glResult, closedResult] = await Promise.all([
      bindAccounts(pool.request()).query(`
        SELECT b.LineId, b.BankAccountNo, b.TranDate, b.Description, b.ChequeNo, b.Debit, b.Credit
        FROM BankStatementLine b
        WHERE b.MatchStatus = 'UNMATCHED' AND b.BankAccountNo IN (${accountParams})
          AND CAST(ROUND(ABS(CASE WHEN b.Credit IS NOT NULL THEN b.Credit ELSE b.Debit END) * 100, 0) AS BIGINT) IN (${centsList})
      `),
      // BC365 ยอดเดียวกันทั้งที่ยังไม่จับคู่และที่พักไว้ — ใช้นับคู่แข่งของ statement แต่ละบรรทัด
      bindAccounts(pool.request()).query(`
        SELECT e.Entry_No, e.Bank_Account_No, e.Posting_Date, e.Debit_Amount_LCY, e.Credit_Amount_LCY,
               am.MatchId, am.MatchType
        FROM BankAccountLedgerEntries e
        OUTER APPLY (
          SELECT TOP 1 rm.MatchId, rm.MatchType
          FROM ReconciliationMatchLine rml
          JOIN ReconciliationMatch rm ON rm.MatchId = rml.MatchId AND rm.Status = 'ACTIVE'
          WHERE rml.SourceType = 'GL' AND rml.Status = 'ACTIVE' AND rml.GLEntryNo = e.Entry_No
        ) am
        WHERE e.Bank_Account_No IN (${accountParams})
          AND CAST(ROUND(ABS(${glSignedSql('e')}) * 100, 0) AS BIGINT) IN (${centsList})
      `),
      periodCloseReady
        ? bindAccounts(pool.request()).query(`
            SELECT BankAccountNo, PeriodStart, PeriodEnd, ClosedBy FROM ReconciliationPeriodClose
            WHERE Status = 'CLOSED' AND BankAccountNo IN (${accountParams})
          `)
        : null,
    ]);

    const closedByAccount = new Map<string, ClosedPeriodRange[]>();
    for (const r of closedResult?.recordset ?? []) {
      const list = closedByAccount.get(String(r.BankAccountNo)) ?? [];
      list.push(toClosedRange(r));
      closedByAccount.set(String(r.BankAccountNo), list);
    }

    const statementLines: StatementLine[] = bankResult.recordset.map((r) => ({
      lineId: Number(r.LineId),
      accountNo: String(r.BankAccountNo),
      date: isoDate(r.TranDate),
      direction: r.Credit !== null ? 'IN' : 'OUT',
      amount: Math.abs(Number(r.Credit !== null ? r.Credit : r.Debit)),
      description: r.Description ?? '',
      chequeNo: r.ChequeNo && r.ChequeNo !== '0' ? String(r.ChequeNo) : null,
    }));

    const suspendedGl: SuspendedGlLine[] = [];
    const openGl: OpenGlLine[] = [];
    for (const r of glResult.recordset) {
      const line = {
        entryNo: Number(r.Entry_No),
        accountNo: String(r.Bank_Account_No ?? ''),
        date: isoDate(r.Posting_Date),
        direction: glDirection(r),
        amount: glAmount(r),
      };
      // รายการที่ถูกกลับรายการใน BC365 จับคู่กับ statement ไม่ได้อยู่แล้ว จึงไม่นับเป็นคู่แข่งทั้งสองแบบ
      if (cancelled.has(line.entryNo)) continue;
      if (r.MatchType === 'SUSPENSE') suspendedGl.push({ ...line, matchId: Number(r.MatchId) });
      else if (r.MatchId === null) openGl.push(line);
    }

    const items = targets.map((target) => {
      const closed = findBlockingClosedPeriod([target.date], closedByAccount.get(target.accountNo) ?? []);
      return {
        ...suggestStatementPairs({ target, statementLines, suspendedGl, openGl, limit }),
        closedPeriod: closed ? { periodStart: closed.periodStart, periodEnd: closed.periodEnd } : null,
      };
    });
    return NextResponse.json({ items });
  } catch (err) {
    console.error('Suspense pair suggestions API error:', err);
    return NextResponse.json({ error: 'หาคู่ใน statement ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' }, { status: 500 });
  }
}

/**
 * POST /api/reconcile/suspense-pair — ผู้ใช้ยืนยันว่ารายการพักนี้คือ statement บรรทัดนี้
 * body: { matchId, entryNo, bankLineId }
 *
 * ทำใน transaction เดียว: เอารายการ BC365 ออกจากรายการพัก (ลบหัวรายการพักถ้าไม่เหลือบรรทัด แบบเดียวกับ
 * /api/reconcile/unsuspend) แล้วสร้างคู่ MATCHED ใหม่กับ statement แบบเดียวกับ /api/reconcile/match
 * จับคู่จากหน้านี้ได้เฉพาะ 1 ต่อ 1 ที่ยอดตรงกันพอดีเท่านั้น ยอดต่างกันต้องคืนไปจับคู่ที่หน้ากระทบยอด
 *
 * ล็อกงวด (ผู้ใช้ตัดสินใจ 2 พ.ย. 2026 ตาม spec ข้อ E.25 ใน docs/spec-matching-period-close.md):
 *   statement ต้องอยู่ในงวดที่ยังเปิด และฝั่งนั้นยังไม่ยืนยันงาน เหมือนจุดอื่นที่แก้ข้อมูล
 *   รายการพักที่อยู่ในงวดที่ปิดแล้ว จับคู่กับ statement งวดที่ยังเปิดได้ — ยอดคงเหลือของงวดที่ปิดไม่เปลี่ยน
 *   แค่ย้ายจากยอดพักไปเป็นคู่ข้ามงวด แต่ถ้าจับคู่ผิด ต้องเปิดงวดนั้นคืนก่อนจึงจะยกเลิกได้ (unmatch ยังล็อกตามเดิม)
 *   รายการพักที่งวดยังไม่ปิดแต่ฝั่งนั้นยืนยันงานแล้ว ยังห้ามเหมือนเดิม ไม่งั้นข้อมูลเปลี่ยนหลังยืนยันจนปิดงวดไม่ได้
 */
export async function POST(req: NextRequest) {
  const auth = await requireRole(RECONCILE_ROLES);
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json().catch(() => null);
    const matchId = body?.matchId;
    const entryNo = body?.entryNo;
    const bankLineId = body?.bankLineId;
    if (![matchId, entryNo, bankLineId].every((v) => Number.isInteger(v) && v > 0 && v <= Number.MAX_SAFE_INTEGER)) {
      return badRequest('รูปแบบรายการที่เลือกไม่ถูกต้อง');
    }
    if (!(await bankAccountColumnsReady())) return NextResponse.json({ error: ACCOUNT_MIGRATION_HINT }, { status: 409 });

    // ผู้ทำรายการอ่านจาก session cookie ที่เซ็นไว้เท่านั้น เหมือน /api/reconcile/match
    const createdBy = auditActor(auth.session);
    const pool = await getPool();
    const cancelled = await cancelledGlEntryNos(pool);
    const periodCloseReady = await reconcilePeriodCloseReady();
    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      const glResult = await new sql.Request(transaction)
        .input('matchId', sql.Int, matchId)
        .input('entryNo', sql.BigInt, entryNo)
        .query(`
          SELECT e.Bank_Account_No, e.Posting_Date, e.Debit_Amount_LCY, e.Credit_Amount_LCY
          FROM ReconciliationMatchLine rml
          JOIN ReconciliationMatch rm ON rm.MatchId = rml.MatchId AND rm.MatchType = 'SUSPENSE' AND rm.Status = 'ACTIVE'
          JOIN BankAccountLedgerEntries e ON e.Entry_No = rml.GLEntryNo
          WHERE rml.MatchId = @matchId AND rml.SourceType = 'GL' AND rml.GLEntryNo = @entryNo AND rml.Status = 'ACTIVE'
        `);
      const gl = glResult.recordset[0];
      if (!gl) throw new Error('ไม่พบรายการพักนี้แล้ว อาจถูกคืนหรือจับคู่ไปแล้ว กรุณารีเฟรชหน้าใหม่');
      if (cancelled.has(entryNo)) throw new Error('รายการ BC365 นี้ถูกกลับรายการใน BC365 แล้ว จับคู่กับ statement ไม่ได้');

      const bankResult = await new sql.Request(transaction)
        .input('lineId', sql.BigInt, bankLineId)
        .query(`
          SELECT LineId, BankCode, BankAccountNo, TranDate, Debit, Credit, UPPER(MatchStatus) AS MatchStatus
          FROM BankStatementLine WHERE LineId = @lineId
        `);
      const bank = bankResult.recordset[0];
      if (!bank) throw new Error('ไม่พบรายการ statement นี้ในระบบ กรุณารีเฟรชหน้าใหม่');
      if (bank.MatchStatus !== 'UNMATCHED') throw new Error('รายการ statement นี้ถูกจับคู่หรือถูกลบไปแล้ว กรุณารีเฟรชหน้าใหม่');

      const accountNo = String(gl.Bank_Account_No ?? '');
      if (!accountNo || bank.BankAccountNo !== accountNo) {
        throw new Error(`statement รายการนี้ไม่ใช่บัญชี ${accountNo || 'เดียวกับรายการพัก'} จับคู่ข้ามบัญชีไม่ได้`);
      }
      const direction = glDirection(gl);
      if ((bank.Credit !== null ? 'IN' : 'OUT') !== direction) {
        throw new Error('รายการหนึ่งเป็นเงินเข้า อีกรายการเป็นเงินออก จับคู่ไม่ได้');
      }
      const bankAmount = Math.abs(Number(bank.Credit !== null ? bank.Credit : bank.Debit));
      if (Math.abs(bankAmount - glAmount(gl)) >= AMOUNT_TOLERANCE) {
        throw new Error('ยอดเงินสองรายการไม่เท่ากัน หน้านี้จับคู่ได้เฉพาะยอดที่ตรงกันพอดี ยอดต่างกันให้คืนไปจับคู่ที่หน้ากระทบยอด');
      }

      if (periodCloseReady) {
        // ตรวจ statement ก่อน — assertDatesOpen ล็อกบัญชีไว้จนจบ transaction สถานะงวดที่อ่านต่อจากนี้จึงเปลี่ยนกลางทางไม่ได้
        await assertDatesOpen(transaction, accountNo, [{ date: isoDate(bank.TranDate), direction }]);
        const glDate = isoDate(gl.Posting_Date);
        if (!(await closedPeriodContaining(transaction, accountNo, glDate))) {
          await assertDatesOpen(transaction, accountNo, [{ date: glDate, direction }]);
        }
      }
      await assertWorkSides(auth.session, [direction], transaction);

      // เขียนแบบมีเงื่อนไขสถานะเดิม แล้วนับแถวที่โดน — กันอีกคนคืนรายการพักหรือจับคู่ statement ตัดหน้าระหว่างนี้
      const removed = await new sql.Request(transaction)
        .input('matchId', sql.Int, matchId)
        .input('entryNo', sql.BigInt, entryNo)
        .query(`
          DELETE FROM ReconciliationMatchLine
          WHERE MatchId = @matchId AND SourceType = 'GL' AND GLEntryNo = @entryNo AND Status = 'ACTIVE'
        `);
      if (removed.rowsAffected[0] !== 1) throw new Error('รายการพักนี้เพิ่งถูกแก้ไข กรุณารีเฟรชหน้าใหม่');

      const remain = await new sql.Request(transaction)
        .input('matchId', sql.Int, matchId)
        .query(`SELECT COUNT(*) AS cnt FROM ReconciliationMatchLine WHERE MatchId = @matchId`);
      let clearedSuspenseMatchId: number | null = null;
      if (Number(remain.recordset[0]?.cnt ?? 0) === 0) {
        await new sql.Request(transaction)
          .input('matchId', sql.Int, matchId)
          .query(`DELETE FROM ReconciliationMatch WHERE MatchId = @matchId`);
        clearedSuspenseMatchId = matchId;
      }

      const taken = await new sql.Request(transaction)
        .input('lineId', sql.BigInt, bankLineId)
        .query(`UPDATE BankStatementLine SET MatchStatus = 'MATCHED' WHERE LineId = @lineId AND MatchStatus = 'UNMATCHED'`);
      if (taken.rowsAffected[0] !== 1) throw new Error('รายการ statement นี้เพิ่งถูกจับคู่ไป กรุณารีเฟรชหน้าใหม่');

      const inserted = await new sql.Request(transaction)
        .input('bankCode', sql.NVarChar, bank.BankCode)
        .input('bankAccountNo', sql.NVarChar, accountNo)
        .input('createdBy', sql.NVarChar, createdBy)
        .query(`
          INSERT INTO ReconciliationMatch (BankCode, BankAccountNo, MatchType, CreatedBy)
          OUTPUT INSERTED.MatchId
          VALUES (@bankCode, @bankAccountNo, 'MATCHED', @createdBy)
        `);
      const newMatchId = Number(inserted.recordset[0].MatchId);

      await new sql.Request(transaction)
        .input('matchId', sql.Int, newMatchId)
        .input('bankLineId', sql.BigInt, bankLineId)
        .input('glEntryNo', sql.BigInt, entryNo)
        .query(`
          INSERT INTO ReconciliationMatchLine (MatchId, Num, SourceType, BankLineId) VALUES (@matchId, 1, 'BANK', @bankLineId);
          INSERT INTO ReconciliationMatchLine (MatchId, Num, SourceType, GLEntryNo) VALUES (@matchId, 1, 'GL', @glEntryNo);
        `);

      await transaction.commit();
      return NextResponse.json({ matchId: newMatchId, clearedSuspenseMatchId, bankAccountNo: accountNo });
    } catch (err) {
      await transaction.rollback();
      // ข้อผิดพลาดที่โยนเองข้างบนเป็นเรื่องของข้อมูลที่เลือกมา ตอบ 409 พร้อมข้อความตรงๆ เหมือน /api/reconcile/match
      if (err instanceof WorkPermissionError) return NextResponse.json({ error: err.message }, { status: err.status });
      if (err instanceof Error) return NextResponse.json({ error: err.message }, { status: 409 });
      throw err;
    }
  } catch (err) {
    console.error('Suspense pair API error:', err);
    return NextResponse.json({ error: 'จับคู่กับ statement ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' }, { status: 500 });
  }
}
