import { describe, it, expect } from 'vitest';
import { normalizeRole, RECONCILE_ROLES, VIEWER_ROLES, DEFAULT_ROLE } from '../lib/roles';

describe('normalizeRole — map ค่า role_prog จาก TRW Data Center', () => {
  it('รู้จัก role ที่ระบบมี โดยไม่สนตัวพิมพ์และช่องว่าง', () => {
    expect(normalizeRole('Admin')).toBe('Admin');
    expect(normalizeRole('admin')).toBe('Admin');
    expect(normalizeRole(' DEV ')).toBe('Dev');
    expect(normalizeRole('user')).toBe('User');
  });

  it('ให้สิทธิ์ต่ำสุดไว้ก่อนเมื่อ API ส่งค่าที่ไม่รู้จักหรือไม่ส่งมา', () => {
    expect(normalizeRole('SuperAdmin')).toBe(DEFAULT_ROLE);
    expect(normalizeRole('')).toBe(DEFAULT_ROLE);
    expect(normalizeRole(null)).toBe(DEFAULT_ROLE);
    expect(normalizeRole(undefined)).toBe(DEFAULT_ROLE);
    expect(DEFAULT_ROLE).toBe('User');
  });
});

describe('ชุดสิทธิ์', () => {
  it('ผู้ใช้ทั่วไปแก้ข้อมูลกระทบยอดไม่ได้ แต่ดูรายงานได้', () => {
    expect(RECONCILE_ROLES).not.toContain('User');
    expect(VIEWER_ROLES).toContain('User');
  });

  it('Admin และ Dev ทำงานกระทบยอดได้', () => {
    expect(RECONCILE_ROLES).toEqual(expect.arrayContaining(['Admin', 'Dev']));
  });
});
