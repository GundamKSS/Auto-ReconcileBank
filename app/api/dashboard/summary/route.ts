import { NextRequest, NextResponse } from 'next/server';
import sql from 'mssql';
import { getPool } from '../../../../lib/db';
import { badRequest } from '../../../../lib/apiInput';
import { requireRole } from '../../../../lib/session';
import { VIEWER_ROLES } from '../../../../lib/roles';
import { readWorkPermissions } from '../../../../lib/workRolesDb';
import { visibleWorkSides } from '../../../../lib/workRoles';
import { resolveAccountFilter } from '../../../../lib/bankAccountDb';
import { loadBanksWithStatement, splitByCoverage } from '../../../../lib/statementCoverage';
import {
  SIDE_DIRECTION,
  bindFilters,
  buildReportCte,
  buildSummary,
  type DateBasis,
  type ReportFilters,
  type ReportSide,
} from '../../reports/reconciliation/query';

// ตัวเลขบนหน้า dashboard ต้องสดเสมอ — เดือน/ธนาคาร/เกณฑ์วันที่เปลี่ยนได้ตลอด
export const dynamic = 'force-dynamic';

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** อายุรายการค้าง — ใช้ทั้งใน SELECT และ GROUP BY จึงต้องเป็นสตริงเดียวกันเป๊ะ */
const AGING_CASE = `
    CASE
      WHEN DATEDIFF(day, EffDate, @asOf) <= 7  THEN 0
      WHEN DATEDIFF(day, EffDate, @asOf) <= 30 THEN 1
      WHEN DATEDIFF(day, EffDate, @asOf) <= 60 THEN 2
      WHEN DATEDIFF(day, EffDate, @asOf) <= 90 THEN 3
      ELSE 4
    END`;

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

function toIsoDate(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function isoDay(value: unknown): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;
  // ค่าที่ได้จาก mssql เป็น DATE (เที่ยงคืน UTC) จึงตัดสตริง ISO ตรงๆ ได้โดยไม่เลื่อนวัน
  return d.toISOString().slice(0, 10);
}

/** ต้นเดือน–สิ้นเดือนของ 'YYYY-MM' */
function monthBounds(month: string) {
  const [y, m] = month.split('-').map(Number);
  return {
    from: toIsoDate(new Date(y, m - 1, 1)),
    to: toIsoDate(new Date(y, m, 0)), // day 0 ของเดือนถัดไป = วันสุดท้ายของเดือนนี้
  };
}

/** ต้นเดือนของ n เดือนก่อนหน้า 'YYYY-MM' (ใช้เป็นจุดเริ่มของกราฟแนวโน้ม) */
function monthsBackStart(month: string, n: number) {
  const [y, m] = month.split('-').map(Number);
  return toIsoDate(new Date(y, m - 1 - (n - 1), 1));
}

type StatusKey = 'MATCHED' | 'SUSPENSE' | 'UNMATCHED';

/**
 * GET /api/dashboard/summary
 *
 * Query params:
 *   side         - 'AR' (ค่าเริ่มต้น, เงินเข้า) | 'AP' (เงินออก) | 'ALL' (รวมทั้งสองฝั่ง)
 *   month        - เดือนที่ดู 'YYYY-MM' (ค่าเริ่มต้น = เดือนปัจจุบัน)
 *   basis        - 'BANK' (ค่าเริ่มต้น) | 'GL' เกณฑ์วันที่ที่ใช้จัดรายการเข้าเดือน
 *   bankCode      - รหัสธนาคาร หรือ 'ALL'
 *   bankAccountNo - เลขบัญชีธนาคาร หรือ 'ALL' — แคบลงถึงระดับบัญชีให้ตรงกับหน้ากระทบยอด
 *   section      - 'overview' โหลดเดือนปัจจุบันก่อน | 'trend' โหลดย้อนหลัง | 'all' (ค่าเดิม)
 *   trendMonths  - 6 หรือ 12 เดือน; section=trend รับ 2 เดือนสำหรับการเทียบเดือนก่อนด้วย
 *
 * ใช้ตัวสร้าง SQL ชุดเดียวกับหน้า Reports (buildReportCte) เพื่อให้ยอดบน dashboard
 * ตรงกับรีพอร์ตและไฟล์ Excel เสมอ — ต่างกันแค่ระดับการ group เท่านั้น
 * การแบ่ง AR/AP ก็ใช้ทิศทางของบรรทัดแบบเดียวกับรีพอร์ต (AR = IN, AP = OUT)
 */
export async function GET(req: NextRequest) {
  const auth = await requireRole(VIEWER_ROLES);
  if (!auth.ok) return auth.response;

  try {
    const params = req.nextUrl.searchParams;
    const section = params.get('section') ?? 'all';
    if (!['all', 'overview', 'trend'].includes(section)) return badRequest('ส่วนข้อมูล Dashboard ไม่ถูกต้อง');
    const includeOverview = section !== 'trend';
    const includeTrend = section !== 'overview';

    const rawMonth = params.get('month');
    const now = new Date();
    const month = rawMonth && MONTH_RE.test(rawMonth) ? rawMonth : `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;

    const basis: DateBasis = params.get('basis') === 'GL' ? 'GL' : 'BANK';
    const rawBank = params.get('bankCode');
    let bankCode = rawBank && rawBank !== 'ALL' ? rawBank : null;

    const rawAccount = params.get('bankAccountNo');
    const account = await resolveAccountFilter(rawAccount && rawAccount !== 'ALL' ? rawAccount : null);
    if (!account.ok) return NextResponse.json({ error: account.error }, { status: 400 });
    // เลือกบัญชีแล้วธนาคารต้องตามบัญชีนั้น ไม่ใช่ตามปุ่มที่ค้างอยู่
    if (account.bankCode) bankCode = account.bankCode;
    const trendMonths = params.get('trendMonths') === '12' ? 12
      : section === 'trend' && params.get('trendMonths') === '2' ? 2 : 6;
    const rawSide = params.get('side')?.toUpperCase();
    // สิทธิ์ AP หรือ AR ฝั่งเดียวเห็นเฉพาะฝั่งของตัวเอง (กติกาเดียวกับหน้ากระทบยอด/ประวัติ/รายการพัก)
    // ขอฝั่งอื่นหรือ "รวม" มาก็ได้ฝั่งของตัวเองกลับไป — Viewer, Master, Admin และ Dev เห็นทุกฝั่ง
    const visibleSides = visibleWorkSides(await readWorkPermissions(auth.session));
    const ownSide: ReportSide | null = visibleSides.length === 1 ? (visibleSides[0] === 'IN' ? 'AR' : 'AP') : null;
    const lockedSides: (ReportSide | 'ALL')[] = ownSide ? (['AR', 'AP', 'ALL'] as const).filter((s) => s !== ownSide) : [];
    const side: ReportSide | 'ALL' = ownSide ?? (rawSide === 'AP' ? 'AP' : rawSide === 'ALL' ? 'ALL' : 'AR');

    const { from, to } = monthBounds(month);

    // อายุรายการค้างนับถึง "วันนี้" ถ้าดูเดือนปัจจุบัน แต่ถ้าย้อนดูเดือนเก่าให้นับถึงสิ้นเดือนนั้น
    // ไม่งั้นเปิดดูเดือนที่แล้วทีไรรายการก็จะโชว์อายุเพิ่มขึ้นเรื่อยๆ ทั้งที่ปิดงบไปแล้ว
    const today = toIsoDate(now);
    const asOf = today < to ? today : to;

    const monthFilters: ReportFilters = {
      from,
      to,
      basis,
      status: 'ALL',
      side: side === 'ALL' ? undefined : side,
      bankCode,
      bankAccountNo: account.bankAccountNo,
      q: null,
      // หักล้างกันเอง (OFFSET) ไม่ใช่ทั้งงานที่จับคู่แล้วและงานค้าง — ถ้าปล่อยไว้การ์ด KPI จะนับเป็นงานค้าง
      excludeOffset: true,
    };
    const trendFilters: ReportFilters = {
      ...monthFilters,
      from: monthsBackStart(month, trendMonths),
    };

    const pool = await getPool();
    const allSides = side === 'ALL';
    const trendCte = buildReportCte(trendFilters, { allSides });
    // ยอดสรุปอ่านทั้งสองฝั่งเสมอ เพื่อได้ตัวเลขบนแท็บ AR/AP มาพร้อมกันใน query เดียว แล้วค่อยกรองฝั่งใน JS
    // และนำผลลัพธ์ใส่ #Scoped เพื่อให้ยอดสรุป, ความเคลื่อนไหวรายวัน, อายุรายการ, และรายการค้าง ดึงต่อได้ทันที
    // โดยคำนวณ CTE เพียงรอบเดียวแทนการคำนวณซ้ำถึง 4 รอบ
    const summaryCte = buildReportCte(monthFilters, { allSides: true });

    const monthBatchSql = `
      SET NOCOUNT ON;

      ${summaryCte}
      SELECT * INTO #Scoped FROM Scoped;

      -- 1) ยอดรวมแยกตามสถานะ + ธนาคาร
      SELECT
        Direction,
        Status,
        COALESCE(BankCode, N'-') AS BankCode,
        COUNT(*) AS Rows_,
        COUNT(DISTINCT MatchId) AS Matches_,
        SUM(CASE WHEN BankLineId IS NOT NULL THEN 1 ELSE 0 END) AS BankLines_,
        SUM(CASE WHEN GLEntryNo IS NOT NULL THEN 1 ELSE 0 END) AS GlLines_,
        SUM(CASE WHEN BankDirection = 'IN' THEN BankAmount ELSE 0 END) AS BankIn_,
        SUM(CASE WHEN BankDirection = 'OUT' THEN BankAmount ELSE 0 END) AS BankOut_,
        SUM(COALESCE(BankSigned, 0)) AS BankNet_,
        SUM(CASE WHEN GLDirection = 'IN' THEN GLAmount ELSE 0 END) AS GlIn_,
        SUM(CASE WHEN GLDirection = 'OUT' THEN GLAmount ELSE 0 END) AS GlOut_,
        SUM(COALESCE(GLSigned, 0)) AS GlNet_
      FROM #Scoped
      WHERE GroupHit = 1
      GROUP BY Direction, Status, COALESCE(BankCode, N'-');

      -- 2) ความเคลื่อนไหวรายวันภายในเดือน
      SELECT
        EffDate,
        Status,
        SUM(CASE WHEN BankLineId IS NOT NULL THEN 1 ELSE 0 END)
          + SUM(CASE WHEN GLEntryNo IS NOT NULL THEN 1 ELSE 0 END) AS Lines_,
        SUM(CASE WHEN BankDirection = 'IN' THEN BankAmount ELSE 0 END) AS BankIn_,
        SUM(CASE WHEN BankDirection = 'OUT' THEN BankAmount ELSE 0 END) AS BankOut_
      FROM #Scoped
      WHERE EffDate IS NOT NULL AND (@allSides = 1 OR Direction = @direction)
      GROUP BY EffDate, Status
      ORDER BY EffDate;

      -- 3) อายุของรายการที่ยังไม่จับคู่ / พักไว้
      SELECT
        Status,
        ${AGING_CASE} AS Bucket_,
        COUNT(*) AS Rows_,
        SUM(COALESCE(BankAmount, 0)) AS BankAmount_,
        SUM(COALESCE(GLAmount, 0)) AS GlAmount_
      FROM #Scoped
      WHERE Status IN ('UNMATCHED', 'SUSPENSE') AND EffDate IS NOT NULL
        AND (@allSides = 1 OR Direction = @direction)
      GROUP BY Status, ${AGING_CASE}
      ORDER BY Status, Bucket_;

      -- 4) รายการค้างยอดสูงสุด
      SELECT TOP 12
        RowKey,
        Status,
        BankCode,
        EffDate,
        COALESCE(BankAmount, GLAmount) AS Amount_,
        COALESCE(BankDirection, GLDirection) AS Direction_,
        CASE WHEN BankLineId IS NOT NULL THEN 'BANK' ELSE 'GL' END AS Side_,
        COALESCE(NULLIF(BankDescription, N''), GLDocumentNo, GLBankAccountName) AS Label_
      FROM #Scoped
      WHERE Status IN ('UNMATCHED', 'SUSPENSE')
        AND (@allSides = 1 OR Direction = @direction)
      ORDER BY COALESCE(BankAmount, GLAmount) DESC;

      -- 5) รายชื่อธนาคารสำหรับปุ่มกรอง
      SELECT DISTINCT BankCode FROM (
        SELECT BankCode FROM BankAccountMapping WHERE BankCode IS NOT NULL
        UNION
        SELECT BankCode FROM BankStatementLine WHERE BankCode IS NOT NULL
      ) z
      ORDER BY BankCode;

      DROP TABLE #Scoped;
    `;

    const monthRequest = bindFilters(pool.request(), monthFilters)
      .input('asOf', sql.Date, new Date(`${asOf}T00:00:00Z`))
      .input('allSides', sql.Bit, allSides ? 1 : 0);

    const [monthBatchResult, trendResult, banksWithStatement] = await Promise.all([
      includeOverview ? monthRequest.query(monthBatchSql) : null,

      // หน้า Dashboard ขอ section=trend หลังแสดงยอดเดือนปัจจุบันแล้ว
      includeTrend ? bindFilters(pool.request(), trendFilters).query(`
        ${trendCte}
        SELECT
          DATEFROMPARTS(YEAR(EffDate), MONTH(EffDate), 1) AS Month_,
          Status,
          SUM(CASE WHEN BankLineId IS NOT NULL THEN 1 ELSE 0 END)
            + SUM(CASE WHEN GLEntryNo IS NOT NULL THEN 1 ELSE 0 END) AS Lines_,
          SUM(COALESCE(BankSigned, 0)) AS BankNet_,
          SUM(COALESCE(GLSigned, 0)) AS GlNet_
        FROM Scoped
        WHERE EffDate IS NOT NULL
        GROUP BY DATEFROMPARTS(YEAR(EffDate), MONTH(EffDate), 1), Status
        ORDER BY Month_
      `) : null,

      // โหลดรายชื่อธนาคารที่มี statement ในงวดนี้คู่ขนานกันทันที (ไม่ต้องรอหลัง query เสร็จ)
      includeOverview ? loadBanksWithStatement(from, to, account.bankAccountNo) : new Set<string>(),
    ]);

    const metadata = { month, from, to, asOf, basis, bankCode: bankCode ?? 'ALL', trendMonths, side, lockedSides };
    const trend = (trendResult?.recordset ?? []).map((r) => {
      const bankNet = Number(r.BankNet_ ?? 0);
      const glNet = Number(r.GlNet_ ?? 0);
      return {
        month: isoDay(r.Month_)?.slice(0, 7) ?? null,
        status: r.Status as StatusKey,
        lines: Number(r.Lines_ ?? 0),
        bankNet,
        glNet,
        diff: Number((bankNet - glNet).toFixed(2)),
      };
    });
    const headers = { 'Cache-Control': 'private, no-store' };
    if (section === 'trend') return NextResponse.json({ ...metadata, trend }, { headers });

    const recordsets = monthBatchResult?.recordsets as sql.IRecordSet<Record<string, unknown>>[];
    const summaryRows = recordsets[0] ?? [];
    const dailyResultRows = recordsets[1] ?? [];
    const agingResultRows = recordsets[2] ?? [];
    const outstandingResultRows = recordsets[3] ?? [];
    const bankCodesResultRows = recordsets[4] ?? [];

    const summary = buildSummary(
      side === 'ALL' ? summaryRows : summaryRows.filter((r) => r.Direction === SIDE_DIRECTION[side])
    );
    // ป้ายบนแท็บนับเป็นบรรทัด (Bank + GL) ให้หน่วยเดียวกับการ์ดบนหน้า dashboard
    const linesOf = (direction: 'IN' | 'OUT') =>
      summaryRows
        .filter((r) => r.Direction === direction)
        .reduce((sum, r) => sum + Number(r.BankLines_ ?? 0) + Number(r.GlLines_ ?? 0), 0);
    // ฝั่งที่ไม่มีสิทธิ์ไม่ส่งจำนวนออกไป — แท็บนั้นถูกล็อกอยู่แล้ว
    const sideCounts = {
      AR: lockedSides.includes('AR') ? 0 : linesOf('IN'),
      AP: lockedSides.includes('AP') ? 0 : linesOf('OUT'),
    };

    // ธนาคารที่ยังไม่ได้นำเข้า statement ของเดือนนี้ไม่ใช่ "กระทบยอดแล้วไม่ตรง" แต่คือ "ยังไม่ได้เริ่ม"
    // แยกออกจากการ์ดผลต่าง ไม่งั้นตัวเลขพาดหัวจะใหญ่เกินจริงจนสื่อสารผิด
    const coverage = splitByCoverage(summary, banksWithStatement);

    const daily = dailyResultRows.map((r) => ({
      date: isoDay(r.EffDate),
      status: r.Status as StatusKey,
      lines: Number(r.Lines_ ?? 0),
      bankIn: Number(r.BankIn_ ?? 0),
      bankOut: Number(r.BankOut_ ?? 0),
    }));

    const aging = agingResultRows.map((r) => ({
      status: r.Status as StatusKey,
      bucket: Number(r.Bucket_ ?? 0),
      rows: Number(r.Rows_ ?? 0),
      bankAmount: Number(r.BankAmount_ ?? 0),
      glAmount: Number(r.GlAmount_ ?? 0),
    }));

    const outstanding = outstandingResultRows.map((r) => ({
      rowKey: String(r.RowKey),
      status: r.Status as StatusKey,
      bankCode: (r.BankCode as string) ?? null,
      date: isoDay(r.EffDate),
      amount: Number(r.Amount_ ?? 0),
      direction: (r.Direction_ as 'IN' | 'OUT') ?? null,
      side: r.Side_ as 'BANK' | 'GL',
      label: (r.Label_ as string) ?? null,
    }));

    return NextResponse.json({
      ...metadata,
      sideCounts,
      summary,
      daily,
      aging,
      outstanding,
      trend,
      bankCodes: bankCodesResultRows.map((r) => String(r.BankCode)),
      bankAccountNo: account.bankAccountNo ?? 'ALL',
      coverage,
    }, { headers });
  } catch (err) {
    console.error('Dashboard summary API error:', err);
    return NextResponse.json({ error: 'ดึงข้อมูลสรุปไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' }, { status: 500 });
  }
}
