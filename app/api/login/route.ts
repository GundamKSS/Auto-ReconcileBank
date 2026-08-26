import { NextRequest, NextResponse } from 'next/server';
import {
  TRW_API_BASE,
  TRW_PROGRAM_CODE,
  ProgramAccess,
  UserSession,
} from '../../../lib/trwApi';

// กัน Next.js cache response ของ route นี้ไว้ — ต้องยิงเช็คของจริงทุกครั้ง
export const dynamic = 'force-dynamic';

// การตรวจสอบ login ย้ายไปอยู่ที่ TRW Data Center API (/auth/auth_permission_prog) แล้ว
// ไม่ได้เช็คกับตาราง Employee ใน SQL เองอีกต่อไป — route นี้ทำหน้าที่เป็น proxy
// เพื่อให้ browser ไม่ต้องต่อตรงเข้า service ใน LAN และ base URL อยู่ฝั่ง server ที่เดียว
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
      signal: AbortSignal.timeout(15_000),
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

    return NextResponse.json(session);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'เชื่อมต่อระบบตรวจสอบผู้ใช้งานไม่ได้' }, { status: 502 });
  }
}
