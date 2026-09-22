import { NextRequest, NextResponse } from 'next/server';
import sql from 'mssql';
import { getPool } from '../../../../../lib/db';

import { requireRole } from '../../../../../lib/session';
import { RECONCILE_ROLES } from '../../../../../lib/roles';
import { badRequest } from '../../../../../lib/apiInput';
import { bankLineWhere, bindBankLineFilters, parseBankLineFilters } from '../../../../../lib/masterBankLinesQuery';

const PAGE_SIZE = 50;

// GET /api/master/bank-statement/lines?importId=123&offset=0&from=&to=&channel=&status=
// ดึงรายการของ import นั้นทีละ 50 — หน้าจอใช้กางดูรายการของวันเดียว (from = to = วันนั้น)
// ส่วนยอดรวมทั้งไฟล์/รายวันและตัวเลือกช่องทางอยู่ที่ /api/master/bank-statement/days
// ตัวกรองอยู่ใน lib/masterBankLinesQuery.ts ชุดเดียวกับ days — ยอดรวมของวันจะได้เท่ากับรายการที่กางดูเสมอ
//
// อ่านอย่างเดียว — Bank Statement เป็นเอกสารจากธนาคาร จึงไม่มี endpoint แก้ไข/เพิ่ม/ลบทีละรายการ
// ถ้าไฟล์ผิดให้ลบทั้งไฟล์ (DELETE /api/master/bank-statement/imports/:importId) แล้วนำเข้าใหม่
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

    const linesQuery = bindBankLineFilters(pool.request(), filters)
      .input('offset', sql.Int, offset)
      .input('limit', sql.Int, PAGE_SIZE)
      .query(`
        SELECT LineId, ImportId, BankCode, TranDate, Description, Debit, Credit, Balance,
               ChequeNo, Channel, RawDescription, UPPER(MatchStatus) AS MatchStatus, CreatedAt
        FROM BankStatementLine
        ${where}
        ORDER BY TranDate ASC, LineId ASC
        OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
      `);

    // นับ total เฉพาะหน้าแรก ไม่ต้องนับซ้ำทุกครั้งที่กดโหลดเพิ่ม
    const countQuery =
      offset === 0
        ? bindBankLineFilters(pool.request(), filters).query(`SELECT COUNT(*) AS Total FROM BankStatementLine ${where}`)
        : null;

    const [linesResult, countResult] = await Promise.all([linesQuery, countQuery]);

    return NextResponse.json(
      countResult
        ? { lines: linesResult.recordset, total: Number(countResult.recordset[0]?.Total ?? 0) }
        : { lines: linesResult.recordset }
    );
  } catch (err) {
    console.error('Master bank-statement lines GET error:', err);
    return NextResponse.json({ error: 'ดึงรายการไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' }, { status: 500 });
  }
}
