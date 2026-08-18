import { NextRequest, NextResponse } from 'next/server';
import sql from 'mssql';
import { getPool } from '../../../../lib/db';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const matchId = Number(body?.matchId);

    if (!Number.isInteger(matchId)) {
      return NextResponse.json({ error: 'matchId ไม่ถูกต้อง' }, { status: 400 });
    }

    const pool = await getPool();
    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      const matchRequest = new sql.Request(transaction);
      const matchResult = await matchRequest
        .input('matchId', sql.Int, matchId)
        .query(`SELECT MatchId, MatchType FROM ReconciliationMatch WHERE MatchId = @matchId`);

      if (matchResult.recordset.length === 0) {
        await transaction.rollback();
        return NextResponse.json({ error: 'ไม่พบรายการที่พักไว้นี้' }, { status: 404 });
      }
      if (matchResult.recordset[0].MatchType !== 'SUSPENSE') {
        await transaction.rollback();
        return NextResponse.json({ error: 'รายการนี้ไม่ใช่ Suspense' }, { status: 400 });
      }

      const bankLinesRequest = new sql.Request(transaction);
      const bankLinesResult = await bankLinesRequest
        .input('matchId', sql.Int, matchId)
        .query(`SELECT BankLineId FROM ReconciliationMatchLine WHERE MatchId = @matchId AND SourceType = 'BANK'`);
      const bankLineIds: number[] = bankLinesResult.recordset.map((r) => Number(r.BankLineId));

      for (const lineId of bankLineIds) {
        const r = new sql.Request(transaction);
        await r
          .input('lineId', sql.BigInt, lineId)
          .query(`UPDATE BankStatementLine SET MatchStatus = 'UNMATCHED' WHERE LineId = @lineId`);
      }

      const deleteLinesRequest = new sql.Request(transaction);
      await deleteLinesRequest
        .input('matchId', sql.Int, matchId)
        .query(`DELETE FROM ReconciliationMatchLine WHERE MatchId = @matchId`);

      const deleteMatchRequest = new sql.Request(transaction);
      await deleteMatchRequest
        .input('matchId', sql.Int, matchId)
        .query(`DELETE FROM ReconciliationMatch WHERE MatchId = @matchId`);

      await transaction.commit();

      return NextResponse.json({ matchId, revertedBankLineCount: bankLineIds.length });
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  } catch (err) {
    console.error('Unsuspend API error:', err);
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `ดึงกลับไป Reconcile ไม่สำเร็จ: ${detail}` }, { status: 500 });
  }
}
