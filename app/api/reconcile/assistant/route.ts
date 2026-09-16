import { NextRequest, NextResponse } from 'next/server';
import sql from 'mssql';
import { getPool } from '../../../../lib/db';
import { requireRole } from '../../../../lib/session';
import { RECONCILE_ROLES } from '../../../../lib/roles';
import { badRequest, parseDateRange } from '../../../../lib/apiInput';
import {
  DEFAULT_ASSISTANT_WINDOW,
  MAX_ASSISTANT_WINDOW,
  findNearDateMatches,
  type AssistantBankLine,
  type AssistantGlLine,
} from '../../../../lib/matchAssistant';
import { glAmount, glDirection } from '../../../../lib/glAmount';
import { bankAccountColumnsReady } from '../../../../lib/bankAccountDb';

// ข้อมูลต้องสดทุกครั้ง — รายการที่เพิ่งจับคู่ไปต้องไม่โผล่เป็นคำแนะนำอีก
export const dynamic = 'force-dynamic';

function toIsoDate(value: Date | string) {
  return new Date(value).toISOString().slice(0, 10);
}

// ผู้ช่วยหาคู่: หาคู่ Bank ↔ GL ที่ยอดตรงกันพอดีแต่ลงคนละวัน (ดูกติกาใน lib/matchAssistant.ts)
// อ่านอย่างเดียว ไม่บันทึกอะไร — การจับคู่จริงยิงไป /api/reconcile/match ตอนผู้ใช้กด Match เอง
//
// Query params:
//   bankCode      - required
//   bankAccountNo - optional, บัญชีที่กำลังกระทบยอด — ต้องส่งให้ตรงกับที่หน้า workspace ใช้
//                   ไม่งั้นผู้ช่วยจะเสนอคู่ข้ามบัญชีที่ตารางบนหน้าจอไม่มีให้เห็นด้วยซ้ำ
//   from, to      - required, งวดของ Reconciliation workspace (YYYY-MM-DD)
//   windowDays  - optional, ระยะห่างวันที่ที่ยอมรับ (1-31, ค่าเริ่มต้น 7)
//   direction   - optional, 'IN' | 'OUT' ค้นหาเฉพาะฝั่งที่หน้า workspace กำลังดู (ไม่ส่ง = ทั้ง 2 ฝั่ง)
export async function GET(req: NextRequest) {
  const auth = await requireRole(RECONCILE_ROLES);
  if (!auth.ok) return auth.response;

  try {
    const params = req.nextUrl.searchParams;
    const bankCode = params.get('bankCode');
    if (!bankCode) return badRequest('ต้องระบุ bankCode');
    const bankAccountNo = params.get('bankAccountNo');

    const range = parseDateRange(params.get('from'), params.get('to'));
    if ('error' in range) return badRequest(range.error);
    if (!range.from || !range.to) return badRequest('ต้องระบุช่วงวันที่ (from และ to)');

    const rawWindow = Number(params.get('windowDays') ?? DEFAULT_ASSISTANT_WINDOW);
    const windowDays = Number.isFinite(rawWindow)
      ? Math.min(Math.max(Math.trunc(rawWindow), 1), MAX_ASSISTANT_WINDOW)
      : DEFAULT_ASSISTANT_WINDOW;

    const direction = params.get('direction');
    if (direction !== null && direction !== 'IN' && direction !== 'OUT') {
      return badRequest('direction ต้องเป็น IN หรือ OUT');
    }

    // ดึงกว้างกว่างวดทั้ง 2 ฝั่ง: GL นอกงวดยังเป็นคู่ของ Bank ต้น/ปลายงวดได้
    // ส่วน Bank นอกงวดใช้นับเป็นคู่แข่งของ GL เท่านั้น (ไม่ถูกเสนอเป็นการ์ด)
    const scanFrom = new Date(range.from);
    scanFrom.setUTCDate(scanFrom.getUTCDate() - windowDays);
    const scanTo = new Date(range.to);
    scanTo.setUTCDate(scanTo.getUTCDate() + windowDays);

    const pool = await getPool();
    // ขอบเขตต้องตรงกับ /api/reconcile/data เป๊ะ ทั้งเรื่องบัญชีและ ORDER BY
    const byAccount = (await bankAccountColumnsReady()) && Boolean(bankAccountNo);

    // ORDER BY ต้องเหมือน /api/reconcile/data — การจับกลุ่มวันเดียวกันขึ้นกับลำดับรายการ
    const bankRequest = pool
      .request()
      .input('bankCode', sql.NVarChar, bankCode)
      .input('from', sql.Date, scanFrom)
      .input('to', sql.Date, scanTo);
    if (byAccount) bankRequest.input('bankAccountNo', sql.NVarChar, bankAccountNo);
    const bankQuery = bankRequest.query(`
        SELECT LineId, TranDate, Description, Debit, Credit, ChequeNo, Channel
        FROM BankStatementLine
        WHERE MatchStatus = 'UNMATCHED'
          ${byAccount
            ? 'AND (BankAccountNo = @bankAccountNo OR (BankAccountNo IS NULL AND BankCode = @bankCode))'
            : 'AND BankCode = @bankCode'}
          AND TranDate >= @from AND TranDate <= @to
        ORDER BY TranDate DESC, LineId DESC
      `);

    const glRequest = pool
      .request()
      .input('bankCode', sql.NVarChar, bankCode)
      .input('from', sql.Date, scanFrom)
      .input('to', sql.Date, scanTo);
    if (byAccount) glRequest.input('bankAccountNo', sql.NVarChar, bankAccountNo);
    const glQuery = glRequest.query(`
        SELECT e.Entry_No, e.Bank_Account_No, COALESCE(m.BankAccountName, e.Bank_Account_Name) AS AccountName,
               e.Posting_Date, e.Document_No, e.Debit_Amount_LCY, e.Credit_Amount_LCY
        FROM BankAccountLedgerEntries e
        JOIN BankAccountMapping m ON m.BankAccountNo = e.Bank_Account_No
        WHERE m.BankCode = @bankCode
          ${byAccount ? 'AND e.Bank_Account_No = @bankAccountNo' : ''}
          AND NOT EXISTS (
                SELECT 1 FROM ReconciliationMatchLine rml
                JOIN ReconciliationMatch rm ON rm.MatchId = rml.MatchId AND rm.Status = 'ACTIVE'
                WHERE rml.SourceType = 'GL' AND rml.GLEntryNo = e.Entry_No AND rml.Status = 'ACTIVE'
              )
          AND e.Posting_Date >= @from AND e.Posting_Date <= @to
        ORDER BY e.Posting_Date DESC, e.Entry_No DESC
      `);

    const [bankResult, glResult] = await Promise.all([bankQuery, glQuery]);

    const bankLines = bankResult.recordset.map(
      (r): AssistantBankLine => ({
        lineId: Number(r.LineId),
        date: toIsoDate(r.TranDate),
        direction: r.Credit !== null ? 'IN' : 'OUT',
        amount: Number(r.Credit !== null ? r.Credit : r.Debit),
        description: r.Description ?? '',
        ref: r.ChequeNo && r.ChequeNo !== '0' ? `Chq ${r.ChequeNo}` : `L-${r.LineId}`,
        channel: r.Channel ?? null,
      })
    );

    const glLines = glResult.recordset.map(
      (r): AssistantGlLine => ({
        entryNo: Number(r.Entry_No),
        date: toIsoDate(r.Posting_Date),
        direction: glDirection(r),
        amount: glAmount(r),
        documentNo: r.Document_No ?? '',
        accountNo: r.Bank_Account_No ?? '',
        accountName: r.AccountName?.trim() ? r.AccountName : null,
      })
    );

    // ตัดทิศทางอื่นทิ้งก่อนเข้า engine ได้เลย ผลของฝั่งที่เหลือไม่เปลี่ยน — การจับกลุ่มวันเดียวกัน
    // การจับคู่ และการนับคู่แข่ง แยกตามทิศทางอยู่แล้วทั้งหมด (IN ไม่มีทางแย่ง GL กับ OUT)
    const result = findNearDateMatches({
      bankLines: direction ? bankLines.filter((l) => l.direction === direction) : bankLines,
      glLines: direction ? glLines.filter((l) => l.direction === direction) : glLines,
      periodFrom: toIsoDate(range.from),
      periodTo: toIsoDate(range.to),
      windowDays,
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error('Match assistant error:', err);
    return NextResponse.json({ error: 'ผู้ช่วยหาคู่ทำงานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' }, { status: 500 });
  }
}
