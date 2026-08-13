import { NextResponse } from 'next/server';

// กัน Next.js cache response ของ route นี้ไว้ (เป็น action ที่ต้อง trigger จริงทุกครั้ง ไม่ใช่ข้อมูลอ่านอย่างเดียว)
export const dynamic = 'force-dynamic';

const SYNC_API_BASE = process.env.BC365_SYNC_API_URL || 'http://0.0.0.0:8000';

// เรียก TRW Data Center sync service ให้ดึงรายการ GL (BankAccountLedgerEntries) ล่าสุด 40 วัน
// จาก Business Central (BC365) มาอัปเดตตาราง SQL ที่หน้า reconcile อ่านอยู่ — ใช้ตอนบัญชีแก้ไขข้อมูลใน ERP
// เสร็จแล้วอยากดึงของจริงมาเทียบใหม่ทันที โดยไม่ต้องรอ sync job รอบถัดไป
export async function POST() {
  try {
    const res = await fetch(`${SYNC_API_BASE}/sync/BankAccountLedgerEntriesUpdate40days`, {
      method: 'GET',
      cache: 'no-store',
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `ซิงค์ข้อมูลจาก BC365 ไม่สำเร็จ (HTTP ${res.status})` },
        { status: 502 }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'เชื่อมต่อ BC365 sync service ไม่ได้' }, { status: 502 });
  }
}
