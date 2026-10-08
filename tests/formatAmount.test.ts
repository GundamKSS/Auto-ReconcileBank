import { describe, expect, it } from 'vitest';
import { formatAmount, formatAmountOrDash } from '../lib/formatAmount';

describe('formatAmount', () => {
  it('แสดงทศนิยม 2 ตำแหน่งพร้อมคั่นหลักพันเสมอ', () => {
    expect(formatAmount(0)).toBe('0.00');
    expect(formatAmount(1234.5)).toBe('1,234.50');
    expect(formatAmount(20352904.65)).toBe('20,352,904.65');
    expect(formatAmount(-2639787.25)).toBe('-2,639,787.25');
  });

  // เคสที่เจอจริงตอนกระทบยอดฝั่งเงินออก: เลือก 98 รายการเทียบกับ 119 รายการ
  // ผลต่างลงตัวพอดีแต่ผลรวมทศนิยมเหลือเศษติดลบจิ๋วๆ ทำให้ช่อง "ยอดเท่ากัน" แสดง "-0.00"
  // ซึ่งทำให้ฝั่งบัญชีสงสัยว่ายอดไม่ลงตัวจริงหรือเปล่า
  it('ไม่แสดง "-0.00" เมื่อผลต่างลงตัวพอดี', () => {
    expect(formatAmount(-0)).toBe('0.00');
    expect(formatAmount(-0.0000000001)).toBe('0.00');
    expect(formatAmount(0.0000000001)).toBe('0.00');
    // ผลรวมจริงที่เกิดจากการบวกลบทศนิยมหลายรายการ
    const diff = (16786588.69 + 0.1 + 0.2) - (16786588.69 + 0.30000000000000004);
    expect(formatAmount(diff)).toBe('0.00');
  });

  // การแก้ -0.00 ต้องไม่ไปเปลี่ยนการปัดเศษของค่าอื่นแม้แต่กรณีเดียว
  // (ตรวจไว้เพราะเคยลองปัดเองด้วย Math.round(n * 100) / 100 แล้วทำให้ 1.005 เพี้ยนเป็น 1.00)
  it('ปัดเศษเหมือนเดิมทุกกรณี เปลี่ยนเฉพาะการแสดงลบศูนย์', () => {
    const intl = (n: number) =>
      n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    for (const v of [1.005, 2.675, -0.005, 0.004, 0.125, 1234.555, -1234.555, 99.999, -7.455]) {
      expect(formatAmount(v)).toBe(intl(v));
    }
    // ค่าที่ปัดแล้วยังติดลบจริง ต้องคงเครื่องหมายลบไว้
    expect(formatAmount(-0.005)).toBe('-0.01');
    expect(formatAmount(-0.01)).toBe('-0.01');
  });
});

describe('formatAmountOrDash', () => {
  it('แสดงขีดกลางเมื่อไม่มีค่า', () => {
    expect(formatAmountOrDash(null)).toBe('-');
    expect(formatAmountOrDash(undefined)).toBe('-');
  });

  it('ศูนย์ไม่ใช่ค่าว่าง ต้องแสดงเป็น 0.00', () => {
    expect(formatAmountOrDash(0)).toBe('0.00');
    expect(formatAmountOrDash(-0)).toBe('0.00');
  });
});
