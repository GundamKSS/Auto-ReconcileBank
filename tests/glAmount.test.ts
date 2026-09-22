import { describe, it, expect } from 'vitest';
import { glAmount, glDirection, glSignedAmount, glSignedSql, bankSignedSql } from '../lib/glAmount';

describe('glAmount — สูตรอ่านยอดเงินฝั่ง BC365', () => {
  it('ยอดสุทธิ = Debit − Credit', () => {
    expect(glSignedAmount({ Debit_Amount_LCY: 10186.4, Credit_Amount_LCY: 0 })).toBe(10186.4);
    expect(glSignedAmount({ Debit_Amount_LCY: 0, Credit_Amount_LCY: 10186.4 })).toBe(-10186.4);
  });

  it('อ่านแถวกลับรายการ (REVERSAL) ที่ BC เก็บเป็นยอดติดลบได้ถูกต้อง — เคสจริง Match #268', () => {
    // สูตรเดิม `Debit > 0 ? Debit : Credit` จะไปหยิบ Credit = 0 มาแทน รายการเลยขึ้นเป็น 0 บาท
    const reversal = { Debit_Amount_LCY: -10186.4, Credit_Amount_LCY: 0 };

    expect(glSignedAmount(reversal)).toBe(-10186.4);
    expect(glDirection(reversal)).toBe('OUT');
    expect(glAmount(reversal)).toBe(10186.4);
  });

  it('กลับรายการฝั่ง Credit ติดลบ ระบบอ่านเป็นเงินเข้า', () => {
    // เคสจริง PVD2608-0086: Credit −1,117.76
    const reversal = { Debit_Amount_LCY: 0, Credit_Amount_LCY: -1117.76 };

    expect(glSignedAmount(reversal)).toBe(1117.76);
    expect(glDirection(reversal)).toBe('IN');
    expect(glAmount(reversal)).toBe(1117.76);
  });

  it('ยอดที่แสดงไม่ติดลบเสมอ', () => {
    expect(glAmount({ Debit_Amount_LCY: 0, Credit_Amount_LCY: 500 })).toBe(500);
  });

  it('ถือว่าเป็น 0 เมื่อ BC ไม่ส่งคอลัมน์ยอดมา', () => {
    expect(glSignedAmount({})).toBe(0);
    expect(glSignedAmount({ Debit_Amount_LCY: null, Credit_Amount_LCY: undefined })).toBe(0);
  });

  it('ยอด 0 บาทถือเป็นเงินออก (ไม่เข้าเงื่อนไข > 0)', () => {
    expect(glDirection({ Debit_Amount_LCY: 0, Credit_Amount_LCY: 0 })).toBe('OUT');
  });

  it('รับค่าที่ driver ส่งมาเป็น string ได้', () => {
    expect(glSignedAmount({ Debit_Amount_LCY: '250.75', Credit_Amount_LCY: '0' })).toBe(250.75);
  });
});

describe('นิพจน์ SQL ของยอดสุทธิ', () => {
  it('ฝั่ง GL ใส่ alias ของตารางได้', () => {
    expect(glSignedSql('e')).toBe('(COALESCE(e.Debit_Amount_LCY, 0) - COALESCE(e.Credit_Amount_LCY, 0))');
    expect(glSignedSql()).toBe('(COALESCE(Debit_Amount_LCY, 0) - COALESCE(Credit_Amount_LCY, 0))');
  });

  it('ฝั่ง Bank Statement บวก = เงินเข้า (Credit − Debit) ทิศตรงข้ามกับฝั่ง GL', () => {
    expect(bankSignedSql('l')).toBe('(COALESCE(l.Credit, 0) - COALESCE(l.Debit, 0))');
    expect(bankSignedSql()).toBe('(COALESCE(Credit, 0) - COALESCE(Debit, 0))');
  });
});
