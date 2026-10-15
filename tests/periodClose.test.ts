import { describe, expect, it } from 'vitest';
import { findBlockingClosedPeriod, isoDate, type ClosedPeriodRange } from '../lib/periodClose';

// ตรรกะหลักของ assertDatesOpen แยกมาเป็น findBlockingClosedPeriod (pure function) เพื่อเทสได้โดยไม่ต้องต่อ DB
describe('findBlockingClosedPeriod', () => {
  it('ไม่มีงวดที่ปิดเลย → ผ่าน (null)', () => {
    expect(findBlockingClosedPeriod(['2026-08-15'], [])).toBeNull();
  });

  it('วันที่ตรงกับช่วงที่ปิด → บล็อก', () => {
    const closed: ClosedPeriodRange[] = [{ periodStart: '2026-08-01', periodEnd: '2026-08-31', closedBy: 'somying.a' }];
    expect(findBlockingClosedPeriod(['2026-08-15'], closed)).toEqual(closed[0]);
  });

  it('วันที่ตรงกับขอบงวดพอดี (วันแรก/วันสุดท้าย) → บล็อกด้วย', () => {
    const closed: ClosedPeriodRange[] = [{ periodStart: '2026-08-01', periodEnd: '2026-08-31', closedBy: 'somying.a' }];
    expect(findBlockingClosedPeriod(['2026-08-01'], closed)).toEqual(closed[0]);
    expect(findBlockingClosedPeriod(['2026-08-31'], closed)).toEqual(closed[0]);
  });

  it('วันที่อยู่นอกทุกช่วงที่ปิด (มีงวดอื่นปิดอยู่) → ผ่าน', () => {
    const closed: ClosedPeriodRange[] = [{ periodStart: '2026-07-01', periodEnd: '2026-07-31', closedBy: 'somying.a' }];
    expect(findBlockingClosedPeriod(['2026-08-15'], closed)).toBeNull();
  });

  it('ข้าม 2 งวด (งวดกลางเปิดอยู่) → เช็คถูกเฉพาะงวดที่ปิดจริง', () => {
    // ก.ค. ปิด, ส.ค. เปิด, ก.ย. ปิด — วันที่อยู่ ส.ค. ต้องผ่าน แม้มีวันที่อื่นใน ก.ค./ก.ย. ปนมาด้วยก็ต้องโดนบล็อก
    const closed: ClosedPeriodRange[] = [
      { periodStart: '2026-07-01', periodEnd: '2026-07-31', closedBy: 'a' },
      { periodStart: '2026-09-01', periodEnd: '2026-09-30', closedBy: 'b' },
    ];
    expect(findBlockingClosedPeriod(['2026-08-15', '2026-08-20'], closed)).toBeNull();
    expect(findBlockingClosedPeriod(['2026-08-15', '2026-09-05'], closed)).toEqual(closed[1]);
  });

  it('หลายวันที่ปน — เจอวันเดียวที่ชนก็บล็อกทั้งชุด', () => {
    const closed: ClosedPeriodRange[] = [{ periodStart: '2026-08-01', periodEnd: '2026-08-31', closedBy: 'a' }];
    expect(findBlockingClosedPeriod(['2026-07-31', '2026-08-01', '2026-09-01'], closed)).toEqual(closed[0]);
  });
});

describe('isoDate', () => {
  it('แปลง Date เป็น YYYY-MM-DD แบบ UTC', () => {
    expect(isoDate(new Date(Date.UTC(2026, 7, 5)))).toBe('2026-08-05');
  });

  it('รับ string ISO ที่มี time มาด้วยได้', () => {
    expect(isoDate('2026-08-05T00:00:00.000Z')).toBe('2026-08-05');
  });
});
