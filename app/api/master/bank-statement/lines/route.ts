import { NextRequest, NextResponse } from 'next/server';
import sql from 'mssql';
import { getPool } from '../../../../../lib/db';

import { requireRole } from '../../../../../lib/session';
import { RECONCILE_ROLES } from '../../../../../lib/roles';
import { badRequest, parseIdParam } from '../../../../../lib/apiInput';
// GET /api/master/bank-statement/lines?importId=123
// ดึงทุกแถวของ import นั้น (ไม่กรอง MatchStatus เพราะเป็นหน้า master data ต้องเห็นครบทุกสถานะ)
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

// POST /api/master/bank-statement/lines
// เพิ่มรายการใหม่ด้วยมือ เข้า import batch ที่มีอยู่แล้ว
export async function POST(req: NextRequest) {
  const auth = await requireRole(RECONCILE_ROLES);
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json();
    const { bankCode, tranDate, description, debit, credit, balance, chequeNo, channel } = body;

    const importId = parseIdParam(body?.importId);
    if (importId === null || !bankCode || !tranDate) {
      return NextResponse.json({ error: 'ข้อมูลไม่ครบ (ต้องมี importId, bankCode, tranDate)' }, { status: 400 });
    }
    if ((debit === null || debit === undefined) && (credit === null || credit === undefined)) {
      return NextResponse.json({ error: 'ต้องระบุยอดเงินอย่างน้อยฝั่ง Debit หรือ Credit' }, { status: 400 });
    }

    const pool = await getPool();
    const result = await pool
      .request()
      .input('importId', sql.Int, importId)
      .input('bankCode', sql.NVarChar, bankCode)
      .input('tranDate', sql.Date, tranDate)
      .input('description', sql.NVarChar, description ?? null)
      .input('debit', sql.Decimal(18, 2), debit ?? null)
      .input('credit', sql.Decimal(18, 2), credit ?? null)
      .input('balance', sql.Decimal(18, 2), balance ?? null)
      .input('chequeNo', sql.NVarChar, chequeNo ?? null)
      .input('channel', sql.NVarChar, channel ?? null)
      .query(`
        INSERT INTO BankStatementLine
          (ImportId, BankCode, TranDate, Description, Debit, Credit, Balance, ChequeNo, Channel, RawDescription, MatchStatus)
        OUTPUT INSERTED.LineId
        VALUES
          (@importId, @bankCode, @tranDate, @description, @debit, @credit, @balance, @chequeNo, @channel, N'เพิ่มด้วยมือ (Master Data)', 'UNMATCHED')
      `);

    // อัปเดตจำนวนแถวใน import header ให้ตรงของจริง
    await pool
      .request()
      .input('importId', sql.Int, importId)
      .query(`
        UPDATE BankStatementImport
        SET ImportedRowCount = (SELECT COUNT(*) FROM BankStatementLine WHERE ImportId = @importId)
        WHERE ImportId = @importId
      `);

    return NextResponse.json({ lineId: result.recordset[0].LineId });
  } catch (err) {
    console.error('Master bank-statement lines POST error:', err);
    return NextResponse.json({ error: 'เพิ่มรายการไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' }, { status: 500 });
  }
}