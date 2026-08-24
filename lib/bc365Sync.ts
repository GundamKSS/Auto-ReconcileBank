import { NextResponse } from 'next/server';
import { TRW_API_BASE } from './trwApi';

// สอง endpoint ของ TRW Data Center sync service (BC365 -> SQL) ที่ระบบ reconcile ใช้:
//   RECENT — ดึงเฉพาะ 40 วันล่าสุด เร็ว ใช้ที่หน้า reconcile ซึ่งทำงานกันแค่เดือนนั้น
//   FULL   — ดึงใหม่ทั้งหมด ช้ากว่ามาก ใช้ที่หน้า import ตอนต้องการให้ข้อมูล GL ครบทั้งชุด
export const GL_SYNC_ENDPOINT = {
  RECENT: '/sync/BankAccountLedgerEntriesUpdate40days',
  FULL: '/sync/BankAccountLedgerEntries',
} as const;

// ยิงไป sync service แล้วแปลงผลเป็น NextResponse ให้ route handler ส่งกลับได้เลย
// timeoutMs ต่างกันตาม endpoint เพราะ full sync กินเวลานานกว่าแบบ 40 วันมาก
export async function runGlSync(
  endpoint: (typeof GL_SYNC_ENDPOINT)[keyof typeof GL_SYNC_ENDPOINT],
  timeoutMs: number
) {
  try {
    const res = await fetch(`${TRW_API_BASE}${endpoint}`, {
      method: 'GET',
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
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
