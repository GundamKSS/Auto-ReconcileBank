import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { getPool } from '../../../../../lib/db';
import {
  MAX_EXPORT_ROWS,
  ORDER_BY,
  SUMMARY_SELECT,
  bindFilters,
  buildSummary,
  buildUnifiedCte,
  mapRow,
  parseFilters,
  searchCondition,
  type ReportFilters,
  type ReportRow,
} from '../query';

export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, string> = {
  MATCHED: 'จับคู่แล้ว',
  SUSPENSE: 'พักไว้ (Suspense)',
  UNMATCHED: 'ยังไม่จับคู่',
  ALL: 'ทุกสถานะ',
};

const DETAIL_HEADERS = [
  'สถานะ',
  'Match ID',
  'กลุ่มย่อย',
  'ธนาคาร',
  'วันที่ (Bank)',
  'รายละเอียด (Bank)',
  'Ref (Bank)',
  'IN/OUT (Bank)',
  'จำนวนเงิน (Bank)',
  'วันที่ (BC)',
  'Document No (BC)',
  'เลขบัญชี (BC)',
  'ชื่อบัญชี (BC)',
  'IN/OUT (BC)',
  'จำนวนเงิน (BC)',
  'ผลต่าง (Bank - BC)',
  'ผู้จับคู่',
  'วันที่จับคู่',
];

// คอลัมน์ที่เป็นตัวเงิน (index 0-based) ใช้ตั้ง number format ให้ Excel
const DETAIL_MONEY_COLS = [8, 14, 15];
const SUMMARY_MONEY_COLS = [6, 7, 8, 9, 10, 11, 12];
const MONEY_FORMAT = '#,##0.00';

type Cell = string | number | null;

function detailRow(r: ReportRow): Cell[] {
  return [
    STATUS_LABEL[r.status] ?? r.status,
    r.matchId,
    r.groupNum,
    r.bankCode,
    r.bank?.date ?? null,
    r.bank?.description ?? null,
    r.bank?.ref ?? null,
    r.bank?.direction ?? null,
    r.bank?.amount ?? null,
    r.gl?.date ?? null,
    r.gl?.documentNo ?? null,
    r.gl?.accountNo ?? null,
    r.gl?.accountName ?? null,
    r.gl?.direction ?? null,
    r.gl?.amount ?? null,
    r.diff,
    r.createdBy,
    r.createdAt ? r.createdAt.slice(0, 19).replace('T', ' ') : null,
  ];
}

function applyMoneyFormat(ws: XLSX.WorkSheet, moneyCols: number[], firstDataRow: number, lastDataRow: number) {
  for (let row = firstDataRow; row <= lastDataRow; row++) {
    for (const col of moneyCols) {
      const cell = ws[XLSX.utils.encode_cell({ r: row, c: col })];
      if (cell && cell.t === 'n') cell.z = MONEY_FORMAT;
    }
  }
}

function buildWorkbook(filters: ReportFilters, rows: ReportRow[], summary: ReturnType<typeof buildSummary>) {
  const wb = XLSX.utils.book_new();

  // ---------- ชีต Summary ----------
  const basisLabel =
    filters.basis === 'BANK' ? 'วันที่รายการใน Bank Statement (TranDate)' : 'วันที่ลงบัญชีฝั่ง BC365 (Posting Date)';

  const summaryAoa: Cell[][] = [
    ['รายงานสรุปการกระทบยอด (Bank Reconciliation Report)'],
    ['ช่วงวันที่', `${filters.from} ถึง ${filters.to}`],
    ['เกณฑ์วันที่ที่ใช้กรอง', basisLabel],
    ['สถานะที่แสดง', STATUS_LABEL[filters.status] ?? filters.status],
    ['ธนาคาร', filters.bankCode ?? 'ทุกธนาคาร'],
    ['คำค้นหา', filters.q ?? '-'],
    ['ออกรายงานเมื่อ', new Date().toISOString().slice(0, 19).replace('T', ' ')],
    ['จำนวนแถวทั้งหมด', summary.total],
    [],
    [
      'สถานะ',
      'ธนาคาร',
      'จำนวนแถว',
      'จำนวน Match',
      'บรรทัด Bank',
      'บรรทัด BC',
      'Bank เงินเข้า',
      'Bank เงินออก',
      'Bank สุทธิ',
      'BC เงินเข้า',
      'BC เงินออก',
      'BC สุทธิ',
      'ผลต่าง (Bank - BC)',
    ],
  ];

  const bucketFirstRow = summaryAoa.length;
  for (const b of summary.buckets) {
    summaryAoa.push([
      STATUS_LABEL[b.status] ?? b.status,
      b.bankCode,
      b.rows,
      b.matches,
      b.bankLines,
      b.glLines,
      b.bankIn,
      b.bankOut,
      b.bankNet,
      b.glIn,
      b.glOut,
      b.glNet,
      b.diff,
    ]);
  }
  const t = summary.totals;
  summaryAoa.push([
    'รวมทั้งสิ้น',
    '',
    t.rows,
    t.matches,
    t.bankLines,
    t.glLines,
    t.bankIn,
    t.bankOut,
    t.bankNet,
    t.glIn,
    t.glOut,
    t.glNet,
    t.diff,
  ]);

  const wsSummary = XLSX.utils.aoa_to_sheet(summaryAoa);
  wsSummary['!cols'] = [
    { wch: 22 },
    { wch: 14 },
    { wch: 11 },
    { wch: 12 },
    { wch: 12 },
    { wch: 12 },
    { wch: 16 },
    { wch: 16 },
    { wch: 16 },
    { wch: 16 },
    { wch: 16 },
    { wch: 16 },
    { wch: 18 },
  ];
  applyMoneyFormat(wsSummary, SUMMARY_MONEY_COLS, bucketFirstRow, summaryAoa.length - 1);
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');

  // ---------- ชีต Detail ----------
  const detailAoa: Cell[][] = [DETAIL_HEADERS, ...rows.map(detailRow)];
  const wsDetail = XLSX.utils.aoa_to_sheet(detailAoa);
  wsDetail['!cols'] = [
    { wch: 18 },
    { wch: 10 },
    { wch: 10 },
    { wch: 10 },
    { wch: 12 },
    { wch: 42 },
    { wch: 14 },
    { wch: 12 },
    { wch: 16 },
    { wch: 12 },
    { wch: 18 },
    { wch: 14 },
    { wch: 28 },
    { wch: 12 },
    { wch: 16 },
    { wch: 14 },
    { wch: 16 },
    { wch: 20 },
  ];
  wsDetail['!freeze'] = { xSplit: 0, ySplit: 1 };
  if (rows.length > 0) {
    wsDetail['!autofilter'] = {
      ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: DETAIL_HEADERS.length - 1 } }),
    };
  }
  applyMoneyFormat(wsDetail, DETAIL_MONEY_COLS, 1, detailAoa.length - 1);
  XLSX.utils.book_append_sheet(wb, wsDetail, 'Detail');

  return wb;
}

/**
 * GET /api/reports/reconciliation/export
 * รับ query params ชุดเดียวกับ /api/reports/reconciliation (ยกเว้น offset)
 * แล้วส่งไฟล์ .xlsx ที่มี 2 ชีต: Summary (ยอดรวมแยกตามสถานะ/ธนาคาร) และ Detail (ทุกแถวตาม filter)
 */
export async function GET(req: NextRequest) {
  try {
    const filters = parseFilters(req.nextUrl.searchParams);

    if (filters.from > filters.to) {
      return NextResponse.json({ error: 'ช่วงวันที่ไม่ถูกต้อง (วันเริ่มต้นอยู่หลังวันสิ้นสุด)' }, { status: 400 });
    }

    const pool = await getPool();
    const cte = buildUnifiedCte(filters);
    const search = searchCondition(filters);

    const summaryResult = await bindFilters(pool.request(), filters).query(`
      ${cte}
      ${SUMMARY_SELECT} ${search}
      GROUP BY Status, COALESCE(BankCode, N'-')
    `);
    const summary = buildSummary(summaryResult.recordset);

    if (summary.total > MAX_EXPORT_ROWS) {
      return NextResponse.json(
        {
          error: `ข้อมูลมากเกินไป (${summary.total.toLocaleString()} แถว) เกินขีดจำกัด ${MAX_EXPORT_ROWS.toLocaleString()} แถวต่อไฟล์ — กรุณาแคบช่วงวันที่หรือเลือกธนาคารก่อน export`,
        },
        { status: 400 }
      );
    }

    const rowsResult = await bindFilters(pool.request(), filters).query(`
      ${cte}
      SELECT * FROM Unified
      WHERE 1=1 ${search}
      ${ORDER_BY}
    `);
    const rows = rowsResult.recordset.map(mapRow);

    const wb = buildWorkbook(filters, rows, summary);
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

    const fileName = `reconciliation-report_${filters.from}_${filters.to}_${filters.status.toLowerCase()}.xlsx`;

    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Content-Length': String(buf.length),
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('Reconciliation report export error:', err);
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `สร้างไฟล์ Excel ไม่สำเร็จ: ${detail}` }, { status: 500 });
  }
}
