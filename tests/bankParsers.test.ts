import { describe, it, expect } from 'vitest';
import { toISODate, toNumber, findColumnIndex, parseBankStatement } from '../lib/bankParsers';

describe('toISODate — แปลงวันที่จากไฟล์ statement', () => {
  it('อ่าน DD/MM/YYYY แบบไทย ไม่สลับเป็น MM/DD/YYYY แบบอเมริกัน', () => {
    // จุดที่เคยทำให้ข้อมูลที่นำเข้าแล้วเสียหาย (BBL import #8) — วันที่ <= 12 คือกลุ่มเสี่ยง
    expect(toISODate('05/08/2026')).toBe('2026-08-05');
    expect(toISODate('12/01/2026')).toBe('2026-01-12');
    expect(toISODate('31/08/2026')).toBe('2026-08-31');
  });

  it('อ่าน DD-MM-YYYY ได้เหมือนกัน', () => {
    expect(toISODate('17-08-2026')).toBe('2026-08-17');
  });

  it('อ่าน ISO ที่ไม่กำกวมได้ทั้งขีดและทับ', () => {
    expect(toISODate('2026-08-17')).toBe('2026-08-17');
    expect(toISODate('2026/08/17')).toBe('2026-08-17');
    expect(toISODate('2026-08-17T09:30:00')).toBe('2026-08-17');
  });

  it('แปลงปี พ.ศ. เป็น ค.ศ. ให้อัตโนมัติ', () => {
    expect(toISODate('17/08/2569')).toBe('2026-08-17');
  });

  it('อ่าน Date object จากไฟล์ .xlsx ได้', () => {
    expect(toISODate(new Date(2026, 7, 17))).toBe('2026-08-17');
  });

  it('อ่าน Excel serial number ดิบได้ (ฐาน 1899-12-30)', () => {
    expect(toISODate(46251)).toBe('2026-08-17');
    expect(toISODate(46266)).toBe('2026-09-01');
  });

  it('ปฏิเสธ serial ต่ำๆ ที่ค่าชดเชยปีอธิกสุรทิน 1900 ของ Excel ยังใช้ไม่ได้', () => {
    // ฐาน 1899-12-30 ให้ serial 1 = 1899-12-31 (Excel เองถือว่าเป็น 1900-01-01)
    // ค่าชดเชยนี้ถูกต้องตั้งแต่ serial 61 ขึ้นไป — ตัวกันปี < 1900 ตัดช่วงที่เพี้ยนทิ้งให้อยู่แล้ว
    // ไฟล์ statement จริงไม่มีวันที่ยุคนั้น จึงไม่กระทบการนำเข้า
    expect(toISODate(1)).toBeNull();
  });

  it('คืน null แทนที่จะเดา เมื่อแกะวันที่ไม่ได้', () => {
    expect(toISODate('31/02/2026')).toBeNull();
    expect(toISODate('17/13/2026')).toBeNull();
    expect(toISODate('ยอดยกมา')).toBeNull();
    expect(toISODate('')).toBeNull();
    expect(toISODate(null)).toBeNull();
    expect(toISODate(undefined)).toBeNull();
    expect(toISODate(new Date('ไม่ใช่วันที่'))).toBeNull();
  });

  it('คืน null เมื่อ serial number อยู่นอกช่วงที่เป็นไปได้', () => {
    expect(toISODate(0)).toBeNull();
    expect(toISODate(-5)).toBeNull();
    expect(toISODate(100001)).toBeNull();
  });
});

describe('toNumber — แปลงยอดเงินจากไฟล์', () => {
  it('ตัด comma คั่นหลักพันออก รวมถึงค่าติดลบ', () => {
    expect(toNumber('3,562,505.84')).toBe(3562505.84);
    expect(toNumber('-3,562,505.84')).toBe(-3562505.84);
  });

  it('ส่งตัวเลขมาตรงๆ ก็รับ', () => {
    expect(toNumber(1117.76)).toBe(1117.76);
    expect(toNumber(0)).toBe(0);
  });

  it('คืน null เมื่อไม่มีค่า หรือแปลงเป็นตัวเลขไม่ได้', () => {
    expect(toNumber('')).toBeNull();
    expect(toNumber('   ')).toBeNull();
    expect(toNumber(null)).toBeNull();
    expect(toNumber(undefined)).toBeNull();
    expect(toNumber('ไม่ใช่ตัวเลข')).toBeNull();
  });
});

describe('findColumnIndex — หาคอลัมน์จากหัวตาราง', () => {
  const header = ['Tran Date', 'Value  Date', 'DESCRIPTION', 'Cheque No.'];

  it('ไม่สนตัวพิมพ์เล็กใหญ่ และช่องว่างส่วนเกิน', () => {
    expect(findColumnIndex(header, 'tran date')).toBe(0);
    expect(findColumnIndex(header, 'Value Date')).toBe(1);
    expect(findColumnIndex(header, 'Description')).toBe(2);
  });

  it('คืน -1 เมื่อไม่มีคอลัมน์นั้น', () => {
    expect(findColumnIndex(header, 'Balance')).toBe(-1);
  });
});

describe('parseBankStatement — BBL', () => {
  const header = ['Tran Date', 'Description', 'Tran Code', 'Cheque No.', 'Debit', 'Credit', 'Balance', 'Channel'];

  it('อ่านรายการตามหัวตาราง และหาช่วงวันที่ของไฟล์', () => {
    const result = parseBankStatement('BBL', [
      header,
      ['01/08/2026', 'BBL.CARD', 'TR', '', '', '3,000.00', '107,575.86', 'ATM'],
      ['17/08/2026', 'TRANSFER OUT', 'TR', '00123', '1,117.76', '', '106,458.10', 'BAHTNET'],
    ]);

    expect(result.bankCode).toBe('BBL');
    expect(result.periodStart).toBe('2026-08-01');
    expect(result.periodEnd).toBe('2026-08-17');
    expect(result.lines).toEqual([
      {
        tranDate: '2026-08-01',
        description: 'BBL.CARD',
        debit: null,
        credit: 3000,
        balance: 107575.86,
        chequeNo: null,
        channel: 'ATM',
        rawDescription: 'BBL.CARD',
      },
      {
        tranDate: '2026-08-17',
        description: 'TRANSFER OUT',
        debit: 1117.76,
        credit: null,
        balance: 106458.1,
        chequeNo: '00123',
        channel: 'BAHTNET',
        rawDescription: 'TRANSFER OUT',
      },
    ]);
  });

  it('ข้ามแถวว่างและแถวสรุปท้ายไฟล์ที่ไม่มีวันที่', () => {
    const result = parseBankStatement('BBL', [
      header,
      ['01/08/2026', 'BBL.CARD', 'TR', '', '', '3,000.00', '107,575.86', 'ATM'],
      [],
      ['', 'TOTAL', '', '', '1,117.76', '3,000.00', '', ''],
    ]);

    expect(result.lines).toHaveLength(1);
  });

  it('โยน error เมื่อโครงสร้างไฟล์เปลี่ยนจนหาคอลัมน์ไม่เจอ', () => {
    expect(() => parseBankStatement('BBL', [['Tran Date', 'Description']])).toThrow(/ไม่พบคอลัมน์ในไฟล์ BBL/);
  });

  it('ไฟล์ที่ไม่มีรายการเลย ช่วงวันที่เป็น null', () => {
    const result = parseBankStatement('BBL', [header]);

    expect(result.lines).toEqual([]);
    expect(result.periodStart).toBeNull();
    expect(result.periodEnd).toBeNull();
  });
});

describe('parseBankStatement — SCB', () => {
  const header = [
    'Date', 'Time', 'Tr Description', 'Channel', 'Cheque No.',
    'Withdrawal', 'Deposit', 'Outstanding Balance', 'Description',
  ];

  it('แปลง Withdrawal เป็นเงินออก และ Deposit เป็นเงินเข้า', () => {
    const result = parseBankStatement('SCB', [
      header,
      ['05/08/2026', '09:30', 'โอนเงิน', 'MOBILE', '', '500.69', '', '-3,562,505.84', 'รายละเอียดเพิ่มเติม'],
    ]);

    expect(result.bankCode).toBe('SCB');
    expect(result.lines[0]).toEqual({
      tranDate: '2026-08-05',
      description: 'โอนเงิน',
      debit: 500.69,
      credit: null,
      balance: -3562505.84,
      chequeNo: null,
      channel: 'MOBILE',
      rawDescription: 'รายละเอียดเพิ่มเติม',
    });
  });

  it('โยน error เมื่อขาดคอลัมน์ที่จำเป็น', () => {
    expect(() => parseBankStatement('SCB', [['Date', 'Tr Description']])).toThrow(/ไม่พบคอลัมน์ในไฟล์ SCB/);
  });
});

describe('parseBankStatement — KBank', () => {
  const header = ['วันที่', 'เวลา', 'รายการ', 'ถอนเงิน', 'ฝากเงิน', 'ยอดคงเหลือ', 'ช่องทาง', 'รายละเอียด'];

  it('หาหัวตารางแบบ dynamic เผื่อมีแถวว่างนำหน้า', () => {
    const result = parseBankStatement('KBANK', [
      [],
      ['รายงานเดินบัญชี', '', '', '', '', '', '', ''],
      header,
      ['01/08/2026', '09:00', 'โอนเข้า', '', '1,000.00', '11,000.00', 'K PLUS', 'จาก บ.ก'],
    ]);

    expect(result.bankCode).toBe('KBANK');
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].credit).toBe(1000);
    expect(result.lines[0].chequeNo).toBeNull();
  });

  it('ข้ามแถว "ยอดยกมา" ซึ่งไม่ใช่ธุรกรรมจริง', () => {
    const result = parseBankStatement('KBANK', [
      header,
      ['01/08/2026', '', 'ยอดยกมา', '', '', '10,000.00', '', ''],
      ['01/08/2026', '09:00', 'โอนเข้า', '', '1,000.00', '11,000.00', 'K PLUS', ''],
    ]);

    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].description).toBe('โอนเข้า');
  });

  it('โยน error เมื่อหาหัวตารางไม่เจอ', () => {
    expect(() => parseBankStatement('KBANK', [['a', 'b'], ['c', 'd']])).toThrow(/ไม่พบหัวตารางในไฟล์ KBank/);
  });
});

describe('parseBankStatement — ธนาคารที่ไม่รองรับ', () => {
  it('โยน error พร้อมบอกรหัสธนาคาร', () => {
    // @ts-expect-error จงใจส่งธนาคารนอกรายการเพื่อตรวจการป้องกันตอน runtime
    expect(() => parseBankStatement('KTB', [[]])).toThrow('ไม่รองรับธนาคาร: KTB');
  });
});
