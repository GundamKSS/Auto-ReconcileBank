// กติกาหมายเหตุของการจับคู่ — ใช้ทั้งฝั่ง client และ server จึงแยกไว้ไฟล์นี้ ไม่ให้ component ลาก mssql ติดไปด้วย

// หมายเหตุสั้นกว่านี้มักเป็นการพิมพ์ให้ผ่านๆ ("-", "ok") ซึ่งอีกเดือนมาอ่านก็ไม่รู้ว่าทำไม
export const REMARK_MIN_LENGTH = 5;
export const REMARK_MAX_LENGTH = 500;

export function remarkProblem(remark: string): string | null {
  const text = remark.trim();
  if (text.length < REMARK_MIN_LENGTH) return `กรุณาใส่หมายเหตุอย่างน้อย ${REMARK_MIN_LENGTH} ตัวอักษร`;
  if (text.length > REMARK_MAX_LENGTH) return `หมายเหตุยาวเกิน ${REMARK_MAX_LENGTH} ตัวอักษร`;
  return null;
}
