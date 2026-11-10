import { formatAmount } from "./formatAmount";

export interface SearchableLineItem {
  id?: string;
  ref: string;
  date: string;
  description: string;
  senderInfo?: string | null;
  senderHint?: string | null;
  offsetRemark?: string | null;
  offsetCounterpartRef?: string | null;
  amount: number;
}

/**
 * ค้นหารายการแบบเรียลไทม์ครอบคลุมทุกมิติ:
 * - ยอดเงิน (amount) ทั้งแบบมีหรือไม่มีจุลภาค เช่น 20000, 20,000, 20,000.00, 150.5
 * - เลขที่เอกสาร / เช็ค / เลขที่อ้างอิง (ref)
 * - คำอธิบายรายการ / ชื่อบัญชี (description)
 * - ผู้โอน / ธนาคารต้นทาง (senderInfo, senderHint)
 * - วันที่ (date) ทั้งแบบ YYYY-MM-DD และ DD/MM/YYYY
 * รองรับการค้นหาหลายคำพร้อมกัน (tokenized search) เช่น "สมชาย 20000"
 */
export function matchesWorkspaceItem(item: SearchableLineItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;

  const tokens = q.split(/\s+/).filter(Boolean);
  const amountFormatted = formatAmount(item.amount ?? 0);
  const amountDigits = amountFormatted.replace(/,/g, "");
  const amountRaw = String(item.amount ?? 0);

  // Format DMY: 2026-08-15 -> 15/08/2026
  let dmy = "";
  if (item.date && item.date.length >= 10) {
    const parts = item.date.slice(0, 10).split("-");
    if (parts.length === 3) {
      dmy = `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
  }

  return tokens.every((token) => {
    const tokenDigits = token.replace(/,/g, "");
    return (
      (item.ref && item.ref.toLowerCase().includes(token)) ||
      (item.description && item.description.toLowerCase().includes(token)) ||
      (Boolean(item.senderInfo) && item.senderInfo!.toLowerCase().includes(token)) ||
      (Boolean(item.senderHint) && item.senderHint!.toLowerCase().includes(token)) ||
      (Boolean(item.offsetRemark) && item.offsetRemark!.toLowerCase().includes(token)) ||
      (Boolean(item.offsetCounterpartRef) && item.offsetCounterpartRef!.toLowerCase().includes(token)) ||
      (item.date && item.date.includes(token)) ||
      (dmy !== "" && dmy.includes(token)) ||
      amountFormatted.toLowerCase().includes(token) ||
      (tokenDigits !== "" && (amountDigits.includes(tokenDigits) || amountRaw.includes(tokenDigits)))
    );
  });
}
