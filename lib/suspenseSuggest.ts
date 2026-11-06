// หาคู่ให้รายการพัก — รายการ BC365 ที่พักไว้ (SUSPENSE) ไปหา statement ที่ยอดตรงกันพอดี ได้ทุกเดือนของบัญชีเดียวกัน
// เช่น เช็คจ่าย 29/09 ที่พักไว้ตอนกระทบยอด ก.ย. แล้วธนาคารเพิ่งตัดเช็ค 05/10 ใน statement ของ ต.ค.
// ต่างจาก lib/matchAssistant.ts ที่หาคู่ข้ามวันเฉพาะในงวดที่กำลังกระทบยอดอยู่
//
// ไฟล์นี้เป็นฟังก์ชันล้วน ไม่แตะ DB และไม่ import mssql เพราะหน้ารายการพักใช้ชนิดข้อมูลชุดนี้ด้วย
// /api/reconcile/suspense-pair เป็นคนดึงข้อมูลมาส่งให้ และจับคู่จริงเฉพาะตอนผู้ใช้กดยืนยันเองเท่านั้น
// ใช้กติกาล้วนๆ เหมือนผู้ช่วยหาคู่: ยอดตรงกันพอดี ทิศทางเดียวกัน บัญชีเดียวกัน แล้วให้คะแนนตามระยะวันที่และคู่แข่ง

import { confidenceLevel, type ConfidenceLevel } from './matchAssistant';

export type Direction = 'IN' | 'OUT';

/** รายการ BC365 ที่อยู่ในรายการพัก (ReconciliationMatch ประเภท SUSPENSE ที่ยังใช้งานอยู่) */
export type SuspendedGlLine = {
  entryNo: number;
  matchId: number;
  accountNo: string;
  date: string; // 'YYYY-MM-DD'
  direction: Direction;
  amount: number;
};

/** รายการ BC365 ที่ยังไม่อยู่ในการจับคู่ใดเลย (ไม่นับรายการที่ถูกกลับรายการใน BC365) */
export type OpenGlLine = {
  entryNo: number;
  accountNo: string;
  date: string;
  direction: Direction;
  amount: number;
};

/** บรรทัด statement ที่ยังไม่จับคู่ */
export type StatementLine = {
  lineId: number;
  accountNo: string;
  date: string;
  direction: Direction;
  amount: number;
  description: string;
  chequeNo: string | null;
};

export type PairReason = { tone: 'good' | 'warn' | 'info'; text: string };

export type PairCandidate = {
  bank: StatementLine;
  dayGap: number; // วันที่ statement ลบวันที่ BC365 (บวก = ธนาคารลงทีหลัง)
  businessDays: number; // ระยะห่างนับเฉพาะ จ. ถึง ศ. (0 = วันเดียวกัน)
  sameMonth: boolean; // statement อยู่เดือนเดียวกับวันที่ของรายการพัก
  score: number; // 5-100
  level: ConfidenceLevel;
  recommended: boolean; // ตัวที่ระบบแนะนำ มีได้อย่างมากรายการเดียวต่อรายการพัก
  reasons: PairReason[];
};

export type PairSuggestion = {
  entryNo: number;
  matchId: number;
  total: number; // statement ที่ยอดตรงกันทั้งหมด ก่อนตัดตาม limit
  candidates: PairCandidate[];
  // งวดที่ปิดแล้วซึ่งครอบวันที่ของรายการพัก — route เป็นคนเติม (ฟังก์ชันในไฟล์นี้ไม่รู้เรื่องงวด)
  closedPeriod?: { periodStart: string; periodEnd: string } | null;
};

/** จำนวนรายการพักสูงสุดต่อคำขอ — หน้ารายการพักขอทีละชุดตามที่โหลดมาแสดง */
export const MAX_PAIR_TARGETS = 200;
/** จำนวน statement สูงสุดที่ส่งกลับต่อรายการพัก (หน้าต่างหาคู่) */
export const MAX_PAIR_CANDIDATES = 50;
/** BC365 ที่ยังไม่จับคู่ซึ่งห่างจาก statement ไม่เกินกี่วัน ถึงนับว่าน่าจะเป็นคู่ของ statement นั้นมากกว่า */
export const NEAR_OPEN_GL_DAYS = 7;

const DAY_MS = 86_400_000;

function cents(amount: number) {
  return Math.round(amount * 100);
}

/** บัญชี + ทิศทาง + ยอดเป็นสตางค์ — รายการที่คีย์ตรงกันเท่านั้นที่จับคู่กันได้ */
export function pairKey(line: { accountNo: string; direction: Direction; amount: number }): string {
  return `${line.accountNo}|${line.direction}|${cents(line.amount)}`;
}

function dayNumber(iso: string) {
  return Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);
}

// นับวันทำการ (จ. ถึง ศ.) ไม่นับวันเริ่ม นับวันจบ — ไม่รู้วันหยุดนักขัตฤกษ์ รู้แค่เสาร์อาทิตย์
// ต่างวันกันอย่างน้อยนับ 1 วันทำการ (ลงวันเสาร์แล้วอีกฝั่งลงวันอาทิตย์ ไม่ควรดูเหมือนลงวันเดียวกัน)
function businessDaysBetween(a: number, b: number) {
  if (a === b) return 0;
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  let n = 0;
  for (let d = lo + 1; d <= hi; d++) {
    const weekday = new Date(d * DAY_MS).getUTCDay();
    if (weekday !== 0 && weekday !== 6) n++;
  }
  return Math.max(1, n);
}

function scoreCandidate(args: {
  target: SuspendedGlLine;
  bank: StatementLine;
  options: number; // statement ยอดเท่ากันที่รายการพักนี้เลือกได้
  closerRivals: number; // รายการพักอื่นยอดเท่ากันที่วันที่ใกล้ statement นี้พอกันหรือใกล้กว่า
  nearOpen: number; // BC365 ยอดเท่ากันที่ยังไม่จับคู่ ห่างจาก statement นี้ไม่เกิน NEAR_OPEN_GL_DAYS วัน
}): PairCandidate {
  const { target, bank, options, closerRivals, nearOpen } = args;
  const reasons: PairReason[] = [{ tone: 'good', text: 'ยอดเงินตรงกันพอดี' }];
  let score = 100;

  const dayGap = dayNumber(bank.date) - dayNumber(target.date);
  const days = Math.abs(dayGap);
  const businessDays = businessDaysBetween(dayNumber(target.date), dayNumber(bank.date));
  // เช็คค้างจ่ายอาจขึ้นเงินหลังจากนั้นหลายสัปดาห์ จึงหักน้อยกว่าผู้ช่วยหาคู่ในงวด และหักสูงสุดแค่ 40
  score -= Math.min(40, businessDays * 2);
  if (dayGap === 0) {
    reasons.push({ tone: 'good', text: 'ลงวันเดียวกัน' });
  } else {
    const when = dayGap > 0 ? `ธนาคารลงหลัง BC365 ${days} วัน` : `ธนาคารลงก่อน BC365 ${days} วัน`;
    reasons.push({
      tone: businessDays <= 3 ? 'good' : businessDays <= 10 ? 'info' : 'warn',
      text: businessDays < days ? `${when} (${businessDays} วันทำการ)` : when,
    });
  }

  if (options === 1) {
    reasons.push({ tone: 'good', text: 'ยอดนี้มีใน statement รายการเดียว' });
  } else {
    score -= Math.min(45, (options - 1) * 15);
    reasons.push({ tone: 'warn', text: `ยอดนี้มีใน statement ${options} รายการ ตรวจให้ถูกรายการ` });
  }

  if (closerRivals > 0) {
    score -= Math.min(50, closerRivals * 25);
    reasons.push({
      tone: 'warn',
      text: `มีรายการพักอื่นยอดเท่ากัน ${closerRivals} รายการ ที่วันที่ใกล้ statement นี้พอกันหรือใกล้กว่า`,
    });
  }

  // statement ที่มี BC365 ยอดเท่ากันรอจับคู่อยู่ใกล้ๆ น่าจะเป็นคู่ของรายการนั้นมากกว่ารายการที่พักไว้
  if (nearOpen > 0) {
    score -= Math.min(60, nearOpen * 30);
    reasons.push({
      tone: 'warn',
      text: `มี BC365 ยอดเท่ากันที่ยังไม่จับคู่ ห่างจาก statement นี้ไม่เกิน ${NEAR_OPEN_GL_DAYS} วัน ${nearOpen} รายการ อาจเป็นคู่ของรายการนั้น`,
    });
  }

  // ยอดมีเศษสตางค์บังเอิญซ้ำกันยาก ส่วนยอดเล็กที่เป็นเลขกลมมักเป็นค่าธรรมเนียมที่เกิดซ้ำทุกวัน
  if (cents(target.amount) % 100 !== 0) {
    reasons.push({ tone: 'good', text: 'ยอดมีเศษสตางค์ บังเอิญซ้ำกันยาก' });
  } else {
    score -= 5;
    if (target.amount < 100) {
      score -= 15;
      reasons.push({ tone: 'warn', text: 'ยอดเล็กเลขกลม มักเป็นค่าธรรมเนียมที่ซ้ำบ่อย' });
    }
  }

  const finalScore = Math.max(5, Math.round(score));
  return {
    bank,
    dayGap,
    businessDays,
    sameMonth: bank.date.slice(0, 7) === target.date.slice(0, 7),
    score: finalScore,
    level: confidenceLevel(finalScore),
    recommended: false,
    reasons,
  };
}

/**
 * statement ที่น่าจะเป็นคู่ของรายการพักหนึ่งรายการ เรียงจากน่าจะใช่มากไปน้อย
 *
 * statementLines / suspendedGl / openGl ส่งมาเกินได้ (เช่น ของหลายบัญชีหรือหลายยอดรวมกัน)
 * ฟังก์ชันนี้คัดเฉพาะรายการที่บัญชี ทิศทาง และยอดตรงกับรายการพักเอง
 */
export function suggestStatementPairs(input: {
  target: SuspendedGlLine;
  statementLines: StatementLine[];
  suspendedGl: SuspendedGlLine[];
  openGl: OpenGlLine[];
  limit?: number;
}): PairSuggestion {
  const { target } = input;
  const empty: PairSuggestion = { entryNo: target.entryNo, matchId: target.matchId, total: 0, candidates: [] };
  if (cents(target.amount) <= 0) return empty;

  const key = pairKey(target);
  const banks = input.statementLines.filter((line) => pairKey(line) === key);
  const rivals = input.suspendedGl.filter((line) => line.entryNo !== target.entryNo && pairKey(line) === key);
  const open = input.openGl.filter((line) => line.entryNo !== target.entryNo && pairKey(line) === key);
  const targetDay = dayNumber(target.date);
  const closerRivalsByLine = new Map<number, number>();

  const candidates = banks.map((bank) => {
    const bankDay = dayNumber(bank.date);
    const ownGap = Math.abs(bankDay - targetDay);
    const closerRivals = rivals.filter((line) => Math.abs(dayNumber(line.date) - bankDay) <= ownGap).length;
    closerRivalsByLine.set(bank.lineId, closerRivals);
    return scoreCandidate({
      target,
      bank,
      options: banks.length,
      closerRivals,
      nearOpen: open.filter((line) => Math.abs(dayNumber(line.date) - bankDay) <= NEAR_OPEN_GL_DAYS).length,
    });
  });

  candidates.sort(
    (a, b) =>
      b.score - a.score ||
      Math.abs(a.dayGap) - Math.abs(b.dayGap) ||
      a.bank.date.localeCompare(b.bank.date) ||
      a.bank.lineId - b.bank.lineId
  );

  // แนะนำเฉพาะตัวที่คะแนนนำตัวถัดไปชัดเจน ความมั่นใจไม่ต่ำ และไม่มีรายการพักอื่นที่วันที่ใกล้ statement นั้นพอกันหรือใกล้กว่า
  // คะแนนเท่ากันหรือมีรายการพักแย่ง statement เดียวกันแปลว่าระบบแยกไม่ออก ให้คนเลือกเอง
  // กติกานี้ทำให้ statement บรรทัดเดียวไม่ถูกแนะนำให้รายการพักหลายรายการพร้อมกัน (ต้องใกล้ที่สุดแบบไม่เสมอใคร)
  const [top, second] = candidates;
  if (
    top &&
    top.level !== 'low' &&
    closerRivalsByLine.get(top.bank.lineId) === 0 &&
    (!second || top.score > second.score)
  ) {
    top.recommended = true;
  }

  const limit = Math.max(1, Math.min(input.limit ?? MAX_PAIR_CANDIDATES, MAX_PAIR_CANDIDATES));
  return { ...empty, total: candidates.length, candidates: candidates.slice(0, limit) };
}
