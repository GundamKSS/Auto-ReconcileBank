// ชนิดข้อมูลและตัวช่วยของหน้ารายการพัก (/suspense)
//
// หน้านี้รวมรายการพัก 2 แบบที่มาจากคนละที่กัน:
//   พักทั้งรายการ (suspenseKind = "LINE")       - ReconciliationMatch ประเภท SUSPENSE มีแต่บรรทัดฝั่ง BC
//                                                 คืนรายการกลับไปจับคู่ใหม่ได้ทีละบรรทัด (/api/reconcile/unsuspend)
//   พักส่วนต่าง   (suspenseKind = "DIFFERENCE")  - คู่ที่จับไว้แล้ว (MATCHED) แต่ยอดสองฝั่งไม่เท่ากัน
//                                                 ส่วนต่างคือยอดที่ยังพักอยู่ ยกเลิกต้องไปทำที่หน้าประวัติการจับคู่
//
// ฝั่งรับ/จ่ายของสองแบบนี้อ่านคนละที่: พักทั้งรายการดูทิศทางของบรรทัด BC (Match เดียวพักไว้ได้ทั้งสองทิศ)
// ส่วนพักส่วนต่างดูยอดสุทธิฝั่ง Bank — ต้องตรงกับ suspenseSideCondition ใน app/api/history/route.ts

export type Direction = "IN" | "OUT";

/** แท็บฝั่งรับ/จ่าย — ค่าตรงกับพารามิเตอร์ suspenseSide ของ /api/history */
export type SideTab = "ALL" | "IN" | "OUT";

export type RawBankLine = {
  lineId: number;
  num: number;
  date: string;
  description?: string;
  direction: Direction;
  amount: number;
};

export type RawGlLine = {
  entryNo: number;
  num: number;
  date: string;
  ref?: string;
  accountName?: string;
  direction: Direction;
  amount: number;
};

export type MatchRecord = {
  matchId: number;
  bankCode: string;
  matchType: "MATCHED" | "SUSPENSE";
  suspenseKind?: "LINE" | "DIFFERENCE";
  suspenseDifference?: number | null;
  suspenseDirection?: Direction;
  remark?: string | null;
  createdBy: string | null;
  createdAt: string;
  bankLines: RawBankLine[];
  glLines: RawGlLine[];
};

export type UnifiedLine = {
  key: string;
  matchId: number;
  sourceType: "BANK" | "GL";
  refId: number;
  num: number;
  date: string;
  detail: string;
  direction: Direction;
  amount: number;
};

/** รวมบรรทัดสองฝั่งเป็นรายการเดียว — key ใช้เป็นตัวระบุตอนติ๊กเลือกและตอนส่งไปคืนรายการ */
export function toUnifiedLines(match: MatchRecord): UnifiedLine[] {
  const bank: UnifiedLine[] = match.bankLines.map((l) => ({
    key: `${match.matchId}:BANK:${l.lineId}`,
    matchId: match.matchId,
    sourceType: "BANK",
    refId: l.lineId,
    num: l.num,
    date: l.date,
    detail: l.description || "-",
    direction: l.direction,
    amount: l.amount,
  }));
  const gl: UnifiedLine[] = match.glLines.map((l) => ({
    key: `${match.matchId}:GL:${l.entryNo}`,
    matchId: match.matchId,
    sourceType: "GL",
    refId: l.entryNo,
    num: l.num,
    date: l.date,
    detail: [l.ref, l.accountName].filter(Boolean).join(" · ") || "-",
    direction: l.direction,
    amount: l.amount,
  }));
  return [...bank, ...gl];
}

/**
 * บรรทัดที่ต้องแสดง (และติ๊กเลือกได้) ของการ์ดหนึ่งใบ ภายใต้แท็บฝั่งที่เลือกอยู่
 *
 * อยู่แท็บฝั่งใดฝั่งหนึ่ง = การ์ดพักทั้งรายการโชว์เฉพาะบรรทัดของฝั่งนั้น เพราะ Match เดียวพักไว้ได้ทั้งสองทิศ
 * และคืนรายการทีละบรรทัดได้ — ถ้าโชว์ทั้งคู่ "เลือกทั้งหมด" จะลากอีกฝั่งที่ไม่ได้ดูอยู่ไปคืนด้วย
 * ส่วนพักส่วนต่างโชว์ครบเสมอ เพราะเป็นคู่ที่จับไว้แล้ว ต้องเห็นทั้งสองฝั่งถึงจะตรวจส่วนต่างได้
 */
export function visibleLines(match: MatchRecord, side: SideTab): UnifiedLine[] {
  const lines = toUnifiedLines(match);
  if (side === "ALL" || match.suspenseKind === "DIFFERENCE") return lines;
  return lines.filter((l) => l.direction === side);
}

/** ป้ายฝั่งบนการ์ด อ่านจากบรรทัดที่แสดงอยู่จริง ไม่ใช่ทิศทางสุทธิของทั้ง Match */
export function sideLabelOf(lines: UnifiedLine[]): { hasIn: boolean; hasOut: boolean; label: string | null } {
  const hasIn = lines.some((l) => l.direction === "IN");
  const hasOut = lines.some((l) => l.direction === "OUT");
  return { hasIn, hasOut, label: hasIn && hasOut ? "รับ + จ่าย" : hasIn ? "รับ" : hasOut ? "จ่าย" : null };
}

// ── แถบสรุปยอดพักโอน ─────────────────────────────────────────────────────────────
//
// ยอดพักโอนปลายงวด (Bank ปลายงวด − BC ก่อนปรับปรุง) แตกออกเป็นส่วนๆ ได้พอดีเสมอ ตามที่
// /api/reconcile/balance คำนวณไว้:
//   difference = ผลต่างยอดยกมา + Bank ที่ยังไม่จับคู่ − BC ที่ยังไม่จับคู่ − BC ที่พักไว้
//                − BC ที่หักล้างกันเอง + ส่วนต่างของคู่ที่ยอดไม่เท่ากัน + คู่ที่อีกฝั่งอยู่นอกงวด
//
// หน้ารายการพักรับผิดชอบแค่ 2 ก้อนในนั้น คือ "พักทั้งรายการ" (เข้าสูตรด้วยเครื่องหมายลบ)
// กับ "พักส่วนต่าง" (เข้าสูตรด้วยเครื่องหมายบวก) — ที่เหลือเป็นเรื่องของหน้ากระทบยอด
// จึงห้ามเรียกส่วนที่เหลือว่า "ยังอธิบายไม่ได้" เพราะมันอธิบายได้อยู่แล้ว แค่ไม่ได้อธิบายด้วยหน้านี้

export type BalanceBreakdownInput = {
  difference: number | null;
  breakdown: {
    glSuspense: { net: number };
    suspenseDifference: number;
  };
} | null;

export type SuspenseBalanceParts = {
  /** ยอดพักโอนปลายงวดของบัญชี+งวดที่เลือกไว้ในหน้ากระทบยอด */
  difference: number | null;
  /** ส่วนที่อธิบายได้ด้วยรายการพักที่แสดงอยู่ในหน้านี้ */
  explained: number | null;
  /** ส่วนที่เหลือ — ยอดยกมา, รายการที่ยังไม่จับคู่, หักล้างกันเอง, คู่ข้ามงวด */
  rest: number | null;
};

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export function suspenseBalanceParts(balance: BalanceBreakdownInput): SuspenseBalanceParts {
  if (!balance || balance.difference === null) return { difference: null, explained: null, rest: null };
  const explained = round2(-balance.breakdown.glSuspense.net + balance.breakdown.suspenseDifference);
  return {
    difference: round2(balance.difference),
    explained,
    rest: round2(balance.difference - explained),
  };
}
