import { NextRequest, NextResponse } from 'next/server';
import sql from 'mssql';
import { getPool } from '../../../../../lib/db';

import { requireRole } from '../../../../../lib/session';
import { RECONCILE_ROLES } from '../../../../../lib/roles';

const PAGE_SIZE = 50;

// GET /api/master/bank-statement/delete-history?bankCode=BBL&offset=0
// ประวัติการลบไฟล์ Bank Statement ของธนาคารนั้นทีละ 50 (infinite scroll) — ใครลบ ลบเมื่อไร เหตุผลอะไร ล่าสุดก่อน
// ต้องรัน sql/005_bank_statement_import_soft_delete.sql ก่อนใช้งาน
export async function GET(req: NextRequest) {
  const auth = await requireRole(RECONCILE_ROLES);
  if (!auth.ok) return auth.response;

  try {
    const params = req.nextUrl.searchParams;
    const bankCode = params.get('bankCode');
    if (!bankCode) {
      return NextResponse.json({ error: 'ต้องระบุ bankCode' }, { status: 400 });
    }
    const offset = Math.max(0, Number(params.get('offset') ?? '0') || 0);

    const pool = await getPool();
    const result = await pool
      .request()
      .input('bankCode', sql.NVarChar, bankCode)
      .input('offset', sql.Int, offset)
      .input('limit', sql.Int, PAGE_SIZE)
      .query(`
        SELECT ImportId, BankCode, FileName, PeriodStart, PeriodEnd, ImportedRowCount,
               -- แนบ offset ให้ ImportedAt ด้วยเหตุผลเดียวกับ /imports — DeletedAt เป็น DATETIMEOFFSET อยู่แล้ว
               TODATETIMEOFFSET(ImportedAt, DATEPART(TZOFFSET, SYSDATETIMEOFFSET())) AS ImportedAt,
               DeletedAt, DeletedBy, DeletedReason
        FROM BankStatementImport
        WHERE BankCode = @bankCode AND Status = 'DELETED'
        ORDER BY DeletedAt DESC, ImportId DESC
        OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
      `);

    if (offset > 0) {
      return NextResponse.json({ deletions: result.recordset });
    }

    const countResult = await pool
      .request()
      .input('bankCode', sql.NVarChar, bankCode)
      .query(`SELECT COUNT(*) AS Total FROM BankStatementImport WHERE BankCode = @bankCode AND Status = 'DELETED'`);

    return NextResponse.json({ deletions: result.recordset, total: Number(countResult.recordset[0]?.Total ?? 0) });
  } catch (err) {
    console.error('Master bank-statement delete-history GET error:', err);
    // 207 = Invalid column name — ยังไม่ได้รันสคริปต์ที่เพิ่มคอลัมน์ DeletedAt/DeletedBy/DeletedReason
    if ((err as { number?: number } | null)?.number === 207) {
      return NextResponse.json(
        { error: 'ยังดูประวัติการลบไม่ได้ — ต้องรัน sql/005_bank_statement_import_soft_delete.sql กับฐานข้อมูลก่อน' },
        { status: 500 }
      );
    }
    return NextResponse.json({ error: 'โหลดประวัติการลบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' }, { status: 500 });
  }
}
