import { NextRequest, NextResponse } from 'next/server';
import sql from 'mssql';
import { getPool } from '../../../../lib/db';
import { requireRole } from '../../../../lib/session';
import { RECONCILE_ROLES } from '../../../../lib/roles';

type UnsuspendItem = {
  matchId: number;
  sourceType: 'BANK' | 'GL';
  refId: number; // BankLineId (SourceType='BANK') หรือ GLEntryNo (SourceType='GL')
};

export async function POST(req: NextRequest) {
  const auth = await requireRole(RECONCILE_ROLES);
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json();
    const items: UnsuspendItem[] = body?.items;

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'ไม่มีรายการที่เลือก' }, { status: 400 });
    }
    for (const it of items) {
      const validSource = it?.sourceType === 'BANK' || it?.sourceType === 'GL';
      if (!Number.isInteger(it?.matchId) || !Number.isInteger(it?.refId) || !validSource) {
        return NextResponse.json({ error: 'รูปแบบรายการที่เลือกไม่ถูกต้อง' }, { status: 400 });
      }
    }

    const byMatch = new Map<number, { bank: number[]; gl: number[] }>();
    for (const it of items) {
      const g = byMatch.get(it.matchId) ?? { bank: [], gl: [] };
      if (it.sourceType === 'BANK') g.bank.push(it.refId);
      else g.gl.push(it.refId);
      byMatch.set(it.matchId, g);
    }

    const pool = await getPool();
    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      let revertedBankLineCount = 0;
      const clearedMatchIds: number[] = [];

      for (const [matchId, group] of byMatch) {
        const matchCheck = new sql.Request(transaction);
        const matchResult = await matchCheck
          .input('matchId', sql.Int, matchId)
          .query(`SELECT MatchType FROM ReconciliationMatch WHERE MatchId = @matchId`);

        if (matchResult.recordset.length === 0) {
          throw new Error(`ไม่พบ MatchId ${matchId} — อาจถูกดึงกลับไปแล้ว กรุณารีเฟรชหน้าใหม่`);
        }
        if (matchResult.recordset[0].MatchType !== 'SUSPENSE') {
          throw new Error(`MatchId ${matchId} ไม่ใช่รายการ Suspense`);
        }

        for (const lineId of group.bank) {
          const del = new sql.Request(transaction);
          await del
            .input('matchId', sql.Int, matchId)
            .input('lineId', sql.BigInt, lineId)
            .query(
              `DELETE FROM ReconciliationMatchLine WHERE MatchId = @matchId AND SourceType = 'BANK' AND BankLineId = @lineId`
            );
          const upd = new sql.Request(transaction);
          await upd
            .input('lineId', sql.BigInt, lineId)
            .query(`UPDATE BankStatementLine SET MatchStatus = 'UNMATCHED' WHERE LineId = @lineId`);
          revertedBankLineCount += 1;
        }

        for (const entryNo of group.gl) {
          const del = new sql.Request(transaction);
          await del
            .input('matchId', sql.Int, matchId)
            .input('entryNo', sql.BigInt, entryNo)
            .query(
              `DELETE FROM ReconciliationMatchLine WHERE MatchId = @matchId AND SourceType = 'GL' AND GLEntryNo = @entryNo`
            );
        }

        const remain = new sql.Request(transaction);
        const remainResult = await remain
          .input('matchId', sql.Int, matchId)
          .query(`SELECT COUNT(*) AS cnt FROM ReconciliationMatchLine WHERE MatchId = @matchId`);

        if (remainResult.recordset[0].cnt === 0) {
          const delMatch = new sql.Request(transaction);
          await delMatch.input('matchId', sql.Int, matchId).query(`DELETE FROM ReconciliationMatch WHERE MatchId = @matchId`);
          clearedMatchIds.push(matchId);
        }
      }

      await transaction.commit();
      return NextResponse.json({ revertedBankLineCount, clearedMatchIds });
    } catch (err) {
      await transaction.rollback();
      // ไม่พบ MatchId / ไม่ใช่รายการ Suspense = ข้อมูลที่เลือกมาไม่ตรงกับของจริงแล้ว ตอบ 409
      if (err instanceof Error) {
        return NextResponse.json({ error: err.message }, { status: 409 });
      }
      throw err;
    }
  } catch (err) {
    console.error('Unsuspend API error:', err);
    return NextResponse.json({ error: 'ดึงกลับไป Reconcile ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' }, { status: 500 });
  }
}
