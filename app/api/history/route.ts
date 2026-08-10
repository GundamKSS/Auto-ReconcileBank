import { NextRequest, NextResponse } from 'next/server';
import sql from 'mssql';
import { getPool } from '../../../lib/db';


export async function GET(req: NextRequest) {
  try {
    const bankCode = req.nextUrl.searchParams.get('bankCode');
    const pool = await getPool();

    // 1) หัวบันทึกทุก match (ล่าสุดก่อน)
    const headerRequest = pool.request();
    if (bankCode) headerRequest.input('bankCode', sql.NVarChar, bankCode);
    const headerResult = await headerRequest.query(`
      SELECT MatchId, BankCode, MatchType, CreatedBy, CreatedAt
      FROM ReconciliationMatch
      WHERE 1=1 ${bankCode ? 'AND BankCode = @bankCode' : ''}
      ORDER BY CreatedAt DESC, MatchId DESC
    `);

    // 2) รายละเอียดฝั่ง Bank ของทุก match (join กลับ BankStatementLine) — ดึง Num มาด้วยเพื่อรู้ว่าอยู่กลุ่มย่อยไหน
    const bankLinesRequest = pool.request();
    if (bankCode) bankLinesRequest.input('bankCode', sql.NVarChar, bankCode);
    const bankLinesResult = await bankLinesRequest.query(`
      SELECT rm.MatchId, rml.Num, bsl.LineId, bsl.TranDate, bsl.Description, bsl.Debit, bsl.Credit
      FROM ReconciliationMatch rm
      JOIN ReconciliationMatchLine rml ON rml.MatchId = rm.MatchId AND rml.SourceType = 'BANK'
      JOIN BankStatementLine bsl ON bsl.LineId = rml.BankLineId
      WHERE 1=1 ${bankCode ? 'AND rm.BankCode = @bankCode' : ''}
    `);

    // 3) รายละเอียดฝั่ง GL ของทุก match (join กลับ BankAccountLedgerEntries) — ดึง Num มาด้วยเช่นกัน
    const glLinesRequest = pool.request();
    if (bankCode) glLinesRequest.input('bankCode', sql.NVarChar, bankCode);
    const glLinesResult = await glLinesRequest.query(`
      SELECT rm.MatchId, rml.Num, e.Entry_No, e.Posting_Date, e.Document_No, e.Bank_Account_No,
             m.BankAccountName, e.Debit_Amount_LCY, e.Credit_Amount_LCY
      FROM ReconciliationMatch rm
      JOIN ReconciliationMatchLine rml ON rml.MatchId = rm.MatchId AND rml.SourceType = 'GL'
      JOIN BankAccountLedgerEntries e ON e.Entry_No = rml.GLEntryNo
      LEFT JOIN BankAccountMapping m ON m.BankAccountNo = e.Bank_Account_No
      WHERE 1=1 ${bankCode ? 'AND rm.BankCode = @bankCode' : ''}
    `);

    // รวมทั้ง 3 query เข้าด้วยกัน กลุ่มตาม MatchId
    const bankLinesByMatch = new Map<number, unknown[]>();
    for (const r of bankLinesResult.recordset) {
      const list = bankLinesByMatch.get(r.MatchId) ?? [];
      list.push({
        lineId: Number(r.LineId),
        num: r.Num,
        date: r.TranDate,
        description: r.Description,
        direction: r.Credit !== null ? 'IN' : 'OUT',
        amount: r.Credit !== null ? r.Credit : r.Debit,
      });
      bankLinesByMatch.set(r.MatchId, list);
    }

    const glLinesByMatch = new Map<number, unknown[]>();
    for (const r of glLinesResult.recordset) {
      const list = glLinesByMatch.get(r.MatchId) ?? [];
      list.push({
        entryNo: Number(r.Entry_No),
        num: r.Num,
        date: r.Posting_Date,
        ref: r.Document_No,
        accountName: r.BankAccountName,
        direction: Number(r.Debit_Amount_LCY) > 0 ? 'IN' : 'OUT',
        amount: Number(r.Debit_Amount_LCY) > 0 ? Number(r.Debit_Amount_LCY) : Number(r.Credit_Amount_LCY),
      });
      glLinesByMatch.set(r.MatchId, list);
    }

    const matches = headerResult.recordset.map((h) => ({
      matchId: h.MatchId,
      bankCode: h.BankCode,
      matchType: h.MatchType,
      createdBy: h.CreatedBy,
      createdAt: h.CreatedAt,
      bankLines: bankLinesByMatch.get(h.MatchId) ?? [],
      glLines: glLinesByMatch.get(h.MatchId) ?? [],
    }));

    return NextResponse.json({ matches });
  } catch (err) {
    console.error('Match history API error:', err);
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `ดึงประวัติการจับคู่ไม่สำเร็จ: ${detail}` }, { status: 500 });
  }
}