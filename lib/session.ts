import crypto from 'crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { APP_ROLES, normalizeRole, type AppRole } from './roles';
import { effectiveAppRole, normalizeEmployeeCode } from './workRoles';
import { readWorkPermissions } from './workRolesDb';

export const SESSION_COOKIE = 'arb_session';

// อายุ session ฝั่ง server — ยาวกว่า inactivity timeout ฝั่ง UI (30 นาที) เพื่อให้ตัวที่เตะผู้ใช้ออก
// คือ useInactivityLogout ตามเดิม ไม่ใช่ cookie หมดอายุกลางคันระหว่างทำงาน
const SESSION_TTL_SECONDS = 12 * 60 * 60; // 12 ชั่วโมง

type SessionPayload = {
  u: string;  // username
  d: string;  // displayName
  r: string;  // roleProg
  e: number;  // เวลาหมดอายุ (epoch ms)
  emp?: string; // trusted employee_no from central authentication, not client input
};

export type Session = {
  username: string;
  displayName: string;
  // จาก cookie = role ระบบกลาง; หลังผ่าน requireRole = role ที่ใช้งานจริง (อาจเป็น Staff หรือ Admin จาก MASTER)
  role: AppRole;
  employeeNo?: string;
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

export function createSessionToken(input: { username: string; displayName: string; roleProg: string | null; employeeNo?: string | null }): string {
  const payload: SessionPayload = {
    u: input.username,
    d: input.displayName,
    r: input.roleProg ?? '',
    e: Date.now() + SESSION_TTL_SECONDS * 1000,
    ...(normalizeEmployeeCode(input.employeeNo) ? { emp: normalizeEmployeeCode(input.employeeNo)! } : {}),
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
      ...(normalizeEmployeeCode(payload.emp) ? { employeeNo: normalizeEmployeeCode(payload.emp)! } : {}),
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

/** ความยาวสูงสุดของคอลัมน์ audit ทุกตัวในฐานข้อมูล (CreatedBy / ReversedBy / DeletedBy / UpdatedBy) */
export const AUDIT_ACTOR_MAX_LENGTH = 100;

/**
 * ชื่อผู้ทำรายการที่จะบันทึกลง audit trail
 *
 * ต้องมี username ติดไปด้วยเสมอ ไม่ใช่ชื่อแสดงผลอย่างเดียว เพราะชื่อแสดงผลซ้ำกันได้
 * ระหว่างคนละคน (โค้ดฝั่ง workspace ใน lib/tabWorkspace.ts เตือนเรื่องนี้ไว้แล้ว
 * แต่คอลัมน์ audit ยังเก็บแต่ชื่อแสดงผลอยู่) ถ้าซ้ำกันจะชี้ตัวผู้ทำรายการไม่ได้
 * ซึ่งเป็นสิ่งแรกที่ผู้สอบบัญชีถามเวลาตรวจรายการกลับรายการ
 *
 * รูปแบบ 'ชื่อที่แสดง (username)' — อ่านรู้เรื่องสำหรับฝ่ายบัญชี และไม่กำกวมสำหรับการตรวจสอบ
 * หน้าประวัติการจับคู่ค้นด้วย CreatedBy LIKE อยู่แล้ว จึงค้นได้ทั้งชื่อและ username
 *
 * แถวเก่าที่บันทึกไว้ก่อนหน้านี้มีแต่ชื่อแสดงผล ยังอ่านได้ตามเดิม ไม่ต้องแก้ย้อนหลัง
 */
export function auditActor(session: Session): string {
  const name = session.displayName?.trim();
  const user = session.username.trim();
  const label = name && name !== user ? `${name} (${user})` : user;
  // คอลัมน์เป็น NVARCHAR(100) — ตัดให้พอดีเองดีกว่าปล่อยให้ SQL Server ปฏิเสธทั้ง transaction
  // ตัดส่วนชื่อออกก่อน เพราะ username คือส่วนที่ต้องเก็บให้ครบเพื่อชี้ตัวคนได้
  if (label.length <= AUDIT_ACTOR_MAX_LENGTH) return label;
  const suffix = ` (${user})`;
  const room = AUDIT_ACTOR_MAX_LENGTH - suffix.length;
  return room > 1 ? `${name!.slice(0, room - 1)}…${suffix}` : user.slice(0, AUDIT_ACTOR_MAX_LENGTH);
}

/** Workflow approvals must retain the EMP code used for authorization at that moment. */
export function auditWorkActor(session: Session): string {
  const code = normalizeEmployeeCode(session.employeeNo);
  const actor = auditActor(session);
  return code ? `EMP ${code} · ${actor}`.slice(0, AUDIT_ACTOR_MAX_LENGTH) : actor;
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
  allowed: readonly AppRole[]
): Promise<{ ok: true; session: Session } | { ok: false; response: NextResponse }> {
  const session = await getSession();

  if (!session) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'กรุณาเข้าสู่ระบบก่อนใช้งาน' }, { status: 401 }),
    };
  }

  // Dev/Admin มาจากระบบกลางอย่างเดียว ส่วน User ต้องดูสิทธิ์ในโปรแกรมต่อ (ดู effectiveAppRole) — อ่านจาก DB
  // ทุก request ถอนสิทธิ์แล้วมีผลทันทีโดยไม่ต้อง logout; route ที่ทุก role เข้าได้ (ภาพรวม/รายงาน) ผลไม่เปลี่ยน จึงข้ามได้
  const role = session.role !== 'User' || APP_ROLES.every((r) => allowed.includes(r))
    ? session.role
    : effectiveAppRole(session.role, await readWorkPermissions(session));

  if (!allowed.includes(role)) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'คุณไม่มีสิทธิ์ใช้งานส่วนนี้' }, { status: 403 }),
    };
  }

  return { ok: true, session: { ...session, role } };
}
