// แกะข้อมูลผู้โอน (ธนาคารต้นทาง / เลขบัญชี / ชื่อผู้โอน) จากข้อความรายละเอียดดิบ (RawDescription)
// ใช้เป็นหลักสำหรับ SCB และ KBANK ที่ไม่ได้แยกคอลัมน์ผู้โอนมาให้เหมือน BBL
// และใช้เป็น fallback สำหรับ BBL กรณีไฟล์บางรูปแบบรวมข้อความไว้ใน Description/Remarks
//
// ใช้ Regular Expression (RegExp) มาตรฐานของ JavaScript/TypeScript ล้วน ไม่พึ่งพาไลบรารีภายนอก
// เพื่อให้ทำงานเร็ว (ระดับไมโครวินาทีต่อแถว) และผลลัพธ์คาดเดาได้ 100%

export type ExtractedSender = {
  senderBank: string | null;
  senderAccountNo: string | null;
  senderAccountName: string | null;
};

// รหัสธนาคารมาตรฐานที่พบบ่อยในใบแจ้งยอดธนาคารไทย (จับแบบคำเดี่ยว ไม่ติดกลางคำอื่น)
const BANK_CODE_ALIASES: Array<[RegExp, string]> = [
  [/\b(?:KBANK|KBNK|KASIKORN)\b/i, 'KBANK'],
  [/\bSCB\b/i, 'SCB'],
  [/\bBBL\b/i, 'BBL'],
  [/\bKTB\b/i, 'KTB'],
  [/\b(?:TTB|TMB|TBANK)\b/i, 'TTB'],
  [/\b(?:BAY|KRUNGSRI)\b/i, 'BAY'],
  [/\bGSB\b/i, 'GSB'],
  [/\bBAAC\b/i, 'BAAC'],
  [/\bCIMBT?\b/i, 'CIMBT'],
  [/\bUOBT?\b/i, 'UOBT'],
  [/\bTISCO\b/i, 'TISCO'],
  [/\bKKP\b/i, 'KKP'],
  [/\bLHBANK\b/i, 'LHBANK'],
  [/\bICBC\b/i, 'ICBC'],
  [/\bCITI\b/i, 'CITI'],
  [/\bMHCB\b/i, 'MHCB'],
  [/\bSMBC\b/i, 'SMBC'],
  [/\bHSBC\b/i, 'HSBC'],
  [/\bGHB\b/i, 'GHB'],
  [/กสิกร(?:ไทย)?/, 'KBANK'],
  [/ไทยพาณิชย์/, 'SCB'],
  [/ธนาคารกรุงเทพ/, 'BBL'],
  [/กรุงไทย/, 'KTB'],
  [/ทหารไทยธนชาต|ทีทีบี/, 'TTB'],
  [/กรุงศรี(?:อยุธยา)?/, 'BAY'],
  [/ออมสิน/, 'GSB'],
];

// ตรวจว่าสายอักขระเลขบัญชีมีตัวเลขจริงอย่างน้อย 2 ตัว และไม่ใช่เลขศูนย์ล้วน (เช่น '0000000000')
function isValidAccountToken(token: string): boolean {
  const digits = token.replace(/\D/g, '');
  if (digits.length < 2) return false;
  if (/^0+$/.test(digits)) return false;
  return true;
}

export function extractSenderBank(text: string): string | null {
  for (const [pattern, code] of BANK_CODE_ALIASES) {
    if (pattern.test(text)) return code;
  }
  return null;
}

export function extractSenderAccountNo(text: string): { accountNo: string; endIndex: number } | null {
  // 1) รูปแบบมีขีดคั่นของบัญชีธนาคารไทย เช่น 123-4-56789-0, xxx-x-x1234-x, 037-3-029725, 150-3074633
  //    (กันรูปแบบวันที่ YYYY-MM-DD หรือ DD-MM-YYYY ด้วยการบังคับให้กลุ่มท้ายมีอย่างน้อย 4 ตัว หรือมี 4 กลุ่ม)
  const hyphenRegex = /\b([0-9xX]{3}-[0-9xX]{1,2}-[0-9xX]{4,7}(?:-[0-9xX]{1,2})?)\b/g;
  for (const match of text.matchAll(hyphenRegex)) {
    const candidate = match[1];
    if (isValidAccountToken(candidate)) {
      return { accountNo: candidate.toUpperCase(), endIndex: (match.index ?? 0) + match[0].length };
    }
  }

  // 2) รูปแบบเลขบัญชีที่ถูก mask ด้วย X ติดกัน เช่น 9061XXX100, 02176XXX697, 1503xxx633, XXXXXX1234
  //    ต้องมีทั้ง X อย่างน้อย 2 ตัว และตัวเลขจริงอย่างน้อย 2 ตัว (กันรหัสอ้างอิงทั่วไป)
  const maskedRegex = /\b([0-9xX]{6,15})\b/g;
  for (const match of text.matchAll(maskedRegex)) {
    const candidate = match[1];
    const xCount = (candidate.match(/[xX]/g) ?? []).length;
    if (xCount >= 2 && isValidAccountToken(candidate)) {
      return { accountNo: candidate.toUpperCase(), endIndex: (match.index ?? 0) + match[0].length };
    }
  }

  // 3) เลขบัญชี 10–12 หลักที่ไม่ถูก mask เมื่ออยู่หลังคำบ่งชี้ เช่น "บัญชี", "A/C", "FROM", "จาก" หรือรหัสธนาคาร
  const contextAccountRegex =
    /(?:บัญชี(?:เลขที่)?|A\/C(?:\s*NO\.?)?|ACCT|FROM|จาก|KBANK|KBNK|SCB|BBL|KTB|TTB|TMB|BAY|GSB|CIMBT?|UOBT?)[\s:/.-]*(\d{10,12})\b/i;
  const ctxMatch = contextAccountRegex.exec(text);
  if (ctxMatch && isValidAccountToken(ctxMatch[1])) {
    const startIdx = (ctxMatch.index ?? 0) + ctxMatch[0].lastIndexOf(ctxMatch[1]);
    return { accountNo: ctxMatch[1], endIndex: startIdx + ctxMatch[1].length };
  }

  return null;
}

export function extractSenderAccountName(text: string, accountEndIndex?: number): string | null {
  // 1) ถ้าระบุคำนำหน้าชื่อชัดเจน เช่น "ชื่อบัญชี ...", "ชื่อผู้โอน ..."
  const labeled = /(?:ชื่อบัญชี(?:ผู้โอน)?|ชื่อผู้โอน)\s*[:.-]?\s*([^|/,\n]+)/i.exec(text);
  if (labeled?.[1]) {
    const cleaned = labeled[1].replace(/\s+/g, ' ').trim();
    if (cleaned.length >= 2) return cleaned;
  }

  // 2) ถ้ามีข้อความต่อท้ายหลังเลขบัญชีที่แกะได้ เช่น "KBANK 139-8-XXX43-4 บจก. จินหลง มอเตอร์"
  if (accountEndIndex !== undefined && accountEndIndex < text.length) {
    const afterAccount = text
      .slice(accountEndIndex)
      .replace(/^[\s:/,|-]+/, '')
      .split(/\s*(?:\||\/|REF\b|หมายเหตุ)/i)[0]
      .replace(/\s+/g, ' ')
      .trim();
    if (afterAccount.length >= 2 && !/^\d+$/.test(afterAccount)) {
      return afterAccount;
    }
  }

  // 3) หาจากคำนำหน้าชื่อบุคคลหรือนิติบุคคลในข้อความ เช่น บจก., บริษัท, หจก., นาย, นาง, น.ส., MR., CO., LTD.
  const entityRegex =
    /((?:บจก\.?|บจ\.?|บมจ\.?|หจก\.?|บริษัท|ห้างหุ้นส่วนจำกัด|ห้างหุ้นส่วน|นาย|นางสาว|น\.ส\.|นาง|คุณ|MR\.?\s|MRS\.?\s|MS\.?\s)[^|/,\n]+)/i;
  const entityMatch = entityRegex.exec(text);
  if (entityMatch?.[1]) {
    const cleaned = entityMatch[1].replace(/\s+/g, ' ').trim();
    if (cleaned.length >= 2) return cleaned;
  }

  return null;
}

/**
 * แกะ SenderBank, SenderAccountNo, SenderAccountName จากข้อความรายละเอียดของรายการธนาคาร
 */
export function extractSenderFromText(rawText: string | null | undefined): ExtractedSender {
  if (!rawText) {
    return { senderBank: null, senderAccountNo: null, senderAccountName: null };
  }
  const text = rawText.replace(/\s+/g, ' ').trim();
  if (!text) {
    return { senderBank: null, senderAccountNo: null, senderAccountName: null };
  }

  const senderBank = extractSenderBank(text);
  const accResult = extractSenderAccountNo(text);
  const senderAccountNo = accResult?.accountNo ?? null;
  const senderAccountName = extractSenderAccountName(text, accResult?.endIndex);

  return {
    senderBank,
    senderAccountNo,
    senderAccountName,
  };
}
