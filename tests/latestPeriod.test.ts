import { describe, expect, it } from 'vitest';
import { monthBounds } from '../lib/latestPeriod';
import { monthRangeOf } from '../hooks/useInitialPeriod';

// ขอบเดือนเป็นจุดที่พลาดง่าย โดยเฉพาะเดือนที่ไม่ใช่ 31 วัน และปีอธิกสุรทิน
describe('monthBounds (ฝั่ง server, คิดแบบ UTC)', () => {
  it('ครอบทั้งเดือนของวันที่ที่ให้มา', () => {
    expect(monthBounds(new Date(Date.UTC(2026, 7, 15)))).toEqual({
      month: '2026-08',
      from: '2026-08-01',
      to: '2026-08-31',
    });
  });

  it('เดือนที่มี 30 วัน', () => {
    expect(monthBounds(new Date(Date.UTC(2026, 8, 1))).to).toBe('2026-09-30');
  });

  it('กุมภาพันธ์ปีปกติกับปีอธิกสุรทิน', () => {
    expect(monthBounds(new Date(Date.UTC(2026, 1, 3))).to).toBe('2026-02-28');
    expect(monthBounds(new Date(Date.UTC(2028, 1, 3))).to).toBe('2028-02-29');
  });

  it('ธันวาคมต้องไม่ข้ามไปปีถัดไป', () => {
    expect(monthBounds(new Date(Date.UTC(2026, 11, 31)))).toEqual({
      month: '2026-12',
      from: '2026-12-01',
      to: '2026-12-31',
    });
  });

  it('วันแรกและวันสุดท้ายของเดือนให้ผลเดียวกัน', () => {
    const first = monthBounds(new Date(Date.UTC(2026, 7, 1)));
    const last = monthBounds(new Date(Date.UTC(2026, 7, 31)));
    expect(first).toEqual(last);
  });
});

describe('monthRangeOf (ฝั่งหน้าจอ, คิดแบบเวลาท้องถิ่น)', () => {
  it('ครอบทั้งเดือนและเติมศูนย์หน้าเลขเดือน/วันเสมอ', () => {
    expect(monthRangeOf(new Date(2026, 0, 9))).toEqual({ from: '2026-01-01', to: '2026-01-31' });
    expect(monthRangeOf(new Date(2026, 8, 9))).toEqual({ from: '2026-09-01', to: '2026-09-30' });
  });

  it('กุมภาพันธ์ปีอธิกสุรทิน', () => {
    expect(monthRangeOf(new Date(2028, 1, 10)).to).toBe('2028-02-29');
  });
});
