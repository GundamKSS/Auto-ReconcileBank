import { NextRequest, NextResponse } from 'next/server';
import sql from 'mssql';
import { getPool } from '../../../lib/db';

import { requireRole } from '../../../lib/session';
import { RECONCILE_ROLES } from '../../../lib/roles';
import { badRequest, parseDateRange } from '../../../lib/apiInput';
import { bankSignedSql, glAmount, glDirection, glSignedSql } from '../../../lib/glAmount';
import { reconcileExtrasReady } from '../../../lib/reconcileExtrasDb';
const PAGE_SIZE = 50;

// ประเภทของ ReconciliationMatch ทั้งหมดที่ระบบสร้างได้ (ดู app/api/reconcile/match/route.ts)
// MATCHED = จับคู่ Bank ↔ BC, SUSPENSE = ย้ายเข้าบัญชีพัก, OFFSET = หักล้างกันเองใน BC,
// EXCLUDED = JV ปรับปรุงพักโอนที่ไม่นำมาจับคู่ — สามแบบหลังมีแต่บรรทัดฝั่ง GL
const MATCH_TYPES = ['MATCHED', 'SUSPENSE', 'OFFSET', 'EXCLUDED'] as const;
type MatchTypeValue = (typeof MATCH_TYPES)[number];

/**
 * GET /api/history
 *
 * Query params:
 *   bankCode  - รหัสธนาคาร หรือไม่ใส่ = ทุกธนาคาร
 *   matchType - 'MATCHED' | 'SUSPENSE' | 'OFFSET' | 'EXCLUDED' ใส่ได้หลายค่าคั่นด้วย comma
 *               ('MATCHED,OFFSET') หรือไม่ใส่ = ทุกประเภท
 *               ทุกประเภทยกเว้น MATCHED มีแต่บรรทัดฝั่ง GL — ใช้คู่กับ dateBasis GL/CREATED และ side ALL
 *               เท่านั้น (dateBasis BANK หรือ side AR/AP กรองจากบรรทัด Bank จึงไม่มีทางเจอ)
 *   side      - 'AR' (เงินเข้า) | 'AP' (เงินออก) หรือไม่ใส่/ALL = ทั้งคู่ — ความหมายเดียวกับหน้า Dashboard/Reports
 *               ดูจากทิศทางของบรรทัดฝั่ง Bank ใน Match (Credit มีค่า = เงินเข้า) Match ที่มีทั้งสองทิศปนกัน
 *               จะโผล่ทั้งสองแท็บ เพราะมีรายการของทั้งสองฝั่งอยู่จริง
 *   dateBasis - 'BANK' = วันที่ Bank Statement, 'GL' = วันที่ลงบัญชี BC (Posting_Date)
 *               'CREATED' หรือไม่ใส่ = เวลาที่กดจับคู่ (หน้า Suspense ยังใช้แบบนี้)
 *   from, to  - ช่วงวันที่ YYYY-MM-DD (ไม่ใส่ = ไม่กรองวันที่)
 *   q         - ค้นหาทั้ง MatchId, Line/Entry No., ยอดเงิน, รายละเอียด/เช็คฝั่ง Bank,
 *               เลขเอกสาร/เลขบัญชี/ชื่อบัญชีฝั่ง GL, ธนาคาร และผู้จับคู่
 *   offset    - เริ่มที่ Match ลำดับที่เท่าไร (infinite scroll ทีละ 50 Match)
 *
 * ตอบกลับ total + bankCodes + sideCounts + typeCounts เฉพาะตอนโหลดหน้าแรก (offset = 0)
 * เพื่อไม่ให้ต้องนับใหม่ทุกครั้งที่ scroll — typeCounts นับโดยไม่สนตัวกรองประเภท เพื่อให้แท็บประเภท
 * ยังโชว์เลขของแท็บอื่นได้ตอนที่เลือกแท็บใดแท็บหนึ่งอยู่ (หลักเดียวกับ sideCounts)
 */
export async function GET(req: NextRequest) {
  const auth = await requireRole(RECONCILE_ROLES);
  if (!auth.ok) return auth.response;

  try {
    const params = req.nextUrl.searchParams;
    const bankCode = params.get('bankCode');
    // matchType รับได้ทั้งค่าเดียวและหลายค่าคั่นด้วย comma — หน้าประวัติแท็บ "ทั้งหมด" ไม่ส่งมาเลย = ไม่กรองประเภท
    const rawMatchTypes = (params.get('matchType') ?? '')
      .split(',')
      .map((v) => v.trim().toUpperCase())
      .filter(Boolean);
    if (rawMatchTypes.some((t) => !(MATCH_TYPES as readonly string[]).includes(t))) {
      return badRequest(`matchType ต้องเป็น ${MATCH_TYPES.join(', ')}`);
    }
    const matchTypes = [...new Set(rawMatchTypes)] as MatchTypeValue[];
    // ชื่อพารามิเตอร์ของแต่ละประเภท — ประกอบเป็น IN (@matchType0, @matchType1, ...) ใช้ร่วมกันทุก query
    const matchTypeParams = matchTypes.map((_, i) => `@matchType${i}`).join(', ');
    function bindMatchTypes(request: sql.Request) {
      matchTypes.forEach((t, i) => request.input(`matchType${i}`, sql.NVarChar, t));
      return request;
    }
    const from = params.get('from');
    const to = params.get('to');
    const rawQ = params.get('q');
    const q = rawQ && rawQ.trim() ? rawQ.trim() : null;
    const qCompact = q?.replace(/,/g, '') ?? null;
    const offset = Math.max(0, Number(params.get('offset') ?? '0') || 0);
    const extrasReady = await reconcileExtrasReady();
    // หน้า Suspense ต้องรวมทั้งรายการที่พักทั้งแถว และผลต่างของ MATCHED ที่ยอด Bank/BC ไม่เท่ากัน
    const includeDifferenceSuspense =
      params.get('includeDifferenceSuspense') === '1' &&
      matchTypes.length === 1 &&
      matchTypes[0] === 'SUSPENSE' &&
      extrasReady;

    const differenceSuspenseSql = `
      rm.MatchType = 'MATCHED' AND rm.Status = 'ACTIVE' AND rm.Remark IS NOT NULL
      AND ABS(
        ABS(COALESCE((
          SELECT SUM(${bankSignedSql('ds_b')})
          FROM ReconciliationMatchLine ds_bl
          JOIN BankStatementLine ds_b ON ds_b.LineId = ds_bl.BankLineId
          WHERE ds_bl.MatchId = rm.MatchId AND ds_bl.SourceType = 'BANK' AND ds_bl.Status = 'ACTIVE'
        ), 0))
        - ABS(COALESCE((
          SELECT SUM(${glSignedSql('ds_g')})
          FROM ReconciliationMatchLine ds_gl
          JOIN BankAccountLedgerEntries ds_g ON ds_g.Entry_No = ds_gl.GLEntryNo
          WHERE ds_gl.MatchId = rm.MatchId AND ds_gl.SourceType = 'GL' AND ds_gl.Status = 'ACTIVE'
        ), 0))
      ) >= 0.005
    `;

    const rawSide = params.get('side')?.toUpperCase() ?? 'ALL';
    if (rawSide !== 'AR' && rawSide !== 'AP' && rawSide !== 'ALL') return badRequest('side ต้องเป็น AR, AP หรือ ALL');
    const side = rawSide as 'AR' | 'AP' | 'ALL';

    const rawBasis = params.get('dateBasis')?.toUpperCase() ?? 'CREATED';
    if (rawBasis !== 'BANK' && rawBasis !== 'GL' && rawBasis !== 'CREATED') {
      return badRequest('dateBasis ต้องเป็น BANK, GL หรือ CREATED');
    }
    const dateBasis = rawBasis as 'BANK' | 'GL' | 'CREATED';

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
    const byGlDate = dateBasis === 'GL' && Boolean(fromDate || toDate);

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

    function glLineExists() {
      if (!byGlDate) return '';
      const conds = [
        fromDate ? 'x_e.Posting_Date >= @glFrom' : '',
        toDate ? 'x_e.Posting_Date <= @glTo' : '',
      ].filter(Boolean);
      return `AND EXISTS (
        SELECT 1 FROM ReconciliationMatchLine x_rml
        JOIN BankAccountLedgerEntries x_e ON x_e.Entry_No = x_rml.GLEntryNo
        WHERE x_rml.MatchId = rm.MatchId AND x_rml.SourceType = 'GL' AND ${conds.join(' AND ')}
      )`;
    }

    // ค้นหาต้องเห็นได้ทุก Match ในระบบ ไม่ใช่แค่หน้าที่โหลดมาแล้ว จึงกรองที่ SQL ไม่ใช่ฝั่ง client
    // (ต่างจาก MatchId ที่ cast ตรงๆ ได้ — คำค้นอาจตรงกับรายละเอียดฝั่ง Bank หรือ GL เท่านั้น เลยต้อง EXISTS
    // เข้าไปเช็คที่บรรทัดย่อยของ Match นั้น ตาม SourceType)
    // ไม่รวมเงื่อนไข AR/AP ไว้ที่นี่ — ส่วนนับจำนวนต่อแท็บต้องใช้เงื่อนไขอื่นทั้งหมดเหมือนเดิมแต่ไม่กรองฝั่ง
    // และแยกเงื่อนไข "ประเภท" ออกมาต่างหาก เพราะการนับจำนวนต่อประเภท (typeCounts) ต้องไม่กรองประเภท
    const typeCondition =
      matchTypes.length === 0
        ? ''
        : includeDifferenceSuspense
          ? `AND (rm.MatchType IN (${matchTypeParams}) OR (${differenceSuspenseSql}))`
          : `AND rm.MatchType IN (${matchTypeParams})`;

    const whereWithoutType = `
      WHERE 1=1
        ${bankCode ? 'AND rm.BankCode = @bankCode' : ''}
        ${dateBasis === 'CREATED' && fromDate ? 'AND rm.CreatedAt >= @from' : ''}
        ${dateBasis === 'CREATED' && toDateExclusive ? 'AND rm.CreatedAt < @to' : ''}
        ${
          q
            ? `AND (
                CAST(rm.MatchId AS NVARCHAR(20)) LIKE @q
                OR rm.BankCode LIKE @q
                OR rm.CreatedBy LIKE @q
                OR EXISTS (
                  SELECT 1 FROM ReconciliationMatchLine q_rml
                  JOIN BankStatementLine q_bsl ON q_bsl.LineId = q_rml.BankLineId
                  WHERE q_rml.MatchId = rm.MatchId AND q_rml.SourceType = 'BANK'
                    AND (
                      CAST(q_bsl.LineId AS NVARCHAR(30)) LIKE @q
                      OR q_bsl.Description LIKE @q
                      OR q_bsl.ChequeNo LIKE @q
                      OR q_bsl.RawDescription LIKE @q
                      OR CONVERT(NVARCHAR(50), q_bsl.Credit) LIKE @qCompact
                      OR CONVERT(NVARCHAR(50), q_bsl.Debit) LIKE @qCompact
                    )
                )
                OR EXISTS (
                  SELECT 1 FROM ReconciliationMatchLine q_rml
                  JOIN BankAccountLedgerEntries q_e ON q_e.Entry_No = q_rml.GLEntryNo
                  LEFT JOIN BankAccountMapping q_m ON q_m.BankAccountNo = q_e.Bank_Account_No
                  WHERE q_rml.MatchId = rm.MatchId AND q_rml.SourceType = 'GL'
                    AND (
                      CAST(q_e.Entry_No AS NVARCHAR(30)) LIKE @q
                      OR q_e.Document_No LIKE @q
                      OR q_e.Bank_Account_No LIKE @q
                      OR q_m.BankAccountName LIKE @q
                      OR CONVERT(NVARCHAR(50), q_e.Debit_Amount_LCY) LIKE @qCompact
                      OR CONVERT(NVARCHAR(50), q_e.Credit_Amount_LCY) LIKE @qCompact
                    )
                )
              )`
            : ''
        }
    `;
    const baseWhere = `${whereWithoutType} ${typeCondition}`;
    const whereClause = `${baseWhere} ${bankLineExists(side)} ${glLineExists()}`;

    // ทุก query ที่ใช้ baseWhere ต้อง bind พารามิเตอร์ชุดเดียวกัน — รวมไว้ที่เดียวกันลืม
    function bindFilters(request: sql.Request) {
      if (bankCode) request.input('bankCode', sql.NVarChar, bankCode);
      bindMatchTypes(request);
      if (dateBasis === 'CREATED' && fromDate) request.input('from', sql.DateTime2, fromDate);
      if (dateBasis === 'CREATED' && toDateExclusive) request.input('to', sql.DateTime2, toDateExclusive);
      if (byBankDate && fromDate) request.input('bankFrom', sql.Date, fromDate);
      if (byBankDate && toDate) request.input('bankTo', sql.Date, toDate);
      if (byGlDate && fromDate) request.input('glFrom', sql.Date, fromDate);
      if (byGlDate && toDate) request.input('glTo', sql.Date, toDate);
      if (q) {
        request.input('q', sql.NVarChar, `%${q}%`);
        request.input('qCompact', sql.NVarChar, `%${qCompact}%`);
      }
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
      ${
        dateBasis === 'BANK'
          ? `OUTER APPLY (
               SELECT MIN(o_bsl.TranDate) AS FirstBankDate
               FROM ReconciliationMatchLine o_rml
               JOIN BankStatementLine o_bsl ON o_bsl.LineId = o_rml.BankLineId
               WHERE o_rml.MatchId = rm.MatchId AND o_rml.SourceType = 'BANK'
             ) ord`
          : ''
      }
      ${whereClause}
      ${
        // กรองตามวันที่ Bank → เรียงวันที่ 1 ไปสิ้นเดือนตามวันที่รายการแรกใน statement
        // Match ที่ไม่มีบรรทัด Bank ให้อ้างอิงไปอยู่ท้ายสุด; MatchId ต่อท้ายให้ลำดับนิ่งตอน infinite scroll
        dateBasis === 'BANK'
          ? 'ORDER BY CASE WHEN ord.FirstBankDate IS NULL THEN 1 ELSE 0 END, ord.FirstBankDate ASC, rm.MatchId ASC'
          : 'ORDER BY rm.CreatedAt DESC, rm.MatchId DESC'
      }
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
    // หมายเหตุมีเฉพาะหลังรัน sql/007 — คู่ที่จับทั้งที่ยอดไม่เท่ากันต้องเห็นเหตุผลในหน้าประวัติ
    const remarkColumn = extrasReady ? 'Remark' : 'CAST(NULL AS NVARCHAR(500)) AS Remark';
    const headerResult = await pool.request().query(`
      SELECT MatchId, BankCode, MatchType, CreatedBy, CreatedAt, Status, ReversedAt, ReversedBy, ReversedReason, ${remarkColumn}
      FROM ReconciliationMatch
      WHERE MatchId IN (${idsCsv})
    `);

    // 3) รายละเอียดฝั่ง Bank เฉพาะ MatchId หน้านี้ (join กลับ BankStatementLine) — ดึง Num มาด้วย
    const bankLinesResult = await pool.request().query(`
      SELECT rm.MatchId, rml.Num, rml.Status, rml.ReversedAt, rml.ReversedBy, rml.ReversedReason,
             bsl.LineId, bsl.TranDate, bsl.Description, bsl.ChequeNo, bsl.Debit, bsl.Credit
      FROM ReconciliationMatch rm
      JOIN ReconciliationMatchLine rml ON rml.MatchId = rm.MatchId AND rml.SourceType = 'BANK'
      JOIN BankStatementLine bsl ON bsl.LineId = rml.BankLineId
      WHERE rm.MatchId IN (${idsCsv})
    `);

    // 4) รายละเอียดฝั่ง GL เฉพาะ MatchId หน้านี้ (join กลับ BankAccountLedgerEntries)
    const glLinesResult = await pool.request().query(`
      SELECT rm.MatchId, rml.Num, rml.Status, rml.ReversedAt, rml.ReversedBy, rml.ReversedReason,
             e.Entry_No, e.Posting_Date, e.Document_No, e.Bank_Account_No, e.Source_Code,
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
        ref: r.ChequeNo,
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
        accountNo: r.Bank_Account_No,
        accountName: r.BankAccountName,
        // หน้าประวัติหักล้างกันเองใช้แยก "กลับรายการใน BC" ออกจาก "จับคู่เอง" (lib/glOffset.ts)
        sourceCode: r.Source_Code ?? null,
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
      .map((h) => {
        const bankLines = (bankLinesByMatch.get(h.MatchId) ?? []) as Array<{ direction: 'IN' | 'OUT'; amount: number; status: string }>;
        const glLines = (glLinesByMatch.get(h.MatchId) ?? []) as Array<{ direction: 'IN' | 'OUT'; amount: number; status: string }>;
        const activeBank = bankLines.filter((l) => l.status === 'ACTIVE');
        const activeGl = glLines.filter((l) => l.status === 'ACTIVE');
        const bankSigned = activeBank.reduce((s, l) => s + (l.direction === 'IN' ? l.amount : -l.amount), 0);
        const glSigned = activeGl.reduce((s, l) => s + (l.direction === 'IN' ? l.amount : -l.amount), 0);
        const suspenseDifference = Math.round((Math.abs(bankSigned) - Math.abs(glSigned)) * 100) / 100;
        const isDifferenceSuspense = h.MatchType === 'MATCHED' && Math.abs(suspenseDifference) >= 0.005;
        return {
          matchId: h.MatchId,
          bankCode: h.BankCode,
          matchType: h.MatchType,
          suspenseKind: isDifferenceSuspense ? 'DIFFERENCE' : 'LINE',
          suspenseDifference: isDifferenceSuspense ? suspenseDifference : null,
          suspenseDirection: (bankSigned >= 0 ? 'IN' : 'OUT') as 'IN' | 'OUT',
          createdBy: h.CreatedBy,
          createdAt: h.CreatedAt,
          status: h.Status ?? 'ACTIVE',
          reversedAt: h.ReversedAt,
          reversedBy: h.ReversedBy,
          reversedReason: h.ReversedReason,
          remark: h.Remark ?? null,
          bankLines,
          glLines,
        };
      });

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
        ${baseWhere} ${bankLineExists('ALL')} ${glLineExists()}
      ) t
    `);
    const counts = countResult.recordset[0] ?? {};
    const sideCounts = {
      ALL: Number(counts.AllCount ?? 0),
      AR: Number(counts.ArCount ?? 0),
      AP: Number(counts.ApCount ?? 0),
    };
    const total = sideCounts[side];

    // จำนวน Match ของแต่ละประเภท ภายใต้ตัวกรองอื่นที่เลือกอยู่ (ธนาคาร/ช่วงวันที่/คำค้น/ฝั่ง) แต่ไม่กรองประเภท
    // — ไม่งั้นพอกดแท็บ "หักล้างกันเอง" แล้วเลขบนแท็บอื่นจะกลายเป็น 0 ทั้งแถว
    const typeCountResult = await bindFilters(pool.request()).query(`
      SELECT rm.MatchType AS MatchType, COUNT(*) AS Cnt
      FROM ReconciliationMatch rm
      ${whereWithoutType} ${bankLineExists(side)} ${glLineExists()}
      GROUP BY rm.MatchType
    `);
    const typeCounts: Record<MatchTypeValue, number> = { MATCHED: 0, SUSPENSE: 0, OFFSET: 0, EXCLUDED: 0 };
    let typeCountAll = 0;
    for (const row of typeCountResult.recordset) {
      const cnt = Number(row.Cnt ?? 0);
      typeCountAll += cnt;
      const key = String(row.MatchType ?? '') as MatchTypeValue;
      if (key in typeCounts) typeCounts[key] = cnt;
    }

    let suspenseSummary: { incoming: number; outgoing: number; lineCount: number; differenceCount: number } | undefined;
    if (includeDifferenceSuspense) {
      const summaryResult = await bindFilters(pool.request()).query(`
        SELECT
          COALESCE(SUM(CASE
            WHEN x.MatchType = 'SUSPENSE' THEN x.GlIn
            WHEN x.MatchType = 'MATCHED' AND x.BankNet >= 0 THEN x.DifferenceAmount
            ELSE 0 END), 0) AS Incoming,
          COALESCE(SUM(CASE
            WHEN x.MatchType = 'SUSPENSE' THEN x.GlOut
            WHEN x.MatchType = 'MATCHED' AND x.BankNet < 0 THEN x.DifferenceAmount
            ELSE 0 END), 0) AS Outgoing,
          COALESCE(SUM(CASE WHEN x.MatchType = 'SUSPENSE' THEN 1 ELSE 0 END), 0) AS LineCount,
          COALESCE(SUM(CASE WHEN x.MatchType = 'MATCHED' THEN 1 ELSE 0 END), 0) AS DifferenceCount
        FROM (
          SELECT rm.MatchType,
                 COALESCE(bt.BankNet, 0) AS BankNet,
                 ABS(ABS(COALESCE(bt.BankNet, 0)) - ABS(COALESCE(gt.GlNet, 0))) AS DifferenceAmount,
                 COALESCE(gt.GlIn, 0) AS GlIn,
                 COALESCE(gt.GlOut, 0) AS GlOut
          FROM ReconciliationMatch rm
          OUTER APPLY (
            SELECT SUM(${bankSignedSql('sb')}) AS BankNet
            FROM ReconciliationMatchLine sl
            JOIN BankStatementLine sb ON sb.LineId = sl.BankLineId
            WHERE sl.MatchId = rm.MatchId AND sl.SourceType = 'BANK' AND sl.Status = 'ACTIVE'
          ) bt
          OUTER APPLY (
            SELECT SUM(${glSignedSql('sg')}) AS GlNet,
                   SUM(CASE WHEN ${glSignedSql('sg')} > 0 THEN ${glSignedSql('sg')} ELSE 0 END) AS GlIn,
                   SUM(CASE WHEN ${glSignedSql('sg')} < 0 THEN -${glSignedSql('sg')} ELSE 0 END) AS GlOut
            FROM ReconciliationMatchLine sl
            JOIN BankAccountLedgerEntries sg ON sg.Entry_No = sl.GLEntryNo
            WHERE sl.MatchId = rm.MatchId AND sl.SourceType = 'GL' AND sl.Status = 'ACTIVE'
          ) gt
          ${whereClause}
        ) x
      `);
      const s = summaryResult.recordset[0] ?? {};
      suspenseSummary = {
        incoming: Math.round(Number(s.Incoming ?? 0) * 100) / 100,
        outgoing: Math.round(Number(s.Outgoing ?? 0) * 100) / 100,
        lineCount: Number(s.LineCount ?? 0),
        differenceCount: Number(s.DifferenceCount ?? 0),
      };
    }

    // รายชื่อธนาคารสำหรับปุ่มกรอง — ดึงจากข้อมูลจริงทั้งหมด ไม่ผูกกับ filter ธนาคาร/วันที่ที่เลือกอยู่
    // ไม่งั้นพอเลือกธนาคารเดียวแล้วปุ่มธนาคารอื่นจะหายไปหมด
    // (แต่ยังผูกกับ matchType — หน้า Match History ไม่ควรมีปุ่มธนาคารที่มีแต่รายการพักโอนโผล่มาแล้วกดได้ผลลัพธ์ว่าง)
    const bankCodesRequest = bindMatchTypes(pool.request());
    const bankCodesResult = await bankCodesRequest.query(`
      SELECT DISTINCT BankCode FROM ReconciliationMatch
      WHERE BankCode IS NOT NULL ${
        matchTypes.length === 0
          ? ''
          : includeDifferenceSuspense
            ? `AND (MatchType IN (${matchTypeParams}) OR (MatchType = 'MATCHED' AND Remark IS NOT NULL))`
            : `AND MatchType IN (${matchTypeParams})`
      }
      ORDER BY BankCode
    `);

    return NextResponse.json({
      matches,
      total,
      sideCounts,
      typeCounts: { ...typeCounts, ALL: typeCountAll },
      suspenseSummary,
      bankCodes: bankCodesResult.recordset.map((r) => String(r.BankCode)),
    });
  } catch (err) {
    console.error('Match history API error:', err);
    return NextResponse.json({ error: 'ดึงประวัติการจับคู่ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' }, { status: 500 });
  }
}
