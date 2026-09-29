// ชนิดข้อมูลและตัวช่วยที่ใช้ร่วมกันทั้งหน้าประวัติการจับคู่ (/reconcile/history)
//
// หน้าประวัติแสดง ReconciliationMatch ได้ทุกประเภทที่หน้า Reconcile สร้างขึ้น ไม่ใช่แค่ MATCHED:
//   MATCHED  - จับคู่ Bank ↔ BC365 (มีทั้งสองฝั่ง)
//   OFFSET   - หักล้างกันเองใน BC (ขาเข้าชนขาออกจนสุทธิเป็น 0 ไม่มีเงินผ่านธนาคาร)
//   SUSPENSE - ย้ายรายการ BC เข้าบัญชีพักโอน รอจับคู่กับ Bank ในงวดถัดไป
//   EXCLUDED - JV ปรับปรุงพักโอน ที่ตั้งใจไม่นำมาจับคู่กับ Bank เลย
// สามแบบหลังมีแต่บรรทัดฝั่ง GL — การ์ดจึงต้องเลือกหน้าตาตามประเภท (ดู MatchDetail.tsx)

import { findReversalPairs } from "../../../../lib/glOffset";

export type LineStatus = "ACTIVE" | "REVERSED";

export type MatchTypeValue = "MATCHED" | "SUSPENSE" | "OFFSET" | "EXCLUDED";

export type LineItem = {
  lineId?: number;
  entryNo?: number;
  num: number;
  date: string;
  description?: string;
  ref?: string;
  accountNo?: string;
  accountName?: string;
  sourceCode?: string | null;
  direction: "IN" | "OUT";
  amount: number;
  status: LineStatus;
  reversedAt: string | null;
  reversedBy: string | null;
  reversedReason: string | null;
};

export type MatchRecord = {
  matchId: number;
  bankCode: string;
  matchType: MatchTypeValue;
  createdBy: string | null;
  createdAt: string;
  status: LineStatus;
  reversedAt: string | null;
  reversedBy: string | null;
  reversedReason: string | null;
  // หมายเหตุตอนบันทึก — บังคับเมื่อจับคู่ทั้งที่ยอดสองฝั่งไม่เท่ากัน และเมื่อบันทึกเป็น EXCLUDED
  remark?: string | null;
  bankLines: LineItem[];
  glLines: LineItem[];
};

// กลุ่มย่อย (Num) = 1 cluster ที่บาลานซ์กันเอง ไม่ว่าจะ 1:1, 1:N, N:1 — เป็นหน่วยที่ติ๊กเลือก/ยกเลิกได้
export type SubGroup = {
  key: string;
  matchId: number;
  num: number;
  bankLines: LineItem[];
  glLines: LineItem[];
  bankTotal: number;
  glTotal: number;
  status: LineStatus;
  reversedAt: string | null;
  reversedBy: string | null;
  reversedReason: string | null;
};

/** ผลต่างที่ยอมรับได้ตอนเทียบยอดสองฝั่ง — ครึ่งสตางค์ ให้ตรงกับเกณฑ์ฝั่ง server */
export const AMOUNT_TOLERANCE = 0.005;

export function formatAmount(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** ยอดพร้อมเครื่องหมาย + / − สำหรับส่วนต่างและยอดสุทธิ */
export function formatSigned(n: number) {
  return `${n < 0 ? "−" : "+"}${formatAmount(Math.abs(n))}`;
}

// สร้าง formatter ครั้งเดียว — toLocaleString แบบใส่ options จะสร้าง Intl ใหม่ทุกครั้ง
// ซึ่งหน้านี้เรียกทุกการ์ดทุกครั้งที่ติ๊ก checkbox (re-render ทั้งรายการ) ทำให้กดแล้วหน่วง
const dateTimeFormatter = new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short" });

export function formatDateTime(iso: string) {
  return dateTimeFormatter.format(new Date(iso));
}

export function formatDate(iso: string) {
  return new Date(iso).toISOString().slice(0, 10);
}

/** 2026-08-17 → 17/08/2026 — รูปแบบเดียวกับที่ทีมบัญชีอ่านในกระดาษทำการ */
export function formatDMY(iso: string) {
  const [y, m, d] = formatDate(iso).split("-");
  return `${d}/${m}/${y}`;
}

// ---------------------------------------------------------------------------
// ข้อมูลประจำประเภทของ Match — ใช้ทั้งชิปบนหัวการ์ด แท็บกรอง และการเลือกหน้าตาตอนคลี่
// ---------------------------------------------------------------------------

export type MatchTypeMeta = {
  label: string;
  /** คำอธิบายสั้นๆ ใต้ชื่อแท็บ */
  hint: string;
  chipClass: string;
  tabClass: string;
  /** ประเภทนี้มีบรรทัดฝั่ง Bank หรือไม่ — ใช้ตัดสินว่าให้กรองด้วยวันที่ Statement / AR / AP ได้ไหม */
  hasBankSide: boolean;
  /**
   * ยกเลิกได้จากหน้านี้หรือไม่ — SUSPENSE ใช้ /api/reconcile/unsuspend ซึ่งลบบรรทัดทิ้ง
   * (ไม่เหลือร่องรอยให้แสดงเป็น "ยกเลิกแล้ว") และมีหน้า /suspense ที่ทำเป็นชุดอยู่แล้ว
   */
  revertable: boolean;
};

export const MATCH_TYPE_META: Record<MatchTypeValue, MatchTypeMeta> = {
  MATCHED: {
    label: "จับคู่ธนาคารกับ BC365",
    hint: "มีทั้งสองฝั่ง",
    chipClass: "bg-emerald-100 text-emerald-700",
    tabClass: "border-emerald-600 text-emerald-700",
    hasBankSide: true,
    revertable: true,
  },
  OFFSET: {
    label: "หักล้างรายการ BC365",
    hint: "เฉพาะ BC365 ยอดสุทธิเป็นศูนย์",
    chipClass: "bg-teal-100 text-teal-700",
    tabClass: "border-teal-600 text-teal-700",
    hasBankSide: false,
    revertable: true,
  },
  SUSPENSE: {
    label: "พักรายการ",
    hint: "รอจับคู่ภายหลัง",
    chipClass: "bg-amber-100 text-amber-700",
    tabClass: "border-amber-500 text-amber-700",
    hasBankSide: false,
    revertable: false,
  },
  EXCLUDED: {
    label: "JV ปรับปรุง",
    hint: "JV ไม่นำมาจับคู่",
    chipClass: "bg-slate-200 text-slate-700",
    tabClass: "border-slate-600 text-slate-700",
    hasBankSide: false,
    revertable: true,
  },
};

export const MATCH_TYPE_ORDER: MatchTypeValue[] = ["MATCHED", "OFFSET", "SUSPENSE", "EXCLUDED"];

// ---------------------------------------------------------------------------
// สีประจำกลุ่มย่อย — ใช้โยงแถวฝั่ง Bank กับฝั่ง BC ที่อยู่กลุ่มเดียวกันให้เห็นด้วยตา
// ชุดสีเดียวกับหน้า Reconcile (GROUP_COLORS ใน ActiveWorkspace.tsx) เพื่อให้สลับหน้าแล้วอ่านต่อได้ทันที
// ---------------------------------------------------------------------------

export const GROUP_COLORS = [
  { chip: "bg-purple-100 text-purple-700", dot: "bg-purple-500", row: "bg-purple-50/70", ring: "ring-purple-300" },
  { chip: "bg-orange-100 text-orange-700", dot: "bg-orange-500", row: "bg-orange-50/70", ring: "ring-orange-300" },
  { chip: "bg-cyan-100 text-cyan-700", dot: "bg-cyan-500", row: "bg-cyan-50/70", ring: "ring-cyan-300" },
  { chip: "bg-pink-100 text-pink-700", dot: "bg-pink-500", row: "bg-pink-50/70", ring: "ring-pink-300" },
  { chip: "bg-lime-100 text-lime-700", dot: "bg-lime-500", row: "bg-lime-50/70", ring: "ring-lime-300" },
  { chip: "bg-indigo-100 text-indigo-700", dot: "bg-indigo-500", row: "bg-indigo-50/70", ring: "ring-indigo-300" },
];

/** กลุ่มย่อยที่ n (เริ่มที่ 1) ใช้สีไหน — วนซ้ำเมื่อกลุ่มเยอะกว่าจำนวนสี */
export function groupColor(num: number) {
  return GROUP_COLORS[(Math.max(1, num) - 1) % GROUP_COLORS.length];
}

// ---------------------------------------------------------------------------

export function subGroupKey(matchId: number, num: number) {
  return `${matchId}:${num}`;
}

/** แตก Match ออกเป็นกลุ่มย่อยตาม Num — สถานะของกลุ่มมาจากบรรทัดข้างใน (ยกเลิกทีเดียวทั้งกลุ่มเสมอ) */
export function toSubGroups(match: MatchRecord): SubGroup[] {
  const nums = Array.from(
    new Set([...match.bankLines.map((l) => l.num), ...match.glLines.map((l) => l.num)])
  ).sort((a, b) => a - b);

  return nums.map((num) => {
    const bankLines = match.bankLines.filter((l) => l.num === num);
    const glLines = match.glLines.filter((l) => l.num === num);
    const lines = [...bankLines, ...glLines];
    const reversedLine = lines.find((l) => l.status === "REVERSED");
    // ถือว่ากลุ่มถูกยกเลิกเมื่อทุกบรรทัดในกลุ่มถูกยกเลิก — เผื่อกรณีข้อมูลเก่าที่ยกเลิกไว้ที่หัว Match เท่านั้น
    // ให้ดูสถานะหัว Match ประกอบด้วย
    const reversed = match.status === "REVERSED" || (lines.length > 0 && lines.every((l) => l.status === "REVERSED"));
    return {
      key: subGroupKey(match.matchId, num),
      matchId: match.matchId,
      num,
      bankLines,
      glLines,
      bankTotal: bankLines.reduce((s, l) => s + l.amount, 0),
      glTotal: glLines.reduce((s, l) => s + l.amount, 0),
      status: reversed ? "REVERSED" : "ACTIVE",
      reversedAt: reversedLine?.reversedAt ?? match.reversedAt,
      reversedBy: reversedLine?.reversedBy ?? match.reversedBy,
      reversedReason: reversedLine?.reversedReason ?? match.reversedReason,
    };
  });
}

/** แยกรายการเป็นขาเข้า/ขาออกพร้อมยอดรวมของแต่ละขา — ใช้กับ OFFSET และการ์ดสรุปพักโอน */
export function splitByDirection(lines: LineItem[]) {
  const inLines = lines.filter((l) => l.direction === "IN");
  const outLines = lines.filter((l) => l.direction === "OUT");
  return {
    inLines,
    outLines,
    inTotal: inLines.reduce((s, l) => s + l.amount, 0),
    outTotal: outLines.reduce((s, l) => s + l.amount, 0),
  };
}

// กติกาเดียวกับ /api/reconcile/offsets — ทุกรายการในกลุ่มจับเป็นคู่กลับรายการใน BC ได้ครบ = ระบบเจอให้
// ที่เหลือ = ผู้ใช้เลือกเอง
export function offsetKind(lines: LineItem[]): "REVERSAL" | "MANUAL" {
  const pairs = findReversalPairs(
    lines.map((l) => ({
      entryNo: l.entryNo ?? 0,
      accountNo: l.accountNo ?? "",
      documentNo: l.ref ?? null,
      sourceCode: l.sourceCode ?? null,
      signedAmount: l.direction === "IN" ? l.amount : -l.amount,
    }))
  );
  return lines.length > 0 && pairs.length * 2 === lines.length ? "REVERSAL" : "MANUAL";
}

/**
 * ยอดที่ยังมีผลของ Match นี้ (นับเฉพาะกลุ่มที่ยังไม่ถูกยกเลิก)
 * bankSigned/glSigned คิดเครื่องหมายตามทิศทาง เพื่อให้กลุ่มที่มีทั้งเข้าและออกได้ยอดสุทธิที่ถูกต้อง
 */
export function summarizeGroups(groups: SubGroup[]) {
  const bankLines = groups.flatMap((g) => g.bankLines);
  const glLines = groups.flatMap((g) => g.glLines);
  const bankTotal = bankLines.reduce((s, l) => s + l.amount, 0);
  const glTotal = glLines.reduce((s, l) => s + l.amount, 0);
  const bankSigned = bankLines.reduce((s, l) => s + (l.direction === "IN" ? l.amount : -l.amount), 0);
  const glSigned = glLines.reduce((s, l) => s + (l.direction === "IN" ? l.amount : -l.amount), 0);
  return {
    bankLines,
    glLines,
    bankTotal,
    glTotal,
    bankSigned,
    glSigned,
    // เทียบแบบไม่ติดทิศทาง ให้ตรงกับที่ server คำนวณยอดพักโอนส่วนต่าง (api/reconcile/match)
    difference: Math.round((Math.abs(bankSigned) - Math.abs(glSigned)) * 100) / 100,
  };
}

/** ชื่อบัญชี BC ที่ตัด '#เลขบัญชี' ท้ายออกแล้ว — เลขบัญชีแสดงแยกต่างหากในแถว */
export function cleanAccountName(accountName: string | null | undefined) {
  if (!accountName) return "";
  return accountName.replace(/#\s*[\d-]+\s*$/, "").trim();
}
