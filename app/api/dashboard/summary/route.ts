import { NextRequest, NextResponse } from 'next/server';
import sql from 'mssql';
import { getPool } from '../../../../lib/db';
import {
  SUMMARY_SELECT,
  bindFilters,
  buildSummary,
  buildUnifiedCte,
  type DateBasis,
  type ReportFilters,
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
 *   month        - เดือนที่ดู 'YYYY-MM' (ค่าเริ่มต้น = เดือนปัจจุบัน)
 *   basis        - 'BANK' (ค่าเริ่มต้น) | 'GL' เกณฑ์วันที่ที่ใช้จัดรายการเข้าเดือน
 *   bankCode     - รหัสธนาคาร หรือ 'ALL'
 *   trendMonths  - จำนวนเดือนย้อนหลังของกราฟแนวโน้ม (6 หรือ 12, ค่าเริ่มต้น 6)
 *
 * ใช้ตัวสร้าง SQL ชุดเดียวกับหน้า Reports (buildUnifiedCte) เพื่อให้ยอดบน dashboard
 * ตรงกับรีพอร์ตและไฟล์ Excel เสมอ — ต่างกันแค่ระดับการ group เท่านั้น
 */
export async function GET(req: NextRequest) {
  try {
    const params = req.nextUrl.searchParams;

    const rawMonth = params.get('month');
    const now = new Date();
    const month = rawMonth && MONTH_RE.test(rawMonth) ? rawMonth : `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;

    const basis: DateBasis = params.get('basis') === 'GL' ? 'GL' : 'BANK';
    const rawBank = params.get('bankCode');
    const bankCode = rawBank && rawBank !== 'ALL' ? rawBank : null;
    const trendMonths = params.get('trendMonths') === '12' ? 12 : 6;

    const { from, to } = monthBounds(month);

    // อายุรายการค้างนับถึง "วันนี้" ถ้าดูเดือนปัจจุบัน แต่ถ้าย้อนดูเดือนเก่าให้นับถึงสิ้นเดือนนั้น
    // ไม่งั้นเปิดดูเดือนที่แล้วทีไรรายการก็จะโชว์อายุเพิ่มขึ้นเรื่อยๆ ทั้งที่ปิดงบไปแล้ว
    const today = toIsoDate(now);
    const asOf = today < to ? today : to;

    const monthFilters: ReportFilters = { from, to, basis, status: 'ALL', bankCode, q: null };
    const trendFilters: ReportFilters = {
      ...monthFilters,
      from: monthsBackStart(month, trendMonths),
    };

    const pool = await getPool();
    const cte = buildUnifiedCte(monthFilters);
    const trendCte = buildUnifiedCte(trendFilters);

    const [summaryResult, dailyResult, agingResult, outstandingResult, trendResult, bankCodesResult] =
      await Promise.all([
        // 1) ยอดรวมแยกตามสถานะ + ธนาคาร — ป้อนทั้งการ์ด KPI, โดนัทสถานะ และตารางแยกธนาคาร
        bindFilters(pool.request(), monthFilters).query(`
          ${cte}
          ${SUMMARY_SELECT}
          GROUP BY Status, COALESCE(BankCode, N'-')
        `),

        // 2) ความเคลื่อนไหวรายวันภายในเดือน
        bindFilters(pool.request(), monthFilters).query(`
          ${cte}
          SELECT
            EffDate,
            Status,
            SUM(CASE WHEN BankLineId IS NOT NULL THEN 1 ELSE 0 END)
              + SUM(CASE WHEN GLEntryNo IS NOT NULL THEN 1 ELSE 0 END) AS Lines_,
            SUM(CASE WHEN BankDirection = 'IN' THEN BankAmount ELSE 0 END) AS BankIn_,
            SUM(CASE WHEN BankDirection = 'OUT' THEN BankAmount ELSE 0 END) AS BankOut_
          FROM Unified
          WHERE EffDate IS NOT NULL
          GROUP BY EffDate, Status
          ORDER BY EffDate
        `),

        // 3) อายุของรายการที่ยังไม่จับคู่ / พักไว้
        bindFilters(pool.request(), monthFilters)
          .input('asOf', sql.Date, new Date(`${asOf}T00:00:00Z`))
          .query(`
            ${cte}
            SELECT
              Status,
              ${AGING_CASE} AS Bucket_,
              COUNT(*) AS Rows_,
              SUM(COALESCE(BankAmount, GLAmount, 0)) AS Amount_
            FROM Unified
            WHERE Status IN ('UNMATCHED', 'SUSPENSE') AND EffDate IS NOT NULL
            GROUP BY Status, ${AGING_CASE}
            ORDER BY Status, Bucket_
          `),

        // 4) รายการค้างยอดสูงสุด — ไว้ไล่เคลียร์เรียงตามผลกระทบ
        bindFilters(pool.request(), monthFilters).query(`
          ${cte}
          SELECT TOP 12
            RowKey,
            Status,
            BankCode,
            EffDate,
            COALESCE(BankAmount, GLAmount) AS Amount_,
            COALESCE(BankDirection, GLDirection) AS Direction_,
            CASE WHEN BankLineId IS NOT NULL THEN 'BANK' ELSE 'GL' END AS Side_,
            COALESCE(NULLIF(BankDescription, N''), GLDocumentNo, GLBankAccountName) AS Label_
          FROM Unified
          WHERE Status IN ('UNMATCHED', 'SUSPENSE')
          ORDER BY COALESCE(BankAmount, GLAmount) DESC
        `),

        // 5) แนวโน้มย้อนหลังหลายเดือน — ช่วงวันที่กว้างกว่า จึงต้องสร้าง CTE แยก
        bindFilters(pool.request(), trendFilters).query(`
          ${trendCte}
          SELECT
            DATEFROMPARTS(YEAR(EffDate), MONTH(EffDate), 1) AS Month_,
            Status,
            SUM(CASE WHEN BankLineId IS NOT NULL THEN 1 ELSE 0 END)
              + SUM(CASE WHEN GLEntryNo IS NOT NULL THEN 1 ELSE 0 END) AS Lines_,
            SUM(COALESCE(BankSigned, 0)) AS BankNet_,
            SUM(COALESCE(GLSigned, 0)) AS GlNet_
          FROM Unified
          WHERE EffDate IS NOT NULL
          GROUP BY DATEFROMPARTS(YEAR(EffDate), MONTH(EffDate), 1), Status
          ORDER BY Month_
        `),

        // รายชื่อธนาคารสำหรับปุ่มกรอง — ดึงจากข้อมูลจริง ไม่ผูกกับ filter ที่เลือกอยู่
        pool.request().query(`
          SELECT DISTINCT BankCode FROM (
            SELECT BankCode FROM BankAccountMapping WHERE BankCode IS NOT NULL
            UNION
            SELECT BankCode FROM BankStatementLine WHERE BankCode IS NOT NULL
          ) z
          ORDER BY BankCode
        `),
      ]);

    const summary = buildSummary(summaryResult.recordset);

    const daily = dailyResult.recordset.map((r) => ({
      date: isoDay(r.EffDate),
      status: r.Status as StatusKey,
      lines: Number(r.Lines_ ?? 0),
      bankIn: Number(r.BankIn_ ?? 0),
      bankOut: Number(r.BankOut_ ?? 0),
    }));

    const aging = agingResult.recordset.map((r) => ({
      status: r.Status as StatusKey,
      bucket: Number(r.Bucket_ ?? 0),
      rows: Number(r.Rows_ ?? 0),
      amount: Number(r.Amount_ ?? 0),
    }));

    const outstanding = outstandingResult.recordset.map((r) => ({
      rowKey: String(r.RowKey),
      status: r.Status as StatusKey,
      bankCode: (r.BankCode as string) ?? null,
      date: isoDay(r.EffDate),
      amount: Number(r.Amount_ ?? 0),
      direction: (r.Direction_ as 'IN' | 'OUT') ?? null,
      side: r.Side_ as 'BANK' | 'GL',
      label: (r.Label_ as string) ?? null,
    }));

    const trend = trendResult.recordset.map((r) => {
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

    return NextResponse.json({
      month,
      from,
      to,
      asOf,
      basis,
      bankCode: bankCode ?? 'ALL',
      trendMonths,
      summary,
      daily,
      aging,
      outstanding,
      trend,
      bankCodes: bankCodesResult.recordset.map((r) => String(r.BankCode)),
    });
  } catch (err) {
    console.error('Dashboard summary API error:', err);
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `ดึงข้อมูลสรุปไม่สำเร็จ: ${detail}` }, { status: 500 });
  }
}
