import { NextRequest, NextResponse } from 'next/server';
import sql from 'mssql';
import { getPool } from '../../../lib/db';

const PAGE_SIZE = 50;

/**
 * GET /api/history
 *
 * Query params:
 *   bankCode  - รหัสธนาคาร หรือไม่ใส่ = ทุกธนาคาร
 *   matchType - 'MATCHED' | 'SUSPENSE' หรือไม่ใส่ = ทั้งคู่
 *   from, to  - ช่วงวันที่ YYYY-MM-DD กรองที่ CreatedAt (ไม่ใส่ = ไม่กรองวันที่)
 *   offset    - เริ่มที่ Match ลำดับที่เท่าไร (infinite scroll ทีละ 50 Match)
 *
 * ตอบกลับ total + bankCodes เฉพาะตอนโหลดหน้าแรก (offset = 0) เพื่อไม่ให้ต้องนับใหม่ทุกครั้งที่ scroll
 */
export async function GET(req: NextRequest) {
  try {
    const params = req.nextUrl.searchParams;
    const bankCode = params.get('bankCode');
    const matchType = params.get('matchType');
    const from = params.get('from');
    const to = params.get('to');
    const offset = Math.max(0, Number(params.get('offset') ?? '0') || 0);

    // ช่วงวันที่กรองที่ CreatedAt (datetime มีเวลาแฝงอยู่) — from ใช้เที่ยงคืนของวันนั้น
    // to ต้องรวมทั้งวันสุดท้ายด้วย เลยขยับไปเที่ยงคืนของ "วันถัดไป" แล้วเทียบด้วย < แทน <=
    const fromDate = from ? new Date(`${from}T00:00:00`) : null;
    let toDateExclusive: Date | null = null;
    if (to) {
      toDateExclusive = new Date(`${to}T00:00:00`);
      toDateExclusive.setDate(toDateExclusive.getDate() + 1);
    }

    const whereClause = `
      WHERE 1=1
        ${bankCode ? 'AND BankCode = @bankCode' : ''}
        ${matchType ? 'AND MatchType = @matchType' : ''}
        ${fromDate ? 'AND CreatedAt >= @from' : ''}
        ${toDateExclusive ? 'AND CreatedAt < @to' : ''}
    `;

    const pool = await getPool();

    // 1) หา MatchId ของหน้านี้ก่อน (ล่าสุดก่อน, ทีละ 50) แล้วค่อยไป join รายละเอียดเฉพาะชุดนี้
    //    — กันไม่ให้ต้อง join รายละเอียดของ Match ทั้งหมดในระบบทุกครั้งที่โหลด เหมือนโค้ดเดิม
    const idRequest = pool.request();
    if (bankCode) idRequest.input('bankCode', sql.NVarChar, bankCode);
    if (matchType) idRequest.input('matchType', sql.NVarChar, matchType);
    if (fromDate) idRequest.input('from', sql.DateTime2, fromDate);
    if (toDateExclusive) idRequest.input('to', sql.DateTime2, toDateExclusive);
    idRequest.input('offset', sql.Int, offset);
    idRequest.input('limit', sql.Int, PAGE_SIZE);
    const idResult = await idRequest.query(`
      SELECT MatchId
      FROM ReconciliationMatch
      ${whereClause}
      ORDER BY CreatedAt DESC, MatchId DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `);
    const pageMatchIds: number[] = idResult.recordset.map((r) => Number(r.MatchId));

    if (pageMatchIds.length === 0) {
      return NextResponse.json(offset > 0 ? { matches: [] } : { matches: [], total: 0, bankCodes: [] });
    }
    // MatchId มาจาก query ของเราเอง (Number() แล้วทุกตัว) ไม่ใช่ input ดิบจาก client — ปลอดภัยจาก SQL injection
    const idsCsv = pageMatchIds.join(',');

    // 2) หัวบันทึกของ MatchId หน้านี้เท่านั้น
    const headerResult = await pool.request().query(`
      SELECT MatchId, BankCode, MatchType, CreatedBy, CreatedAt, Status, ReversedAt, ReversedBy, ReversedReason
      FROM ReconciliationMatch
      WHERE MatchId IN (${idsCsv})
    `);

    // 3) รายละเอียดฝั่ง Bank เฉพาะ MatchId หน้านี้ (join กลับ BankStatementLine) — ดึง Num มาด้วย
    const bankLinesResult = await pool.request().query(`
      SELECT rm.MatchId, rml.Num, rml.Status, rml.ReversedAt, rml.ReversedBy, rml.ReversedReason,
             bsl.LineId, bsl.TranDate, bsl.Description, bsl.Debit, bsl.Credit
      FROM ReconciliationMatch rm
      JOIN ReconciliationMatchLine rml ON rml.MatchId = rm.MatchId AND rml.SourceType = 'BANK'
      JOIN BankStatementLine bsl ON bsl.LineId = rml.BankLineId
      WHERE rm.MatchId IN (${idsCsv})
    `);

    // 4) รายละเอียดฝั่ง GL เฉพาะ MatchId หน้านี้ (join กลับ BankAccountLedgerEntries)
    const glLinesResult = await pool.request().query(`
      SELECT rm.MatchId, rml.Num, rml.Status, rml.ReversedAt, rml.ReversedBy, rml.ReversedReason,
             e.Entry_No, e.Posting_Date, e.Document_No, e.Bank_Account_No,
             m.BankAccountName, e.Debit_Amount_LCY, e.Credit_Amount_LCY
      FROM ReconciliationMatch rm
      JOIN ReconciliationMatchLine rml ON rml.MatchId = rm.MatchId AND rml.SourceType = 'GL'
      JOIN BankAccountLedgerEntries e ON e.Entry_No = rml.GLEntryNo
      LEFT JOIN BankAccountMapping m ON m.BankAccountNo = e.Bank_Account_No
      WHERE rm.MatchId IN (${idsCsv})
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
        status: r.Status ?? 'ACTIVE',
        reversedAt: r.ReversedAt ?? null,
        reversedBy: r.ReversedBy ?? null,
        reversedReason: r.ReversedReason ?? null,
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
        status: r.Status ?? 'ACTIVE',
        reversedAt: r.ReversedAt ?? null,
        reversedBy: r.ReversedBy ?? null,
        reversedReason: r.ReversedReason ?? null,
      });
      glLinesByMatch.set(r.MatchId, list);
    }

    // ประกอบกลับตามลำดับเดิมจาก idResult (CreatedAt DESC) — ห้ามใช้ลำดับของ headerResult เพราะ
    // WHERE MatchId IN (...) ไม่การันตีลำดับแถวที่ได้กลับมา
    const headerByMatchId = new Map(headerResult.recordset.map((h) => [Number(h.MatchId), h]));
    const matches = pageMatchIds
      .map((id) => headerByMatchId.get(id))
      .filter((h): h is NonNullable<typeof h> => h != null)
      .map((h) => ({
        matchId: h.MatchId,
        bankCode: h.BankCode,
        matchType: h.MatchType,
        createdBy: h.CreatedBy,
        createdAt: h.CreatedAt,
        status: h.Status ?? 'ACTIVE',
        reversedAt: h.ReversedAt,
        reversedBy: h.ReversedBy,
        reversedReason: h.ReversedReason,
        bankLines: bankLinesByMatch.get(h.MatchId) ?? [],
        glLines: glLinesByMatch.get(h.MatchId) ?? [],
      }));

    if (offset > 0) {
      return NextResponse.json({ matches });
    }

    // นับ total + รายชื่อธนาคาร เฉพาะตอนโหลดหน้าแรก ไม่ต้องนับซ้ำทุกครั้งที่เลื่อนโหลดเพิ่ม
    const countRequest = pool.request();
    if (bankCode) countRequest.input('bankCode', sql.NVarChar, bankCode);
    if (matchType) countRequest.input('matchType', sql.NVarChar, matchType);
    if (fromDate) countRequest.input('from', sql.DateTime2, fromDate);
    if (toDateExclusive) countRequest.input('to', sql.DateTime2, toDateExclusive);
    const countResult = await countRequest.query(`SELECT COUNT(*) AS Total FROM ReconciliationMatch ${whereClause}`);
    const total = Number(countResult.recordset[0]?.Total ?? 0);

    // รายชื่อธนาคารสำหรับปุ่มกรอง — ดึงจากข้อมูลจริงทั้งหมด ไม่ผูกกับ filter ธนาคาร/วันที่ที่เลือกอยู่
    // ไม่งั้นพอเลือกธนาคารเดียวแล้วปุ่มธนาคารอื่นจะหายไปหมด
    // (แต่ยังผูกกับ matchType — หน้า Match History ไม่ควรมีปุ่มธนาคารที่มีแต่รายการพักโอนโผล่มาแล้วกดได้ผลลัพธ์ว่าง)
    const bankCodesRequest = pool.request();
    if (matchType) bankCodesRequest.input('matchType', sql.NVarChar, matchType);
    const bankCodesResult = await bankCodesRequest.query(`
      SELECT DISTINCT BankCode FROM ReconciliationMatch
      WHERE BankCode IS NOT NULL ${matchType ? 'AND MatchType = @matchType' : ''}
      ORDER BY BankCode
    `);

    return NextResponse.json({
      matches,
      total,
      bankCodes: bankCodesResult.recordset.map((r) => String(r.BankCode)),
    });
  } catch (err) {
    console.error('Match history API error:', err);
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `ดึงประวัติการจับคู่ไม่สำเร็จ: ${detail}` }, { status: 500 });
  }
}
