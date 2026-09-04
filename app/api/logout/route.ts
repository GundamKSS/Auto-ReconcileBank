import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '../../../lib/session';

export const dynamic = 'force-dynamic';

// ล้าง session cookie ฝั่ง server — เรียกคู่กับการล้าง localStorage ตอนกด Logout
// และตอนถูกเตะออกเพราะไม่มีความเคลื่อนไหว (useInactivityLogout)
// ถ้าไม่เรียกตัวนี้ cookie จะยังใช้งานได้ต่อจนหมดอายุ แม้หน้าเว็บจะเด้งไป /login แล้วก็ตาม
export async function POST() {
  const response = NextResponse.json({ success: true });
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
