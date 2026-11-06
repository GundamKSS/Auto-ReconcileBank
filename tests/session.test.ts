import { describe, it, expect, afterEach, vi } from 'vitest';
import { AUDIT_ACTOR_MAX_LENGTH, auditActor, auditWorkActor, createSessionToken, verifySessionToken } from '../lib/session';

const login = (o: Partial<Parameters<typeof createSessionToken>[0]> = {}) =>
  createSessionToken({ username: 'siwakorn', displayName: 'ศิวกร ส.', roleProg: 'Admin', ...o });

afterEach(() => {
  vi.useRealTimers();
});

describe('createSessionToken / verifySessionToken', () => {
  it('binds the authenticated employee code into the signed cookie, preserving leading zeros', () => {
    expect(verifySessionToken(login({ employeeNo: ' 0012a ' }))?.employeeNo).toBe('0012A');
    expect(verifySessionToken(login())?.employeeNo).toBeUndefined();
  });
  it('rejects client tampering with the employee code', () => {
    const [body, signature] = login({ employeeNo: '001' }).split('.');
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    payload.emp = '999';
    expect(verifySessionToken(`${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${signature}`)).toBeNull();
  });
  it('อ่าน session กลับมาได้ครบหลังเซ็น', () => {
    expect(verifySessionToken(login())).toEqual({
      username: 'siwakorn',
      displayName: 'ศิวกร ส.',
      role: 'Admin',
    });
  });

  it('map role_prog ที่ไม่รู้จักเป็นสิทธิ์ต่ำสุด ไม่ใช่ปฏิเสธ token', () => {
    expect(verifySessionToken(login({ roleProg: 'SuperAdmin' }))?.role).toBe('User');
    expect(verifySessionToken(login({ roleProg: null }))?.role).toBe('User');
  });

  it('ใช้ username แทนเมื่อไม่มีชื่อที่แสดง', () => {
    expect(verifySessionToken(login({ displayName: '' }))?.displayName).toBe('siwakorn');
  });

  it('ปฏิเสธ token ที่ถูกแก้เนื้อหา — แก้ payload แล้วลายเซ็นเดิมใช้ไม่ได้', () => {
    const token = login({ roleProg: 'User' });
    const [body, signature] = [token.slice(0, token.lastIndexOf('.')), token.slice(token.lastIndexOf('.') + 1)];
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));

    // ลองยกสิทธิ์ตัวเองเป็น Admin โดยไม่รู้คีย์
    payload.r = 'Admin';
    const forged = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');

    expect(verifySessionToken(`${forged}.${signature}`)).toBeNull();
  });

  it('ปฏิเสธ token ที่ลายเซ็นถูกแก้', () => {
    const token = login();

    expect(verifySessionToken(`${token}x`)).toBeNull();
    expect(verifySessionToken(token.slice(0, -1))).toBeNull();
  });

  it('ปฏิเสธ token ที่รูปแบบไม่ถูกต้อง', () => {
    expect(verifySessionToken(null)).toBeNull();
    expect(verifySessionToken(undefined)).toBeNull();
    expect(verifySessionToken('')).toBeNull();
    expect(verifySessionToken('ไม่มีจุดคั่น')).toBeNull();
    expect(verifySessionToken('.signature-only')).toBeNull();
  });

  it('token หมดอายุหลัง 12 ชั่วโมง', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-21T08:00:00Z'));
    const token = login();

    vi.setSystemTime(new Date('2026-09-21T19:59:00Z'));
    expect(verifySessionToken(token)).not.toBeNull();

    vi.setSystemTime(new Date('2026-09-21T20:01:00Z'));
    expect(verifySessionToken(token)).toBeNull();
  });
});

describe('auditActor — ชื่อผู้ทำรายการที่บันทึกลง audit trail', () => {
  it('workflow audit includes the employee identity used to authorize the action', () => {
    const actor = auditWorkActor({ username: 'alice', displayName: 'Alice', role: 'Admin', employeeNo: '001' });
    expect(actor).toBe('EMP 001 · Alice (alice)');
    expect(auditWorkActor({ username: 'a', displayName: 'x'.repeat(200), role: 'Admin', employeeNo: '001' }).length).toBeLessThanOrEqual(100);
  });
  const session = (username: string, displayName: string) =>
    ({ username, displayName, role: 'Admin' }) as Parameters<typeof auditActor>[0];

  // ชื่อแสดงผลซ้ำกันได้ระหว่างคนละคน จึงต้องมี username ติดไปด้วยเสมอ
  it('เก็บทั้งชื่อที่แสดงและ username', () => {
    expect(auditActor(session('acct', 'สมหญิง บัญชี'))).toBe('สมหญิง บัญชี (acct)');
  });

  it('คนละคนที่ชื่อแสดงผลเหมือนกัน ต้องแยกออกจากกันได้', () => {
    const a = auditActor(session('somying.a', 'สมหญิง บัญชี'));
    const b = auditActor(session('somying.b', 'สมหญิง บัญชี'));
    expect(a).not.toBe(b);
  });

  it('ไม่ใส่วงเล็บซ้ำเมื่อชื่อที่แสดงกับ username เป็นค่าเดียวกัน', () => {
    expect(auditActor(session('gundam', 'gundam'))).toBe('gundam');
  });

  it('ไม่มีชื่อที่แสดง ใช้ username อย่างเดียว', () => {
    expect(auditActor(session('acct', ''))).toBe('acct');
    expect(auditActor(session('acct', '   '))).toBe('acct');
  });

  // คอลัมน์เป็น NVARCHAR(100) — ยาวเกินต้องตัดเอง ไม่ใช่ปล่อยให้ SQL Server ล้ม transaction ทั้งก้อน
  it('ยาวเกิน 100 ตัวต้องถูกตัด แต่ username ต้องอยู่ครบ', () => {
    const long = 'ก'.repeat(300);
    const result = auditActor(session('acct', long));
    expect(result.length).toBeLessThanOrEqual(AUDIT_ACTOR_MAX_LENGTH);
    expect(result.endsWith('(acct)')).toBe(true);
  });

  it('username ยาวเกินคอลัมน์เองก็ยังไม่ล้น', () => {
    const result = auditActor(session('u'.repeat(200), 'ชื่อยาว'));
    expect(result.length).toBeLessThanOrEqual(AUDIT_ACTOR_MAX_LENGTH);
  });
});
