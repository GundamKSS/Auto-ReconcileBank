import { describe, it, expect } from 'vitest';
import { parseIsoDateParam, parseIdParam, parseDateRange } from '../lib/apiInput';

describe('parseIsoDateParam', () => {
  it('แปลง YYYY-MM-DD เป็น Date เที่ยงคืน UTC', () => {
    expect(parseIsoDateParam('2026-08-17')?.toISOString()).toBe('2026-08-17T00:00:00.000Z');
  });

  it('คืน undefined เมื่อไม่ได้ส่งค่ามา (ไม่ใช่ความผิดพลาด)', () => {
    expect(parseIsoDateParam(null)).toBeUndefined();
    expect(parseIsoDateParam('')).toBeUndefined();
  });

  it('คืน null เมื่อรูปแบบผิด', () => {
    expect(parseIsoDateParam('17/08/2026')).toBeNull();
    expect(parseIsoDateParam('2026-8-17')).toBeNull();
    expect(parseIsoDateParam('2026-08-17T00:00:00Z')).toBeNull();
    expect(parseIsoDateParam('ไม่ใช่วันที่')).toBeNull();
  });

  it('คืน null เมื่อรูปแบบถูกแต่เป็นวันที่ที่ไม่มีอยู่จริง (JS จะเลื่อนวันให้เงียบๆ)', () => {
    expect(parseIsoDateParam('2026-02-31')).toBeNull();
    expect(parseIsoDateParam('2026-13-01')).toBeNull();
    expect(parseIsoDateParam('2026-02-29')).toBeNull();
  });

  it('รับวันที่ 29 ก.พ. ของปีอธิกสุรทิน', () => {
    expect(parseIsoDateParam('2024-02-29')?.toISOString()).toBe('2024-02-29T00:00:00.000Z');
  });
});

describe('parseIdParam', () => {
  it('รับจำนวนเต็มบวกที่อยู่ในช่วงของ SQL Server INT', () => {
    expect(parseIdParam('4633')).toBe(4633);
    expect(parseIdParam('1')).toBe(1);
    expect(parseIdParam('2147483647')).toBe(2147483647);
  });

  it('ปฏิเสธค่าที่ไม่ใช่ id ที่ใช้ได้', () => {
    expect(parseIdParam('0')).toBeNull();
    expect(parseIdParam('-1')).toBeNull();
    expect(parseIdParam('1.5')).toBeNull();
    expect(parseIdParam('2147483648')).toBeNull();
    expect(parseIdParam('abc')).toBeNull();
  });

  it('ปฏิเสธค่าว่างและค่าที่ไม่ได้ส่งมา', () => {
    expect(parseIdParam('')).toBeNull();
    expect(parseIdParam('   ')).toBeNull();
    expect(parseIdParam(null)).toBeNull();
    expect(parseIdParam(undefined)).toBeNull();
  });
});

describe('parseDateRange', () => {
  it('คืนช่วงวันที่เมื่อส่งมาครบและถูกต้อง', () => {
    const result = parseDateRange('2026-08-01', '2026-08-31');

    expect(result).not.toHaveProperty('error');
    if ('from' in result) {
      expect(result.from?.toISOString().slice(0, 10)).toBe('2026-08-01');
      expect(result.to?.toISOString().slice(0, 10)).toBe('2026-08-31');
    }
  });

  it('คืน null ทั้งคู่เมื่อไม่ได้ส่งช่วงวันที่มาเลย', () => {
    expect(parseDateRange(null, null)).toEqual({ from: null, to: null });
  });

  it('ส่งมาข้างเดียวได้', () => {
    const result = parseDateRange('2026-08-01', null);

    expect('from' in result && result.to).toBeNull();
  });

  it('บอกว่าวันที่เริ่มต้นรูปแบบผิด', () => {
    expect(parseDateRange('01/08/2026', '2026-08-31')).toEqual({
      error: 'รูปแบบวันที่เริ่มต้นไม่ถูกต้อง (ต้องเป็น YYYY-MM-DD)',
    });
  });

  it('บอกว่าวันที่สิ้นสุดรูปแบบผิด', () => {
    expect(parseDateRange('2026-08-01', '2026-08-32')).toEqual({
      error: 'รูปแบบวันที่สิ้นสุดไม่ถูกต้อง (ต้องเป็น YYYY-MM-DD)',
    });
  });

  it('กัน "ถึงวันที่" มาก่อน "จากวันที่" ซึ่งเดิมแสดงผลว่างจนผู้ใช้เข้าใจผิดว่าไม่มีข้อมูล', () => {
    expect(parseDateRange('2026-08-31', '2026-08-01')).toEqual({
      error: 'ช่วงวันที่ไม่ถูกต้อง — "ถึงวันที่" ต้องไม่มาก่อน "จากวันที่"',
    });
  });

  it('วันเดียวกันทั้งต้นและปลายถือว่าใช้ได้', () => {
    expect(parseDateRange('2026-08-17', '2026-08-17')).not.toHaveProperty('error');
  });
});
