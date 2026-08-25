import { NextRequest, NextResponse } from 'next/server';
import sql from 'mssql';
import { getPool } from '../../../../lib/db';


type Item = { id: number; amount: number };
type RawCluster = { bankIds: number[]; glIds: number[] };

// หา subset ของ items ที่ผลรวมเท่ากับ target พอดี (ภายในความคลาดเคลื่อน 0.005)
function findSubsetSum(items: Item[], target: number, maxSize = 5): Item[] | null {
  const sorted = [...items].sort((a, b) => b.amount - a.amount);
  const chosen: Item[] = [];
  function backtrack(startIdx: number, remaining: number): boolean {
    if (Math.abs(remaining) < 0.005 && chosen.length > 0) return true;
    if (chosen.length >= maxSize) return false;
    for (let i = startIdx; i < sorted.length; i++) {
      if (sorted[i].amount - remaining > 0.005) continue;
      chosen.push(sorted[i]);
      if (backtrack(i + 1, remaining - sorted[i].amount)) return true;
      chosen.pop();
    }
    return false;
  }
  return backtrack(0, target) ? [...chosen] : null;
}

// จัดกลุ่ม bank/gl ภายใน 1 (วันที่+ทิศทาง) เดียวกัน ให้เป็น cluster ย่อยๆ ที่ยอดตรงกันพอดี
function clusterMatches(bankItems: Item[], glItems: Item[]): RawCluster[] {
  const remainingBank = [...bankItems];
  const remainingGl = [...glItems];
  const clusters: RawCluster[] = [];

  for (let i = remainingBank.length - 1; i >= 0; i--) {
    const b = remainingBank[i];
    const j = remainingGl.findIndex((g) => Math.abs(g.amount - b.amount) < 0.005);
    if (j !== -1) {
      clusters.push({ bankIds: [b.id], glIds: [remainingGl[j].id] });
      remainingBank.splice(i, 1);
      remainingGl.splice(j, 1);
    }
  }
  for (let i = remainingBank.length - 1; i >= 0; i--) {
    const b = remainingBank[i];
    const subset = findSubsetSum(remainingGl, b.amount);
    if (subset) {
      clusters.push({ bankIds: [b.id], glIds: subset.map((s) => s.id) });
      remainingBank.splice(i, 1);
      for (const s of subset) {
        const idx = remainingGl.findIndex((g) => g.id === s.id);
        if (idx !== -1) remainingGl.splice(idx, 1);
      }
    }
  }
  for (let i = remainingGl.length - 1; i >= 0; i--) {
    const g = remainingGl[i];
    const subset = findSubsetSum(remainingBank, g.amount);
    if (subset) {
      clusters.push({ bankIds: subset.map((s) => s.id), glIds: [g.id] });
      remainingGl.splice(i, 1);
      for (const s of subset) {
        const idx = remainingBank.findIndex((b) => b.id === s.id);
        if (idx !== -1) remainingBank.splice(idx, 1);
      }
    }
  }
  return clusters;
}

// PREVIEW เท่านั้น — หา cluster แล้วส่งรายละเอียดเต็มกลับมาให้ดูก่อน "ไม่บันทึกลง database ใดๆ ทั้งสิ้น"
// การบันทึกจริงเกิดตอนผู้ใช้กด Match/Move to suspense ในหน้า preview ซึ่งจะยิงไปที่ /api/reconcile/match แยกต่างหาก
//
// ต้องกรองช่วงวันที่ (from/to/glExtendDays) ให้ตรงกับ /api/reconcile/data เป๊ะ — ไม่งั้น suggest จะไปดึงรายการ
// นอก Period ที่หน้า Reconciliation workspace กำลังทำงานอยู่มาปนด้วย (bank ใช้ to เดิม, GL ขยายได้ตาม glExtendDays)
export async function POST(req: NextRequest) {
  try {
    const { bankCode, from, to, glExtendDays: glExtendDaysRaw } = await req.json();
    if (!bankCode) {
      return NextResponse.json({ error: 'ต้องระบุ bankCode' }, { status: 400 });
    }

    const glExtendDays = Number(glExtendDaysRaw ?? '0');
    const fromDate = from ? new Date(`${from}T00:00:00Z`) : null;
    const toDate = to ? new Date(`${to}T00:00:00Z`) : null;

    let glToDate = toDate;
    if (toDate && glExtendDays > 0) {
      glToDate = new Date(toDate);
      glToDate.setUTCDate(glToDate.getUTCDate() + glExtendDays);
    }

    const pool = await getPool();

    const bankRequest = pool.request().input('bankCode', sql.NVarChar, bankCode);
    if (fromDate) bankRequest.input('from', sql.Date, fromDate);
    if (toDate) bankRequest.input('to', sql.Date, toDate);
    const bankResult = await bankRequest.query(`
        SELECT LineId, TranDate, Description, Debit, Credit
        FROM BankStatementLine
        WHERE BankCode = @bankCode AND MatchStatus = 'UNMATCHED'
          ${fromDate ? 'AND TranDate >= @from' : ''}
          ${toDate ? 'AND TranDate <= @to' : ''}
      `);

    const glRequest = pool.request().input('bankCode', sql.NVarChar, bankCode);
    if (fromDate) glRequest.input('from', sql.Date, fromDate);
    if (glToDate) glRequest.input('to', sql.Date, glToDate);
    const glResult = await glRequest.query(`
        SELECT e.Entry_No, e.Posting_Date, e.Document_No, e.Bank_Account_No, m.BankAccountName,
               e.Debit_Amount_LCY, e.Credit_Amount_LCY
        FROM BankAccountLedgerEntries e
        JOIN BankAccountMapping m ON m.BankAccountNo = e.Bank_Account_No
        WHERE m.BankCode = @bankCode
          AND NOT EXISTS (
            SELECT 1 FROM ReconciliationMatchLine rml
            JOIN ReconciliationMatch rm ON rm.MatchId = rml.MatchId AND rm.Status = 'ACTIVE'
            WHERE rml.SourceType = 'GL' AND rml.GLEntryNo = e.Entry_No AND rml.Status = 'ACTIVE'
          )
          ${fromDate ? 'AND e.Posting_Date >= @from' : ''}
          ${glToDate ? 'AND e.Posting_Date <= @to' : ''}
      `);

    type BankDetail = {
      lineId: number; date: string; description: string; direction: 'IN' | 'OUT'; amount: number;
    };
    type GlDetail = {
      entryNo: number; date: string; ref: string; accountName: string; direction: 'IN' | 'OUT'; amount: number;
    };

    const bankDetailMap = new Map<number, BankDetail>();
    const bankByKey = new Map<string, Item[]>();
    for (const r of bankResult.recordset) {
      const lineId = Number(r.LineId);
      const date = new Date(r.TranDate).toISOString().slice(0, 10);
      const direction: 'IN' | 'OUT' = r.Credit !== null ? 'IN' : 'OUT';
      const amount = Number(r.Credit !== null ? r.Credit : r.Debit);
      bankDetailMap.set(lineId, { lineId, date, description: r.Description, direction, amount });
      const key = `${date}_${direction}`;
      const list = bankByKey.get(key) ?? [];
      list.push({ id: lineId, amount });
      bankByKey.set(key, list);
    }

    const glDetailMap = new Map<number, GlDetail>();
    const glByKey = new Map<string, Item[]>();
    for (const r of glResult.recordset) {
      const entryNo = Number(r.Entry_No);
      const date = new Date(r.Posting_Date).toISOString().slice(0, 10);
      const direction: 'IN' | 'OUT' = Number(r.Debit_Amount_LCY) > 0 ? 'IN' : 'OUT';
      const amount = Number(r.Debit_Amount_LCY) > 0 ? Number(r.Debit_Amount_LCY) : Number(r.Credit_Amount_LCY);
      glDetailMap.set(entryNo, { entryNo, date, ref: r.Document_No, accountName: r.BankAccountName, direction, amount });
      const key = `${date}_${direction}`;
      const list = glByKey.get(key) ?? [];
      list.push({ id: entryNo, amount });
      glByKey.set(key, list);
    }

    const rawClusters: RawCluster[] = [];
    for (const [key, bankItems] of bankByKey) {
      const glItems = glByKey.get(key);
      if (!glItems || glItems.length === 0) continue;
      rawClusters.push(...clusterMatches(bankItems, glItems));
    }

    const clusters = rawClusters.map((c, idx) => {
      const type = c.bankIds.length === 1 && c.glIds.length === 1
        ? 'ONE_TO_ONE'
        : c.bankIds.length === 1
        ? 'ONE_TO_MANY'
        : 'MANY_TO_ONE';
      return {
        clusterId: idx + 1,
        type,
        bankLines: c.bankIds.map((id) => bankDetailMap.get(id)!),
        glLines: c.glIds.map((id) => glDetailMap.get(id)!),
      };
    });

    return NextResponse.json({ clusters });
  } catch (err) {
    console.error('Suggest preview error:', err);
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Suggest matches ไม่สำเร็จ: ${detail}` }, { status: 500 });
  }
}