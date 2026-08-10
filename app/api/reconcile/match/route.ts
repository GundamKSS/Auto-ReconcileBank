import { NextRequest, NextResponse } from 'next/server';
import sql from 'mssql';
import { getPool } from '../../../../lib/db';


type MatchGroup = {
  bankLineIds: number[];
  glEntryNos: number[];
};

type MatchRequestBody = {
  bankCode: string;
  matchType: 'MATCHED' | 'SUSPENSE';
  groups: MatchGroup[]; // แต่ละ group = 1 กลุ่มย่อย (Num) ภายใน MatchId เดียวกัน
  createdBy?: string;
};

export async function POST(req: NextRequest) {
  try {
    const body: MatchRequestBody = await req.json();
    const { bankCode, matchType, groups, createdBy } = body;

    if (!bankCode || !matchType) {
      return NextResponse.json({ error: 'ข้อมูลไม่ครบ' }, { status: 400 });
    }
    if (!groups || groups.length === 0) {
      return NextResponse.json({ error: 'ต้องมีอย่างน้อย 1 กลุ่ม' }, { status: 400 });
    }
    for (const g of groups) {
      if (matchType === 'MATCHED' && (g.bankLineIds.length === 0 || g.glEntryNos.length === 0)) {
        return NextResponse.json(
          { error: 'การ Match แต่ละกลุ่มต้องมีทั้งฝั่ง Bank และฝั่ง GL อย่างน้อยฝั่งละ 1 รายการ' },
          { status: 400 }
        );
      }
      const allIds = [...g.bankLineIds, ...g.glEntryNos];
      if (!allIds.every((id) => Number.isInteger(id))) {
        return NextResponse.json({ error: 'มีค่า id ที่ไม่ใช่จำนวนเต็ม' }, { status: 400 });
      }
    }

    const pool = await getPool();
    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      // 1 MatchId ต่อ 1 การกด Match ครั้งนี้ (ไม่ว่าจะมีกี่กลุ่มย่อยข้างในก็ตาม)
      const matchRequest = new sql.Request(transaction);
      const matchResult = await matchRequest
        .input('bankCode', sql.NVarChar, bankCode)
        .input('matchType', sql.NVarChar, matchType)
        .input('createdBy', sql.NVarChar, createdBy ?? null)
        .query(`
          INSERT INTO ReconciliationMatch (BankCode, MatchType, CreatedBy)
          OUTPUT INSERTED.MatchId
          VALUES (@bankCode, @matchType, @createdBy)
        `);
      const matchId = matchResult.recordset[0].MatchId;

      let num = 0;
      const allBankIds: number[] = [];

      for (const group of groups) {
        num += 1; // เลขกลุ่มย่อยเริ่มที่ 1 ไล่ขึ้นไปเรื่อยๆ ภายใน MatchId นี้

        for (const bankId of group.bankLineIds) {
          const r = new sql.Request(transaction);
          await r
            .input('matchId', sql.Int, matchId)
            .input('num', sql.Int, num)
            .input('bankLineId', sql.BigInt, bankId)
            .query(`INSERT INTO ReconciliationMatchLine (MatchId, Num, SourceType, BankLineId) VALUES (@matchId, @num, 'BANK', @bankLineId)`);
          allBankIds.push(bankId);
        }

        for (const glId of group.glEntryNos) {
          const r = new sql.Request(transaction);
          await r
            .input('matchId', sql.Int, matchId)
            .input('num', sql.Int, num)
            .input('glEntryNo', sql.BigInt, glId)
            .query(`INSERT INTO ReconciliationMatchLine (MatchId, Num, SourceType, GLEntryNo) VALUES (@matchId, @num, 'GL', @glEntryNo)`);
        }
      }

      // อัปเดตสถานะฝั่ง BankStatementLine รวดเดียวทั้งหมดที่อยู่ใน MatchId นี้
      if (allBankIds.length > 0) {
        const updateRequest = new sql.Request(transaction);
        await updateRequest.query(`
          UPDATE BankStatementLine SET MatchStatus = '${matchType}' WHERE LineId IN (${allBankIds.join(',')})
        `);
      }

      await transaction.commit();

      return NextResponse.json({ matchId, matchType, groupCount: groups.length, bankLineCount: allBankIds.length });
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  } catch (err) {
    console.error('Match API error:', err);
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `บันทึกการจับคู่ไม่สำเร็จ: ${detail}` }, { status: 500 });
  }
}