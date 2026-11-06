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
import { bankAccountColumnsReady, statementSenderColumnsReady } from '../../../../lib/bankAccountDb';
import { extractSenderFromText } from '../../../../lib/bankParsers/senderExtractor';
import { cancelledGlEntryNos } from '../../../../lib/cancelledGl';

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
    const [accountReady, hasSender] = await Promise.all([
      bankAccountColumnsReady(),
      statementSenderColumnsReady(),
    ]);
    const byAccount = accountReady && Boolean(bankAccountNo);

    // ORDER BY ต้องเหมือน /api/reconcile/data — การจับกลุ่มวันเดียวกันขึ้นกับลำดับรายการ
    // เมื่อ byAccount = true เราดึงทุกบัญชีที่ยังไม่จับคู่ในช่วงเวลามาด้วย เพื่อให้:
    //   1) ตรวจพบ GL ต่างบัญชีที่อาจลงผิดบัญชีใน BC365 (Cross-Account alert)
    //   2) กัน GL ต่างบัญชีที่มีคู่ Statement ของบัญชีตัวเองในวันเดียวกันอยู่แล้วออก (ไม่เตือนมั่ว)
    const bankRequest = pool
      .request()
      .input('bankCode', sql.NVarChar, bankCode)
      .input('from', sql.Date, scanFrom)
      .input('to', sql.Date, scanTo);
    if (byAccount) bankRequest.input('bankAccountNo', sql.NVarChar, bankAccountNo);
    const bankQuery = bankRequest.query(`
        SELECT LineId, TranDate, Description, Debit, Credit, ChequeNo, Channel, RawDescription,
               ${accountReady ? 'COALESCE(BankAccountNo, CASE WHEN BankCode = @bankCode THEN @bankAccountNo ELSE NULL END) AS BankAccountNo,' : 'NULL AS BankAccountNo,'}
               ${hasSender ? 'SenderBank, SenderAccountNo, SenderAccountName' : 'NULL AS SenderBank, NULL AS SenderAccountNo, NULL AS SenderAccountName'}
        FROM BankStatementLine
        WHERE MatchStatus = 'UNMATCHED'
          ${byAccount ? '' : 'AND BankCode = @bankCode'}
          AND TranDate >= @from AND TranDate <= @to
        ORDER BY TranDate DESC, LineId DESC
      `);

    const glRequest = pool
      .request()
      .input('bankCode', sql.NVarChar, bankCode)
      .input('from', sql.Date, scanFrom)
      .input('to', sql.Date, scanTo);
    const glQuery = glRequest.query(`
        SELECT e.Entry_No, e.Bank_Account_No, m.BankCode,
               COALESCE(m.BankAccountName, e.Bank_Account_Name) AS AccountName,
               e.Posting_Date, e.Document_No, e.Source_Code, e.Debit_Amount_LCY, e.Credit_Amount_LCY
        FROM BankAccountLedgerEntries e
        JOIN BankAccountMapping m ON m.BankAccountNo = e.Bank_Account_No
        WHERE ${byAccount ? 'm.BankCode IS NOT NULL' : 'm.BankCode = @bankCode'}
          AND NOT EXISTS (
                SELECT 1 FROM ReconciliationMatchLine rml
                JOIN ReconciliationMatch rm ON rm.MatchId = rml.MatchId AND rm.Status = 'ACTIVE'
                WHERE rml.SourceType = 'GL' AND rml.GLEntryNo = e.Entry_No AND rml.Status = 'ACTIVE'
              )
          AND e.Posting_Date >= @from AND e.Posting_Date <= @to
        ORDER BY e.Posting_Date DESC, e.Entry_No DESC
      `);

    const [bankResult, glResult, cancelled] = await Promise.all([
      bankQuery, glQuery, cancelledGlEntryNos(pool),
    ]);

    const bankLines = bankResult.recordset.map((r): AssistantBankLine => {
      const fallback =
        !r.SenderBank && !r.SenderAccountNo && !r.SenderAccountName
          ? extractSenderFromText(r.RawDescription)
          : null;
      return {
        lineId: Number(r.LineId),
        date: toIsoDate(r.TranDate),
        direction: r.Credit !== null ? 'IN' : 'OUT',
        amount: Number(r.Credit !== null ? r.Credit : r.Debit),
        description: r.Description ?? '',
        ref: r.ChequeNo && r.ChequeNo !== '0' ? `Chq ${r.ChequeNo}` : `L-${r.LineId}`,
        channel: r.Channel ?? null,
        accountNo: r.BankAccountNo ?? null,
        rawDescription: r.RawDescription ?? null,
        senderBank: r.SenderBank ?? fallback?.senderBank ?? null,
        senderAccountNo: r.SenderAccountNo ?? fallback?.senderAccountNo ?? null,
        senderAccountName: r.SenderAccountName ?? fallback?.senderAccountName ?? null,
      };
    });

    // คู่กลับรายการใน BC ถูกแยกออกจากตารางใน /api/reconcile/data แล้ว — ต้องตัดออกแบบเดียวกัน
    // ไม่งั้นผู้ช่วยจะเสนอใบที่ถูกยกเลิกไปแล้วให้จับคู่กับเงินจริงในธนาคาร และจับกลุ่มวันเดียวกันไม่ตรงกับตาราง
    const glRows = glResult.recordset.filter((r) => !cancelled.has(Number(r.Entry_No)));

    const glLines = glRows.map(
      (r): AssistantGlLine => ({
        entryNo: Number(r.Entry_No),
        date: toIsoDate(r.Posting_Date),
        direction: glDirection(r),
        amount: glAmount(r),
        documentNo: r.Document_No ?? '',
        accountNo: r.Bank_Account_No ?? '',
        accountName: r.AccountName?.trim() ? r.AccountName : null,
        bankCode: r.BankCode ?? null,
      })
    );

    // ส่ง bankLines และ glLines ทั้งหมดเข้า engine เพื่อให้ตรวจจับเคส "บันทึกผิดฝั่ง" (IN vs OUT)
    // และ "Statement ต่างบัญชี" ได้ โดย engine จะกรอง activeDirection ให้เอง
    const result = findNearDateMatches({
      bankLines,
      glLines,
      periodFrom: toIsoDate(range.from),
      periodTo: toIsoDate(range.to),
      windowDays,
      bankAccountNo: byAccount ? bankAccountNo : null,
      activeDirection: direction,
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error('Match assistant error:', err);
    return NextResponse.json({ error: 'ผู้ช่วยหาคู่ทำงานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' }, { status: 500 });
  }
}
