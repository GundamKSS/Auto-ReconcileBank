import { NextRequest, NextResponse } from 'next/server';
import sql from 'mssql';
import { getPool } from '../../../../../lib/db';

import { requireRole } from '../../../../../lib/session';
import { RECONCILE_ROLES } from '../../../../../lib/roles';
import { badRequest, parseDateRange, parseIdParam } from '../../../../../lib/apiInput';

const PAGE_SIZE = 50;
const STATUS_VALUES = new Set(['UNMATCHED', 'MATCHED', 'SUSPENSE']);

// GET /api/master/bank-statement/lines?importId=123&offset=0&from=&to=&channel=&status=
// ดึงรายการของ import นั้นทีละ 50 (infinite scroll) — ไม่กรอง MatchStatus เป็นค่าเริ่มต้น เพราะเป็นหน้า
// master data ต้องเห็นครบทุกสถานะ แต่กรองได้ผ่าน query param status ถ้าต้องการ
//
// อ่านอย่างเดียว — Bank Statement เป็นเอกสารจากธนาคาร จึงไม่มี endpoint แก้ไข/เพิ่ม/ลบทีละรายการ
// ถ้าไฟล์ผิดให้ลบทั้งไฟล์ (DELETE /api/master/bank-statement/imports/:importId) แล้วนำเข้าใหม่
export async function GET(req: NextRequest) {
  const auth = await requireRole(RECONCILE_ROLES);
  if (!auth.ok) return auth.response;

  try {
    const params = req.nextUrl.searchParams;
    const raw = params.get('importId');
    if (!raw) return badRequest('ต้องระบุ importId');
    // เดิมตรวจแค่ว่ามีค่าส่งมาไหม ค่าอย่าง "abc" จะกลายเป็น NaN แล้ว query คืนรายการว่างพร้อม 200
    // ทำให้ผู้เรียกแยกไม่ออกว่า "ไฟล์นี้ไม่มีรายการ" หรือ "ส่ง id ผิด"
    const importId = parseIdParam(raw);
    if (importId === null) return badRequest('importId ต้องเป็นจำนวนเต็มบวก');

    const range = parseDateRange(params.get('from'), params.get('to'));
    if ('error' in range) return badRequest(range.error);
    const { from, to } = range;

    const channel = params.get('channel')?.trim() || null;
    const rawStatus = params.get('status')?.trim().toUpperCase() || null;
    if (rawStatus && !STATUS_VALUES.has(rawStatus)) return badRequest('status ต้องเป็น UNMATCHED, MATCHED หรือ SUSPENSE');

    const offset = Math.max(0, Number(params.get('offset') ?? '0') || 0);

    const whereClause = `
      WHERE ImportId = @importId
        ${from ? 'AND TranDate >= @from' : ''}
        ${to ? 'AND TranDate <= @to' : ''}
        ${channel ? 'AND Channel = @channel' : ''}
        ${rawStatus ? 'AND UPPER(MatchStatus) = @status' : ''}
    `;

    const bindFilters = (request: sql.Request) => {
      request.input('importId', sql.Int, importId);
      if (from) request.input('from', sql.Date, from);
      if (to) request.input('to', sql.Date, to);
      if (channel) request.input('channel', sql.NVarChar, channel);
      if (rawStatus) request.input('status', sql.NVarChar, rawStatus);
      return request;
    };

    const pool = await getPool();

    const linesResult = await bindFilters(pool.request())
      .input('offset', sql.Int, offset)
      .input('limit', sql.Int, PAGE_SIZE)
      .query(`
        SELECT LineId, ImportId, BankCode, TranDate, Description, Debit, Credit, Balance,
               ChequeNo, Channel, RawDescription, UPPER(MatchStatus) AS MatchStatus, CreatedAt
        FROM BankStatementLine
        ${whereClause}
        ORDER BY TranDate ASC, LineId ASC
        OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
      `);

    if (offset > 0) {
      return NextResponse.json({ lines: linesResult.recordset });
    }

    // นับ total + รายชื่อช่องทาง เฉพาะตอนโหลดหน้าแรก ไม่ต้องนับ/ดึงซ้ำทุกครั้งที่เลื่อนโหลดเพิ่ม
    const countResult = await bindFilters(pool.request()).query(`SELECT COUNT(*) AS Total FROM BankStatementLine ${whereClause}`);

    // รายชื่อช่องทางสำหรับปุ่มกรอง — ดึงจากทั้งไฟล์นี้ ไม่ผูกกับ filter ช่องทาง/สถานะ/วันที่ที่เลือกอยู่
    // ไม่งั้นพอเลือกช่องทางเดียวแล้วตัวเลือกช่องทางอื่นจะหายไปหมด (เหมือนปุ่มธนาคารในหน้า Match History)
    const channelsResult = await pool
      .request()
      .input('importId', sql.Int, importId)
      .query(`SELECT DISTINCT Channel FROM BankStatementLine WHERE ImportId = @importId AND Channel IS NOT NULL ORDER BY Channel`);

    return NextResponse.json({
      lines: linesResult.recordset,
      total: Number(countResult.recordset[0]?.Total ?? 0),
      channels: channelsResult.recordset.map((r) => String(r.Channel)),
    });
  } catch (err) {
    console.error('Master bank-statement lines GET error:', err);
    return NextResponse.json({ error: 'ดึงรายการไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' }, { status: 500 });
  }
}
