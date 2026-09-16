// ตัวช่วยเกี่ยวกับ "บัญชีธนาคาร" ที่ใช้ร่วมกันทั้งฝั่ง server และฝั่ง client
//
// ไฟล์นี้ต้องไม่ import mssql หรืออะไรที่แตะฐานข้อมูล เพราะ component ฝั่ง client
// (หน้า Import, modal ของหน้า Reconcile) import ไปใช้เดาบัญชีจากชื่อไฟล์ด้วย
//
// คำศัพท์ที่ปนกันง่ายในระบบนี้:
//   bankCode      - 'BBL' | 'KBANK' | 'SCB'  ระดับธนาคาร
//   bankAccountNo - รหัสบัญชีของ BC365 เช่น 'TW_SCB_C1' (ไม่ใช่เลขบัญชีธนาคาร) เป็น PK ของ BankAccountMapping
//   displayNo     - เลขบัญชีธนาคารจริง เช่น '037-3-029725' ซึ่ง BC365 ไม่ได้เก็บเป็นคอลัมน์แยก
//                   แต่ต่อท้ายชื่อบัญชีด้วย '#' เช่น 'TRW กระแสรายวัน SCB เฉลิมนคร #037-3-029725'

export type BankAccountOption = {
  bankAccountNo: string;
  bankCode: string | null;
  accountName: string | null;
  // เลขบัญชีธนาคารจริงที่แกะมาจากชื่อบัญชี — null ถ้าชื่อบัญชีไม่ได้ใส่ '#เลขบัญชี' ไว้
  displayNo: string | null;
  // จำนวนไฟล์ statement ที่นำเข้าไว้แล้วของบัญชีนี้ (ใช้เรียงลำดับ/บอกใบ้ผู้ใช้ใน dropdown)
  importCount?: number;
};

// แกะเลขบัญชีจากชื่อบัญชีของ BC365 — เอาส่วนหลัง '#' ตัวสุดท้าย
// รูปแบบที่เจอจริงมีทั้ง '#037-3-029725', '#150-3074633', '#027-2-37773-3' และ '#490-9'
// จึงไม่ fix จำนวนหลัก รับตัวเลขกับขีดกลางไปทั้งหมด
export function extractDisplayNo(accountName: string | null | undefined): string | null {
  if (!accountName) return null;
  const m = accountName.match(/#\s*([\d-]+)\s*$/);
  if (!m) return null;
  const cleaned = m[1].replace(/-+$/, '').trim();
  return cleaned || null;
}

// เหลือเฉพาะตัวเลข ใช้เทียบกันโดยไม่สนว่าขีดกลางคั่นตรงไหน
// (BC365 เขียนขีดไม่เหมือนกันทุกบัญชี เช่น '150-3074633' กับ '037-3-029725')
function digitsOnly(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '');
}

// ป้ายสั้นๆ ที่ใช้ในแท็บ/ชิป เช่น 'SCB ···9725' — ถ้าไม่มีเลขบัญชีก็ถอยไปใช้รหัส BC365
export function shortAccountLabel(account: BankAccountOption): string {
  const digits = digitsOnly(account.displayNo);
  if (!digits) return account.bankAccountNo;
  return `${account.bankCode ?? ''} ···${digits.slice(-4)}`.trim();
}

// ป้ายเต็มสำหรับ dropdown / หัวตาราง เช่น
//   'TRW กระแสรายวัน SCB เฉลิมนคร #037-3-029725'  (มีชื่อ)
//   'TW_SCB_C1'                                    (ยังไม่มีชื่อ เพราะยังไม่ได้รัน sql/006)
export function fullAccountLabel(account: BankAccountOption): string {
  return account.accountName?.trim() ? account.accountName.trim() : account.bankAccountNo;
}

/**
 * เดาว่าไฟล์ statement ที่เลือกเป็นของบัญชีไหน จากเลขบัญชีที่ผู้ใช้ใส่ไว้ในชื่อไฟล์
 *
 * ผู้ใช้ตั้งชื่อไฟล์ด้วยเลขท้ายบัญชีอยู่แล้วโดยไม่มีใครบังคับ เช่น
 *   '9725 8.26.XLSX'      -> TW_SCB_C1 (#037-3-029725)
 *   'BBL4633 (8) IT.xlsx' -> TW_BBL_C1 (#150-3074633)
 *
 * กติกา: หยิบกลุ่มตัวเลขยาว 4 หลักขึ้นไปจากชื่อไฟล์ แล้วดูว่าตรงกับ "หางเลขบัญชี" ของบัญชีไหน
 * ต้องตรงกับบัญชีเดียวเท่านั้นจึงจะคืนค่า — ถ้ากำกวม (ตรงหลายบัญชี) คืน null ให้ผู้ใช้เลือกเอง
 * ดีกว่าเลือกผิดให้แบบเงียบๆ เพราะการนำเข้าผิดบัญชีทำให้กระทบยอดผิดทั้งงวด
 *
 * ค่าที่ได้เป็นแค่ "ค่าตั้งต้นใน dropdown" ผู้ใช้เปลี่ยนได้เสมอก่อนกดนำเข้า
 */
export function guessAccountFromFileName(
  fileName: string,
  accounts: BankAccountOption[]
): BankAccountOption | null {
  // ตัดนามสกุลไฟล์ทิ้งก่อน ไม่งั้น '.xlsx' หรือปีในชื่อไฟล์กลายเป็นตัวเลขให้เทียบไปด้วย
  const base = fileName.replace(/\.[a-z0-9]+$/i, '');
  const runs = base.match(/\d{4,}/g);
  if (!runs) return null;

  const hits = new Set<string>();
  for (const run of runs) {
    for (const account of accounts) {
      const digits = digitsOnly(account.displayNo);
      // ต้องยาวพอจะเป็นเลขบัญชีจริง ไม่ใช่ '490-9' ที่มี 4 หลักพอดีจนชนเลขปี/เดือนได้ง่าย
      if (digits.length < 6) continue;
      if (digits.endsWith(run)) hits.add(account.bankAccountNo);
    }
  }

  if (hits.size !== 1) return null;
  const [only] = [...hits];
  return accounts.find((a) => a.bankAccountNo === only) ?? null;
}
