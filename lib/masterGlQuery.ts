import sql from 'mssql';
import { parseDateRange } from './apiInput';
import { glSignedSql } from './glAmount';

// query กลางของหน้า Master Data · GL — ใช้ร่วมกันระหว่าง "สรุปรายวัน" (/api/master/gl/days)
// กับ "รายการในวัน" (/api/master/gl/entries) ให้ตัวกรองสองชุดตรงกันเสมอ ตัวเลขรวมของวันจะได้เท่ากับรายการที่กางดู
//
// ตาราง GL (BankAccountLedgerEntries) เป็นกระจกเงาที่ sync มาจาก BC365 — อ่านอย่างเดียว
// เฉพาะบัญชีที่อยู่ใน BankAccountMapping (JOIN แบบหน้า Reconcile) เพราะในตารางมี Bank_Account_No ที่ไม่ใช่
// บัญชีธนาคาร เช่น 'PDC - R' และ 'TRANSFER' ปนอยู่
// สถานะไม่มีเก็บในตาราง GL — ดูจาก ReconciliationMatchLine ที่ยัง ACTIVE ของ Match ที่ยัง ACTIVE ไม่มีคือ UNMATCHED
// ทิศทางรับ/จ่ายใช้ยอดสุทธิ Debit - Credit (lib/glAmount.ts) เพราะแถว REVERSAL เก็บยอดติดลบไว้ในช่องเดิม

export const GL_STATUS_VALUES = ['UNMATCHED', 'MATCHED', 'SUSPENSE', 'OFFSET', 'EXCLUDED'] as const;

// ยาวได้ไม่เกินคอลัมน์ Source_Code NVARCHAR(10) / Bank_Account_No NVARCHAR(20)
const MAX_SOURCE_CODE_LENGTH = 10;
const MAX_ACCOUNT_NO_LENGTH = 20;

export type GlFilters = {
  bankCode: string | null;
  bankAccountNo: string | null;
  from: Date | null;
  to: Date | null;
  direction: 'IN' | 'OUT' | null;
  sourceCode: string | null;
  status: string | null;
  q: string | null;
};

export function parseGlFilters(params: URLSearchParams): { error: string } | GlFilters {
  const bankCode = params.get('bankCode')?.trim() || null;
  const bankAccountNo = params.get('bankAccountNo')?.trim() || null;
  if (bankAccountNo && bankAccountNo.length > MAX_ACCOUNT_NO_LENGTH) return { error: 'bankAccountNo ไม่ถูกต้อง' };

  const range = parseDateRange(params.get('from'), params.get('to'));
  if ('error' in range) return range;

  const direction = params.get('direction')?.trim().toUpperCase() || null;
  if (direction && direction !== 'IN' && direction !== 'OUT') return { error: 'direction ต้องเป็น IN หรือ OUT' };

  const sourceCode = params.get('sourceCode')?.trim() || null;
  if (sourceCode && sourceCode.length > MAX_SOURCE_CODE_LENGTH) return { error: 'sourceCode ไม่ถูกต้อง' };

  const status = params.get('status')?.trim().toUpperCase() || null;
  if (status && !(GL_STATUS_VALUES as readonly string[]).includes(status)) {
    return { error: 'status ต้องเป็น UNMATCHED, MATCHED, SUSPENSE, OFFSET หรือ EXCLUDED' };
  }

  return {
    bankCode,
    bankAccountNo,
    from: range.from,
    to: range.to,
    direction: direction as GlFilters['direction'],
    sourceCode,
    status,
    q: params.get('q')?.trim() || null,
  };
}

/** ขอบเขตบัญชี — ใช้ทั้งกับรายการและกับตัวเลือกสมุดรายวันใน dropdown */
export function glScopeWhere(f: GlFilters) {
  return `
    WHERE m.BankCode IS NOT NULL
      ${f.bankCode ? 'AND m.BankCode = @bankCode' : ''}
      ${f.bankAccountNo ? 'AND e.Bank_Account_No = @bankAccountNo' : ''}
  `;
}

/**
 * CTE ชื่อ Gl ที่กรองทุกอย่างแล้ว ยกเว้นทิศทางกับสถานะ — สองตัวนี้คำนวณจากคอลัมน์ที่สร้างใน CTE
 * จึงกรองใน WHERE ชั้นเดียวกันไม่ได้ ใช้ glDirectionWhere / glStatusMatch ต่อชั้นนอกแทน
 */
export function glCte(f: GlFilters) {
  return `
    WITH Gl AS (
      SELECT e.Entry_No, m.BankCode, e.Bank_Account_No,
             COALESCE(NULLIF(LTRIM(RTRIM(m.BankAccountName)), N''), e.Bank_Account_Name) AS BankAccountName,
             e.Posting_Date, e.Document_Date, NULLIF(LTRIM(RTRIM(e.Document_Type)), N'') AS Document_Type,
             e.Document_No, e.Source_Code, e.Debit_Amount_LCY, e.Credit_Amount_LCY,
             ${glSignedSql('e')} AS SignedAmount,
             st.MatchId, COALESCE(st.MatchType, 'UNMATCHED') AS MatchStatus
      FROM BankAccountLedgerEntries e
      JOIN BankAccountMapping m ON m.BankAccountNo = e.Bank_Account_No
      OUTER APPLY (
        SELECT TOP 1 rm.MatchId, UPPER(rm.MatchType) AS MatchType
        FROM ReconciliationMatchLine rml
        JOIN ReconciliationMatch rm ON rm.MatchId = rml.MatchId AND rm.Status = 'ACTIVE'
        WHERE rml.SourceType = 'GL' AND rml.GLEntryNo = e.Entry_No AND rml.Status = 'ACTIVE'
        ORDER BY rm.MatchId DESC
      ) st
      ${glScopeWhere(f)}
        ${f.from ? 'AND e.Posting_Date >= @from' : ''}
        ${f.to ? 'AND e.Posting_Date <= @to' : ''}
        ${f.sourceCode ? 'AND e.Source_Code = @sourceCode' : ''}
        ${
          f.q
            ? `AND (
                e.Document_No LIKE @q
                OR CAST(e.Entry_No AS NVARCHAR(30)) LIKE @q
                OR CONVERT(NVARCHAR(50), e.Debit_Amount_LCY) LIKE @qCompact
                OR CONVERT(NVARCHAR(50), e.Credit_Amount_LCY) LIKE @qCompact
              )`
            : ''
        }
    )
  `;
}

/** IN = ยอดสุทธิเป็นบวก ที่เหลือเป็น OUT — ให้ตรงกับ glDirection ที่หน้า Reconcile/Reports ใช้ */
export function glDirectionWhere(f: GlFilters) {
  return `
    WHERE 1=1
      ${f.direction === 'IN' ? 'AND SignedAmount > 0' : ''}
      ${f.direction === 'OUT' ? 'AND SignedAmount <= 0' : ''}
  `;
}

/** เงื่อนไขสถานะแบบใส่ใน WHERE หรือ CASE WHEN ได้ — ไม่กรองสถานะคือ 1=1 */
export function glStatusMatch(f: GlFilters) {
  return f.status ? 'MatchStatus = @status' : '1=1';
}

export function bindGlFilters(request: sql.Request, f: GlFilters) {
  if (f.bankCode) request.input('bankCode', sql.NVarChar, f.bankCode);
  if (f.bankAccountNo) request.input('bankAccountNo', sql.NVarChar, f.bankAccountNo);
  if (f.from) request.input('from', sql.Date, f.from);
  if (f.to) request.input('to', sql.Date, f.to);
  if (f.sourceCode) request.input('sourceCode', sql.NVarChar, f.sourceCode);
  if (f.q) {
    request.input('q', sql.NVarChar, `%${f.q}%`);
    // ค้นยอดเงินแบบพิมพ์มีจุลภาคได้ เช่น "1,234.50" — ตัดจุลภาคก่อนเทียบกับค่าตัวเลขที่แปลงเป็นข้อความ
    request.input('qCompact', sql.NVarChar, `%${f.q.replace(/,/g, '')}%`);
  }
  if (f.status) request.input('status', sql.NVarChar, f.status);
  return request;
}
