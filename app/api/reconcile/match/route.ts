import { NextRequest, NextResponse } from 'next/server';
import sql from 'mssql';
import { getPool } from '../../../../lib/db';
import { requireRole } from '../../../../lib/session';
import { RECONCILE_ROLES } from '../../../../lib/roles';
import { bankSignedSql, glSignedSql } from '../../../../lib/glAmount';
import { bankAccountColumnsReady } from '../../../../lib/bankAccountDb';

type MatchGroup = {
  bankLineIds: number[];
  glEntryNos: number[];
};

type MatchRequestBody = {
  bankCode: string;
  // บัญชีของ session ที่กำลังทำอยู่ — ใช้ยืนยันว่าทุกรายการที่ส่งมาเป็นบัญชีเดียวกันจริง
  bankAccountNo?: string | null;
  // OFFSET = หักล้างกันเอง: รายการ GL ล้วนที่ยกเลิกกันเองจนสุทธิเป็น 0 ไม่มีเงินผ่านธนาคาร (ดู lib/glOffset.ts)
  matchType: 'MATCHED' | 'SUSPENSE' | 'OFFSET';
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
    const { bankCode, bankAccountNo, matchType, groups } = body;
    // ผู้ทำรายการอ่านจาก session cookie ที่เซ็นไว้เท่านั้น ไม่รับค่าจาก body อีกต่อไป
    // ไม่งั้นใครก็ตั้งชื่อคนอื่นเป็นผู้จับคู่ได้ ทำให้ audit trail เชื่อถือไม่ได้
    const createdBy = auth.session.displayName;

    if (!bankCode || !matchType) {
      return NextResponse.json({ error: 'ข้อมูลไม่ครบ' }, { status: 400 });
    }
    // matchType ถูกนำไปใช้ทั้ง bind param และประกอบ SQL ต่อ (UPDATE MatchStatus) — ต้องจำกัดไว้เฉพาะ
    // ค่าที่รู้จักเท่านั้น กันค่าแปลกปลอมจาก client หลุดเข้า query (SQL injection) และกันสถานะขยะลง DB
    if (matchType !== 'MATCHED' && matchType !== 'SUSPENSE' && matchType !== 'OFFSET') {
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
      // หักล้างกันเองต้องมีอย่างน้อยขาเข้า 1 + ขาออก 1 และห้ามมีฝั่ง Bank — ถ้ามีเงินผ่านธนาคารจริงต้องใช้ MATCHED
      if (matchType === 'OFFSET') {
        if (g.bankLineIds.length > 0) {
          return NextResponse.json(
            { error: 'หักล้างกันเองใช้ได้เฉพาะรายการฝั่ง GL (BC365) — รายการที่มีเงินผ่านธนาคารต้องจับคู่ด้วยปุ่ม Match' },
            { status: 400 }
          );
        }
        if (g.glEntryNos.length < 2) {
          return NextResponse.json(
            { error: 'การหักล้างกันเองแต่ละกลุ่มต้องมีรายการ GL อย่างน้อย 2 รายการ (ขาเข้าและขาออก)' },
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
    const accountReady = await bankAccountColumnsReady();
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

      // 1b) รายการฝั่ง GL ต้องมีอยู่จริงและยังไม่อยู่ใน match ที่ ACTIVE — เดิมเช็คแค่ฝั่ง Bank
      //     ทำให้ GL ตัวเดียวถูกจับคู่ซ้ำได้ ถ้ามี 2 คนเปิดหน้าค้างไว้ หรือกดจาก popup ที่ข้อมูลเก่า
      if (seenGl.size > 0) {
        const glCsv = [...seenGl].join(','); // ทุกตัวผ่าน Number.isInteger แล้ว ต่อเข้า IN(...) ได้ปลอดภัย
        const glFound = await new sql.Request(transaction).query(
          `SELECT COUNT(DISTINCT Entry_No) AS N FROM BankAccountLedgerEntries WHERE Entry_No IN (${glCsv})`
        );
        if (Number(glFound.recordset[0]?.N ?? 0) !== seenGl.size) {
          throw new Error('มีรายการฝั่ง GL ที่ไม่พบในระบบ กรุณารีเฟรชหน้าใหม่');
        }
        const glTaken = await new sql.Request(transaction).query(`
          SELECT DISTINCT rml.GLEntryNo
          FROM ReconciliationMatchLine rml
          JOIN ReconciliationMatch rm ON rm.MatchId = rml.MatchId AND rm.Status = 'ACTIVE'
          WHERE rml.SourceType = 'GL' AND rml.Status = 'ACTIVE' AND rml.GLEntryNo IN (${glCsv})
        `);
        if (glTaken.recordset.length > 0) {
          throw new Error(
            `รายการฝั่ง GL ${glTaken.recordset.map((r) => r.GLEntryNo).join(', ')} ถูกจับคู่ไปแล้ว กรุณารีเฟรชหน้าใหม่`
          );
        }
      }

      // 1c) ทุกรายการในการจับคู่ครั้งนี้ต้องอยู่ "บัญชีเดียวกัน"
      //     ธนาคารหนึ่งมีได้หลายบัญชี (SCB 6 บัญชี) แต่ statement 1 ใบเป็นของบัญชีเดียว การจับคู่
      //     ข้ามบัญชีจึงผิดเสมอ แม้ยอดจะดุลกันพอดีก็ตาม — เคยหลุดไปแล้วจริง (MatchId 242 และ 261
      //     จับ TW_BBL_C1 ปนกับ PV_BBL_S1) ตอนที่ระบบยังกรองแค่ระดับธนาคาร
      //     ด่านนี้อยู่ฝั่ง server เพราะ client ที่เปิดค้างไว้ก่อนอัปเดตยังส่งของเดิมมาได้
      let matchAccountNo: string | null = null;
      if (accountReady) {
        if (seenGl.size > 0) {
          const glCsv = [...seenGl].join(',');
          const glAccounts = await new sql.Request(transaction).query(
            `SELECT DISTINCT Bank_Account_No FROM BankAccountLedgerEntries WHERE Entry_No IN (${glCsv})`
          );
          const list = glAccounts.recordset.map((r) => r.Bank_Account_No);
          if (list.length > 1) {
            throw new Error(
              `จับคู่ข้ามบัญชีไม่ได้ — รายการฝั่ง GL ที่เลือกมาจาก ${list.length} บัญชี (${list.join(', ')})`
            );
          }
          matchAccountNo = list[0] ?? null;
        }

        if (bankAccountNo) {
          if (matchAccountNo && matchAccountNo !== bankAccountNo) {
            throw new Error(
              `รายการฝั่ง GL เป็นของบัญชี ${matchAccountNo} แต่กำลังกระทบยอดบัญชี ${bankAccountNo} — กรุณารีเฟรชหน้าใหม่`
            );
          }
          matchAccountNo = matchAccountNo ?? bankAccountNo;
        }

        // ฝั่ง bank ยอมให้ BankAccountNo เป็น NULL ได้ (ไฟล์ที่นำเข้าก่อนระบบแยกตามบัญชี)
        // แต่ถ้าระบุไว้แล้วต้องตรงกัน
        if (seenBank.size > 0 && matchAccountNo) {
          const idsCsv = [...seenBank].join(',');
          const wrong = await new sql.Request(transaction)
            .input('accountNo', sql.NVarChar, matchAccountNo)
            .query(`
              SELECT DISTINCT BankAccountNo FROM BankStatementLine
              WHERE LineId IN (${idsCsv}) AND BankAccountNo IS NOT NULL AND BankAccountNo <> @accountNo
            `);
          if (wrong.recordset.length > 0) {
            throw new Error(
              `จับคู่ข้ามบัญชีไม่ได้ — รายการฝั่ง Bank เป็นของบัญชี ` +
                `${wrong.recordset.map((r) => r.BankAccountNo).join(', ')} ไม่ใช่ ${matchAccountNo}`
            );
          }
        }
      }

      // 2) แต่ละกลุ่มของ MATCHED ต้องมียอดสองฝั่งดุลกัน — ตรวจจากยอดจริงใน DB ไม่ใช่ตัวเลขที่ client ส่งมา
      //    ด่านนี้จำเป็นเพราะฝั่ง UI เคยส่งกลุ่มที่ยอดไม่ดุลมาได้ (ตอนผู้ใช้เลือกข้ามวันแล้วบางรายการถูกตัดทิ้ง)
      if (matchType === 'MATCHED') {
        for (let i = 0; i < groups.length; i++) {
          const g = groups[i];
          const bankReq = new sql.Request(transaction);
          const bankSum = await bankReq.query(
            `SELECT SUM(${bankSignedSql()}) AS Total
             FROM BankStatementLine WHERE LineId IN (${g.bankLineIds.join(',')})`
          );
          const glReq = new sql.Request(transaction);
          const glSum = await glReq.query(
            `SELECT SUM(${glSignedSql()}) AS Total
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

      // 2b) กลุ่มหักล้างกันเองต้องมีทั้งขาเข้าและขาออก และยอดสุทธิเป็น 0 จริง — ตรวจจากยอดใน DB เช่นกัน
      if (matchType === 'OFFSET') {
        const signed = glSignedSql();
        for (let i = 0; i < groups.length; i++) {
          const result = await new sql.Request(transaction).query(`
            SELECT SUM(${signed}) AS Net,
                   SUM(CASE WHEN ${signed} > 0 THEN 1 ELSE 0 END) AS InCount,
                   SUM(CASE WHEN ${signed} < 0 THEN 1 ELSE 0 END) AS OutCount,
                   SUM(CASE WHEN ${signed} = 0 THEN 1 ELSE 0 END) AS ZeroCount,
                   COUNT(DISTINCT Bank_Account_No) AS AccountCount
            FROM BankAccountLedgerEntries WHERE Entry_No IN (${groups[i].glEntryNos.join(',')})
          `);
          const row = result.recordset[0] ?? {};
          const net = Number(row.Net ?? 0);
          // ด่าน 1c ข้ามไปถ้ายังไม่ได้รัน sql/006 แต่การหักล้างข้ามบัญชีผิดเสมอ ฝั่ง GL มีเลขบัญชีทุกแถวอยู่แล้วจึงเช็คได้เลย
          if (Number(row.AccountCount ?? 0) !== 1) {
            throw new Error(`กลุ่มย่อยที่ ${i + 1} มีรายการจากหลายบัญชี — หักล้างข้ามบัญชีไม่ได้`);
          }
          if (Number(row.ZeroCount ?? 0) > 0) {
            throw new Error(`กลุ่มย่อยที่ ${i + 1} มีรายการยอด 0 บาท — หักล้างไม่ได้`);
          }
          if (Number(row.InCount ?? 0) === 0 || Number(row.OutCount ?? 0) === 0) {
            throw new Error(`กลุ่มย่อยที่ ${i + 1} ต้องมีทั้งรายการขาเข้า (IN) และขาออก (OUT) — หักล้างไม่ได้`);
          }
          if (Math.abs(net) >= AMOUNT_TOLERANCE) {
            throw new Error(
              `กลุ่มย่อยที่ ${i + 1} ขาเข้ากับขาออกต่างกัน ${formatAmount(Math.abs(net))} — หักล้างกันเองไม่ได้`
            );
          }
        }
      }

      // ── บันทึก ──────────────────────────────────────────────────────────────
      // 1 MatchId ต่อ 1 การกด Match ครั้งนี้ (ไม่ว่าจะมีกี่กลุ่มย่อยข้างในก็ตาม)
      const matchRequest = new sql.Request(transaction);
      matchRequest
        .input('bankCode', sql.NVarChar, bankCode)
        .input('matchType', sql.NVarChar, matchType)
        .input('createdBy', sql.NVarChar, createdBy);
      const storeAccount = accountReady && Boolean(matchAccountNo);
      if (storeAccount) matchRequest.input('bankAccountNo', sql.NVarChar, matchAccountNo);

      const matchResult = await matchRequest.query(`
          INSERT INTO ReconciliationMatch (BankCode, ${storeAccount ? 'BankAccountNo, ' : ''}MatchType, CreatedBy)
          OUTPUT INSERTED.MatchId
          VALUES (@bankCode, ${storeAccount ? '@bankAccountNo, ' : ''}@matchType, @createdBy)
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

      return NextResponse.json({
        matchId,
        matchType,
        bankAccountNo: matchAccountNo,
        groupCount: groups.length,
        bankLineCount: allBankIds.length,
      });
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
