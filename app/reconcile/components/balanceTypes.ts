// รูปแบบข้อมูลจาก GET /api/reconcile/balance — ใช้ร่วมกันระหว่างป้ายยอดคงเหลือกับหน้าต่างสรุปยอด

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
};
