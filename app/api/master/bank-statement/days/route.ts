import { NextRequest, NextResponse } from 'next/server';
import sql from 'mssql';
import { getPool } from '../../../../../lib/db';

import { requireRole } from '../../../../../lib/session';
import { RECONCILE_ROLES } from '../../../../../lib/roles';
import { badRequest } from '../../../../../lib/apiInput';
import { bankLineWhere, bindBankLineFilters, parseBankLineFilters } from '../../../../../lib/masterBankLinesQuery';

const PAGE_SIZE = 50;

// GET /api/master/bank-statement/days?importId=123&offset=0&from=&to=&channel=&status=
// สรุปรายการในไฟล์เป็นรายวัน ทีละ 50 วัน เรียงตามวันที่ (ลำดับเดียวกับ statement):
// จำนวน ยอดฝาก ยอดถอน และจำนวนที่ยังไม่จับคู่ — รายการของแต่ละวันกางดูผ่าน /api/master/bank-statement/lines
//
// หน้าแรก (offset = 0) ส่ง total จำนวนวัน + ยอดสรุปทั้งช่วง + รายชื่อช่องทางมาด้วย
export async function GET(req: NextRequest) {
  const auth = await requireRole(RECONCILE_ROLES);
  if (!auth.ok) return auth.response;

  try {
    const params = req.nextUrl.searchParams;
    const filters = parseBankLineFilters(params);
    if ('error' in filters) return badRequest(filters.error);
    const offset = Math.max(0, Number(params.get('offset') ?? '0') || 0);

    const where = bankLineWhere(filters);
    const pool = await getPool();

    const daysQuery = bindBankLineFilters(pool.request(), filters)
      .input('offset', sql.Int, offset)
      .input('limit', sql.Int, PAGE_SIZE)
      .query(`
        SELECT TranDate AS Day,
               COUNT(*) AS Cnt,
               SUM(CASE WHEN Credit IS NOT NULL THEN 1 ELSE 0 END) AS InCount,
               SUM(COALESCE(Credit, 0)) AS InAmount,
               SUM(CASE WHEN Credit IS NULL THEN 1 ELSE 0 END) AS OutCount,
               SUM(CASE WHEN Credit IS NULL THEN COALESCE(Debit, 0) ELSE 0 END) AS OutAmount,
               SUM(CASE WHEN UPPER(MatchStatus) = 'UNMATCHED' THEN 1 ELSE 0 END) AS UnmatchedCount
        FROM BankStatementLine
        ${where}
        GROUP BY TranDate
        ORDER BY TranDate ASC
        OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
      `);

    // ยอดรวมทั้งช่วงใช้ตัวกรองชุดเดียวกับรายวัน ตัวเลขบนการ์ดจึงเท่ากับผลรวมของทุกวันในตาราง
    const summaryQuery =
      offset === 0
        ? bindBankLineFilters(pool.request(), filters).query(`
            SELECT COUNT(DISTINCT TranDate) AS DayCount,
                   COUNT(*) AS Total,
                   SUM(CASE WHEN Credit IS NOT NULL THEN 1 ELSE 0 END) AS InCount,
                   SUM(COALESCE(Credit, 0)) AS InAmount,
                   SUM(CASE WHEN Credit IS NULL THEN 1 ELSE 0 END) AS OutCount,
                   SUM(CASE WHEN Credit IS NULL THEN COALESCE(Debit, 0) ELSE 0 END) AS OutAmount
            FROM BankStatementLine
            ${where}
          `)
        : null;

    // รายชื่อช่องทางสำหรับปุ่มกรอง — ดึงจากทั้งไฟล์ ไม่ผูกกับตัวกรองที่เลือกอยู่
    // ไม่งั้นพอเลือกช่องทางเดียวแล้วตัวเลือกช่องทางอื่นจะหายไปหมด
    const channelsQuery =
      offset === 0
        ? pool
            .request()
            .input('importId', sql.Int, filters.importId)
            .query(
              `SELECT DISTINCT Channel FROM BankStatementLine WHERE ImportId = @importId AND Channel IS NOT NULL ORDER BY Channel`
            )
        : null;

    const [daysResult, summaryResult, channelsResult] = await Promise.all([daysQuery, summaryQuery, channelsQuery]);

    const days = daysResult.recordset.map((r) => ({
      date: r.Day,
      count: Number(r.Cnt),
      inCount: Number(r.InCount),
      inAmount: Number(r.InAmount),
      outCount: Number(r.OutCount),
      outAmount: Number(r.OutAmount),
      unmatchedCount: Number(r.UnmatchedCount),
    }));

    if (!summaryResult || !channelsResult) return NextResponse.json({ days });

    const s = summaryResult.recordset[0] ?? {};
    return NextResponse.json({
      days,
      total: Number(s.DayCount ?? 0),
      summary: {
        lineCount: Number(s.Total ?? 0),
        inCount: Number(s.InCount ?? 0),
        inAmount: Number(s.InAmount ?? 0),
        outCount: Number(s.OutCount ?? 0),
        outAmount: Number(s.OutAmount ?? 0),
      },
      channels: channelsResult.recordset.map((r) => String(r.Channel)),
    });
  } catch (err) {
    console.error('Master bank-statement days GET error:', err);
    return NextResponse.json({ error: 'ดึงสรุปรายวันไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' }, { status: 500 });
  }
}
