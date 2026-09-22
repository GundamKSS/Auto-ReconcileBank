import { NextRequest, NextResponse } from 'next/server';
import sql from 'mssql';
import { getPool } from '../../../../../lib/db';

import { requireRole } from '../../../../../lib/session';
import { RECONCILE_ROLES } from '../../../../../lib/roles';
import { badRequest } from '../../../../../lib/apiInput';
import {
  bindGlFilters,
  glCte,
  glDirectionWhere,
  glScopeWhere,
  glStatusMatch,
  parseGlFilters,
} from '../../../../../lib/masterGlQuery';

// ข้อมูล GL sync มาจาก BC365 ได้ตลอด — ห้าม cache
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

// GET /api/master/gl/days?bankCode=&bankAccountNo=&from=&to=&direction=&sourceCode=&status=&q=&offset=0
// สรุปรายการ GL เป็นรายวัน (วันที่ผ่านรายการ) ทีละ 50 วัน ล่าสุดก่อน: จำนวน ยอดรับ ยอดจ่าย และจำนวนที่ยังไม่จับคู่
// รายการของแต่ละวันกางดูผ่าน /api/master/gl/entries ด้วยตัวกรองชุดเดียวกัน (lib/masterGlQuery.ts)
//
// หน้าแรก (offset = 0) ส่ง total จำนวนวัน + ยอดสรุปทั้งช่วง + ตัวนับรายสถานะ + ตัวเลือกสมุดรายวันมาด้วย
export async function GET(req: NextRequest) {
  const auth = await requireRole(RECONCILE_ROLES);
  if (!auth.ok) return auth.response;

  try {
    const params = req.nextUrl.searchParams;
    const filters = parseGlFilters(params);
    if ('error' in filters) return badRequest(filters.error);
    const offset = Math.max(0, Number(params.get('offset') ?? '0') || 0);

    const cte = glCte(filters);
    const directionWhere = glDirectionWhere(filters);
    const statusMatch = glStatusMatch(filters);
    const pool = await getPool();

    const daysQuery = bindGlFilters(pool.request(), filters)
      .input('offset', sql.Int, offset)
      .input('limit', sql.Int, PAGE_SIZE)
      .query(`
        ${cte}
        SELECT Posting_Date AS Day,
               COUNT(*) AS Cnt,
               SUM(CASE WHEN SignedAmount > 0 THEN 1 ELSE 0 END) AS InCount,
               SUM(CASE WHEN SignedAmount > 0 THEN SignedAmount ELSE 0 END) AS InAmount,
               SUM(CASE WHEN SignedAmount <= 0 THEN 1 ELSE 0 END) AS OutCount,
               SUM(CASE WHEN SignedAmount <= 0 THEN -SignedAmount ELSE 0 END) AS OutAmount,
               SUM(CASE WHEN MatchStatus = 'UNMATCHED' THEN 1 ELSE 0 END) AS UnmatchedCount
        FROM Gl
        ${directionWhere} AND ${statusMatch}
        GROUP BY Posting_Date
        ORDER BY Posting_Date DESC
        OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
      `);

    // ตัวนับรายสถานะไม่ใช้ตัวกรองสถานะ (ใช้ตัวกรองอื่นครบ) — หน้าจอใช้เป็นแท็บสถานะ ถ้ากรองด้วย
    // พอกดแท็บหนึ่งแล้วแท็บอื่นจะกลายเป็น 0 หมด ส่วนจำนวน/ยอดรับจ่ายรวม/จำนวนวันใช้ตัวกรองครบทุกตัว
    const summaryQuery =
      offset === 0
        ? bindGlFilters(pool.request(), filters).query(`
            ${cte}
            SELECT COUNT(DISTINCT CASE WHEN ${statusMatch} THEN Posting_Date END) AS DayCount,
                   SUM(CASE WHEN ${statusMatch} THEN 1 ELSE 0 END) AS Total,
                   SUM(CASE WHEN ${statusMatch} AND SignedAmount > 0 THEN 1 ELSE 0 END) AS InCount,
                   SUM(CASE WHEN ${statusMatch} AND SignedAmount > 0 THEN SignedAmount ELSE 0 END) AS InAmount,
                   SUM(CASE WHEN ${statusMatch} AND SignedAmount <= 0 THEN 1 ELSE 0 END) AS OutCount,
                   SUM(CASE WHEN ${statusMatch} AND SignedAmount <= 0 THEN -SignedAmount ELSE 0 END) AS OutAmount,
                   SUM(CASE WHEN MatchStatus = 'UNMATCHED' THEN 1 ELSE 0 END) AS UnmatchedCount,
                   SUM(CASE WHEN MatchStatus = 'MATCHED' THEN 1 ELSE 0 END) AS MatchedCount,
                   SUM(CASE WHEN MatchStatus = 'SUSPENSE' THEN 1 ELSE 0 END) AS SuspenseCount,
                   SUM(CASE WHEN MatchStatus = 'OFFSET' THEN 1 ELSE 0 END) AS OffsetCount,
                   SUM(CASE WHEN MatchStatus = 'EXCLUDED' THEN 1 ELSE 0 END) AS ExcludedCount
            FROM Gl
            ${directionWhere}
          `)
        : null;

    // ตัวเลือกสมุดรายวันผูกกับบัญชีที่เลือกเท่านั้น ไม่ผูกกับตัวกรองอื่น — ไม่งั้นพอเลือกค่าหนึ่งแล้วตัวเลือกอื่นหายหมด
    const sourceCodesQuery =
      offset === 0
        ? (() => {
            const request = pool.request();
            if (filters.bankCode) request.input('bankCode', sql.NVarChar, filters.bankCode);
            if (filters.bankAccountNo) request.input('bankAccountNo', sql.NVarChar, filters.bankAccountNo);
            return request.query(`
              SELECT DISTINCT e.Source_Code
              FROM BankAccountLedgerEntries e
              JOIN BankAccountMapping m ON m.BankAccountNo = e.Bank_Account_No
              ${glScopeWhere(filters)}
                AND e.Source_Code IS NOT NULL AND LTRIM(RTRIM(e.Source_Code)) <> N''
              ORDER BY e.Source_Code
            `);
          })()
        : null;

    const [daysResult, summaryResult, sourceCodesResult] = await Promise.all([
      daysQuery,
      summaryQuery,
      sourceCodesQuery,
    ]);

    const days = daysResult.recordset.map((r) => ({
      date: r.Day,
      count: Number(r.Cnt),
      inCount: Number(r.InCount),
      inAmount: Number(r.InAmount),
      outCount: Number(r.OutCount),
      outAmount: Number(r.OutAmount),
      unmatchedCount: Number(r.UnmatchedCount),
    }));

    if (!summaryResult || !sourceCodesResult) return NextResponse.json({ days });

    const s = summaryResult.recordset[0] ?? {};
    return NextResponse.json({
      days,
      total: Number(s.DayCount ?? 0),
      summary: {
        entryCount: Number(s.Total ?? 0),
        inCount: Number(s.InCount ?? 0),
        inAmount: Number(s.InAmount ?? 0),
        outCount: Number(s.OutCount ?? 0),
        outAmount: Number(s.OutAmount ?? 0),
        statusCounts: {
          UNMATCHED: Number(s.UnmatchedCount ?? 0),
          MATCHED: Number(s.MatchedCount ?? 0),
          SUSPENSE: Number(s.SuspenseCount ?? 0),
          OFFSET: Number(s.OffsetCount ?? 0),
          EXCLUDED: Number(s.ExcludedCount ?? 0),
        },
      },
      sourceCodes: sourceCodesResult.recordset.map((r) => String(r.Source_Code)),
    });
  } catch (err) {
    console.error('Master GL days GET error:', err);
    return NextResponse.json({ error: 'ดึงสรุปรายวันของ GL ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' }, { status: 500 });
  }
}
