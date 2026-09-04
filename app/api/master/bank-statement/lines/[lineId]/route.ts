import { NextRequest, NextResponse } from 'next/server';
import sql from 'mssql';
import { getPool } from '../../../../../../lib/db';

import { requireRole } from '../../../../../../lib/session';
import { RECONCILE_ROLES } from '../../../../../../lib/roles';
import { badRequest, parseIdParam } from '../../../../../../lib/apiInput';
async function assertUnlocked(pool: sql.ConnectionPool, lineId: number) {
  const check = await pool
    .request()
    .input('lineId', sql.Int, lineId)
    .query(`SELECT UPPER(MatchStatus) AS MatchStatus, ImportId FROM BankStatementLine WHERE LineId = @lineId`);
  const row = check.recordset[0];
  if (!row) return { ok: false as const, error: 'ไม่พบรายการนี้' };
  if (row.MatchStatus !== 'UNMATCHED') {
    return { ok: false as const, error: 'รายการนี้จับคู่ไปแล้ว แก้ไข/ลบไม่ได้' };
  }
  return { ok: true as const, importId: row.ImportId as number };
}

// PUT /api/master/bank-statement/lines/:lineId
// แก้ไขรายการเดียว — บล็อกถ้าจับคู่ไปแล้ว (ต้องยกเลิกการจับคู่ที่หน้า reconcile ก่อน)
export async function PUT(req: NextRequest, { params }: { params: Promise<{ lineId: string }> }) {
  const auth = await requireRole(RECONCILE_ROLES);
  if (!auth.ok) return auth.response;

  try {
    const { lineId: rawLineId } = await params;
    const lineId = parseIdParam(rawLineId);
    if (lineId === null) return badRequest('lineId ต้องเป็นจำนวนเต็มบวก');

    const body = await req.json();
    const { tranDate, description, debit, credit, balance, chequeNo, channel } = body;

    if (!tranDate) {
      return NextResponse.json({ error: 'ต้องระบุวันที่' }, { status: 400 });
    }
    if ((debit === null || debit === undefined) && (credit === null || credit === undefined)) {
      return NextResponse.json({ error: 'ต้องระบุยอดเงินอย่างน้อยฝั่ง Debit หรือ Credit' }, { status: 400 });
    }

    const pool = await getPool();
    const lock = await assertUnlocked(pool, lineId);
    if (!lock.ok) {
      return NextResponse.json({ error: lock.error }, { status: 409 });
    }

    await pool
      .request()
      .input('lineId', sql.Int, lineId)
      .input('tranDate', sql.Date, tranDate)
      .input('description', sql.NVarChar, description ?? null)
      .input('debit', sql.Decimal(18, 2), debit ?? null)
      .input('credit', sql.Decimal(18, 2), credit ?? null)
      .input('balance', sql.Decimal(18, 2), balance ?? null)
      .input('chequeNo', sql.NVarChar, chequeNo ?? null)
      .input('channel', sql.NVarChar, channel ?? null)
      .query(`
        UPDATE BankStatementLine
        SET TranDate = @tranDate,
            Description = @description,
            Debit = @debit,
            Credit = @credit,
            Balance = @balance,
            ChequeNo = @chequeNo,
            Channel = @channel
        WHERE LineId = @lineId
      `);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Master bank-statement line PUT error:', err);
    return NextResponse.json({ error: 'แก้ไขไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' }, { status: 500 });
  }
}

// DELETE /api/master/bank-statement/lines/:lineId
// ลบรายการเดียว — บล็อกถ้าจับคู่ไปแล้ว แล้วอัปเดตจำนวนแถวใน import header ให้ตรงของจริง
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ lineId: string }> }) {
  const auth = await requireRole(RECONCILE_ROLES);
  if (!auth.ok) return auth.response;

  try {
    const { lineId: rawLineId } = await params;
    const lineId = parseIdParam(rawLineId);
    if (lineId === null) return badRequest('lineId ต้องเป็นจำนวนเต็มบวก');

    const pool = await getPool();
    const lock = await assertUnlocked(pool, lineId);
    if (!lock.ok) {
      return NextResponse.json({ error: lock.error }, { status: 409 });
    }

    await pool.request().input('lineId', sql.Int, lineId).query(`DELETE FROM BankStatementLine WHERE LineId = @lineId`);

    await pool
      .request()
      .input('importId', sql.Int, lock.importId)
      .query(`
        UPDATE BankStatementImport
        SET ImportedRowCount = (SELECT COUNT(*) FROM BankStatementLine WHERE ImportId = @importId)
        WHERE ImportId = @importId
      `);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Master bank-statement line DELETE error:', err);
    return NextResponse.json({ error: 'ลบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' }, { status: 500 });
  }
}
