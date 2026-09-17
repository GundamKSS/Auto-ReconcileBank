// หักล้างกันเอง (GL offset) — รายการฝั่ง BC365 ที่ยกเลิกกันเองจนยอดสุทธิเป็น 0 จึงไม่เคยมีเงินผ่านธนาคาร
// ไม่ต้องจับคู่กับ Bank Statement แต่ต้องบันทึกเก็บไว้เป็น ReconciliationMatch.MatchType = 'OFFSET'
// (มีแต่บรรทัดฝั่ง GL แบบเดียวกับ SUSPENSE) เพื่อให้ตรวจย้อนหลังและยกเลิกได้
//
// ไฟล์นี้ต้องไม่ import mssql — หน้า Reconcile (client) ใช้ร่วมกับ route ฝั่ง server
//
// เคสจริงที่มาของกติกา (BBL #150-3074633 วันที่ 21/08/2026):
//   PVD2608-0086 จ่ายออก 1,117.76 → กด Reverse ใน BC ได้แถว Source_Code = 'REVERSAL' (Credit −1,117.76 ระบบอ่านเป็นเงินเข้า)
//   → ออกใบใหม่ PVD2608-0132 จ่ายออก 1,117.76 ซึ่งเป็นใบเดียวที่ตัดเงินจากธนาคารจริง
//
// ห้ามจับคู่อัตโนมัติด้วย "ยอดเท่ากัน + วันเดียวกัน + ทิศตรงข้าม" — ข้อมูลจริงมีเคสที่ผิด:
//   BBL 31/08 ยอด 20,000 CAV2608-0011 (เข้า) เป็นเงินเข้าธนาคารจริง แต่ยอด/วันตรงกับ GEN-P26-0010 (ออก)
//   และเคส 21/08 ข้างบน แถว REVERSAL ยอดตรงกับใบออกได้ทั้ง 0086 และ 0132 (0132 คือใบที่จ่ายจริง)
// จึงจับคู่อัตโนมัติเฉพาะแถว REVERSAL กับใบเดิมที่ "เลขเอกสารเดียวกัน" (ข้อมูลจริง 124 แถว ตรงกัน 1:1 ทุกแถว)
// ส่วนการแก้ด้วย JV ซึ่งเลขเอกสารคนละใบ ให้ผู้ใช้เลือกจับคู่เองในหน้าต่างหักล้างกันเอง

export const OFFSET_MATCH_TYPE = 'OFFSET';

// ผลต่างที่ยอมรับได้ — ต้องตรงกับ AMOUNT_TOLERANCE ใน api/reconcile/match
const AMOUNT_TOLERANCE = 0.005;

export type OffsetCandidate = {
  entryNo: number;
  accountNo: string;
  documentNo: string | null;
  sourceCode: string | null;
  /** ยอดสุทธิแบบมีเครื่องหมาย (Debit − Credit) บวก = เงินเข้า, ลบ = เงินออก */
  signedAmount: number;
};

export type ReversalPair = { originalEntryNo: number; reversalEntryNo: number };

export function isReversalSource(sourceCode: string | null | undefined) {
  return (sourceCode ?? '').trim().toUpperCase() === 'REVERSAL';
}

function cents(n: number) {
  return Math.round(n * 100);
}

function pairKey(accountNo: string, documentNo: string, amountCents: number) {
  return `${accountNo}|${documentNo}|${amountCents}`;
}

/**
 * จับคู่แถวกลับรายการ (Source_Code = REVERSAL) กับใบเดิม: บัญชีเดียวกัน + เลขเอกสารเดียวกัน + ยอดตรงข้ามกันพอดี
 * ถ้ามีใบเดิมเข้าเงื่อนไขหลายใบ (ยังไม่เคยเจอในข้อมูลจริง) เลือกใบที่บันทึกก่อนแถวกลับรายการและ Entry_No ใกล้ที่สุด
 * แถวที่หาคู่ไม่ได้ไม่ถูกเดาให้ — ยังอยู่ในตารางให้คนตัดสินเองตามปกติ
 */
export function findReversalPairs(entries: OffsetCandidate[]): ReversalPair[] {
  const originals = new Map<string, OffsetCandidate[]>();
  const reversals: OffsetCandidate[] = [];
  for (const e of entries) {
    const doc = e.documentNo?.trim();
    if (!doc || cents(e.signedAmount) === 0) continue;
    if (isReversalSource(e.sourceCode)) {
      reversals.push(e);
      continue;
    }
    const key = pairKey(e.accountNo, doc, cents(e.signedAmount));
    const list = originals.get(key);
    if (list) list.push(e);
    else originals.set(key, [e]);
  }

  const used = new Set<number>();
  const pairs: ReversalPair[] = [];
  for (const r of reversals.sort((a, b) => a.entryNo - b.entryNo)) {
    const key = pairKey(r.accountNo, r.documentNo!.trim(), -cents(r.signedAmount));
    const candidates = (originals.get(key) ?? []).filter((o) => !used.has(o.entryNo));
    if (candidates.length === 0) continue;
    const before = candidates.filter((o) => o.entryNo < r.entryNo);
    const pick = (before.length > 0 ? before : candidates).reduce((best, o) =>
      Math.abs(o.entryNo - r.entryNo) < Math.abs(best.entryNo - r.entryNo) ? o : best
    );
    used.add(pick.entryNo);
    pairs.push({ originalEntryNo: pick.entryNo, reversalEntryNo: r.entryNo });
  }
  return pairs;
}

/** แยกคู่กลับรายการออกจากรายการทั้งหมด — rest คงลำดับเดิมไว้ (การติ๊กอัตโนมัติขึ้นกับลำดับรายการ) */
export function splitReversalPairs<T>(items: T[], toCandidate: (item: T) => OffsetCandidate) {
  const candidates = items.map(toCandidate);
  const found = findReversalPairs(candidates);
  const itemByEntryNo = new Map(candidates.map((c, i) => [c.entryNo, items[i]]));
  const paired = new Set(found.flatMap((p) => [p.originalEntryNo, p.reversalEntryNo]));
  return {
    pairs: found.map((p) => ({
      original: itemByEntryNo.get(p.originalEntryNo)!,
      reversal: itemByEntryNo.get(p.reversalEntryNo)!,
    })),
    rest: items.filter((_, i) => !paired.has(candidates[i].entryNo)),
  };
}

/** เหตุผลที่กลุ่มรายการ GL ยังหักล้างกันเองไม่ได้ หรือ null ถ้าได้ — server ตรวจซ้ำจากยอดใน DB อีกชั้นเสมอ */
export function offsetGroupProblem(signedAmounts: number[]): string | null {
  const incoming = signedAmounts.filter((a) => cents(a) > 0).length;
  const outgoing = signedAmounts.filter((a) => cents(a) < 0).length;
  if (incoming === 0 || outgoing === 0) {
    return 'ต้องเลือกทั้งรายการขาเข้า (IN) และขาออก (OUT) อย่างน้อยฝั่งละ 1 รายการ';
  }
  if (incoming + outgoing !== signedAmounts.length) return 'มีรายการยอด 0 บาท หักล้างไม่ได้';
  const net = signedAmounts.reduce((sum, a) => sum + a, 0);
  if (Math.abs(net) >= AMOUNT_TOLERANCE) {
    const diff = Math.abs(net).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `ยอดขาเข้ากับขาออกยังต่างกัน ${diff} — ต้องเท่ากันพอดีจึงหักล้างได้`;
  }
  return null;
}
