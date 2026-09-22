import { describe, it, expect } from 'vitest';
import { statementBalance, type BalanceLine } from '../lib/bankBalance';

const line = (o: Partial<BalanceLine> & { lineId: number }): BalanceLine => ({
  date: '2026-08-01',
  signed: 0,
  balance: null,
  ...o,
});

describe('statementBalance — ยอดยกมา/ยอดคงเหลือ', () => {
  it('ยอดยกมา = Balance บรรทัดแรก ลบยอดเคลื่อนไหวของบรรทัดนั้น (เคสจริง BBL ส.ค. 2026)', () => {
    // บรรทัดแรก BBL.CARD รับ 3,000 Balance 107,575.86 → ยกมา 104,575.86 ตรงกับกระดาษทีมบัญชี
    const result = statementBalance([
      line({ lineId: 1, date: '2026-08-01', signed: 3000, balance: 107575.86 }),
      line({ lineId: 2, date: '2026-08-02', signed: -575.86, balance: 107000 }),
    ]);

    expect(result.opening).toBe(104575.86);
    expect(result.closing).toBe(107000);
    expect(result.chainOk).toBe(true);
  });

  it('เรียงบรรทัดในวันเดียวกันใหม่ ถ้าลำดับ LineId มากไปน้อยคือลำดับที่ Balance ต่อกันได้', () => {
    // ไฟล์บางธนาคารเรียงรายการใหม่สุดขึ้นก่อน: ลำดับจริงคือ lineId 3 → 2 → 1
    const result = statementBalance([
      line({ lineId: 1, signed: 20, balance: 125 }),
      line({ lineId: 2, signed: -5, balance: 105 }),
      line({ lineId: 3, signed: 10, balance: 110 }),
    ]);

    expect(result.opening).toBe(100);
    expect(result.closing).toBe(125);
    expect(result.chainOk).toBe(true);
  });

  it('ติดธง chainOk = false เมื่อ Balance ต่อกันไม่ได้ไม่ว่าจะเรียงแบบไหน', () => {
    const result = statementBalance([
      line({ lineId: 1, signed: 10, balance: 110 }),
      line({ lineId: 2, signed: 10, balance: 999 }),
    ]);

    expect(result.chainOk).toBe(false);
    // ยังคืนค่าตามลำดับวันที่/LineId ให้หน้าจอแสดงพร้อมคำเตือน ไม่ใช่คืน null
    expect(result.opening).toBe(100);
  });

  it('ติดธง chainOk = false เมื่อมีบรรทัดที่ธนาคารไม่ส่ง Balance มา แม้บรรทัดที่เหลือจะต่อกันได้', () => {
    const result = statementBalance([
      line({ lineId: 1, signed: 10, balance: 110 }),
      line({ lineId: 2, signed: 5, balance: null }),
      line({ lineId: 3, signed: 20, balance: 130 }),
    ]);

    expect(result.chainOk).toBe(false);
    expect(result.opening).toBe(100);
    expect(result.closing).toBe(130);
  });

  it('เรียงข้ามวันตามวันที่ก่อนเสมอ แม้ LineId จะสลับ', () => {
    const result = statementBalance([
      line({ lineId: 99, date: '2026-08-02', signed: -50, balance: 50 }),
      line({ lineId: 1, date: '2026-08-01', signed: 100, balance: 100 }),
    ]);

    expect(result.opening).toBe(0);
    expect(result.closing).toBe(50);
    expect(result.chainOk).toBe(true);
  });

  it('เก็บยอดคงเหลือสิ้นวันของแต่ละวันไว้ใน closingByDate', () => {
    const result = statementBalance([
      line({ lineId: 1, date: '2026-08-01', signed: 100, balance: 100 }),
      line({ lineId: 2, date: '2026-08-01', signed: 50, balance: 150 }),
      line({ lineId: 3, date: '2026-08-03', signed: -30, balance: 120 }),
    ]);

    expect(result.closingByDate.get('2026-08-01')).toBe(150);
    expect(result.closingByDate.get('2026-08-03')).toBe(120);
    expect(result.closingByDate.has('2026-08-02')).toBe(false);
  });

  it('ปัดยอดยกมาเป็นทศนิยม 2 ตำแหน่ง ไม่ให้เศษ floating point หลุดออกไป', () => {
    const result = statementBalance([line({ lineId: 1, signed: 0.1, balance: 0.3 })]);

    expect(result.opening).toBe(0.2);
  });

  it('คืน null ทั้งหมดเมื่อไม่มีบรรทัดไหนมี Balance เลย', () => {
    const result = statementBalance([
      line({ lineId: 1, signed: 10 }),
      line({ lineId: 2, signed: 20 }),
    ]);

    expect(result).toEqual({ opening: null, closing: null, chainOk: false, closingByDate: new Map() });
  });

  it('คืน null ทั้งหมดเมื่อไม่มีบรรทัดเลย', () => {
    const result = statementBalance([]);

    expect(result.opening).toBeNull();
    expect(result.closing).toBeNull();
    expect(result.chainOk).toBe(false);
  });
});
