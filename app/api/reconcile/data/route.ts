import { NextRequest, NextResponse } from 'next/server';
import sql from 'mssql';
import { getPool } from  '../../../../lib/db';


// กัน Next.js cache response ของ route นี้ไว้ (ต้องเป็นข้อมูลสดทุกครั้ง เพราะ filter วันที่/ธนาคารเปลี่ยนได้ตลอด)
export const dynamic = 'force-dynamic';

// Query params:
//   bankCode      - optional, ไม่ใส่ = ทุกธนาคาร
//   from, to      - optional, ช่วงวันที่ (YYYY-MM-DD) ถ้าไม่ใส่ = ไม่กรองวันที่
//   glExtendDays  - optional, ขยายวันที่ "to" ฝั่ง GL ออกไปอีกกี่วัน (ใช้หารายการพักโอนข้ามเดือน)
//                   ฝั่ง bank statement ยังใช้ "to" เดิม ไม่ขยายตาม
export async function GET(req: NextRequest) {
  try {
    const params = req.nextUrl.searchParams;
    const bankCode = params.get('bankCode');
    const from = params.get('from');
    const to = params.get('to');
    const glExtendDays = Number(params.get('glExtendDays') ?? '0');

    // แปลงเป็น Date object จริงก่อน bind เข้า sql.Date เสมอ (ส่ง string ตรงๆ ให้ mssql
    // บางเวอร์ชัน validate ค่าไม่ผ่านแบบเงียบๆ แล้ว filter ไม่ทำงานโดยไม่มี error ให้เห็น)
    const fromDate = from ? new Date(`${from}T00:00:00Z`) : null;
    const toDate = to ? new Date(`${to}T00:00:00Z`) : null;

    let glToDate = toDate;
    if (toDate && glExtendDays > 0) {
      glToDate = new Date(toDate);
      glToDate.setUTCDate(glToDate.getUTCDate() + glExtendDays);
    }

    const pool = await getPool();

    const bankRequest = pool.request();
    if (bankCode) bankRequest.input('bankCode', sql.NVarChar, bankCode);
    if (fromDate) bankRequest.input('from', sql.Date, fromDate);
    if (toDate) bankRequest.input('to', sql.Date, toDate);
    const bankResult = await bankRequest.query(`
      SELECT LineId, BankCode, TranDate, Description, Debit, Credit, ChequeNo
      FROM BankStatementLine
      WHERE MatchStatus = 'UNMATCHED'
        ${bankCode ? 'AND BankCode = @bankCode' : ''}
        ${fromDate ? 'AND TranDate >= @from' : ''}
        ${toDate ? 'AND TranDate <= @to' : ''}
      ORDER BY TranDate DESC, LineId DESC
    `);

    const glRequest = pool.request();
    if (bankCode) glRequest.input('bankCode', sql.NVarChar, bankCode);
    if (fromDate) glRequest.input('from', sql.Date, fromDate);
    if (glToDate) glRequest.input('to', sql.Date, glToDate);
    const glResult = await glRequest.query(`
      SELECT e.Entry_No, m.BankCode, e.Bank_Account_No, m.BankAccountName, e.Posting_Date,
             e.Document_No, e.Debit_Amount_LCY, e.Credit_Amount_LCY
      FROM BankAccountLedgerEntries e
      JOIN BankAccountMapping m ON m.BankAccountNo = e.Bank_Account_No
      WHERE m.BankCode IS NOT NULL
        AND NOT EXISTS (
              SELECT 1 FROM ReconciliationMatchLine rml
              JOIN ReconciliationMatch rm ON rm.MatchId = rml.MatchId AND rm.Status = 'ACTIVE'
              WHERE rml.SourceType = 'GL' AND rml.GLEntryNo = e.Entry_No AND rml.Status = 'ACTIVE'
            )
        ${bankCode ? 'AND m.BankCode = @bankCode' : ''}
        ${fromDate ? 'AND e.Posting_Date >= @from' : ''}
        ${glToDate ? 'AND e.Posting_Date <= @to' : ''}
      ORDER BY e.Posting_Date DESC, e.Entry_No DESC
    `);

    const bankLines = bankResult.recordset.map((r) => ({
      id: `bank-${r.LineId}`,
      lineId: Number(r.LineId),
      bankCode: r.BankCode,
      date: r.TranDate,
      ref: r.ChequeNo && r.ChequeNo !== '0' ? `Chq ${r.ChequeNo}` : `L-${r.LineId}`,
      direction: r.Credit !== null ? 'IN' : 'OUT',
      description: r.Description,
      amount: r.Credit !== null ? r.Credit : r.Debit,
    }));

    const glLines = glResult.recordset.map((r) => ({
      id: `gl-${r.Entry_No}`,
      entryNo: Number(r.Entry_No),
      bankCode: r.BankCode,
      accountNo: r.Bank_Account_No,
      accountName: r.BankAccountName,
      date: r.Posting_Date,
      ref: r.Document_No,
      direction: Number(r.Debit_Amount_LCY) > 0 ? 'IN' : 'OUT',
      description: r.Document_No,
      amount: Number(r.Debit_Amount_LCY) > 0 ? Number(r.Debit_Amount_LCY) : Number(r.Credit_Amount_LCY),
    }));

    return NextResponse.json({ bankLines, glLines });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'ไม่สามารถดึงข้อมูลสำหรับ reconcile ได้' }, { status: 500 });
  }
}