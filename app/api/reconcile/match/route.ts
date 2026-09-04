import { NextRequest, NextResponse } from 'next/server';
import sql from 'mssql';
import { getPool } from '../../../../lib/db';
import { requireRole } from '../../../../lib/session';
import { RECONCILE_ROLES } from '../../../../lib/roles';

type MatchGroup = {
  bankLineIds: number[];
  glEntryNos: number[];
};

type MatchRequestBody = {
  bankCode: string;
  matchType: 'MATCHED' | 'SUSPENSE';
  groups: MatchGroup[]; // แต่ละ group = 1 กลุ่มย่อย (Num) ภายใน MatchId เดียวกัน
};

// ผลต่างที่ยอมรับได้ตอนเทียบยอด Bank กับ GL — ครึ่งสตางค์ ให้ตรงกับเกณฑ์ที่ฝั่ง UI ใช้
const AMOUNT_TOLERANCE = 0.005;

function formatAmount(n: number) {
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export async function POST(req: NextRequest) {
  const auth = await requireRole(RECONCILE_ROLES);
  if (!auth.ok) return auth.response;

  try {
    const body: MatchRequestBody = await req.json();
    const { bankCode, matchType, groups } = body;
    // ผู้ทำรายการอ่านจาก session cookie ที่เซ็นไว้เท่านั้น ไม่รับค่าจาก body อีกต่อไป
    // ไม่งั้นใครก็ตั้งชื่อคนอื่นเป็นผู้จับคู่ได้ ทำให้ audit trail เชื่อถือไม่ได้
    const createdBy = auth.session.displayName;

    if (!bankCode || !matchType) {
      return NextResponse.json({ error: 'ข้อมูลไม่ครบ' }, { status: 400 });
    }
    // matchType ถูกนำไปใช้ทั้ง bind param และประกอบ SQL ต่อ (UPDATE MatchStatus) — ต้องจำกัดไว้เฉพาะ
    // ค่าที่รู้จักเท่านั้น กันค่าแปลกปลอมจาก client หลุดเข้า query (SQL injection) และกันสถานะขยะลง DB
    if (matchType !== 'MATCHED' && matchType !== 'SUSPENSE') {
      return NextResponse.json({ error: 'matchType ไม่ถูกต้อง' }, { status: 400 });
    }
    if (!Array.isArray(groups) || groups.length === 0) {
      return NextResponse.json({ error: 'ต้องมีอย่างน้อย 1 กลุ่ม' }, { status: 400 });
    }
    for (const g of groups) {
      if (!g || !Array.isArray(g.bankLineIds) || !Array.isArray(g.glEntryNos)) {
        return NextResponse.json({ error: 'รูปแบบกลุ่มไม่ถูกต้อง' }, { status: 400 });
      }
      if (matchType === 'MATCHED' && (g.bankLineIds.length === 0 || g.glEntryNos.length === 0)) {
        return NextResponse.json(
          { error: 'การ Match แต่ละกลุ่มต้องมีทั้งฝั่ง Bank และฝั่ง GL อย่างน้อยฝั่งละ 1 รายการ' },
          { status: 400 }
        );
      }
      // Suspense พักได้เฉพาะฝั่ง GL (Bank Statement เป็นข้อมูลจากธนาคาร ห้ามพัก) แต่ต้องมีอย่างน้อย 1 รายการ
      // เดิมเงื่อนไข "กลุ่มต้องไม่ว่าง" บังคับเฉพาะ MATCHED ทำให้ส่ง SUSPENSE กลุ่มว่างมาแล้ว
      // ได้หัวบันทึก ReconciliationMatch ที่ไม่มีบรรทัดข้างในค้างอยู่ในระบบ
      if (matchType === 'SUSPENSE') {
        if (g.glEntryNos.length === 0) {
          return NextResponse.json(
            { error: 'การพักเข้าบัญชีพักต้องมีรายการฝั่ง GL (BC365) อย่างน้อย 1 รายการ' },
            { status: 400 }
          );
        }
        if (g.bankLineIds.length > 0) {
          return NextResponse.json(
            { error: 'พักเข้าบัญชีพักได้เฉพาะฝั่ง GL (BC365) เท่านั้น ฝั่ง Bank Statement พักไม่ได้' },
            { status: 400 }
          );
        }
      }
      const allIds = [...g.bankLineIds, ...g.glEntryNos];
      if (!allIds.every((id) => Number.isInteger(id))) {
        return NextResponse.json({ error: 'มีค่า id ที่ไม่ใช่จำนวนเต็ม' }, { status: 400 });
      }
    }

    // รายการเดียวกันห้ามอยู่ใน 2 กลุ่มพร้อมกัน ไม่งั้นจะได้บรรทัดซ้ำใน MatchId เดียว
    const seenBank = new Set<number>();
    const seenGl = new Set<number>();
    for (const g of groups) {
      for (const id of g.bankLineIds) {
        if (seenBank.has(id)) {
          return NextResponse.json({ error: `รายการ Bank ซ้ำกันในหลายกลุ่ม (LineId ${id})` }, { status: 400 });
        }
        seenBank.add(id);
      }
      for (const id of g.glEntryNos) {
        if (seenGl.has(id)) {
          return NextResponse.json({ error: `รายการ GL ซ้ำกันในหลายกลุ่ม (Entry_No ${id})` }, { status: 400 });
        }
        seenGl.add(id);
      }
    }

    const pool = await getPool();
    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      // ── ตรวจก่อนบันทึก ──────────────────────────────────────────────────────
      // 1) รายการฝั่ง Bank ต้องยังว่าง (UNMATCHED) อยู่จริง — กันกรณีอีกคนจับคู่ตัดหน้าไปแล้ว
      if (seenBank.size > 0) {
        const idsCsv = [...seenBank].join(','); // ทุกตัวผ่าน Number.isInteger แล้ว ต่อเข้า IN(...) ได้ปลอดภัย
        const check = new sql.Request(transaction);
        const found = await check.query(
          `SELECT LineId, UPPER(MatchStatus) AS MatchStatus FROM BankStatementLine WHERE LineId IN (${idsCsv})`
        );
        if (found.recordset.length !== seenBank.size) {
          throw new Error('มีรายการฝั่ง Bank ที่ไม่พบในระบบ กรุณารีเฟรชหน้าใหม่');
        }
        const taken = found.recordset.filter((r) => r.MatchStatus !== 'UNMATCHED');
        if (taken.length > 0) {
          throw new Error(
            `รายการฝั่ง Bank ${taken.map((r) => r.LineId).join(', ')} ถูกจับคู่ไปแล้ว กรุณารีเฟรชหน้าใหม่`
          );
        }
      }

      // 2) แต่ละกลุ่มของ MATCHED ต้องมียอดสองฝั่งดุลกัน — ตรวจจากยอดจริงใน DB ไม่ใช่ตัวเลขที่ client ส่งมา
      //    ด่านนี้จำเป็นเพราะฝั่ง UI เคยส่งกลุ่มที่ยอดไม่ดุลมาได้ (ตอนผู้ใช้เลือกข้ามวันแล้วบางรายการถูกตัดทิ้ง)
      if (matchType === 'MATCHED') {
        for (let i = 0; i < groups.length; i++) {
          const g = groups[i];
          const bankReq = new sql.Request(transaction);
          const bankSum = await bankReq.query(
            `SELECT SUM(CASE WHEN Credit IS NOT NULL THEN Credit ELSE Debit END) AS Total
             FROM BankStatementLine WHERE LineId IN (${g.bankLineIds.join(',')})`
          );
          const glReq = new sql.Request(transaction);
          const glSum = await glReq.query(
            `SELECT SUM(CASE WHEN Debit_Amount_LCY > 0 THEN Debit_Amount_LCY ELSE Credit_Amount_LCY END) AS Total
             FROM BankAccountLedgerEntries WHERE Entry_No IN (${g.glEntryNos.join(',')})`
          );
          const bankTotal = Number(bankSum.recordset[0]?.Total ?? 0);
          const glTotal = Number(glSum.recordset[0]?.Total ?? 0);

          if (Math.abs(bankTotal - glTotal) >= AMOUNT_TOLERANCE) {
            throw new Error(
              `กลุ่มย่อยที่ ${i + 1} ยอดสองฝั่งไม่ตรงกัน ` +
                `(Bank ${formatAmount(bankTotal)} / GL ${formatAmount(glTotal)} ` +
                `ต่างกัน ${formatAmount(Math.abs(bankTotal - glTotal))}) — จับคู่ไม่ได้`
            );
          }
        }
      }

      // ── บันทึก ──────────────────────────────────────────────────────────────
      // 1 MatchId ต่อ 1 การกด Match ครั้งนี้ (ไม่ว่าจะมีกี่กลุ่มย่อยข้างในก็ตาม)
      const matchRequest = new sql.Request(transaction);
      const matchResult = await matchRequest
        .input('bankCode', sql.NVarChar, bankCode)
        .input('matchType', sql.NVarChar, matchType)
        .input('createdBy', sql.NVarChar, createdBy)
        .query(`
          INSERT INTO ReconciliationMatch (BankCode, MatchType, CreatedBy)
          OUTPUT INSERTED.MatchId
          VALUES (@bankCode, @matchType, @createdBy)
        `);
      const matchId = matchResult.recordset[0].MatchId;

      let num = 0;
      const allBankIds: number[] = [];

      for (const group of groups) {
        num += 1; // เลขกลุ่มย่อยเริ่มที่ 1 ไล่ขึ้นไปเรื่อยๆ ภายใน MatchId นี้

        for (const bankId of group.bankLineIds) {
          const r = new sql.Request(transaction);
          await r
            .input('matchId', sql.Int, matchId)
            .input('num', sql.Int, num)
            .input('bankLineId', sql.BigInt, bankId)
            .query(`INSERT INTO ReconciliationMatchLine (MatchId, Num, SourceType, BankLineId) VALUES (@matchId, @num, 'BANK', @bankLineId)`);
          allBankIds.push(bankId);
        }

        for (const glId of group.glEntryNos) {
          const r = new sql.Request(transaction);
          await r
            .input('matchId', sql.Int, matchId)
            .input('num', sql.Int, num)
            .input('glEntryNo', sql.BigInt, glId)
            .query(`INSERT INTO ReconciliationMatchLine (MatchId, Num, SourceType, GLEntryNo) VALUES (@matchId, @num, 'GL', @glEntryNo)`);
        }
      }

      // อัปเดตสถานะฝั่ง BankStatementLine รวดเดียวทั้งหมดที่อยู่ใน MatchId นี้
      if (allBankIds.length > 0) {
        const updateRequest = new sql.Request(transaction);
        // allBankIds ผ่าน Number.isInteger ครบทุกตัวแล้ว จึงต่อเข้า IN(...) ได้อย่างปลอดภัย
        // ส่วน matchType bind เป็น parameter เสมอ ไม่ต่อสตริงดิบ (แม้จะ validate เป็น enum ไว้แล้วก็ตาม)
        await updateRequest
          .input('matchType', sql.NVarChar, matchType)
          .query(`
          UPDATE BankStatementLine SET MatchStatus = @matchType WHERE LineId IN (${allBankIds.join(',')})
        `);
      }

      await transaction.commit();

      return NextResponse.json({ matchId, matchType, groupCount: groups.length, bankLineCount: allBankIds.length });
    } catch (err) {
      await transaction.rollback();
      // ข้อผิดพลาดที่เราตั้งใจโยนเองข้างบนเป็นเรื่องของข้อมูลที่ผู้ใช้เลือกมา ไม่ใช่ระบบพัง
      // จึงตอบ 409 (ข้อมูลขัดแย้ง) พร้อมข้อความตรงๆ ให้ผู้ใช้แก้ได้เอง
      if (err instanceof Error) {
        return NextResponse.json({ error: err.message }, { status: 409 });
      }
      throw err;
    }
  } catch (err) {
    console.error('Match API error:', err);
    return NextResponse.json({ error: 'บันทึกการจับคู่ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' }, { status: 500 });
  }
}
