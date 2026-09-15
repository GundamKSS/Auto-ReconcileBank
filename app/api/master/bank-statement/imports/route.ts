import { NextRequest, NextResponse } from 'next/server';
import sql from 'mssql';
import { getPool } from '../../../../../lib/db';

import { requireRole } from '../../../../../lib/session';
import { RECONCILE_ROLES } from '../../../../../lib/roles';
// GET /api/master/bank-statement/imports?bankCode=BBL
// รายชื่อไฟล์ (batch) ที่นำเข้าไว้และยังไม่ถูกลบของธนาคารนั้น ล่าสุดก่อน
// LockedCount = จำนวนรายการในไฟล์ที่จับคู่/พักไว้อยู่ — มากกว่า 0 แปลว่ายังลบทั้งไฟล์ไม่ได้
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
        SELECT i.ImportId, i.BankCode, i.FileName, i.PeriodStart, i.PeriodEnd, i.ImportedRowCount,
               -- ImportedAt เป็น datetime เวลาไทยของเครื่อง DB แบบไม่มี offset ซึ่ง mssql อ่านเป็น UTC
               -- ทำให้หน้าเว็บแสดงเวลาเลื่อนไป 7 ชั่วโมง จึงแนบ offset ของเครื่อง DB ให้เป็นเวลาจริงก่อนส่งออก
               TODATETIMEOFFSET(i.ImportedAt, DATEPART(TZOFFSET, SYSDATETIMEOFFSET())) AS ImportedAt,
               COALESCE(lk.LockedCount, 0) AS LockedCount
        FROM BankStatementImport i
        LEFT JOIN (
          SELECT ImportId, COUNT(*) AS LockedCount
          FROM BankStatementLine
          WHERE MatchStatus <> 'UNMATCHED'
          GROUP BY ImportId
        ) lk ON lk.ImportId = i.ImportId
        WHERE i.BankCode = @bankCode AND i.Status = 'SUCCESS'
        ORDER BY i.ImportedAt DESC
      `);

    return NextResponse.json({ imports: result.recordset });
  } catch (err) {
    console.error('Master bank-statement imports GET error:', err);
    return NextResponse.json({ error: 'โหลดรายการไฟล์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' }, { status: 500 });
  }
}
