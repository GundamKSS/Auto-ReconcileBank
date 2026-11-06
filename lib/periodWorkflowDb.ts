import sql from 'mssql';
import { createHash } from 'node:crypto';
import { glSignedSql } from './glAmount';
import type { WorkApproval, WorkDirection } from './periodWorkflow';

type Connection = sql.ConnectionPool | sql.Transaction;
const requestFor = (connection: Connection) => connection instanceof sql.Transaction
  ? new sql.Request(connection) : new sql.Request(connection);
export const WORK_APPROVAL_MIGRATION_HINT = 'ต้องรัน sql/009_period_work_approval.sql ก่อนใช้งานการยืนยัน AP/AR และปิดงวดรวม';

// No negative cache: a migration becomes available immediately; failures must not silently unlock work.
export async function workApprovalReady(connection: Connection): Promise<boolean> {
  const result = await requestFor(connection).query(`
    SELECT CASE WHEN OBJECT_ID('dbo.ReconciliationWorkApproval', 'U') IS NOT NULL
      AND OBJECT_ID('dbo.ReconciliationPeriodEvent', 'U') IS NOT NULL THEN 1 ELSE 0 END AS Ready
  `);
  return Number(result.recordset[0]?.Ready) === 1;
}

// All app reconciliation writes and approvals use the same transaction-owned account lock.
export async function lockReconciliationAccount(connection: sql.Transaction, account: string) {
  const result = await new sql.Request(connection)
    .input('resource', sql.NVarChar(255), `reconciliation:${account.toUpperCase()}`)
    .query(`DECLARE @r INT;
      EXEC @r = sp_getapplock @Resource=@resource, @LockMode='Exclusive',
        @LockOwner='Transaction', @LockTimeout=10000;
      SELECT @r AS Result;`);
  if (Number(result.recordset[0]?.Result ?? -1) < 0) {
    throw new Error('บัญชีนี้กำลังมีผู้บันทึกข้อมูล กรุณาลองใหม่อีกครั้ง');
  }
}

export async function readWorkApprovals(connection: Connection, account: string): Promise<(WorkApproval & { fingerprint: string })[]> {
  const result = await requestFor(connection).input('account', sql.NVarChar, account).query(`
    SELECT PeriodStart, PeriodEnd, Direction, ConfirmedBy, ConfirmedAt, Note, DataFingerprint
    FROM ReconciliationWorkApproval WHERE BankAccountNo = @account ORDER BY PeriodStart, Direction
  `);
  return result.recordset.map((r) => ({
    direction: r.Direction,
    periodStart: new Date(r.PeriodStart).toISOString().slice(0, 10),
    periodEnd: new Date(r.PeriodEnd).toISOString().slice(0, 10),
    confirmedBy: r.ConfirmedBy,
    confirmedAt: new Date(r.ConfirmedAt).toISOString(),
    note: r.Note,
    fingerprint: r.DataFingerprint,
  }));
}

// Detect source changes by ERP sync (outside this app's transaction locks) before final closing.
export async function workFingerprint(connection: Connection, account: string, bankCode: string | null,
  from: Date, to: Date, direction: WorkDirection): Promise<string> {
  const bind = () => requestFor(connection).input('acc', sql.NVarChar, account)
    .input('bank', sql.NVarChar, bankCode).input('from', sql.Date, from).input('to', sql.Date, to)
    .input('direction', sql.NVarChar, direction);
  const bank = await bind().query(`
    SELECT b.LineId, b.TranDate, b.Debit, b.Credit, b.Balance, b.MatchStatus, b.Description
    FROM BankStatementLine b WITH (HOLDLOCK)
    WHERE (b.BankAccountNo=@acc OR (b.BankAccountNo IS NULL AND b.BankCode=@bank))
      AND b.MatchStatus <> 'DELETED' AND b.TranDate BETWEEN @from AND @to
      AND CASE WHEN b.Credit IS NOT NULL THEN 'IN' ELSE 'OUT' END = @direction
    ORDER BY b.LineId
  `);
  const gl = await bind().query(`
    SELECT g.Entry_No, g.Posting_Date, g.Document_No, g.Debit_Amount_LCY, g.Credit_Amount_LCY,
      g.Source_Code, rml.MatchId, rml.Num, rm.MatchType
    FROM BankAccountLedgerEntries g WITH (HOLDLOCK)
    LEFT JOIN ReconciliationMatchLine rml ON rml.GLEntryNo=g.Entry_No AND rml.SourceType='GL' AND rml.Status='ACTIVE'
    LEFT JOIN ReconciliationMatch rm ON rm.MatchId=rml.MatchId AND rm.Status='ACTIVE'
    WHERE g.Bank_Account_No=@acc AND g.Posting_Date BETWEEN @from AND @to
      AND CASE WHEN ${glSignedSql('g')} > 0 THEN 'IN' ELSE 'OUT' END = @direction
    ORDER BY g.Entry_No, rml.MatchId, rml.Num
  `);
  return createHash('sha256').update(JSON.stringify([bank.recordset, gl.recordset])).digest('hex');
}

export async function recordPeriodEvent(connection: Connection, account: string, from: Date, to: Date,
  action: 'CONFIRM' | 'REOPEN_WORK' | 'CLOSE' | 'REOPEN_PERIOD', direction: WorkDirection | null,
  actor: string, reason: string) {
  await requestFor(connection).input('acc', sql.NVarChar, account)
    .input('from', sql.Date, from).input('to', sql.Date, to).input('action', sql.NVarChar, action)
    .input('direction', sql.NVarChar, direction).input('actor', sql.NVarChar, actor)
    .input('reason', sql.NVarChar(500), reason).query(`
      INSERT INTO ReconciliationPeriodEvent (BankAccountNo, PeriodStart, PeriodEnd, Action, Direction, Actor, Reason)
      VALUES (@acc, @from, @to, @action, @direction, @actor, @reason)
    `);
}
