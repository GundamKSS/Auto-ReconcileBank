import { NextRequest, NextResponse } from 'next/server';
import sql from 'mssql';
import { getPool } from '../../../../../lib/db';

// GET /api/master/bank-statement/imports?bankCode=BBL
// รายชื่อไฟล์ (batch) ที่นำเข้าไว้ทั้งหมดของธนาคารนั้น ล่าสุดก่อน
export async function GET(req: NextRequest) {
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
        SELECT ImportId, BankCode, FileName, PeriodStart, PeriodEnd, ImportedRowCount, ImportedAt
        FROM BankStatementImport
        WHERE BankCode = @bankCode AND Status = 'SUCCESS'
        ORDER BY ImportedAt DESC
      `);

    return NextResponse.json({ imports: result.recordset });
  } catch (err) {
    console.error('Master bank-statement imports GET error:', err);
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `โหลดรายการไฟล์ไม่สำเร็จ: ${detail}` }, { status: 500 });
  }
}
