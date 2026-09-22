import { NextRequest, NextResponse } from 'next/server';
import sql from 'mssql';
import { getPool } from '../../../../../lib/db';

import { requireRole } from '../../../../../lib/session';
import { RECONCILE_ROLES } from '../../../../../lib/roles';
import { badRequest } from '../../../../../lib/apiInput';
import { glDirection, glAmount } from '../../../../../lib/glAmount';
import {
  bindGlFilters,
  glCte,
  glDirectionWhere,
  glStatusMatch,
  parseGlFilters,
} from '../../../../../lib/masterGlQuery';

// ข้อมูล GL sync มาจาก BC365 ได้ตลอด — ห้าม cache
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

// GET /api/master/gl/entries?bankCode=&bankAccountNo=&from=&to=&direction=&sourceCode=&status=&q=&offset=0
// รายการ GL ทีละ 50 ล่าสุดก่อน — หน้าจอใช้กางดูรายการของวันเดียว (from = to = วันนั้น)
// ส่วนยอดรวม/ตัวนับสถานะ/ตัวเลือกสมุดรายวันอยู่ที่ /api/master/gl/days
// ตัวกรองทั้งหมดอยู่ใน lib/masterGlQuery.ts ชุดเดียวกับ days — ยอดรวมของวันจะได้เท่ากับรายการที่กางดูเสมอ
export async function GET(req: NextRequest) {
  const auth = await requireRole(RECONCILE_ROLES);
  if (!auth.ok) return auth.response;

  try {
    const params = req.nextUrl.searchParams;
    const filters = parseGlFilters(params);
    if ('error' in filters) return badRequest(filters.error);
    const offset = Math.max(0, Number(params.get('offset') ?? '0') || 0);

    const cte = glCte(filters);
    const where = `${glDirectionWhere(filters)} AND ${glStatusMatch(filters)}`;
    const pool = await getPool();

    const entriesQuery = bindGlFilters(pool.request(), filters)
      .input('offset', sql.Int, offset)
      .input('limit', sql.Int, PAGE_SIZE)
      .query(`
        ${cte}
        SELECT Entry_No, BankCode, Bank_Account_No, BankAccountName, Posting_Date, Document_Date,
               Document_Type, Document_No, Source_Code, Debit_Amount_LCY, Credit_Amount_LCY, MatchId, MatchStatus
        FROM Gl
        ${where}
        ORDER BY Posting_Date DESC, Entry_No DESC
        OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
      `);

    // นับ total เฉพาะหน้าแรก ไม่ต้องนับซ้ำทุกครั้งที่กดโหลดเพิ่ม
    const countQuery =
      offset === 0
        ? bindGlFilters(pool.request(), filters).query(`${cte} SELECT COUNT(*) AS Total FROM Gl ${where}`)
        : null;

    const [entriesResult, countResult] = await Promise.all([entriesQuery, countQuery]);

    const entries = entriesResult.recordset.map((r) => ({
      entryNo: Number(r.Entry_No),
      bankCode: r.BankCode as string,
      accountNo: r.Bank_Account_No as string,
      accountName: (r.BankAccountName as string | null) ?? null,
      postingDate: r.Posting_Date,
      documentDate: r.Document_Date ?? null,
      documentType: (r.Document_Type as string | null) ?? null,
      documentNo: (r.Document_No as string | null) ?? null,
      sourceCode: (r.Source_Code as string | null) ?? null,
      direction: glDirection(r),
      amount: glAmount(r),
      matchId: r.MatchId === null || r.MatchId === undefined ? null : Number(r.MatchId),
      status: r.MatchStatus as string,
    }));

    return NextResponse.json(
      countResult ? { entries, total: Number(countResult.recordset[0]?.Total ?? 0) } : { entries }
    );
  } catch (err) {
    console.error('Master GL entries GET error:', err);
    return NextResponse.json({ error: 'ดึงรายการ GL ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' }, { status: 500 });
  }
}
