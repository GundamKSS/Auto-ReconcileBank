import { NextRequest, NextResponse } from 'next/server';
import sql from 'mssql';
import { getPool } from '../../../../lib/db';
import { requireRole } from '../../../../lib/session';
import { RECONCILE_ROLES } from '../../../../lib/roles';
import { badRequest, parseDateRange } from '../../../../lib/apiInput';
import { glAmount, glDirection, glSignedAmount } from '../../../../lib/glAmount';
import { bankAccountColumnsReady } from '../../../../lib/bankAccountDb';
import { OFFSET_MATCH_TYPE, findReversalPairs } from '../../../../lib/glOffset';

// ข้อมูลต้องสดทุกครั้ง — เพิ่งยืนยัน/ยกเลิกไปต้องเห็นผลทันที
export const dynamic = 'force-dynamic';

// รายการหักล้างกันเอง (MatchType = 'OFFSET') ที่ยืนยันไว้แล้วของบัญชี + งวดที่กำลังกระทบยอด
// ให้แท็บ "ยืนยันแล้ว" ในหน้าต่างหักล้างกันเองของหน้า Reconcile — อ่านอย่างเดียว
// การบันทึกใช้ /api/reconcile/match (matchType OFFSET) และการยกเลิกใช้ /api/reconcile/unmatch ตามเดิม
//
// รายการพวกนี้ไม่มีฝั่ง Bank จึงไม่โผล่ในหน้า Match History (กรองด้วยวันที่/ทิศทางของบรรทัด Bank)
// ดูย้อนหลังข้ามงวดได้ที่หน้า Reports สถานะ "หักล้างกันเอง"
//
// Query params:
//   bankCode      - required
//   bankAccountNo - optional, บัญชีที่กำลังกระทบยอด (ขอบเขตเดียวกับ /api/reconcile/data)
//   from, to      - required, งวดของ workspace — เอากลุ่มที่มีรายการ GL ลงวันที่ในช่วงนี้อย่างน้อย 1 รายการ
//   glExtendDays  - optional, ขยายวันที่ "to" แบบเดียวกับ /api/reconcile/data
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

    const rawExtend = Number(params.get('glExtendDays') ?? '0');
    const glExtendDays = Number.isFinite(rawExtend) ? Math.min(Math.max(Math.trunc(rawExtend), 0), 365) : 0;
    const glTo = new Date(range.to);
    glTo.setUTCDate(glTo.getUTCDate() + glExtendDays);

    const pool = await getPool();
    const byAccount = (await bankAccountColumnsReady()) && Boolean(bankAccountNo);

    const request = pool
      .request()
      .input('matchType', sql.NVarChar, OFFSET_MATCH_TYPE)
      .input('bankCode', sql.NVarChar, bankCode)
      .input('from', sql.Date, range.from)
      .input('to', sql.Date, glTo);
    if (byAccount) request.input('bankAccountNo', sql.NVarChar, bankAccountNo);

    const result = await request.query(`
      SELECT rm.MatchId, rml.Num, rm.CreatedBy, rm.CreatedAt,
             e.Entry_No, e.Bank_Account_No, e.Posting_Date, e.Document_No, e.Source_Code,
             e.Debit_Amount_LCY, e.Credit_Amount_LCY
      FROM ReconciliationMatch rm
      JOIN ReconciliationMatchLine rml
        ON rml.MatchId = rm.MatchId AND rml.SourceType = 'GL' AND rml.Status = 'ACTIVE'
      JOIN BankAccountLedgerEntries e ON e.Entry_No = rml.GLEntryNo
      WHERE rm.MatchType = @matchType AND rm.Status = 'ACTIVE' AND rm.BankCode = @bankCode
        ${byAccount ? 'AND e.Bank_Account_No = @bankAccountNo' : ''}
        AND EXISTS (
              SELECT 1
              FROM ReconciliationMatchLine x_rml
              JOIN BankAccountLedgerEntries x_e ON x_e.Entry_No = x_rml.GLEntryNo
              WHERE x_rml.MatchId = rml.MatchId AND x_rml.Num = rml.Num
                AND x_rml.SourceType = 'GL' AND x_rml.Status = 'ACTIVE'
                AND x_e.Posting_Date >= @from AND x_e.Posting_Date <= @to
            )
      ORDER BY rm.CreatedAt DESC, rm.MatchId DESC, rml.Num, e.Posting_Date, e.Entry_No
    `);

    type Row = (typeof result.recordset)[number];
    const rowsByGroup = new Map<string, Row[]>();
    for (const r of result.recordset) {
      const key = `${r.MatchId}:${r.Num}`;
      const list = rowsByGroup.get(key);
      if (list) list.push(r);
      else rowsByGroup.set(key, [r]);
    }

    const groups = [...rowsByGroup.values()].map((rows) => {
      const first = rows[0];
      // กลุ่มที่อธิบายได้ครบด้วยคู่กลับรายการใน BC = ระบบเจอให้ ที่เหลือ = ผู้ใช้เลือกจับคู่เอง (เช่นแก้ด้วย JV)
      const reversalPairs = findReversalPairs(
        rows.map((r) => ({
          entryNo: Number(r.Entry_No),
          accountNo: r.Bank_Account_No,
          documentNo: r.Document_No,
          sourceCode: r.Source_Code,
          signedAmount: glSignedAmount(r),
        }))
      );
      return {
        matchId: Number(first.MatchId),
        num: Number(first.Num),
        createdBy: first.CreatedBy ?? null,
        createdAt: first.CreatedAt,
        kind: reversalPairs.length * 2 === rows.length ? 'REVERSAL' : 'MANUAL',
        lines: rows.map((r) => ({
          entryNo: Number(r.Entry_No),
          date: r.Posting_Date,
          ref: r.Document_No,
          sourceCode: r.Source_Code ?? null,
          direction: glDirection(r),
          amount: glAmount(r),
        })),
      };
    });

    return NextResponse.json({ groups });
  } catch (err) {
    console.error('GL offset list error:', err);
    return NextResponse.json({ error: 'ดึงรายการหักล้างกันเองไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' }, { status: 500 });
  }
}
