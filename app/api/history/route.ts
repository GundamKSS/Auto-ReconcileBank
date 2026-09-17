import { NextRequest, NextResponse } from 'next/server';
import sql from 'mssql';
import { getPool } from '../../../lib/db';

import { requireRole } from '../../../lib/session';
import { RECONCILE_ROLES } from '../../../lib/roles';
import { badRequest, parseDateRange } from '../../../lib/apiInput';
import { glAmount, glDirection } from '../../../lib/glAmount';
const PAGE_SIZE = 50;

/**
 * GET /api/history
 *
 * Query params:
 *   bankCode  - รหัสธนาคาร หรือไม่ใส่ = ทุกธนาคาร
 *   matchType - 'MATCHED' | 'SUSPENSE' หรือไม่ใส่ = ทั้งคู่
 *   side      - 'AR' (เงินเข้า) | 'AP' (เงินออก) หรือไม่ใส่/ALL = ทั้งคู่ — ความหมายเดียวกับหน้า Dashboard/Reports
 *               ดูจากทิศทางของบรรทัดฝั่ง Bank ใน Match (Credit มีค่า = เงินเข้า) Match ที่มีทั้งสองทิศปนกัน
 *               จะโผล่ทั้งสองแท็บ เพราะมีรายการของทั้งสองฝั่งอยู่จริง
 *   dateBasis - 'BANK' = from/to กรองที่วันที่ของ Bank Statement (TranDate)
 *               'CREATED' หรือไม่ใส่ = กรองที่เวลาที่กดจับคู่ (CreatedAt) แบบเดิม — หน้า Suspense ยังใช้แบบนี้
 *   from, to  - ช่วงวันที่ YYYY-MM-DD (ไม่ใส่ = ไม่กรองวันที่)
 *   q         - ค้นหาข้อความอิสระ — ตรงกับ MatchId, รายละเอียดฝั่ง Bank, หรือเลขที่/ชื่อบัญชีฝั่ง GL
 *   offset    - เริ่มที่ Match ลำดับที่เท่าไร (infinite scroll ทีละ 50 Match)
 *
 * ตอบกลับ total + bankCodes + sideCounts เฉพาะตอนโหลดหน้าแรก (offset = 0) เพื่อไม่ให้ต้องนับใหม่ทุกครั้งที่ scroll
 */
export async function GET(req: NextRequest) {
  const auth = await requireRole(RECONCILE_ROLES);
  if (!auth.ok) return auth.response;

  try {
    const params = req.nextUrl.searchParams;
    const bankCode = params.get('bankCode');
    const matchType = params.get('matchType');
    const from = params.get('from');
    const to = params.get('to');
    const rawQ = params.get('q');
    const q = rawQ && rawQ.trim() ? rawQ.trim() : null;
    const offset = Math.max(0, Number(params.get('offset') ?? '0') || 0);

    const rawSide = params.get('side')?.toUpperCase() ?? 'ALL';
    if (rawSide !== 'AR' && rawSide !== 'AP' && rawSide !== 'ALL') return badRequest('side ต้องเป็น AR, AP หรือ ALL');
    const side = rawSide as 'AR' | 'AP' | 'ALL';

    const rawBasis = params.get('dateBasis')?.toUpperCase() ?? 'CREATED';
    if (rawBasis !== 'BANK' && rawBasis !== 'CREATED') return badRequest('dateBasis ต้องเป็น BANK หรือ CREATED');
    const dateBasis = rawBasis as 'BANK' | 'CREATED';

    // ตรวจรูปแบบและลำดับวันที่ก่อนส่งเข้า query — ค่าผิดต้องได้ 400 พร้อมข้อความที่อ่านรู้เรื่อง
    // ไม่ใช่ปล่อยให้ mssql โยน "Validation failed for parameter 'from'" ออกมาเป็น 500
    const range = parseDateRange(from, to);
    if ('error' in range) return badRequest(range.error);

    // ช่วงวันที่ตาม CreatedAt (datetime มีเวลาแฝงอยู่) — from ใช้เที่ยงคืนของวันนั้น
    // to ต้องรวมทั้งวันสุดท้ายด้วย เลยขยับไปเที่ยงคืนของ "วันถัดไป" แล้วเทียบด้วย < แทน <=
    // ส่วน TranDate ของ Bank เป็นชนิด date ล้วน เทียบ BETWEEN ตรงๆ ได้เลย
    const fromDate = range.from;
    const toDate = range.to;
    let toDateExclusive: Date | null = null;
    if (toDate) {
      toDateExclusive = new Date(toDate);
      toDateExclusive.setUTCDate(toDateExclusive.getUTCDate() + 1);
    }
    const byBankDate = dateBasis === 'BANK' && Boolean(fromDate || toDate);

    // เงื่อนไขของ "บรรทัดฝั่ง Bank" — ทิศทาง (AR/AP) กับวันที่ Bank ต้องเป็นของบรรทัดเดียวกัน จึงรวมไว้ใน EXISTS ก้อนเดียว
    // ไม่งั้นแท็บ AR + เดือน ส.ค. จะได้ Match ที่มีเงินเข้าเดือน ก.ค. กับเงินออกเดือน ส.ค. ติดมาด้วย
    function bankLineExists(sideOfLine: 'AR' | 'AP' | 'ALL') {
      const conds = [
        sideOfLine === 'AR' ? 'x_bsl.Credit IS NOT NULL' : '',
        sideOfLine === 'AP' ? 'x_bsl.Credit IS NULL' : '',
        byBankDate && fromDate ? 'x_bsl.TranDate >= @bankFrom' : '',
        byBankDate && toDate ? 'x_bsl.TranDate <= @bankTo' : '',
      ].filter(Boolean);
      if (conds.length === 0) return '';
      return `AND EXISTS (
        SELECT 1 FROM ReconciliationMatchLine x_rml
        JOIN BankStatementLine x_bsl ON x_bsl.LineId = x_rml.BankLineId
        WHERE x_rml.MatchId = rm.MatchId AND x_rml.SourceType = 'BANK' AND ${conds.join(' AND ')}
      )`;
    }

    // ค้นหาต้องเห็นได้ทุก Match ในระบบ ไม่ใช่แค่หน้าที่โหลดมาแล้ว จึงกรองที่ SQL ไม่ใช่ฝั่ง client
    // (ต่างจาก MatchId ที่ cast ตรงๆ ได้ — คำค้นอาจตรงกับรายละเอียดฝั่ง Bank หรือ GL เท่านั้น เลยต้อง EXISTS
    // เข้าไปเช็คที่บรรทัดย่อยของ Match นั้น ตาม SourceType)
    // ไม่รวมเงื่อนไข AR/AP ไว้ที่นี่ — ส่วนนับจำนวนต่อแท็บต้องใช้เงื่อนไขอื่นทั้งหมดเหมือนเดิมแต่ไม่กรองฝั่ง
    const baseWhere = `
      WHERE 1=1
        ${bankCode ? 'AND rm.BankCode = @bankCode' : ''}
        ${matchType ? 'AND rm.MatchType = @matchType' : ''}
        ${dateBasis === 'CREATED' && fromDate ? 'AND rm.CreatedAt >= @from' : ''}
        ${dateBasis === 'CREATED' && toDateExclusive ? 'AND rm.CreatedAt < @to' : ''}
        ${
          q
            ? `AND (
                CAST(rm.MatchId AS NVARCHAR(20)) LIKE @q
                OR EXISTS (
                  SELECT 1 FROM ReconciliationMatchLine q_rml
                  JOIN BankStatementLine q_bsl ON q_bsl.LineId = q_rml.BankLineId
                  WHERE q_rml.MatchId = rm.MatchId AND q_rml.SourceType = 'BANK' AND q_bsl.Description LIKE @q
                )
                OR EXISTS (
                  SELECT 1 FROM ReconciliationMatchLine q_rml
                  JOIN BankAccountLedgerEntries q_e ON q_e.Entry_No = q_rml.GLEntryNo
                  LEFT JOIN BankAccountMapping q_m ON q_m.BankAccountNo = q_e.Bank_Account_No
                  WHERE q_rml.MatchId = rm.MatchId AND q_rml.SourceType = 'GL'
                    AND (q_e.Document_No LIKE @q OR q_m.BankAccountName LIKE @q)
                )
              )`
            : ''
        }
    `;
    const whereClause = `${baseWhere} ${bankLineExists(side)}`;

    // ทุก query ที่ใช้ baseWhere ต้อง bind พารามิเตอร์ชุดเดียวกัน — รวมไว้ที่เดียวกันลืม
    function bindFilters(request: sql.Request) {
      if (bankCode) request.input('bankCode', sql.NVarChar, bankCode);
      if (matchType) request.input('matchType', sql.NVarChar, matchType);
      if (dateBasis === 'CREATED' && fromDate) request.input('from', sql.DateTime2, fromDate);
      if (dateBasis === 'CREATED' && toDateExclusive) request.input('to', sql.DateTime2, toDateExclusive);
      if (byBankDate && fromDate) request.input('bankFrom', sql.Date, fromDate);
      if (byBankDate && toDate) request.input('bankTo', sql.Date, toDate);
      if (q) request.input('q', sql.NVarChar, `%${q}%`);
      return request;
    }

    const pool = await getPool();

    // 1) หา MatchId ของหน้านี้ก่อน (ล่าสุดก่อน, ทีละ 50) แล้วค่อยไป join รายละเอียดเฉพาะชุดนี้
    //    — กันไม่ให้ต้อง join รายละเอียดของ Match ทั้งหมดในระบบทุกครั้งที่โหลด เหมือนโค้ดเดิม
    const idRequest = bindFilters(pool.request());
    idRequest.input('offset', sql.Int, offset);
    idRequest.input('limit', sql.Int, PAGE_SIZE);
    const idResult = await idRequest.query(`
      SELECT rm.MatchId
      FROM ReconciliationMatch rm
      ${whereClause}
      ORDER BY rm.CreatedAt DESC, rm.MatchId DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `);
    const pageMatchIds: number[] = idResult.recordset.map((r) => Number(r.MatchId));

    // หน้าแรกว่างก็ยังต้องนับจำนวนต่อแท็บ — แท็บ AP อาจว่างแต่ AR มีรายการ ผู้ใช้ต้องเห็นเลขนั้นเพื่อกดสลับไป
    if (pageMatchIds.length === 0 && offset > 0) {
      return NextResponse.json({ matches: [] });
    }
    // MatchId มาจาก query ของเราเอง (Number() แล้วทุกตัว) ไม่ใช่ input ดิบจาก client — ปลอดภัยจาก SQL injection
    const idsCsv = pageMatchIds.length > 0 ? pageMatchIds.join(',') : 'NULL';

    // 2) หัวบันทึกของ MatchId หน้านี้เท่านั้น
    const headerResult = await pool.request().query(`
      SELECT MatchId, BankCode, MatchType, CreatedBy, CreatedAt, Status, ReversedAt, ReversedBy, ReversedReason
      FROM ReconciliationMatch
      WHERE MatchId IN (${idsCsv})
    `);

    // 3) รายละเอียดฝั่ง Bank เฉพาะ MatchId หน้านี้ (join กลับ BankStatementLine) — ดึง Num มาด้วย
    const bankLinesResult = await pool.request().query(`
      SELECT rm.MatchId, rml.Num, rml.Status, rml.ReversedAt, rml.ReversedBy, rml.ReversedReason,
             bsl.LineId, bsl.TranDate, bsl.Description, bsl.Debit, bsl.Credit
      FROM ReconciliationMatch rm
      JOIN ReconciliationMatchLine rml ON rml.MatchId = rm.MatchId AND rml.SourceType = 'BANK'
      JOIN BankStatementLine bsl ON bsl.LineId = rml.BankLineId
      WHERE rm.MatchId IN (${idsCsv})
    `);

    // 4) รายละเอียดฝั่ง GL เฉพาะ MatchId หน้านี้ (join กลับ BankAccountLedgerEntries)
    const glLinesResult = await pool.request().query(`
      SELECT rm.MatchId, rml.Num, rml.Status, rml.ReversedAt, rml.ReversedBy, rml.ReversedReason,
             e.Entry_No, e.Posting_Date, e.Document_No, e.Bank_Account_No,
             m.BankAccountName, e.Debit_Amount_LCY, e.Credit_Amount_LCY
      FROM ReconciliationMatch rm
      JOIN ReconciliationMatchLine rml ON rml.MatchId = rm.MatchId AND rml.SourceType = 'GL'
      JOIN BankAccountLedgerEntries e ON e.Entry_No = rml.GLEntryNo
      LEFT JOIN BankAccountMapping m ON m.BankAccountNo = e.Bank_Account_No
      WHERE rm.MatchId IN (${idsCsv})
    `);

    // รวมทั้ง 3 query เข้าด้วยกัน กลุ่มตาม MatchId
    const bankLinesByMatch = new Map<number, unknown[]>();
    for (const r of bankLinesResult.recordset) {
      const list = bankLinesByMatch.get(r.MatchId) ?? [];
      list.push({
        lineId: Number(r.LineId),
        num: r.Num,
        date: r.TranDate,
        description: r.Description,
        direction: r.Credit !== null ? 'IN' : 'OUT',
        amount: r.Credit !== null ? r.Credit : r.Debit,
        status: r.Status ?? 'ACTIVE',
        reversedAt: r.ReversedAt ?? null,
        reversedBy: r.ReversedBy ?? null,
        reversedReason: r.ReversedReason ?? null,
      });
      bankLinesByMatch.set(r.MatchId, list);
    }

    const glLinesByMatch = new Map<number, unknown[]>();
    for (const r of glLinesResult.recordset) {
      const list = glLinesByMatch.get(r.MatchId) ?? [];
      list.push({
        entryNo: Number(r.Entry_No),
        num: r.Num,
        date: r.Posting_Date,
        ref: r.Document_No,
        accountName: r.BankAccountName,
        direction: glDirection(r),
        amount: glAmount(r),
        status: r.Status ?? 'ACTIVE',
        reversedAt: r.ReversedAt ?? null,
        reversedBy: r.ReversedBy ?? null,
        reversedReason: r.ReversedReason ?? null,
      });
      glLinesByMatch.set(r.MatchId, list);
    }

    // ประกอบกลับตามลำดับเดิมจาก idResult (CreatedAt DESC) — ห้ามใช้ลำดับของ headerResult เพราะ
    // WHERE MatchId IN (...) ไม่การันตีลำดับแถวที่ได้กลับมา
    const headerByMatchId = new Map(headerResult.recordset.map((h) => [Number(h.MatchId), h]));
    const matches = pageMatchIds
      .map((id) => headerByMatchId.get(id))
      .filter((h): h is NonNullable<typeof h> => h != null)
      .map((h) => ({
        matchId: h.MatchId,
        bankCode: h.BankCode,
        matchType: h.MatchType,
        createdBy: h.CreatedBy,
        createdAt: h.CreatedAt,
        status: h.Status ?? 'ACTIVE',
        reversedAt: h.ReversedAt,
        reversedBy: h.ReversedBy,
        reversedReason: h.ReversedReason,
        bankLines: bankLinesByMatch.get(h.MatchId) ?? [],
        glLines: glLinesByMatch.get(h.MatchId) ?? [],
      }));

    if (offset > 0) {
      return NextResponse.json({ matches });
    }

    // นับ total + รายชื่อธนาคาร เฉพาะตอนโหลดหน้าแรก ไม่ต้องนับซ้ำทุกครั้งที่เลื่อนโหลดเพิ่ม
    // นับทั้งแท็บปัจจุบัน (total) และจำนวนของทุกแท็บ (sideCounts) ใน query เดียว
    // sideCounts ใช้ baseWhere ที่ไม่กรองฝั่ง ไม่งั้นพออยู่แท็บ AR แล้วเลขของแท็บ AP จะกลายเป็น 0
    // SQL Server ไม่ยอมให้ SUM ครอบนิพจน์ที่มี subquery (EXISTS) ตรงๆ จึงคำนวณ flag ต่อแถวใน derived table ก่อน
    const countResult = await bindFilters(pool.request()).query(`
      SELECT COUNT(*) AS AllCount, SUM(t.IsAr) AS ArCount, SUM(t.IsAp) AS ApCount
      FROM (
        SELECT
          CASE WHEN 1=1 ${bankLineExists('AR')} THEN 1 ELSE 0 END AS IsAr,
          CASE WHEN 1=1 ${bankLineExists('AP')} THEN 1 ELSE 0 END AS IsAp
        FROM ReconciliationMatch rm
        ${baseWhere} ${bankLineExists('ALL')}
      ) t
    `);
    const counts = countResult.recordset[0] ?? {};
    const sideCounts = {
      ALL: Number(counts.AllCount ?? 0),
      AR: Number(counts.ArCount ?? 0),
      AP: Number(counts.ApCount ?? 0),
    };
    const total = sideCounts[side];

    // รายชื่อธนาคารสำหรับปุ่มกรอง — ดึงจากข้อมูลจริงทั้งหมด ไม่ผูกกับ filter ธนาคาร/วันที่ที่เลือกอยู่
    // ไม่งั้นพอเลือกธนาคารเดียวแล้วปุ่มธนาคารอื่นจะหายไปหมด
    // (แต่ยังผูกกับ matchType — หน้า Match History ไม่ควรมีปุ่มธนาคารที่มีแต่รายการพักโอนโผล่มาแล้วกดได้ผลลัพธ์ว่าง)
    const bankCodesRequest = pool.request();
    if (matchType) bankCodesRequest.input('matchType', sql.NVarChar, matchType);
    const bankCodesResult = await bankCodesRequest.query(`
      SELECT DISTINCT BankCode FROM ReconciliationMatch
      WHERE BankCode IS NOT NULL ${matchType ? 'AND MatchType = @matchType' : ''}
      ORDER BY BankCode
    `);

    return NextResponse.json({
      matches,
      total,
      sideCounts,
      bankCodes: bankCodesResult.recordset.map((r) => String(r.BankCode)),
    });
  } catch (err) {
    console.error('Match history API error:', err);
    return NextResponse.json({ error: 'ดึงประวัติการจับคู่ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' }, { status: 500 });
  }
}
