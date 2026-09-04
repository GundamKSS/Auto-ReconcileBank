import { NextRequest, NextResponse } from 'next/server';
import sql from 'mssql';
import { getPool } from '../../../../lib/db';
import { requireRole } from '../../../../lib/session';
import { RECONCILE_ROLES } from '../../../../lib/roles';

// ยกเลิกการจับคู่ (Unmatch) แบบเลือกได้หลายรายการพร้อมกัน โดยใช้เหตุผลเดียวร่วมกันทั้งชุด
// เลือกได้ถึงระดับ "กลุ่มย่อย (Num)" ภายใน MatchId เดียวกัน — กลุ่มย่อยอื่นที่ไม่ได้เลือกยังจับคู่อยู่ตามเดิม
//
// รับได้ 3 แบบ (เรียงจากละเอียดสุด):
//   { targets: [{ matchId, nums?: number[] }] }  - ไม่ใส่ nums = ยกเลิกทุกกลุ่มย่อยที่ยังใช้งานอยู่ของ Match นั้น
//   { matchIds: number[] }                        - ยกเลิกทั้ง Match (เทียบเท่า targets ที่ไม่ใส่ nums)
//   { matchId: number }                           - เผื่อ caller เก่าที่ยังส่งแบบเดี่ยว
// เฉพาะ MatchType = 'MATCHED' เท่านั้น (รายการ SUSPENSE ใช้ /api/reconcile/unsuspend แยกต่างหากตามเดิม)
//
// ทั้งชุดอยู่ใน transaction เดียว — ถ้ามีรายการไหนในชุด invalid (ไม่พบ/ยกเลิกไปแล้ว/ไม่ใช่ MATCHED/
// ระบุ Num ที่ไม่มีอยู่) จะ rollback ทั้งหมด ไม่ยกเลิกแบบครึ่งๆกลางๆ เพื่อให้ผู้ใช้เห็น error ชัดเจน
// แล้วเอารายการที่มีปัญหาออกจากที่เลือกก่อนลองใหม่
//
// ต่างจาก unsuspend ตรงที่ "ไม่ลบ" ReconciliationMatchLine ทิ้ง — เก็บไว้เป็นร่องรอยว่าครั้งนั้น
// เคยจับคู่อะไรกับอะไร แล้ว mark Status = 'REVERSED' พร้อมเหตุผล/ผู้ยกเลิก/เวลา ที่ตัวบรรทัดแทน
// (และ mark ที่หัว ReconciliationMatch ด้วย เมื่อทุกกลุ่มย่อยของ Match นั้นถูกยกเลิกครบแล้ว)
//
// ต้องรัน sql/002_reconciliation_match_reversal.sql และ sql/003_reconciliation_match_line_reversal.sql
// ก่อนใช้งาน endpoint นี้
type UnmatchTargetInput = { matchId: number; nums: number[] | null };

function parseTargets(body: unknown): UnmatchTargetInput[] | null {
  const b = body as Record<string, unknown> | null;
  const rawTargets = Array.isArray(b?.targets)
    ? (b!.targets as unknown[])
    : Array.isArray(b?.matchIds)
      ? (b!.matchIds as unknown[]).map((matchId) => ({ matchId }))
      : b?.matchId !== undefined
        ? [{ matchId: b!.matchId }]
        : [];

  // รวม target ที่ชี้ Match เดียวกันเข้าด้วยกัน — ถ้ามีอันไหนสั่งทั้ง Match (nums = null) ให้ชนะ
  const byMatchId = new Map<number, Set<number> | null>();
  for (const raw of rawTargets) {
    const t = raw as Record<string, unknown>;
    const matchId = Number(t?.matchId);
    if (!Number.isInteger(matchId)) return null;

    const rawNums = t?.nums;
    if (rawNums === undefined || rawNums === null) {
      byMatchId.set(matchId, null);
      continue;
    }
    if (!Array.isArray(rawNums)) return null;
    const nums = rawNums.map((v) => Number(v));
    if (nums.length === 0 || nums.some((n) => !Number.isInteger(n))) return null;

    if (byMatchId.has(matchId)) {
      const existing = byMatchId.get(matchId);
      if (existing === null) continue; // ยกเลิกทั้ง Match อยู่แล้ว ครอบคลุมกลุ่มย่อยนี้
      for (const n of nums) existing!.add(n);
    } else {
      byMatchId.set(matchId, new Set(nums));
    }
  }

  return [...byMatchId.entries()].map(([matchId, nums]) => ({
    matchId,
    nums: nums === null ? null : [...nums].sort((a, b) => a - b),
  }));
}

export async function POST(req: NextRequest) {
  const auth = await requireRole(RECONCILE_ROLES);
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json();
    const targets = parseTargets(body);
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
    // ผู้ยกเลิกอ่านจาก session cookie ที่เซ็นไว้ ไม่รับจาก body — ไม่งั้นระบุตัวผู้ทำรายการไม่ได้จริง
    const unmatchedBy = auth.session.displayName;

    if (targets === null) {
      return NextResponse.json({ error: 'รูปแบบรายการที่ต้องการยกเลิกไม่ถูกต้อง' }, { status: 400 });
    }
    if (targets.length === 0) {
      return NextResponse.json({ error: 'ไม่พบ MatchId ที่ต้องการยกเลิก' }, { status: 400 });
    }
    if (!reason) {
      return NextResponse.json({ error: 'กรุณาระบุเหตุผลในการยกเลิกการจับคู่' }, { status: 400 });
    }

    const pool = await getPool();
    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      let totalRevertedBankLines = 0;
      const results: { matchId: number; nums: number[]; revertedBankLineCount: number; matchFullyReversed: boolean }[] =
        [];

      for (const target of targets) {
        const { matchId } = target;

        const matchCheck = new sql.Request(transaction);
        const matchResult = await matchCheck
          .input('matchId', sql.Int, matchId)
          .query(`SELECT MatchType, Status FROM ReconciliationMatch WHERE MatchId = @matchId`);

        if (matchResult.recordset.length === 0) {
          throw new Error(`ไม่พบ MatchId ${matchId}`);
        }
        const { MatchType, Status } = matchResult.recordset[0];
        if (MatchType !== 'MATCHED') {
          throw new Error(`MatchId ${matchId} ไม่ใช่รายการที่จับคู่แล้ว (ใช้หน้า Suspense สำหรับรายการพักไว้)`);
        }
        if (Status === 'REVERSED') {
          throw new Error(`MatchId ${matchId} ถูกยกเลิกการจับคู่ไปแล้วก่อนหน้านี้`);
        }

        // กลุ่มย่อยที่ยัง "ใช้งานอยู่" ของ Match นี้ — ใช้ตรวจว่าที่ผู้ใช้เลือกมายังยกเลิกได้จริงไหม
        const activeNumsRequest = new sql.Request(transaction);
        const activeNumsResult = await activeNumsRequest
          .input('matchId', sql.Int, matchId)
          .query(`SELECT DISTINCT Num FROM ReconciliationMatchLine WHERE MatchId = @matchId AND Status = 'ACTIVE'`);
        const activeNums = new Set<number>(activeNumsResult.recordset.map((r) => Number(r.Num)));

        if (activeNums.size === 0) {
          throw new Error(`MatchId ${matchId} ถูกยกเลิกการจับคู่ไปแล้วก่อนหน้านี้`);
        }

        const numsToReverse = target.nums ?? [...activeNums].sort((a, b) => a - b);
        const alreadyReversed = numsToReverse.filter((n) => !activeNums.has(n));
        if (alreadyReversed.length > 0) {
          throw new Error(
            `MatchId ${matchId} กลุ่มย่อยที่ ${alreadyReversed.join(', ')} ถูกยกเลิกไปแล้ว หรือไม่มีอยู่ในรายการนี้`
          );
        }
        // Num ทุกตัวผ่าน Number.isInteger + เช็คว่ามีอยู่จริงใน Match นี้แล้ว — ปลอดภัยจาก SQL injection
        const numsCsv = numsToReverse.join(',');

        const bankLinesRequest = new sql.Request(transaction);
        const bankLinesResult = await bankLinesRequest.input('matchId', sql.Int, matchId).query(
          `SELECT BankLineId FROM ReconciliationMatchLine
           WHERE MatchId = @matchId AND SourceType = 'BANK' AND Status = 'ACTIVE' AND Num IN (${numsCsv})`
        );
        const bankLineIds: number[] = bankLinesResult.recordset.map((r) => Number(r.BankLineId));

        // คืนสถานะฝั่ง Bank เป็น UNMATCHED ให้กลับไปจับคู่ใหม่ได้ในหน้า Reconcile
        // (ฝั่ง GL ไม่มีคอลัมน์สถานะแยก — ใช้ Status ของ ReconciliationMatchLine ที่กำลังจะเปลี่ยนเป็น
        //  REVERSED นี่แหละเป็นตัวบอกว่า GL entry นี้ว่างพอจะจับคู่ใหม่ได้แล้ว ผ่าน query ฝั่ง data/suggest)
        if (bankLineIds.length > 0) {
          const updateBank = new sql.Request(transaction);
          await updateBank.query(
            `UPDATE BankStatementLine SET MatchStatus = 'UNMATCHED' WHERE LineId IN (${bankLineIds.join(',')})`
          );
        }

        const reverseLines = new sql.Request(transaction);
        await reverseLines
          .input('matchId', sql.Int, matchId)
          .input('reversedBy', sql.NVarChar, unmatchedBy)
          .input('reason', sql.NVarChar, reason)
          .query(`
            UPDATE ReconciliationMatchLine
            SET Status = 'REVERSED', ReversedAt = SYSDATETIME(), ReversedBy = @reversedBy, ReversedReason = @reason
            WHERE MatchId = @matchId AND Status = 'ACTIVE' AND Num IN (${numsCsv})
          `);

        // ยกเลิกครบทุกกลุ่มย่อยแล้ว = ทั้ง Match ถือว่าถูกยกเลิก — mark ที่หัวด้วยเพื่อให้ query เดิม
        // ที่เช็คแค่ระดับ Match (เช่นรายงาน) ยังเห็นตรงกัน
        const matchFullyReversed = numsToReverse.length === activeNums.size;
        if (matchFullyReversed) {
          const reverseHeader = new sql.Request(transaction);
          await reverseHeader
            .input('matchId', sql.Int, matchId)
            .input('reversedBy', sql.NVarChar, unmatchedBy)
            .input('reason', sql.NVarChar, reason)
            .query(`
              UPDATE ReconciliationMatch
              SET Status = 'REVERSED', ReversedAt = SYSDATETIME(), ReversedBy = @reversedBy, ReversedReason = @reason
              WHERE MatchId = @matchId
            `);
        }

        totalRevertedBankLines += bankLineIds.length;
        results.push({
          matchId,
          nums: numsToReverse,
          revertedBankLineCount: bankLineIds.length,
          matchFullyReversed,
        });
      }

      await transaction.commit();
      return NextResponse.json({
        results,
        matchIds: results.map((r) => r.matchId),
        groupCount: results.reduce((s, r) => s + r.nums.length, 0),
        revertedBankLineCount: totalRevertedBankLines,
      });
    } catch (err) {
      await transaction.rollback();
      // เงื่อนไขที่เราตรวจเองข้างบน (ไม่พบ Match / ยกเลิกไปแล้ว / ไม่ใช่ MATCHED) เป็นเรื่องของ
      // ข้อมูลที่ผู้ใช้เลือกมา ไม่ใช่ระบบพัง จึงตอบ 409 พร้อมข้อความตรงๆ ให้แก้ที่เลือกแล้วลองใหม่
      if (err instanceof Error) {
        return NextResponse.json({ error: err.message }, { status: 409 });
      }
      throw err;
    }
  } catch (err) {
    console.error('Unmatch API error:', err);
    return NextResponse.json({ error: 'ยกเลิกการจับคู่ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' }, { status: 500 });
  }
}
