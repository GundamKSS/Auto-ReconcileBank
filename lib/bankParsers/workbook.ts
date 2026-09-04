import * as XLSX from 'xlsx';

// เพดานขนาดไฟล์และจำนวนแถวต่อการนำเข้า 1 ครั้ง — กันไฟล์ผิดหรือไฟล์ใหญ่ผิดปกติ
// ทำให้ transaction ตอน import เปิดค้างนานจนล็อกตาราง BankStatementLine ทั้งระบบ
export const MAX_FILE_BYTES = 15 * 1024 * 1024; // 15 MB
export const MAX_IMPORT_ROWS = 20_000;

/**
 * เลือก sheet ที่น่าจะมีข้อมูลจริง:
 * - อันดับ 1: ชื่อ sheet มีชื่อธนาคารอยู่ในนั้นแต่ไม่ใช่ sheet สรุป/pivot (ไฟล์จริงมักมีหลาย sheet ปนกัน)
 * - อันดับ 2: ถ้าไฟล์ถูก export จาก Apple Numbers จะมี sheet ชื่อลงท้ายด้วย 'Table 1-1'
 * - อันดับ 3: เลือก sheet ที่มีจำนวนแถวมากที่สุด (fallback สุดท้าย)
 * - ถ้ามี sheet เดียว ใช้ sheet นั้นตรงๆ
 */
export function pickDataSheetName(workbook: XLSX.WorkBook, bankCode?: string): string {
  if (workbook.SheetNames.length === 1) return workbook.SheetNames[0];

  if (bankCode) {
    const bankMatch = workbook.SheetNames.find(
      (name) => name.toLowerCase().includes(bankCode.toLowerCase()) && !name.toLowerCase().includes('pivot')
    );
    if (bankMatch) return bankMatch;
  }

  const tableSheet = workbook.SheetNames.find((name) => /table 1-1$/i.test(name));
  if (tableSheet) return tableSheet;

  let bestName = workbook.SheetNames[0];
  let bestRowCount = -1;
  for (const name of workbook.SheetNames) {
    const ref = workbook.Sheets[name]['!ref'];
    if (!ref) continue;
    const range = XLSX.utils.decode_range(ref);
    const rowCount = range.e.r - range.s.r + 1;
    if (rowCount > bestRowCount) {
      bestRowCount = rowCount;
      bestName = name;
    }
  }
  return bestName;
}

/**
 * อ่านไฟล์ statement ออกมาเป็น array ของแถว
 *
 * จุดสำคัญคือตัวเลือกที่ส่งให้ XLSX.read ต่างกันตามชนิดไฟล์:
 *
 *   .csv  -> raw: true  (ห้ามให้ SheetJS เดาชนิดข้อมูลเอง)
 *            ไฟล์ CSV เก็บวันที่เป็นข้อความล้วน SheetJS จะพยายามเดาให้เป็นวันที่โดยใช้
 *            รูปแบบอเมริกัน MM/DD/YYYY ทำให้ '02/05/2026' (2 พ.ค.) กลายเป็น 5 ก.พ. เงียบๆ
 *            ส่วนแถวที่วันที่ตั้งแต่ 13 ขึ้นไปจะรอด เพราะเดาเป็นเดือน 13 ไม่ได้เลยปล่อยเป็นข้อความ
 *            ผลคือไฟล์เดียวกันมีทั้งแถวถูกและแถวผิดปนกัน — ตรวจจับยากมาก
 *            การบังคับ raw: true ทำให้ทุกเซลล์เป็นข้อความ แล้วให้ toISODate() แกะด้วย
 *            รูปแบบ DD/MM/YYYY ของไทยเองซึ่งถูกต้อง
 *
 *   .xlsx -> cellDates: true
 *            ไฟล์ Excel จริงเก็บวันที่เป็น serial number ที่ไม่กำกวมอยู่แล้ว แปลงตรงๆ ได้เลย
 */
export function readStatementRows(fileName: string, buffer: Buffer, bankCode?: string): unknown[][] {
  const isCsv = /\.csv$/i.test(fileName.trim());

  const workbook = isCsv
    ? XLSX.read(buffer, { type: 'buffer', raw: true })
    : XLSX.read(buffer, { type: 'buffer', cellDates: true });

  const sheet = workbook.Sheets[pickDataSheetName(workbook, bankCode)];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
}
