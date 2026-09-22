/**
 * หายอดยกมา/ยอดคงเหลือปลายงวดจากคอลัมน์ Balance ของ statement
 *
 * ยอดยกมาของงวด = Balance ของบรรทัดแรก − ยอดเคลื่อนไหวของบรรทัดนั้น
 * (BBL ส.ค. 2026: บรรทัดแรก BBL.CARD รับ 3,000 Balance 107,575.86 → ยกมา 104,575.86 ตรงกับกระดาษทีมบัญชี)
 *
 * "บรรทัดแรก" ห้ามเดาจาก LineId อย่างเดียว — แต่ละธนาคารเรียงไฟล์ภายในวันไม่เหมือนกัน (บางเจ้าใหม่สุดขึ้นก่อน)
 * จึงลองเรียงหลายแบบแล้วเลือกลำดับที่ Balance ต่อกันเป็นสายได้ครบทุกบรรทัด ถ้าไม่มีแบบไหนต่อกันได้
 * (ไฟล์ขาดบางบรรทัด หรือธนาคารไม่ส่ง Balance มา) ยังคืนค่าตามลำดับวันที่/LineId แต่ติดธง chainOk = false
 * ให้หน้าจอเตือนว่ายอดยกมาอาจไม่ถูกต้อง
 */

export type BalanceLine = {
  lineId: number;
  date: string; // YYYY-MM-DD
  signed: number; // บวก = เงินเข้า
  balance: number | null;
};

export type StatementBalance = {
  opening: number | null;
  closing: number | null;
  chainOk: boolean;
  /** ยอดคงเหลือสิ้นวันตามไฟล์ — ใช้เทียบกับยอดที่คำนวณเองในตารางรายวัน */
  closingByDate: Map<string, number>;
};

const EPS = 0.005;

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function chainIsValid(lines: BalanceLine[]) {
  for (let i = 1; i < lines.length; i++) {
    const prev = lines[i - 1].balance;
    const cur = lines[i].balance;
    if (prev === null || cur === null) return false;
    if (Math.abs(prev + lines[i].signed - cur) >= EPS) return false;
  }
  return true;
}

export function statementBalance(input: BalanceLine[]): StatementBalance {
  const withBalance = input.filter((l) => l.balance !== null);
  if (withBalance.length === 0) {
    return { opening: null, closing: null, chainOk: false, closingByDate: new Map() };
  }

  const byDateThen = (lineOrder: 1 | -1) => (a: BalanceLine, b: BalanceLine) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : (a.lineId - b.lineId) * lineOrder;

  const candidates = [[...withBalance].sort(byDateThen(1)), [...withBalance].sort(byDateThen(-1))];
  const valid = candidates.find(chainIsValid);
  const ordered = valid ?? candidates[0];

  const closingByDate = new Map<string, number>();
  for (const l of ordered) closingByDate.set(l.date, l.balance as number);

  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  return {
    opening: round2((first.balance as number) - first.signed),
    closing: round2(last.balance as number),
    chainOk: Boolean(valid) && withBalance.length === input.length,
    closingByDate,
  };
}
