import { NextResponse } from 'next/server';

// ตัวช่วยตรวจ query param / body ของ API ให้ตอบ 400 พร้อมข้อความภาษาคนตั้งแต่ต้นทาง
// แทนที่จะปล่อยค่าผิดๆ ลงไปถึง mssql แล้วได้ 500 พร้อมข้อความดิบจาก driver
// (เช่น "Validation failed for parameter 'from'. Invalid date.") ซึ่งผู้ใช้อ่านไม่รู้เรื่อง
// และเป็นการเปิดเผยรายละเอียดภายในของระบบโดยไม่จำเป็น

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** แปลง 'YYYY-MM-DD' เป็น Date (เที่ยงคืน UTC) — คืน undefined ถ้าไม่ได้ส่งมา, null ถ้ารูปแบบผิด */
export function parseIsoDateParam(raw: string | null): Date | null | undefined {
  if (raw === null || raw === '') return undefined;
  if (!ISO_DATE_RE.test(raw)) return null;
  const d = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  // กันวันที่ที่รูปแบบถูกแต่ไม่มีอยู่จริง เช่น 2026-02-31 (JS จะเลื่อนเป็น 3 มี.ค. ให้เงียบๆ)
  if (d.toISOString().slice(0, 10) !== raw) return null;
  return d;
}

/** แปลงเลข id ที่ต้องเป็นจำนวนเต็มบวกและอยู่ในช่วงของ SQL Server INT */
export function parseIdParam(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined || String(raw).trim() === '') return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0 || n > 2_147_483_647) return null;
  return n;
}

export function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

/**
 * ตรวจช่วงวันที่ที่รับมาจาก query string
 * คืน { error } ถ้าไม่ผ่าน — ครอบคลุมทั้งรูปแบบผิดและกรณี "ถึงวันที่" มาก่อน "จากวันที่"
 * ซึ่งเดิมระบบรับไว้เฉยๆ แล้วแสดงผลลัพธ์ว่าง ทำให้ผู้ใช้เข้าใจผิดว่าไม่มีข้อมูล
 */
export function parseDateRange(
  fromRaw: string | null,
  toRaw: string | null
): { error: string } | { from: Date | null; to: Date | null } {
  const from = parseIsoDateParam(fromRaw);
  if (from === null) return { error: 'รูปแบบวันที่เริ่มต้นไม่ถูกต้อง (ต้องเป็น YYYY-MM-DD)' };

  const to = parseIsoDateParam(toRaw);
  if (to === null) return { error: 'รูปแบบวันที่สิ้นสุดไม่ถูกต้อง (ต้องเป็น YYYY-MM-DD)' };

  if (from && to && from.getTime() > to.getTime()) {
    return { error: 'ช่วงวันที่ไม่ถูกต้อง — "ถึงวันที่" ต้องไม่มาก่อน "จากวันที่"' };
  }

  return { from: from ?? null, to: to ?? null };
}
