import { NextRequest, NextResponse } from 'next/server';
import sql from 'mssql';
import { getPool } from '../../../../../lib/db';

import { requireRole } from '../../../../../lib/session';
import { RECONCILE_ROLES } from '../../../../../lib/roles';
// GET /api/master/bank-statement/delete-history?bankCode=BBL
// ประวัติการลบไฟล์ Bank Statement ของธนาคารนั้น — ใครลบ ลบเมื่อไร เหตุผลอะไร ล่าสุดก่อน
// ต้องรัน sql/005_bank_statement_import_soft_delete.sql ก่อนใช้งาน
export async function GET(req: NextRequest) {
  const auth = await requireRole(RECONCILE_ROLES);
  if (!auth.ok) return auth.response;

  try {
    const bankCode = req.nextUrl.searchParams.get('bankCode');
    if (!bankCode) {
      return NextResponse.json({ error: 'ต้องระบุ bankCode' }, { status: 400 });
    }

    const pool = await getPool();
    const result = await pool
      .request()
      .input('bankCode', sql.NVarChar, bankCode)
      .query(`
        SELECT ImportId, BankCode, FileName, PeriodStart, PeriodEnd, ImportedRowCount,
               -- แนบ offset ให้ ImportedAt ด้วยเหตุผลเดียวกับ /imports — DeletedAt เป็น DATETIMEOFFSET อยู่แล้ว
               TODATETIMEOFFSET(ImportedAt, DATEPART(TZOFFSET, SYSDATETIMEOFFSET())) AS ImportedAt,
               DeletedAt, DeletedBy, DeletedReason
        FROM BankStatementImport
        WHERE BankCode = @bankCode AND Status = 'DELETED'
        ORDER BY DeletedAt DESC, ImportId DESC
      `);

    return NextResponse.json({ deletions: result.recordset });
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
