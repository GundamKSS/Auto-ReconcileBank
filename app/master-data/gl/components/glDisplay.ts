import { extractDisplayNo, shortAccountLabel } from "../../../../lib/bankAccounts";

// ค่าที่ใช้แสดงรายการ GL ร่วมกันระหว่างหน้า Master Data · GL กับตารางรายการของแต่ละวัน

export type GlStatus = "UNMATCHED" | "MATCHED" | "SUSPENSE" | "OFFSET" | "EXCLUDED";

export type GlEntry = {
  entryNo: number;
  bankCode: string;
  accountNo: string;
  accountName: string | null;
  postingDate: string;
  documentDate: string | null;
  documentType: string | null;
  documentNo: string | null;
  sourceCode: string | null;
  direction: "IN" | "OUT";
  amount: number;
  matchId: number | null;
  status: GlStatus;
};

// Source_Code ของ BC365 = สมุดรายวันที่ลงรายการนั้น — แปลให้คนบัญชีอ่านง่าย รหัสที่ไม่รู้จักแสดงรหัสดิบ
export const SOURCE_LABEL: Record<string, string> = {
  CASHRECJNL: "สมุดรับเงิน",
  PAYMENTJNL: "สมุดจ่ายเงิน",
  PURCHJNL: "สมุดรายวันซื้อ",
  GENJNL: "สมุดรายวันทั่วไป",
  REVERSAL: "กลับรายการ",
};

// สีเดียวกับหน้า Reports
export const STATUS_BADGE: Record<GlStatus, string> = {
  MATCHED: "bg-green-100 text-green-700",
  SUSPENSE: "bg-amber-100 text-amber-700",
  OFFSET: "bg-teal-100 text-teal-700",
  EXCLUDED: "bg-slate-200 text-slate-700",
  UNMATCHED: "bg-slate-200 text-slate-600",
};
export const STATUS_LABEL: Record<GlStatus, string> = {
  MATCHED: "จับคู่แล้ว",
  SUSPENSE: "พักไว้",
  OFFSET: "หักล้างกันเอง",
  EXCLUDED: "ปรับปรุงพักโอน",
  UNMATCHED: "ยังไม่จับคู่",
};

export function sourceLabel(code: string | null) {
  if (!code) return "-";
  return SOURCE_LABEL[code] ?? code;
}

// ป้ายบัญชีของแถว — รายการ GL มีชื่อบัญชีติดมาด้วย เลยแกะเลขบัญชีจริงได้เหมือน dropdown เลือกบัญชี
export function entryAccountLabel(e: GlEntry) {
  return shortAccountLabel({
    bankAccountNo: e.accountNo,
    bankCode: e.bankCode,
    accountName: e.accountName,
    displayNo: extractDisplayNo(e.accountName),
  });
}
