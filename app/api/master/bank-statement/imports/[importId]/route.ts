import { NextRequest, NextResponse } from 'next/server';
import sql from 'mssql';
import { getPool } from '../../../../../../lib/db';

import { requireRole } from '../../../../../../lib/session';
import { RECONCILE_ROLES } from '../../../../../../lib/roles';
import { badRequest, parseIdParam } from '../../../../../../lib/apiInput';

// ยาวได้ไม่เกินคอลัมน์ DeletedReason NVARCHAR(500)
const MAX_REASON_LENGTH = 500;

// เงื่อนไขทางธุรกิจที่ไม่ยอมให้ลบ — แยกจาก error ของระบบ เพื่อตอบ 4xx พร้อมข้อความตรงๆ หลัง rollback
class DeleteBlockedError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

// DELETE /api/master/bank-statement/imports/:importId   body: { reason: string }
// ลบ Bank Statement ได้ทีละ "ทั้งไฟล์" เท่านั้น (ไม่มี endpoint แก้ไข/เพิ่ม/ลบรายบรรทัดแล้ว) และต้องมีเหตุผลเสมอ
//
// เป็น soft delete — ไม่ลบแถวทิ้ง แต่ mark หัวไฟล์ Status = 'DELETED' พร้อมผู้ลบ/เวลา/เหตุผล
// และ mark ทุกบรรทัดในไฟล์ MatchStatus = 'DELETED' เพราะ:
//   - ReconciliationMatchLine ที่ยกเลิกการจับคู่ไปแล้ว (REVERSED) ยังอ้าง LineId ในไฟล์อยู่ (ไม่มี FK)
//     ถ้าลบแถวทิ้ง ฝั่ง Bank ของประวัติเหล่านั้นจะหายจากหน้า Match History เงียบๆ
//   - Reconcile/ผู้ช่วยหาคู่ ดึงเฉพาะ MatchStatus = 'UNMATCHED' จึงไม่เห็นรายการของไฟล์ที่ลบทันที
//     ส่วนรายงาน/Dashboard/Export กรอง MatchStatus <> 'DELETED' ไว้ใน reports/reconciliation/query.ts
//   - เช็คไฟล์ซ้ำตอนนำเข้าดูเฉพาะ Status = 'SUCCESS' จึงนำเข้าไฟล์เดิมใหม่ได้หลังลบ
//
// ต้องรัน sql/005_bank_statement_import_soft_delete.sql ก่อนใช้งาน
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ importId: string }> }) {
  const auth = await requireRole(RECONCILE_ROLES);
  if (!auth.ok) return auth.response;

  try {
    const { importId: rawImportId } = await params;
    const importId = parseIdParam(rawImportId);
    if (importId === null) return badRequest('importId ต้องเป็นจำนวนเต็มบวก');

    const body = await req.json().catch(() => null);
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
    if (!reason) return badRequest('กรุณาระบุเหตุผลที่ลบไฟล์');
    if (reason.length > MAX_REASON_LENGTH) {
      return badRequest(`เหตุผลยาวเกินไป (ไม่เกิน ${MAX_REASON_LENGTH} ตัวอักษร)`);
    }
    // ผู้ลบอ่านจาก session cookie ที่เซ็นไว้ ไม่รับจาก body — ประวัติการลบปลอมชื่อไม่ได้
    const deletedBy = auth.session.displayName;

    const pool = await getPool();
    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      // ล็อกหัวไฟล์ไว้จนจบ transaction — กันสองคนกดลบไฟล์เดียวกันพร้อมกันแล้วผ่านทั้งคู่
      const header = await new sql.Request(transaction)
        .input('importId', sql.Int, importId)
        .query(`SELECT Status FROM BankStatementImport WITH (UPDLOCK) WHERE ImportId = @importId`);
      const file = header.recordset[0];
      if (!file) throw new DeleteBlockedError('ไม่พบไฟล์นี้ในระบบ', 404);
      if (file.Status !== 'SUCCESS') throw new DeleteBlockedError('ไฟล์นี้ถูกลบไปแล้ว กรุณารีเฟรชหน้า', 409);

      // รายการที่ยังถูกใช้อยู่ = สถานะไม่ใช่ UNMATCHED หรือยังอยู่ในการจับคู่ที่ใช้งานอยู่
      // เช็คทั้งสองทางเผื่อข้อมูลที่สถานะไม่ตรงกัน ไม่งั้นรายงานฝั่งที่จับคู่แล้วจะยังนับรายการของไฟล์ที่ลบไปแล้ว
      // UPDLOCK ค้างบรรทัดของไฟล์ไว้ด้วย กันคนอื่นจับคู่รายการในไฟล์นี้แทรกเข้ามาระหว่างเช็คกับ mark ลบ
      const locked = await new sql.Request(transaction)
        .input('importId', sql.Int, importId)
        .query(`
          SELECT COUNT(*) AS LockedCount
          FROM BankStatementLine l WITH (UPDLOCK)
          WHERE l.ImportId = @importId
            AND (
              l.MatchStatus <> 'UNMATCHED'
              OR EXISTS (
                SELECT 1 FROM ReconciliationMatchLine rml
                JOIN ReconciliationMatch rm ON rm.MatchId = rml.MatchId AND rm.Status = 'ACTIVE'
                WHERE rml.SourceType = 'BANK' AND rml.BankLineId = l.LineId AND rml.Status = 'ACTIVE'
              )
            )
        `);
      const lockedCount = Number(locked.recordset[0]?.LockedCount ?? 0);
      if (lockedCount > 0) {
        throw new DeleteBlockedError(
          `ลบไม่ได้ เพราะมี ${lockedCount.toLocaleString('th-TH')} รายการในไฟล์นี้ยังจับคู่หรือพักไว้อยู่ — ` +
            'ต้องยกเลิกการจับคู่ก่อน จึงจะลบทั้งไฟล์ได้',
          409
        );
      }

      const lines = await new sql.Request(transaction)
        .input('importId', sql.Int, importId)
        .query(`UPDATE BankStatementLine SET MatchStatus = 'DELETED' WHERE ImportId = @importId`);

      await new sql.Request(transaction)
        .input('importId', sql.Int, importId)
        .input('deletedBy', sql.NVarChar(100), deletedBy)
        .input('reason', sql.NVarChar(500), reason)
        .query(`
          UPDATE BankStatementImport
          SET Status = 'DELETED', DeletedAt = SYSDATETIMEOFFSET(), DeletedBy = @deletedBy, DeletedReason = @reason
          WHERE ImportId = @importId
        `);

      await transaction.commit();
      return NextResponse.json({ success: true, deletedLineCount: lines.rowsAffected[0] ?? 0 });
    } catch (err) {
      await transaction.rollback();
      if (err instanceof DeleteBlockedError) {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      throw err;
    }
  } catch (err) {
    console.error('Master bank-statement import DELETE error:', err);
    // 207 = Invalid column name — ยังไม่ได้รันสคริปต์ที่เพิ่มคอลัมน์ DeletedAt/DeletedBy/DeletedReason
    if ((err as { number?: number } | null)?.number === 207) {
      return NextResponse.json(
        {
          error:
            'ระบบยังไม่พร้อมลบไฟล์ — ต้องรัน sql/005_bank_statement_import_soft_delete.sql กับฐานข้อมูลก่อน (ยังไม่มีข้อมูลใดถูกลบ)',
        },
        { status: 500 }
      );
    }
    return NextResponse.json({ error: 'ลบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' }, { status: 500 });
  }
}
