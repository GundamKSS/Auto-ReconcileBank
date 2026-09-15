import { NextRequest, NextResponse } from 'next/server';
import sql from 'mssql';
import { getPool } from '../../../../../lib/db';

import { requireRole } from '../../../../../lib/session';
import { RECONCILE_ROLES } from '../../../../../lib/roles';
import { badRequest, parseIdParam } from '../../../../../lib/apiInput';
// GET /api/master/bank-statement/lines?importId=123
// ดึงทุกแถวของ import นั้น (ไม่กรอง MatchStatus เพราะเป็นหน้า master data ต้องเห็นครบทุกสถานะ)
//
// อ่านอย่างเดียว — Bank Statement เป็นเอกสารจากธนาคาร จึงไม่มี endpoint แก้ไข/เพิ่ม/ลบทีละรายการ
// ถ้าไฟล์ผิดให้ลบทั้งไฟล์ (DELETE /api/master/bank-statement/imports/:importId) แล้วนำเข้าใหม่
export async function GET(req: NextRequest) {
  const auth = await requireRole(RECONCILE_ROLES);
  if (!auth.ok) return auth.response;

  try {
    const raw = req.nextUrl.searchParams.get('importId');
    if (!raw) return badRequest('ต้องระบุ importId');
    // เดิมตรวจแค่ว่ามีค่าส่งมาไหม ค่าอย่าง "abc" จะกลายเป็น NaN แล้ว query คืนรายการว่างพร้อม 200
    // ทำให้ผู้เรียกแยกไม่ออกว่า "ไฟล์นี้ไม่มีรายการ" หรือ "ส่ง id ผิด"
    const importId = parseIdParam(raw);
    if (importId === null) return badRequest('importId ต้องเป็นจำนวนเต็มบวก');

    const pool = await getPool();
    const result = await pool
      .request()
      .input('importId', sql.Int, importId)
      .query(`
        SELECT LineId, ImportId, BankCode, TranDate, Description, Debit, Credit, Balance,
               ChequeNo, Channel, RawDescription, UPPER(MatchStatus) AS MatchStatus, CreatedAt
        FROM BankStatementLine
        WHERE ImportId = @importId
        ORDER BY TranDate ASC, LineId ASC
      `);

    return NextResponse.json({ lines: result.recordset });
  } catch (err) {
    console.error('Master bank-statement lines GET error:', err);
    return NextResponse.json({ error: 'ดึงรายการไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' }, { status: 500 });
  }
}
