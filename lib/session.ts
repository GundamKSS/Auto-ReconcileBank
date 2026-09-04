import crypto from 'crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { normalizeRole, type Role } from './roles';

export const SESSION_COOKIE = 'arb_session';

// อายุ session ฝั่ง server — ยาวกว่า inactivity timeout ฝั่ง UI (30 นาที) เพื่อให้ตัวที่เตะผู้ใช้ออก
// คือ useInactivityLogout ตามเดิม ไม่ใช่ cookie หมดอายุกลางคันระหว่างทำงาน
const SESSION_TTL_SECONDS = 12 * 60 * 60; // 12 ชั่วโมง

type SessionPayload = {
  u: string;  // username
  d: string;  // displayName
  r: string;  // roleProg
  e: number;  // เวลาหมดอายุ (epoch ms)
};

export type Session = {
  username: string;
  displayName: string;
  role: Role;
};

// คีย์สำหรับเซ็น session — ควรตั้ง SESSION_SECRET ใน .env ให้เป็นค่าคงที่
// ถ้าไม่ได้ตั้ง จะสุ่มใหม่ทุกครั้งที่ start process ซึ่งแปลว่า session เดิมใช้ไม่ได้หลังรีสตาร์ต
// (ผู้ใช้ต้อง login ใหม่) — ปลอดภัยไว้ก่อน ดีกว่าใช้คีย์ที่เดาได้
let cachedSecret: Buffer | null = null;
function getSecret(): Buffer {
  if (cachedSecret) return cachedSecret;
  const fromEnv = process.env.SESSION_SECRET;
  if (fromEnv && fromEnv.length >= 16) {
    cachedSecret = Buffer.from(fromEnv, 'utf8');
  } else {
    console.warn(
      '[session] ไม่พบ SESSION_SECRET ใน .env — สุ่มคีย์ชั่วคราวให้ process นี้ ' +
        'ผู้ใช้ทุกคนจะต้อง login ใหม่ทุกครั้งที่รีสตาร์ตเซิร์ฟเวอร์ ' +
        'กรุณาตั้ง SESSION_SECRET (สุ่มยาวอย่างน้อย 32 ตัวอักษร) ใน .env'
    );
    cachedSecret = crypto.randomBytes(32);
  }
  return cachedSecret;
}

function sign(data: string): string {
  return crypto.createHmac('sha256', getSecret()).update(data).digest('base64url');
}

export function createSessionToken(input: { username: string; displayName: string; roleProg: string | null }): string {
  const payload: SessionPayload = {
    u: input.username,
    d: input.displayName,
    r: input.roleProg ?? '',
    e: Date.now() + SESSION_TTL_SECONDS * 1000,
  };
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${body}.${sign(body)}`;
}

export function verifySessionToken(token: string | undefined | null): Session | null {
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;

  const body = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected = sign(body);

  // เทียบลายเซ็นแบบ timing-safe — กันการเดาลายเซ็นทีละไบต์
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload;
    if (typeof payload?.e !== 'number' || payload.e < Date.now()) return null;
    if (!payload.u) return null;
    return {
      username: payload.u,
      displayName: payload.d || payload.u,
      role: normalizeRole(payload.r),
    };
  } catch {
    return null;
  }
}

/** อ่าน session ปัจจุบันจาก cookie — คืน null ถ้ายังไม่ login หรือ token หมดอายุ/ถูกแก้ */
export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  return verifySessionToken(store.get(SESSION_COOKIE)?.value);
}

export function sessionCookieOptions(isHttps: boolean) {
  return {
    httpOnly: true,          // JavaScript ฝั่งหน้าเว็บอ่านไม่ได้ — กันการขโมย/ปลอม session
    sameSite: 'lax' as const,
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
    // เครื่อง deploy ปัจจุบันรันเป็น HTTP ธรรมดาบนพอร์ต 8080 ถ้าบังคับ secure ไว้ตลอด
    // เบราว์เซอร์จะไม่ส่ง cookie กลับมาเลยและ login ไม่ผ่าน — จึงเปิดเฉพาะตอนเป็น HTTPS จริง
    secure: isHttps,
  };
}

/**
 * ด่านตรวจสิทธิ์ของ API route ทุกเส้นทาง — เรียกเป็นบรรทัดแรกของ handler เสมอ
 *
 * ทำที่ระดับ route handler ไม่ใช่ proxy.ts ตามที่เอกสาร Next.js 16 แนะนำไว้ว่า
 * proxy เหมาะกับการ redirect แบบ optimistic เท่านั้น ไม่ควรใช้เป็นระบบ authorization หลัก
 *
 * ใช้แบบนี้:
 *   const auth = await requireRole(RECONCILE_ROLES);
 *   if (!auth.ok) return auth.response;
 *   // auth.session.username ใช้เป็น CreatedBy ได้เลย — มาจาก cookie ที่เซ็นไว้ ปลอมไม่ได้
 */
export async function requireRole(
  allowed: readonly Role[]
): Promise<{ ok: true; session: Session } | { ok: false; response: NextResponse }> {
  const session = await getSession();

  if (!session) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'กรุณาเข้าสู่ระบบก่อนใช้งาน' }, { status: 401 }),
    };
  }

  if (!allowed.includes(session.role)) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'คุณไม่มีสิทธิ์ใช้งานส่วนนี้' }, { status: 403 }),
    };
  }

  return { ok: true, session };
}
