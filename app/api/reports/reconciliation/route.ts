import { NextRequest, NextResponse } from 'next/server';
import sql from 'mssql';
import { getPool } from '../../../../lib/db';
import { requireRole } from '../../../../lib/session';
import { VIEWER_ROLES } from '../../../../lib/roles';
import {
  PAGE_SIZE,
  ORDER_BY,
  SUMMARY_SELECT,
  bindFilters,
  buildSummary,
  buildUnifiedCte,
  mapRow,
  parseFilters,
  searchCondition,
} from './query';

// ข้อมูลต้องสดทุกครั้ง ช่วงวันที่/เกณฑ์วันที่/สถานะเปลี่ยนได้ตลอด
export const dynamic = 'force-dynamic';

/**
 * GET /api/reports/reconciliation
 *
 * Query params:
 *   from, to    - ช่วงวันที่ YYYY-MM-DD (ไม่ใส่ = วันที่ 1 ถึงสิ้นเดือนปัจจุบัน)
 *   basis       - 'BANK' (ค่าเริ่มต้น, ใช้ TranDate ของ statement) | 'GL' (ใช้ Posting_Date ฝั่ง BC)
 *   status      - 'MATCHED' (ค่าเริ่มต้น) | 'SUSPENSE' | 'UNMATCHED' | 'ALL'
 *   bankCode    - รหัสธนาคาร หรือ 'ALL'
 *   q           - ค้นหาข้อความ (คำอธิบาย bank / ref / document no / ชื่อบัญชี / MatchId)
 *   offset      - เริ่มที่แถวที่เท่าไร (infinite scroll ทีละ 50)
 *
 * ตอบกลับ summary + total เฉพาะตอน offset = 0 เพื่อไม่ให้ต้องรวมยอดใหม่ทุกครั้งที่ scroll
 */
export async function GET(req: NextRequest) {
  const auth = await requireRole(VIEWER_ROLES);
  if (!auth.ok) return auth.response;

  try {
    const filters = parseFilters(req.nextUrl.searchParams);
    const offset = Math.max(0, Number(req.nextUrl.searchParams.get('offset') ?? '0') || 0);

    if (filters.from > filters.to) {
      return NextResponse.json({ error: 'ช่วงวันที่ไม่ถูกต้อง (วันเริ่มต้นอยู่หลังวันสิ้นสุด)' }, { status: 400 });
    }

    const pool = await getPool();
    const cte = buildUnifiedCte(filters);
    const search = searchCondition(filters);

    const rowsRequest = bindFilters(pool.request(), filters)
      .input('offset', sql.Int, offset)
      .input('limit', sql.Int, PAGE_SIZE);

    const rowsResult = await rowsRequest.query(`
      ${cte}
      SELECT * FROM Unified
      WHERE 1=1 ${search}
      ${ORDER_BY}
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `);

    const rows = rowsResult.recordset.map(mapRow);

    if (offset > 0) {
      return NextResponse.json({ rows, pageSize: PAGE_SIZE });
    }

    const summaryResult = await bindFilters(pool.request(), filters).query(`
      ${cte}
      ${SUMMARY_SELECT} ${search}
      GROUP BY Status, COALESCE(BankCode, N'-')
    `);

    const summary = buildSummary(summaryResult.recordset);

    // รายชื่อธนาคารสำหรับปุ่มกรอง — ดึงจากข้อมูลจริง ไม่ผูกกับ filter ที่เลือกอยู่
    // ไม่งั้นพอเลือกธนาคารเดียวแล้วปุ่มธนาคารอื่นจะหายไปหมด
    const bankCodesResult = await pool.request().query(`
      SELECT DISTINCT BankCode FROM (
        SELECT BankCode FROM BankAccountMapping WHERE BankCode IS NOT NULL
        UNION
        SELECT BankCode FROM BankStatementLine WHERE BankCode IS NOT NULL
      ) z
      ORDER BY BankCode
    `);

    return NextResponse.json({
      rows,
      pageSize: PAGE_SIZE,
      total: summary.total,
      summary,
      bankCodes: bankCodesResult.recordset.map((r) => String(r.BankCode)),
      filters,
    });
  } catch (err) {
    console.error('Reconciliation report API error:', err);
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `ดึงข้อมูลรีพอร์ตไม่สำเร็จ: ${detail}` }, { status: 500 });
  }
}
