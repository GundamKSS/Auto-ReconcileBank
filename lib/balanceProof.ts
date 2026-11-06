import sql from 'mssql';
import { bankSignedSql, glSignedSql } from './glAmount';
import { reconcileExtrasReady } from './reconcileExtrasDb';
import { statementBalance } from './bankBalance';
import { isoDate } from './periodClose';

/**
 * ยอดคงเหลือ Bank เทียบ GL ของงวด — แยกออกมาจาก app/api/reconcile/balance/route.ts (GET) เดิม
 * เพื่อให้ POST /api/reconcile/period-close เรียกใช้สูตรคำนวณเดียวกันได้ (เงื่อนไขปิดงวด = remaining === 0)
 * โดยไม่ต้อง copy ตรรกะซ้ำ — ดูคอมเมนต์อธิบายที่มาของสูตรที่ยังคงไว้ใน balance/route.ts
 */

const EPS = 0.005;

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

type GlRow = {
  Entry_No: number;
  Posting_Date: Date;
  Document_No: string | null;
  Signed: number;
  MatchId: number | null;
  MatchType: string | null;
  Num: number | null;
  Remark: string | null;
};

export async function computeBalanceProof(
  pool: sql.ConnectionPool,
  account: { bankAccountNo: string; bankCode: string | null },
  from: Date,
  to: Date
) {
  const extrasReady = await reconcileExtrasReady();
  const bind = (r: sql.Request) =>
    r
      .input('acc', sql.NVarChar, account.bankAccountNo)
      .input('bankCode', sql.NVarChar, account.bankCode)
      .input('from', sql.Date, from)
      .input('to', sql.Date, to);

  // ฝั่ง bank รวมบรรทัดที่ยังไม่ระบุบัญชี (ไฟล์เก่า) ของธนาคารเดียวกันไว้ด้วย — กติกาเดียวกับ /api/reconcile/data
  const bankQuery = bind(pool.request()).query(`
    SELECT LineId, TranDate, Balance, UPPER(MatchStatus) AS MatchStatus, ${bankSignedSql()} AS Signed
    FROM BankStatementLine
    WHERE MatchStatus <> 'DELETED'
      AND (BankAccountNo = @acc OR (BankAccountNo IS NULL AND BankCode = @bankCode))
      AND TranDate >= @from AND TranDate <= @to
  `);

  const glQuery = bind(pool.request()).query(`
    SELECT e.Entry_No, e.Posting_Date, e.Document_No, ${glSignedSql('e')} AS Signed,
           am.MatchId, am.MatchType, am.Num, am.Remark
    FROM BankAccountLedgerEntries e
    OUTER APPLY (
      SELECT TOP 1 rm.MatchId, rm.MatchType, rml.Num, ${extrasReady ? 'rm.Remark' : 'CAST(NULL AS NVARCHAR(500)) AS Remark'}
      FROM ReconciliationMatchLine rml
      JOIN ReconciliationMatch rm ON rm.MatchId = rml.MatchId AND rm.Status = 'ACTIVE'
      WHERE rml.SourceType = 'GL' AND rml.Status = 'ACTIVE' AND rml.GLEntryNo = e.Entry_No
    ) am
    WHERE e.Bank_Account_No = @acc AND e.Posting_Date >= @from AND e.Posting_Date <= @to
  `);

  // คู่ที่จับและพักโอนส่วนต่างไว้ ที่มีบรรทัด Bank อยู่ในงวดนี้ — คิดส่วนต่างจากทุกบรรทัดของ match
  const differenceQuery = extrasReady
    ? bind(pool.request()).query(`
        SELECT rm.MatchId, rm.Remark, rm.CreatedBy, rm.CreatedAt,
               (SELECT SUM(${bankSignedSql('b')}) FROM ReconciliationMatchLine l
                 JOIN BankStatementLine b ON b.LineId = l.BankLineId
                 WHERE l.MatchId = rm.MatchId AND l.SourceType = 'BANK' AND l.Status = 'ACTIVE') AS BankSum,
               (SELECT SUM(${glSignedSql('g')}) FROM ReconciliationMatchLine l
                 JOIN BankAccountLedgerEntries g ON g.Entry_No = l.GLEntryNo
                 WHERE l.MatchId = rm.MatchId AND l.SourceType = 'GL' AND l.Status = 'ACTIVE') AS GlSum
        FROM ReconciliationMatch rm
        WHERE rm.Status = 'ACTIVE' AND rm.MatchType = 'MATCHED' AND rm.Remark IS NOT NULL
          AND rm.BankAccountNo = @acc
          AND EXISTS (
            SELECT 1 FROM ReconciliationMatchLine l
            JOIN BankStatementLine b ON b.LineId = l.BankLineId
            WHERE l.MatchId = rm.MatchId AND l.SourceType = 'BANK' AND l.Status = 'ACTIVE'
              AND b.TranDate >= @from AND b.TranDate <= @to
          )
        ORDER BY rm.MatchId
      `)
    : null;

  // ยอดยกมา GL: ที่บันทึกไว้ของงวดนี้ ถ้าไม่มีให้เสนอจากงวดที่บันทึกไว้ใกล้ที่สุด ± การเคลื่อนไหว GL ระหว่างทาง
  const openingQuery = extrasReady
    ? bind(pool.request()).query(`
        SELECT TOP 1 PeriodStart, GlOpeningBalance, COALESCE(UpdatedBy, CreatedBy) AS SavedBy,
               COALESCE(UpdatedAt, CreatedAt) AS SavedAt, 0 AS Kind
        FROM ReconciliationOpeningBalance WHERE BankAccountNo = @acc AND PeriodStart = @from
        UNION ALL
        SELECT * FROM (
          SELECT TOP 1 o.PeriodStart, o.GlOpeningBalance + COALESCE((
                   SELECT SUM(${glSignedSql('e')}) FROM BankAccountLedgerEntries e
                   WHERE e.Bank_Account_No = @acc AND e.Posting_Date >= o.PeriodStart AND e.Posting_Date < @from
                 ), 0) AS GlOpeningBalance,
                 CAST(NULL AS NVARCHAR(100)) AS SavedBy, CAST(NULL AS DATETIMEOFFSET) AS SavedAt, 1 AS Kind
          FROM ReconciliationOpeningBalance o
          WHERE o.BankAccountNo = @acc AND o.PeriodStart < @from
          ORDER BY o.PeriodStart DESC
        ) prev
        UNION ALL
        SELECT * FROM (
          SELECT TOP 1 o.PeriodStart, o.GlOpeningBalance - COALESCE((
                   SELECT SUM(${glSignedSql('e')}) FROM BankAccountLedgerEntries e
                   WHERE e.Bank_Account_No = @acc AND e.Posting_Date >= @from AND e.Posting_Date < o.PeriodStart
                 ), 0) AS GlOpeningBalance,
                 CAST(NULL AS NVARCHAR(100)) AS SavedBy, CAST(NULL AS DATETIMEOFFSET) AS SavedAt, 2 AS Kind
          FROM ReconciliationOpeningBalance o
          WHERE o.BankAccountNo = @acc AND o.PeriodStart > @from
          ORDER BY o.PeriodStart ASC
        ) nxt
      `)
    : null;

  const [bankResult, glResult, differenceResult, openingResult] = await Promise.all([
    bankQuery,
    glQuery,
    differenceQuery,
    openingQuery,
  ]);

  // ── ฝั่ง Bank ─────────────────────────────────────────────────────────────
  const bankRows = bankResult.recordset.map((r) => ({
    lineId: Number(r.LineId),
    date: isoDate(r.TranDate),
    signed: Number(r.Signed ?? 0),
    balance: r.Balance === null || r.Balance === undefined ? null : Number(r.Balance),
    status: String(r.MatchStatus),
  }));
  const stmt = statementBalance(bankRows);
  const bankIn = bankRows.reduce((s, l) => s + Math.max(l.signed, 0), 0);
  const bankOut = bankRows.reduce((s, l) => s + Math.max(-l.signed, 0), 0);
  const bankUnmatched = bankRows.filter((l) => l.status === 'UNMATCHED');
  const bankMatchedNet = bankRows.filter((l) => l.status !== 'UNMATCHED').reduce((s, l) => s + l.signed, 0);
  // แยกฝั่งตามคนที่รับผิดชอบ (เงินเข้า = AR, เงินออก = AP) ใช้ตรวจเงื่อนไขปิดงวดข้อ 46 ก และข้อ 33
  // ดู lib/periodCloseChecks.ts — วันที่ล่าสุดของแต่ละฝั่งบอกว่าไฟล์ของฝั่งนั้นนำเข้าถึงวันสิ้นงวดแล้วหรือยัง
  const sideOf = (rows: typeof bankRows, direction: 'IN' | 'OUT') =>
    rows.filter((l) => (direction === 'IN' ? l.signed >= 0 : l.signed < 0));
  const lastDateOf = (rows: typeof bankRows) =>
    rows.reduce<string | null>((max, l) => (max === null || l.date > max ? l.date : max), null);
  const sideCount = (direction: 'IN' | 'OUT') => {
    const rows = sideOf(bankUnmatched, direction);
    return { count: rows.length, net: round2(rows.reduce((s, l) => s + l.signed, 0)) };
  };

  // ── ฝั่ง GL ───────────────────────────────────────────────────────────────
  const glRows = (glResult.recordset as GlRow[]).map((r) => ({
    entryNo: Number(r.Entry_No),
    date: isoDate(r.Posting_Date),
    documentNo: r.Document_No,
    signed: Number(r.Signed ?? 0),
    matchId: r.MatchId === null ? null : Number(r.MatchId),
    matchType: r.MatchType ? String(r.MatchType).toUpperCase() : null,
    num: r.Num === null ? null : Number(r.Num),
    remark: r.Remark ?? null,
  }));
  // ยอด GL "ก่อนปรับปรุง" — ไม่รวม JV ปรับปรุงพักโอน ให้ตรงกับกระดาษที่ทีมบัญชีใช้
  const glBeforeAdjustment = glRows.filter((l) => l.matchType !== 'EXCLUDED');
  const glIn = glBeforeAdjustment.reduce((s, l) => s + Math.max(l.signed, 0), 0);
  const glOut = glBeforeAdjustment.reduce((s, l) => s + Math.max(-l.signed, 0), 0);
  const sumOf = (type: string | null) =>
    glRows.filter((l) => l.matchType === type).reduce((s, l) => s + l.signed, 0);
  const countOf = (type: string | null) => glRows.filter((l) => l.matchType === type).length;

  const openingRows = openingResult?.recordset ?? [];
  const saved = openingRows.find((r) => Number(r.Kind) === 0) ?? null;
  const suggestion = openingRows.find((r) => Number(r.Kind) === 1) ?? openingRows.find((r) => Number(r.Kind) === 2) ?? null;
  const glOpening = saved ? Number(saved.GlOpeningBalance) : null;

  // ── รายวัน: ยอดเคลื่อนไหวและยอดคงเหลือสะสมทั้งสองฝั่ง (แบบ pivot ที่ทีมบัญชีทำมือ) ───────────────
  const days = new Map<string, { bankIn: number; bankOut: number; glIn: number; glOut: number }>();
  const day = (d: string) => {
    let v = days.get(d);
    if (!v) days.set(d, (v = { bankIn: 0, bankOut: 0, glIn: 0, glOut: 0 }));
    return v;
  };
  for (const l of bankRows) {
    if (l.signed >= 0) day(l.date).bankIn += l.signed;
    else day(l.date).bankOut -= l.signed;
  }
  for (const l of glBeforeAdjustment) {
    if (l.signed >= 0) day(l.date).glIn += l.signed;
    else day(l.date).glOut -= l.signed;
  }
  let bankRunning = stmt.opening;
  let glRunning = glOpening;
  const daily = [...days.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, v]) => {
      if (bankRunning !== null) bankRunning = round2(bankRunning + v.bankIn - v.bankOut);
      if (glRunning !== null) glRunning = round2(glRunning + v.glIn - v.glOut);
      const statementClosing = stmt.closingByDate.get(date);
      return {
        date,
        bankIn: round2(v.bankIn),
        bankOut: round2(v.bankOut),
        bankBalance: bankRunning,
        // ยอดตามไฟล์ไม่ตรงกับที่คำนวณ = ไฟล์ขาดบรรทัด หรือธนาคารลงยอดผิด ให้หน้าจอเตือน
        bankStatementMismatch:
          statementClosing !== undefined && bankRunning !== null && Math.abs(statementClosing - bankRunning) >= EPS,
        glIn: round2(v.glIn),
        glOut: round2(v.glOut),
        glBalance: glRunning,
        dayDiffIn: round2(v.bankIn - v.glIn),
        dayDiffOut: round2(v.bankOut - v.glOut),
      };
    });

  const bankClosing = stmt.opening === null ? null : round2(stmt.opening + bankIn - bankOut);
  const glClosing = glOpening === null ? null : round2(glOpening + glIn - glOut);

  // ── รายการที่อธิบายผลต่าง ───────────────────────────────────────────────────
  const differenceMatchesWithAccountingSign = (differenceResult?.recordset ?? [])
    .map((r) => {
      const bankSigned = round2(Number(r.BankSum ?? 0));
      const glSigned = round2(Number(r.GlSum ?? 0));
      return {
        matchId: Number(r.MatchId),
        remark: String(r.Remark),
        createdBy: r.CreatedBy as string,
        createdAt: r.CreatedAt,
        bankAmount: Math.abs(bankSigned),
        glAmount: Math.abs(glSigned),
        // เครื่องหมายที่ผู้ใช้เห็นตรงกับ Difference บน workspace: ยอด Bank - ยอด BC โดยไม่กลับเครื่องหมายตาม IN/OUT
        difference: round2(Math.abs(bankSigned) - Math.abs(glSigned)),
        // ใช้เครื่องหมายทางบัญชีเฉพาะตอนอธิบาย Bank closing - GL closing
        accountingDifference: round2(bankSigned - glSigned),
      };
    })
    .filter((m) => Math.abs(m.accountingDifference) >= EPS);
  const differenceTotal = differenceMatchesWithAccountingSign.reduce((s, m) => s + m.accountingDifference, 0);
  const differenceMatches = differenceMatchesWithAccountingSign.map((m) => ({
    matchId: m.matchId,
    remark: m.remark,
    createdBy: m.createdBy,
    createdAt: m.createdAt,
    bankAmount: m.bankAmount,
    glAmount: m.glAmount,
    difference: m.difference,
  }));
  const matchedGap = bankMatchedNet - sumOf('MATCHED');
  const suspenseTransfer = bankClosing !== null && glClosing !== null ? round2(bankClosing - glClosing) : null;
  const adjustmentNet = round2(sumOf('EXCLUDED'));

  const excludedGroups = new Map<string, { matchId: number; num: number; remark: string | null; entries: typeof glRows }>();
  for (const l of glRows) {
    if (l.matchType !== 'EXCLUDED' || l.matchId === null) continue;
    const key = `${l.matchId}-${l.num}`;
    const g = excludedGroups.get(key) ?? { matchId: l.matchId, num: l.num ?? 1, remark: l.remark, entries: [] };
    g.entries.push(l);
    excludedGroups.set(key, g);
  }

  return {
    extrasReady,
    account: { bankAccountNo: account.bankAccountNo, bankCode: account.bankCode },
    period: { from: isoDate(from), to: isoDate(to) },
    bank: {
      opening: stmt.opening,
      totalIn: round2(bankIn),
      totalOut: round2(bankOut),
      closing: bankClosing,
      statementClosing: stmt.closing,
      chainOk: stmt.chainOk,
      lineCount: bankRows.length,
      lastDateIn: lastDateOf(sideOf(bankRows, 'IN')),
      lastDateOut: lastDateOf(sideOf(bankRows, 'OUT')),
    },
    gl: {
      opening: glOpening,
      openingSavedBy: saved?.SavedBy ?? null,
      openingSavedAt: saved?.SavedAt ?? null,
      suggestedOpening: suggestion ? round2(Number(suggestion.GlOpeningBalance)) : null,
      suggestedFromPeriod: suggestion ? isoDate(suggestion.PeriodStart) : null,
      totalIn: round2(glIn),
      totalOut: round2(glOut),
      closing: glClosing,
      lineCount: glRows.length,
    },
    // ยอดพักโอน = Bank ปลายงวด − GL ก่อนปรับปรุง
    difference: suspenseTransfer,
    adjustment: {
      count: countOf('EXCLUDED'),
      net: adjustmentNet,
      glClosingAfter: glClosing === null ? null : round2(glClosing + adjustmentNet),
      // ยอดพักโอนที่ยังไม่มี JV ปรับปรุงรองรับ — 0 = ปรับปรุงครบ GL หลังปรับปรุงเท่ากับ Bank
      remaining: suspenseTransfer === null ? null : round2(suspenseTransfer - adjustmentNet),
    },
    breakdown: {
      openingDifference:
        stmt.opening !== null && glOpening !== null ? round2(stmt.opening - glOpening) : null,
      bankUnmatched: { count: bankUnmatched.length, net: round2(bankUnmatched.reduce((s, l) => s + l.signed, 0)) },
      bankUnmatchedByDirection: { IN: sideCount('IN'), OUT: sideCount('OUT') },
      glUnmatched: { count: countOf(null), net: round2(sumOf(null)) },
      glSuspense: { count: countOf('SUSPENSE'), net: round2(sumOf('SUSPENSE')) },
      glOffset: { count: countOf('OFFSET'), net: round2(sumOf('OFFSET')) },
      // คู่ที่ยอดไม่เท่ากันยังคง Match รายการต้นทางตามจริง แต่พักเฉพาะผลต่างไว้กับ MatchId
      suspenseDifference: round2(differenceTotal),
      crossPeriodMatched: round2(matchedGap - differenceTotal),
    },
    differenceMatches,
    excluded: [...excludedGroups.values()].map((g) => ({
      matchId: g.matchId,
      num: g.num,
      remark: g.remark,
      entries: g.entries.map((e) => ({ entryNo: e.entryNo, date: e.date, documentNo: e.documentNo, amount: round2(e.signed) })),
    })),
    daily,
  };
}
