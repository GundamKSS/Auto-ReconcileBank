import { NextRequest, NextResponse } from 'next/server';
import sql from 'mssql';
import { getPool } from '../../../../../../lib/db';

// DELETE /api/master/bank-statement/imports/:importId
// ลบทั้ง batch (header + ทุก line ข้างใน) — บล็อกทั้งชุดถ้ามีแม้แต่ 1 รายการที่จับคู่ไปแล้ว
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ importId: string }> }) {
  try {
    const { importId } = await params;
    const pool = await getPool();

    const matchedCheck = await pool
      .request()
      .input('importId', sql.Int, Number(importId))
      .query(`
        SELECT COUNT(*) AS MatchedCount
        FROM BankStatementLine
        WHERE ImportId = @importId AND MatchStatus <> 'UNMATCHED'
      `);

    const matchedCount = matchedCheck.recordset[0].MatchedCount;
    if (matchedCount > 0) {
      return NextResponse.json(
        {
          error: `ลบไม่ได้ เพราะมี ${matchedCount} รายการในไฟล์นี้ถูกจับคู่ไปแล้ว (MATCHED/SUSPENSE) — ลบทั้งไฟล์จะทำให้ประวัติการจับคู่เพี้ยน`,
        },
        { status: 409 }
      );
    }

    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
      const req1 = new sql.Request(transaction);
      await req1.input('importId', sql.Int, Number(importId)).query(`DELETE FROM BankStatementLine WHERE ImportId = @importId`);

      const req2 = new sql.Request(transaction);
      await req2.input('importId', sql.Int, Number(importId)).query(`DELETE FROM BankStatementImport WHERE ImportId = @importId`);

      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Master bank-statement import DELETE error:', err);
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `ลบไม่สำเร็จ: ${detail}` }, { status: 500 });
  }
}
