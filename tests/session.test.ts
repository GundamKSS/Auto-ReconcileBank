import { describe, it, expect, afterEach, vi } from 'vitest';
import { createSessionToken, verifySessionToken } from '../lib/session';

const login = (o: Partial<Parameters<typeof createSessionToken>[0]> = {}) =>
  createSessionToken({ username: 'siwakorn', displayName: 'ศิวกร ส.', roleProg: 'Admin', ...o });

afterEach(() => {
  vi.useRealTimers();
});

describe('createSessionToken / verifySessionToken', () => {
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
