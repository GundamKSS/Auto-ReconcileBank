import { NextRequest, NextResponse } from 'next/server';
import {
  TRW_API_BASE,
  TRW_PROGRAM_CODE,
  ProgramAccess,
  UserSession,
} from '../../../lib/trwApi';
import { SESSION_COOKIE, createSessionToken, sessionCookieOptions } from '../../../lib/session';

// กัน Next.js cache response ของ route นี้ไว้ — ต้องยิงเช็คของจริงทุกครั้ง
export const dynamic = 'force-dynamic';

// timeout ของการเรียก TRW Data Center — เดิมตั้งไว้ 15 วินาที ซึ่งนานเกินไปสำหรับ service ในวง LAN
// เวลาที่ service ล่ม ผู้ใช้จะเห็นปุ่มค้าง "Signing in..." ครบ 15 วินาทีโดยไม่รู้ว่าเกิดอะไรขึ้น
const AUTH_TIMEOUT_MS = 8_000;

// การตรวจสอบ login ย้ายไปอยู่ที่ TRW Data Center API (/auth/auth_permission_prog) แล้ว
// ไม่ได้เช็คกับตาราง Employee ใน SQL เองอีกต่อไป — route นี้ทำหน้าที่เป็น proxy
// เพื่อให้ browser ไม่ต้องต่อตรงเข้า service ใน LAN และ base URL อยู่ฝั่ง server ที่เดียว
//
// เมื่อผ่านแล้วจะออก session cookie (httpOnly, เซ็นด้วย HMAC) ให้ด้วย — cookie ตัวนี้คือสิ่งที่
// API ทุกเส้นทางใช้ตรวจสิทธิ์จริง ส่วน JSON ที่ตอบกลับไปเก็บใน localStorage มีไว้ให้ฝั่ง UI
// แสดงชื่อ/กรองเมนูเท่านั้น แก้ค่าในนั้นไม่ทำให้ได้สิทธิ์เพิ่ม
export async function POST(req: NextRequest) {
  try {
    const { username, password } = await req.json();

    if (!username || !password) {
      return NextResponse.json({ error: 'กรุณากรอก username และ password' }, { status: 400 });
    }

    const res = await fetch(`${TRW_API_BASE}/auth/auth_permission_prog`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
      cache: 'no-store',
      signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
    });

    if (!res.ok) {
      // 401/403 = username/รหัสผ่านไม่ถูกต้อง — service ตอบเป็นข้อความอังกฤษกลางๆ ("Invalid credentials")
      // ซึ่งไม่ได้บอกอะไรเพิ่ม เลยแสดงข้อความไทยของเราเองให้เข้ากับหน้าอื่นในระบบ
      if (res.status === 401 || res.status === 403) {
        return NextResponse.json({ error: 'username หรือรหัสผ่านไม่ถูกต้อง' }, { status: 401 });
      }
      return NextResponse.json(
        { error: `ตรวจสอบผู้ใช้งานไม่สำเร็จ (HTTP ${res.status})` },
        { status: 502 }
      );
    }

    const data = await res.json();

    const programs: ProgramAccess[] = Array.isArray(data.programs) ? data.programs : [];
    // API ส่งสิทธิ์มาทุกโปรแกรมที่ผู้ใช้มี — เอาเฉพาะแถวของแอปนี้มาใช้คุมสิทธิ์
    const program = programs.find((p) => p.program_code === TRW_PROGRAM_CODE);

    // ผ่าน login ของ TRW แล้วแต่ไม่ได้รับสิทธิ์แอปนี้ (หรือสิทธิ์ถูกปิดไว้) — ไม่ให้เข้าระบบ
    if (!program || !program.can_use || !program.is_active) {
      return NextResponse.json(
        { error: 'คุณไม่มีสิทธิ์ใช้งานโปรแกรมนี้ กรุณาติดต่อผู้ดูแลระบบ' },
        { status: 403 }
      );
    }

    const session: UserSession = {
      username,
      displayName: data.display_name || username,
      employeeNo: data.employee_no ?? null,
      email: data.email ?? null,
      role: data.role ?? null,
      roleProg: program.role_prog ?? null,
      programs,
      accessToken: data.access_token ?? null,
    };

    const response = NextResponse.json(session);
    response.cookies.set(
      SESSION_COOKIE,
      createSessionToken({
        username: session.username,
        displayName: session.displayName,
        roleProg: session.roleProg,
      }),
      sessionCookieOptions(req.nextUrl.protocol === 'https:')
    );
    return response;
  } catch (err) {
    // AbortError = ยิงไปแล้ว service ไม่ตอบภายในเวลาที่กำหนด แยกข้อความให้ต่างจากต่อไม่ติดเลย
    if (err instanceof Error && err.name === 'TimeoutError') {
      return NextResponse.json(
        { error: 'ระบบตรวจสอบผู้ใช้งานไม่ตอบสนอง กรุณาลองใหม่อีกครั้ง' },
        { status: 504 }
      );
    }
    console.error('Login API error:', err);
    return NextResponse.json({ error: 'เชื่อมต่อระบบตรวจสอบผู้ใช้งานไม่ได้' }, { status: 502 });
  }
}
