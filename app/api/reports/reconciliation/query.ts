import sql from 'mssql';

/**
 * ตัวสร้าง SQL กลางของรีพอร์ตกระทบยอด — ใช้ร่วมกันทั้ง route ที่โหลดตาราง (paging)
 * และ route ที่ export Excel เพื่อให้ตัวเลขบนจอกับในไฟล์มาจาก query ชุดเดียวกันเสมอ
 *
 * 1 แถวของรีพอร์ต = 1 คู่ Bank–GL ภายในกลุ่มย่อย (MatchId + Num) เดียวกัน
 * การจับคู่ใช้ ROW_NUMBER() ของแต่ละฝั่งแล้ว FULL OUTER JOIN กันด้วยลำดับที่ได้
 * ไม่ได้ใช้ cross join แบบ vw_ReconciliationPairReport เพราะกลุ่มที่เป็น 1:N / N:1
 * จะถูกคูณจำนวนแถวจนยอดรวมผิด — วิธีนี้กลุ่ม 1:3 จะได้ 3 แถว (ฝั่ง bank ว่าง 2 แถว)
 * ทำให้ทุกบรรทัดถูกนับพอดี 1 ครั้งเสมอ
 */

export type DateBasis = 'BANK' | 'GL';
export type StatusFilter = 'MATCHED' | 'SUSPENSE' | 'UNMATCHED' | 'ALL';

export type ReportFilters = {
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
  basis: DateBasis;
  status: StatusFilter;
  bankCode: string | null;
  q: string | null;
};

export const PAGE_SIZE = 50;
export const MAX_EXPORT_ROWS = 50000;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

function toIsoDate(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** ค่าเริ่มต้นของรีพอร์ต = วันที่ 1 ถึงวันสิ้นเดือนของเดือนปัจจุบัน */
export function defaultRange(now = new Date()) {
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0); // day 0 ของเดือนถัดไป = วันสุดท้ายของเดือนนี้
  return { from: toIsoDate(first), to: toIsoDate(last) };
}

export function parseFilters(params: URLSearchParams): ReportFilters {
  const fallback = defaultRange();
  const rawFrom = params.get('from');
  const rawTo = params.get('to');
  const rawStatus = (params.get('status') ?? 'MATCHED').toUpperCase();
  const bankCode = params.get('bankCode');
  const q = params.get('q')?.trim();

  return {
    from: rawFrom && DATE_RE.test(rawFrom) ? rawFrom : fallback.from,
    to: rawTo && DATE_RE.test(rawTo) ? rawTo : fallback.to,
    basis: params.get('basis') === 'GL' ? 'GL' : 'BANK',
    status: (['MATCHED', 'SUSPENSE', 'UNMATCHED', 'ALL'] as const).includes(rawStatus as StatusFilter)
      ? (rawStatus as StatusFilter)
      : 'MATCHED',
    bankCode: bankCode && bankCode !== 'ALL' ? bankCode : null,
    q: q ? q : null,
  };
}

export function bindFilters(request: sql.Request, f: ReportFilters) {
  request.input('from', sql.Date, new Date(`${f.from}T00:00:00Z`));
  request.input('to', sql.Date, new Date(`${f.to}T00:00:00Z`));
  if (f.bankCode) request.input('bankCode', sql.NVarChar, f.bankCode);
  if (f.q) request.input('q', sql.NVarChar, `%${f.q}%`);
  if (f.status === 'MATCHED' || f.status === 'SUSPENSE') {
    request.input('matchType', sql.NVarChar, f.status);
  }
  return request;
}

/**
 * เงื่อนไขวันที่ระดับ "กลุ่มย่อย" — ถ้าฝั่งที่เลือกเป็นเกณฑ์มีบรรทัดไหนอยู่ในช่วงวันที่
 * ก็เอาทั้งกลุ่มมาแสดง (ไม่ตัดครึ่งกลุ่ม) รายการพักโอนข้ามเดือนของอีกฝั่งจึงยังติดมาด้วย
 *
 * ถ้ากลุ่มนั้นไม่มีบรรทัดฝั่งที่เลือกเลย (เช่นรายการ Suspense ที่มีแต่ฝั่ง GL เพราะฝั่ง Bank
 * ห้ามพัก) ให้ตกไปใช้วันที่ของอีกฝั่งแทน ไม่งั้นเลือกเกณฑ์ Bank Statement แล้วรายการพักไว้
 * จะหายไปทั้งหมด
 */
function groupDateFilter(basis: DateBasis) {
  const bankLinesOfGroup = (dateCondition: string) => `
        SELECT 1
        FROM ReconciliationMatchLine f_rml
        JOIN BankStatementLine f_b ON f_b.LineId = f_rml.BankLineId
        WHERE f_rml.MatchId = rm.MatchId AND f_rml.Num = rml.Num AND f_rml.SourceType = 'BANK'
          ${dateCondition}`;

  const glLinesOfGroup = (dateCondition: string) => `
        SELECT 1
        FROM ReconciliationMatchLine f_rml
        JOIN BankAccountLedgerEntries f_e ON f_e.Entry_No = f_rml.GLEntryNo
        WHERE f_rml.MatchId = rm.MatchId AND f_rml.Num = rml.Num AND f_rml.SourceType = 'GL'
          ${dateCondition}`;

  const inRangeBank = 'AND f_b.TranDate >= @from AND f_b.TranDate <= @to';
  const inRangeGl = 'AND f_e.Posting_Date >= @from AND f_e.Posting_Date <= @to';

  const [chosenInRange, chosenAny, otherInRange] =
    basis === 'BANK'
      ? [bankLinesOfGroup(inRangeBank), bankLinesOfGroup(''), glLinesOfGroup(inRangeGl)]
      : [glLinesOfGroup(inRangeGl), glLinesOfGroup(''), bankLinesOfGroup(inRangeBank)];

  return `
      AND (
        EXISTS (${chosenInRange}
        )
        OR (
          NOT EXISTS (${chosenAny}
          )
          AND EXISTS (${otherInRange}
          )
        )
      )`;
}

/**
 * สร้างส่วน WITH ... ทั้งหมดจบที่ CTE ชื่อ Unified
 * ผู้เรียกต่อท้ายเองว่าจะ SELECT อะไรจาก Unified (หน้าตาราง / สรุปยอด)
 */
export function buildUnifiedCte(f: ReportFilters): string {
  const includePairs = f.status !== 'UNMATCHED';
  const includeUnmatched = f.status === 'UNMATCHED' || f.status === 'ALL';
  const matchTypeFilter = f.status === 'MATCHED' || f.status === 'SUSPENSE' ? 'AND rm.MatchType = @matchType' : '';
  const matchBankFilter = f.bankCode ? 'AND rm.BankCode = @bankCode' : '';
  const dateFilter = groupDateFilter(f.basis);
  const effDate = f.basis === 'BANK' ? 'COALESCE(b.TranDate, g.Posting_Date)' : 'COALESCE(g.Posting_Date, b.TranDate)';

  const ctes: string[] = [];

  if (includePairs) {
    ctes.push(`
  BankSide AS (
    SELECT
      rm.MatchId, rm.MatchType, rm.BankCode AS MatchBankCode, rm.CreatedBy, rm.CreatedAt,
      rml.Num AS GroupNum,
      ROW_NUMBER() OVER (PARTITION BY rm.MatchId, rml.Num ORDER BY bsl.TranDate, bsl.LineId) AS PairRn,
      bsl.LineId, bsl.TranDate, bsl.Description, bsl.ChequeNo, bsl.Debit, bsl.Credit
    FROM ReconciliationMatch rm
    JOIN ReconciliationMatchLine rml ON rml.MatchId = rm.MatchId AND rml.SourceType = 'BANK'
    JOIN BankStatementLine bsl ON bsl.LineId = rml.BankLineId
    WHERE rm.Status = 'ACTIVE' AND rml.Status = 'ACTIVE' ${matchTypeFilter} ${matchBankFilter} ${dateFilter}
  ),
  GlSide AS (
    SELECT
      rm.MatchId, rm.MatchType, rm.BankCode AS MatchBankCode, rm.CreatedBy, rm.CreatedAt,
      rml.Num AS GroupNum,
      ROW_NUMBER() OVER (PARTITION BY rm.MatchId, rml.Num ORDER BY e.Posting_Date, e.Entry_No) AS PairRn,
      e.Entry_No, e.Posting_Date, e.Document_No, e.Bank_Account_No, m.BankAccountName,
      e.Debit_Amount_LCY, e.Credit_Amount_LCY
    FROM ReconciliationMatch rm
    JOIN ReconciliationMatchLine rml ON rml.MatchId = rm.MatchId AND rml.SourceType = 'GL'
    JOIN BankAccountLedgerEntries e ON e.Entry_No = rml.GLEntryNo
    LEFT JOIN BankAccountMapping m ON m.BankAccountNo = e.Bank_Account_No
    WHERE rm.Status = 'ACTIVE' AND rml.Status = 'ACTIVE' ${matchTypeFilter} ${matchBankFilter} ${dateFilter}
  ),
  Paired AS (
    SELECT
      COALESCE(b.MatchId, g.MatchId) AS MatchId,
      COALESCE(b.MatchType, g.MatchType) AS MatchType,
      COALESCE(b.MatchBankCode, g.MatchBankCode) AS BankCode,
      COALESCE(b.CreatedBy, g.CreatedBy) AS CreatedBy,
      COALESCE(b.CreatedAt, g.CreatedAt) AS CreatedAt,
      COALESCE(b.GroupNum, g.GroupNum) AS GroupNum,
      COALESCE(b.PairRn, g.PairRn) AS PairRn,
      b.LineId AS BankLineId, b.TranDate AS BankTranDate, b.Description AS BankDescription,
      CASE WHEN b.LineId IS NULL THEN NULL
           ELSE COALESCE(NULLIF(b.ChequeNo, '0'), CONCAT('L-', b.LineId)) END AS BankRef,
      CASE WHEN b.LineId IS NULL THEN NULL
           WHEN b.Credit IS NOT NULL THEN 'IN' ELSE 'OUT' END AS BankDirection,
      COALESCE(b.Credit, b.Debit) AS BankAmount,
      CASE WHEN b.LineId IS NULL THEN NULL
           ELSE COALESCE(b.Credit, 0) - COALESCE(b.Debit, 0) END AS BankSigned,
      g.Entry_No AS GLEntryNo, g.Posting_Date AS GLPostingDate, g.Document_No AS GLDocumentNo,
      g.Bank_Account_No AS GLBankAccountNo, g.BankAccountName AS GLBankAccountName,
      CASE WHEN g.Entry_No IS NULL THEN NULL
           WHEN g.Debit_Amount_LCY > 0 THEN 'IN' ELSE 'OUT' END AS GLDirection,
      CASE WHEN g.Entry_No IS NULL THEN NULL
           WHEN g.Debit_Amount_LCY > 0 THEN g.Debit_Amount_LCY ELSE g.Credit_Amount_LCY END AS GLAmount,
      CASE WHEN g.Entry_No IS NULL THEN NULL
           ELSE COALESCE(g.Debit_Amount_LCY, 0) - COALESCE(g.Credit_Amount_LCY, 0) END AS GLSigned,
      ${effDate} AS EffDate
    FROM BankSide b
    FULL OUTER JOIN GlSide g
      ON g.MatchId = b.MatchId AND g.GroupNum = b.GroupNum AND g.PairRn = b.PairRn
  )`);
  }

  const branches: string[] = [];

  if (includePairs) {
    branches.push(`
    SELECT
      CAST(CONCAT('M', p.MatchId, '-', p.GroupNum, '-', p.PairRn) AS NVARCHAR(60)) AS RowKey,
      CAST(p.MatchType AS VARCHAR(10)) AS Status,
      CAST(p.MatchId AS INT) AS MatchId,
      CAST(p.GroupNum AS INT) AS GroupNum,
      CAST(p.BankCode AS NVARCHAR(20)) AS BankCode,
      CAST(p.CreatedBy AS NVARCHAR(100)) AS CreatedBy,
      CAST(p.CreatedAt AS DATETIME2) AS CreatedAt,
      CAST(p.BankLineId AS BIGINT) AS BankLineId,
      CAST(p.BankTranDate AS DATE) AS BankTranDate,
      CAST(p.BankDescription AS NVARCHAR(500)) AS BankDescription,
      CAST(p.BankRef AS NVARCHAR(100)) AS BankRef,
      CAST(p.BankDirection AS VARCHAR(3)) AS BankDirection,
      CAST(p.BankAmount AS DECIMAL(18,2)) AS BankAmount,
      CAST(p.BankSigned AS DECIMAL(18,2)) AS BankSigned,
      CAST(p.GLEntryNo AS BIGINT) AS GLEntryNo,
      CAST(p.GLPostingDate AS DATE) AS GLPostingDate,
      CAST(p.GLDocumentNo AS NVARCHAR(100)) AS GLDocumentNo,
      CAST(p.GLBankAccountNo AS NVARCHAR(50)) AS GLBankAccountNo,
      CAST(p.GLBankAccountName AS NVARCHAR(200)) AS GLBankAccountName,
      CAST(p.GLDirection AS VARCHAR(3)) AS GLDirection,
      CAST(p.GLAmount AS DECIMAL(18,2)) AS GLAmount,
      CAST(p.GLSigned AS DECIMAL(18,2)) AS GLSigned,
      CAST(p.EffDate AS DATE) AS EffDate
    FROM Paired p`);
  }

  if (includeUnmatched) {
    // รายการค้าง (outstanding) ไม่มีคู่ให้ยึด จึงกรองด้วยวันที่ของตัวเองเสมอ ไม่ขึ้นกับเกณฑ์วันที่ที่เลือก
    branches.push(`
    SELECT
      CAST(CONCAT('B', bsl.LineId) AS NVARCHAR(60)) AS RowKey,
      CAST('UNMATCHED' AS VARCHAR(10)) AS Status,
      CAST(NULL AS INT) AS MatchId,
      CAST(NULL AS INT) AS GroupNum,
      CAST(bsl.BankCode AS NVARCHAR(20)) AS BankCode,
      CAST(NULL AS NVARCHAR(100)) AS CreatedBy,
      CAST(NULL AS DATETIME2) AS CreatedAt,
      CAST(bsl.LineId AS BIGINT) AS BankLineId,
      CAST(bsl.TranDate AS DATE) AS BankTranDate,
      CAST(bsl.Description AS NVARCHAR(500)) AS BankDescription,
      CAST(COALESCE(NULLIF(bsl.ChequeNo, '0'), CONCAT('L-', bsl.LineId)) AS NVARCHAR(100)) AS BankRef,
      CAST(CASE WHEN bsl.Credit IS NOT NULL THEN 'IN' ELSE 'OUT' END AS VARCHAR(3)) AS BankDirection,
      CAST(COALESCE(bsl.Credit, bsl.Debit) AS DECIMAL(18,2)) AS BankAmount,
      CAST(COALESCE(bsl.Credit, 0) - COALESCE(bsl.Debit, 0) AS DECIMAL(18,2)) AS BankSigned,
      CAST(NULL AS BIGINT) AS GLEntryNo,
      CAST(NULL AS DATE) AS GLPostingDate,
      CAST(NULL AS NVARCHAR(100)) AS GLDocumentNo,
      CAST(NULL AS NVARCHAR(50)) AS GLBankAccountNo,
      CAST(NULL AS NVARCHAR(200)) AS GLBankAccountName,
      CAST(NULL AS VARCHAR(3)) AS GLDirection,
      CAST(NULL AS DECIMAL(18,2)) AS GLAmount,
      CAST(NULL AS DECIMAL(18,2)) AS GLSigned,
      CAST(bsl.TranDate AS DATE) AS EffDate
    FROM BankStatementLine bsl
    WHERE bsl.TranDate >= @from AND bsl.TranDate <= @to
      ${f.bankCode ? 'AND bsl.BankCode = @bankCode' : ''}
      AND NOT EXISTS (
        SELECT 1 FROM ReconciliationMatchLine u_rml
        JOIN ReconciliationMatch u_rm ON u_rm.MatchId = u_rml.MatchId AND u_rm.Status = 'ACTIVE'
        WHERE u_rml.SourceType = 'BANK' AND u_rml.BankLineId = bsl.LineId AND u_rml.Status = 'ACTIVE'
      )`);

    branches.push(`
    SELECT
      CAST(CONCAT('G', e.Entry_No) AS NVARCHAR(60)) AS RowKey,
      CAST('UNMATCHED' AS VARCHAR(10)) AS Status,
      CAST(NULL AS INT) AS MatchId,
      CAST(NULL AS INT) AS GroupNum,
      CAST(m.BankCode AS NVARCHAR(20)) AS BankCode,
      CAST(NULL AS NVARCHAR(100)) AS CreatedBy,
      CAST(NULL AS DATETIME2) AS CreatedAt,
      CAST(NULL AS BIGINT) AS BankLineId,
      CAST(NULL AS DATE) AS BankTranDate,
      CAST(NULL AS NVARCHAR(500)) AS BankDescription,
      CAST(NULL AS NVARCHAR(100)) AS BankRef,
      CAST(NULL AS VARCHAR(3)) AS BankDirection,
      CAST(NULL AS DECIMAL(18,2)) AS BankAmount,
      CAST(NULL AS DECIMAL(18,2)) AS BankSigned,
      CAST(e.Entry_No AS BIGINT) AS GLEntryNo,
      CAST(e.Posting_Date AS DATE) AS GLPostingDate,
      CAST(e.Document_No AS NVARCHAR(100)) AS GLDocumentNo,
      CAST(e.Bank_Account_No AS NVARCHAR(50)) AS GLBankAccountNo,
      CAST(m.BankAccountName AS NVARCHAR(200)) AS GLBankAccountName,
      CAST(CASE WHEN e.Debit_Amount_LCY > 0 THEN 'IN' ELSE 'OUT' END AS VARCHAR(3)) AS GLDirection,
      CAST(CASE WHEN e.Debit_Amount_LCY > 0 THEN e.Debit_Amount_LCY ELSE e.Credit_Amount_LCY END AS DECIMAL(18,2)) AS GLAmount,
      CAST(COALESCE(e.Debit_Amount_LCY, 0) - COALESCE(e.Credit_Amount_LCY, 0) AS DECIMAL(18,2)) AS GLSigned,
      CAST(e.Posting_Date AS DATE) AS EffDate
    FROM BankAccountLedgerEntries e
    JOIN BankAccountMapping m ON m.BankAccountNo = e.Bank_Account_No
    WHERE m.BankCode IS NOT NULL
      AND e.Posting_Date >= @from AND e.Posting_Date <= @to
      ${f.bankCode ? 'AND m.BankCode = @bankCode' : ''}
      AND NOT EXISTS (
        SELECT 1 FROM ReconciliationMatchLine u_rml
        JOIN ReconciliationMatch u_rm ON u_rm.MatchId = u_rml.MatchId AND u_rm.Status = 'ACTIVE'
        WHERE u_rml.SourceType = 'GL' AND u_rml.GLEntryNo = e.Entry_No AND u_rml.Status = 'ACTIVE'
      )`);
  }

  const unified = `
  Unified AS (${branches.join('\n    UNION ALL')}
  )`;

  return `WITH${[...ctes, unified].join(',')}`;
}

/** เงื่อนไขค้นหาข้อความ ใช้ต่อท้าย WHERE ของ query ที่อ่านจาก Unified */
export function searchCondition(f: ReportFilters) {
  if (!f.q) return '';
  return `
    AND (
      BankDescription LIKE @q
      OR BankRef LIKE @q
      OR GLDocumentNo LIKE @q
      OR GLBankAccountName LIKE @q
      OR CAST(MatchId AS NVARCHAR(20)) LIKE @q
    )`;
}

export const ORDER_BY = 'ORDER BY EffDate, Status, COALESCE(MatchId, 0), COALESCE(GroupNum, 0), RowKey';

export type ReportRow = {
  rowKey: string;
  status: 'MATCHED' | 'SUSPENSE' | 'UNMATCHED';
  matchId: number | null;
  groupNum: number | null;
  bankCode: string | null;
  createdBy: string | null;
  createdAt: string | null;
  effDate: string | null;
  bank: {
    lineId: number;
    date: string | null;
    description: string | null;
    ref: string | null;
    direction: 'IN' | 'OUT';
    amount: number;
  } | null;
  gl: {
    entryNo: number;
    date: string | null;
    documentNo: string | null;
    accountNo: string | null;
    accountName: string | null;
    direction: 'IN' | 'OUT';
    amount: number;
  } | null;
  diff: number;
};

function isoDay(value: unknown): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export function mapRow(r: Record<string, unknown>): ReportRow {
  const bankSigned = r.BankSigned === null || r.BankSigned === undefined ? 0 : Number(r.BankSigned);
  const glSigned = r.GLSigned === null || r.GLSigned === undefined ? 0 : Number(r.GLSigned);

  return {
    rowKey: String(r.RowKey),
    status: r.Status as ReportRow['status'],
    matchId: r.MatchId === null ? null : Number(r.MatchId),
    groupNum: r.GroupNum === null ? null : Number(r.GroupNum),
    bankCode: (r.BankCode as string) ?? null,
    createdBy: (r.CreatedBy as string) ?? null,
    createdAt: r.CreatedAt ? new Date(r.CreatedAt as string).toISOString() : null,
    effDate: isoDay(r.EffDate),
    bank:
      r.BankLineId === null || r.BankLineId === undefined
        ? null
        : {
            lineId: Number(r.BankLineId),
            date: isoDay(r.BankTranDate),
            description: (r.BankDescription as string) ?? null,
            ref: (r.BankRef as string) ?? null,
            direction: r.BankDirection as 'IN' | 'OUT',
            amount: Number(r.BankAmount ?? 0),
          },
    gl:
      r.GLEntryNo === null || r.GLEntryNo === undefined
        ? null
        : {
            entryNo: Number(r.GLEntryNo),
            date: isoDay(r.GLPostingDate),
            documentNo: (r.GLDocumentNo as string) ?? null,
            accountNo: (r.GLBankAccountNo as string) ?? null,
            accountName: (r.GLBankAccountName as string) ?? null,
            direction: r.GLDirection as 'IN' | 'OUT',
            amount: Number(r.GLAmount ?? 0),
          },
    diff: Number((bankSigned - glSigned).toFixed(2)),
  };
}

export type SummaryBucket = {
  status: 'MATCHED' | 'SUSPENSE' | 'UNMATCHED';
  bankCode: string;
  rows: number;
  matches: number;
  bankLines: number;
  glLines: number;
  bankIn: number;
  bankOut: number;
  bankNet: number;
  glIn: number;
  glOut: number;
  glNet: number;
  diff: number;
};

export type ReportSummary = {
  total: number;
  buckets: SummaryBucket[];
  totals: Omit<SummaryBucket, 'status' | 'bankCode'>;
};

export const SUMMARY_SELECT = `
  SELECT
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
  FROM Unified
  WHERE 1=1`;

export function buildSummary(recordset: Record<string, unknown>[]): ReportSummary {
  const buckets: SummaryBucket[] = recordset.map((r) => {
    const bankNet = Number(r.BankNet_ ?? 0);
    const glNet = Number(r.GlNet_ ?? 0);
    return {
      status: r.Status as SummaryBucket['status'],
      bankCode: String(r.BankCode ?? '-'),
      rows: Number(r.Rows_ ?? 0),
      matches: Number(r.Matches_ ?? 0),
      bankLines: Number(r.BankLines_ ?? 0),
      glLines: Number(r.GlLines_ ?? 0),
      bankIn: Number(r.BankIn_ ?? 0),
      bankOut: Number(r.BankOut_ ?? 0),
      bankNet,
      glIn: Number(r.GlIn_ ?? 0),
      glOut: Number(r.GlOut_ ?? 0),
      glNet,
      diff: Number((bankNet - glNet).toFixed(2)),
    };
  });

  const round2 = (n: number) => Number(n.toFixed(2));

  const totals = buckets.reduce(
    (acc, b) => ({
      rows: acc.rows + b.rows,
      matches: acc.matches + b.matches,
      bankLines: acc.bankLines + b.bankLines,
      glLines: acc.glLines + b.glLines,
      bankIn: acc.bankIn + b.bankIn,
      bankOut: acc.bankOut + b.bankOut,
      bankNet: acc.bankNet + b.bankNet,
      glIn: acc.glIn + b.glIn,
      glOut: acc.glOut + b.glOut,
      glNet: acc.glNet + b.glNet,
      diff: 0,
    }),
    {
      rows: 0,
      matches: 0,
      bankLines: 0,
      glLines: 0,
      bankIn: 0,
      bankOut: 0,
      bankNet: 0,
      glIn: 0,
      glOut: 0,
      glNet: 0,
      diff: 0,
    }
  );
  totals.bankIn = round2(totals.bankIn);
  totals.bankOut = round2(totals.bankOut);
  totals.bankNet = round2(totals.bankNet);
  totals.glIn = round2(totals.glIn);
  totals.glOut = round2(totals.glOut);
  totals.glNet = round2(totals.glNet);
  totals.diff = round2(totals.bankNet - totals.glNet);

  // matches ของแต่ละ bucket นับแยกกัน รวมกันตรงๆ อาจซ้ำถ้า match เดียวมีหลาย BankCode
  // ในทางปฏิบัติ 1 match = 1 BankCode เสมอ (ตอนบันทึกใน /api/reconcile/match) จึงรวมได้
  return { total: totals.rows, buckets, totals };
}
