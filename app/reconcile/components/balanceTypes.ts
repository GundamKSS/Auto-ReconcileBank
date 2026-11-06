// รูปแบบข้อมูลจาก GET /api/reconcile/balance — ใช้ร่วมกันระหว่างป้ายยอดคงเหลือกับหน้าต่างสรุปยอด
import type { PeriodWorkflow } from '../../../lib/periodWorkflow';
import type { PeriodCheck } from '../../../lib/periodCloseChecks';

export type BalanceDay = {
  date: string;
  bankIn: number;
  bankOut: number;
  bankBalance: number | null;
  bankStatementMismatch: boolean;
  glIn: number;
  glOut: number;
  glBalance: number | null;
  dayDiffIn: number;
  dayDiffOut: number;
};

export type BalanceData = {
  extrasReady: boolean;
  account: { bankAccountNo: string; bankCode: string };
  period: { from: string; to: string };
  bank: {
    opening: number | null;
    totalIn: number;
    totalOut: number;
    closing: number | null;
    statementClosing: number | null;
    chainOk: boolean;
    lineCount: number;
    /** วันที่ของรายการสุดท้ายในไฟล์ แยกตามฝั่ง ใช้ตรวจว่านำเข้าถึงวันสิ้นงวดแล้วหรือยัง */
    lastDateIn: string | null;
    lastDateOut: string | null;
  };
  gl: {
    opening: number | null;
    openingSavedBy: string | null;
    openingSavedAt: string | null;
    suggestedOpening: number | null;
    suggestedFromPeriod: string | null;
    totalIn: number;
    totalOut: number;
    closing: number | null;
    lineCount: number;
  };
  /** ยอดพักโอน = Bank ปลายงวด − GL ก่อนปรับปรุง */
  difference: number | null;
  adjustment: { count: number; net: number; glClosingAfter: number | null; remaining: number | null };
  breakdown: {
    openingDifference: number | null;
    bankUnmatched: { count: number; net: number };
    /** รายการธนาคารที่ยังไม่จับคู่ แยกตามฝั่ง (เงินเข้า = AR, เงินออก = AP) */
    bankUnmatchedByDirection: { IN: { count: number; net: number }; OUT: { count: number; net: number } };
    glUnmatched: { count: number; net: number };
    glSuspense: { count: number; net: number };
    glOffset: { count: number; net: number };
    /** ผลต่างจากคู่ที่ยอด Bank/GL ไม่เท่ากัน ซึ่งระบบพักโอนไว้อัตโนมัติ */
    suspenseDifference: number;
    crossPeriodMatched: number;
  };
  differenceMatches: {
    matchId: number;
    remark: string;
    createdBy: string;
    createdAt: string;
    bankAmount: number;
    glAmount: number;
    difference: number;
  }[];
  excluded: {
    matchId: number;
    num: number;
    remark: string | null;
    entries: { entryNo: number; date: string; documentNo: string | null; amount: number }[];
  }[];
  daily: BalanceDay[];
  // null = ยังไม่รัน sql/008_period_close.sql — ฟีเจอร์ปิดงวดใช้ไม่ได้ ซ่อน UI ที่เกี่ยวข้องทั้งหมด
  periodClose: PeriodCloseStatus | null;
  workApproval: PeriodWorkflow;
  /**
   * ผลตรวจเงื่อนไขปิดงวดตาม docs/spec-matching-period-close.md
   * โหมดปัจจุบันคือเตือนอย่างเดียว ยังยืนยันงานและปิดงวดได้ตามปกติ
   * undefined = เซิร์ฟเวอร์รุ่นเก่าที่ยังไม่ส่งมา
   */
  checks?: PeriodCheck[];
};

export type PeriodCloseStatus = {
  periodStart: string | null;
  periodEnd: string | null;
  status: 'OPEN' | 'CLOSED' | 'REOPENED';
  closedBy: string | null;
  closedAt: string | null;
  reopenedBy: string | null;
  reopenedAt: string | null;
  reopenReason: string | null;
};
