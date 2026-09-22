import { describe, it, expect } from 'vitest';
import {
  cleanAccountName,
  offsetKind,
  splitByDirection,
  summarizeGroups,
  toSubGroups,
  type LineItem,
  type MatchRecord,
} from '../app/reconcile/history/components/historyModel';

function line(partial: Partial<LineItem> & Pick<LineItem, 'num' | 'direction' | 'amount'>): LineItem {
  return {
    date: '2026-08-11',
    status: 'ACTIVE',
    reversedAt: null,
    reversedBy: null,
    reversedReason: null,
    ...partial,
  };
}

function match(partial: Partial<MatchRecord>): MatchRecord {
  return {
    matchId: 1,
    bankCode: 'BBL',
    matchType: 'MATCHED',
    createdBy: 'tester',
    createdAt: '2026-09-15T04:12:00.000Z',
    status: 'ACTIVE',
    reversedAt: null,
    reversedBy: null,
    reversedReason: null,
    remark: null,
    bankLines: [],
    glLines: [],
    ...partial,
  };
}

describe('toSubGroups — แตก Match เป็นกลุ่มย่อยตาม Num', () => {
  it('จับบรรทัดสองฝั่งที่ Num เดียวกันเข้ากลุ่มเดียว และเรียงตามเลขกลุ่ม', () => {
    const groups = toSubGroups(
      match({
        bankLines: [
          line({ num: 2, direction: 'OUT', amount: 200, lineId: 2 }),
          line({ num: 1, direction: 'OUT', amount: 100, lineId: 1 }),
        ],
        glLines: [line({ num: 1, direction: 'OUT', amount: 100, entryNo: 11 })],
      })
    );

    expect(groups.map((g) => g.num)).toEqual([1, 2]);
    expect(groups[0].bankLines).toHaveLength(1);
    expect(groups[0].glLines).toHaveLength(1);
    expect(groups[1].glLines).toHaveLength(0);
  });

  it('รวมยอดแต่ละฝั่งของกลุ่มแบบ N:1 ได้ถูกต้อง', () => {
    const [group] = toSubGroups(
      match({
        bankLines: [
          line({ num: 1, direction: 'OUT', amount: 31200, lineId: 1 }),
          line({ num: 1, direction: 'OUT', amount: 18800, lineId: 2 }),
        ],
        glLines: [line({ num: 1, direction: 'OUT', amount: 50000, entryNo: 11 })],
      })
    );

    expect(group.bankTotal).toBe(50000);
    expect(group.glTotal).toBe(50000);
    expect(group.status).toBe('ACTIVE');
  });

  it('กลุ่มถือว่ายกเลิกก็ต่อเมื่อทุกบรรทัดในกลุ่มถูกยกเลิก', () => {
    const groups = toSubGroups(
      match({
        bankLines: [
          line({ num: 1, direction: 'IN', amount: 5000, lineId: 1 }),
          line({ num: 2, direction: 'IN', amount: 7000, lineId: 2, status: 'REVERSED' }),
        ],
        glLines: [
          line({ num: 1, direction: 'IN', amount: 5000, entryNo: 11 }),
          line({ num: 2, direction: 'IN', amount: 7000, entryNo: 12, status: 'REVERSED' }),
        ],
      })
    );

    expect(groups[0].status).toBe('ACTIVE');
    expect(groups[1].status).toBe('REVERSED');
  });

  it('ข้อมูลเก่าที่ยกเลิกไว้ที่หัว Match อย่างเดียว ยังต้องอ่านได้ว่ายกเลิกทั้งใบ', () => {
    const groups = toSubGroups(
      match({
        status: 'REVERSED',
        reversedBy: 'somchai',
        reversedReason: 'จับคู่ผิดใบ',
        bankLines: [line({ num: 1, direction: 'IN', amount: 5000, lineId: 1 })],
        glLines: [line({ num: 1, direction: 'IN', amount: 5000, entryNo: 11 })],
      })
    );

    expect(groups[0].status).toBe('REVERSED');
    expect(groups[0].reversedBy).toBe('somchai');
    expect(groups[0].reversedReason).toBe('จับคู่ผิดใบ');
  });
});

describe('summarizeGroups — ยอดสรุปบนหัวการ์ด', () => {
  it('ส่วนต่างคิดแบบไม่ติดทิศทาง ให้ตรงกับยอดพักโอนที่ server บันทึกไว้', () => {
    // เคสจริง PVDยี้2608-0066: Bank จ่ายออก 649,469.00 แต่ BC ลง 649,469.56 → พักโอน −0.56
    const groups = toSubGroups(
      match({
        bankLines: [line({ num: 1, direction: 'OUT', amount: 649469, lineId: 1 })],
        glLines: [line({ num: 1, direction: 'OUT', amount: 649469.56, entryNo: 11 })],
      })
    );

    expect(summarizeGroups(groups).difference).toBe(-0.56);
  });

  it('ยอดสุทธิของกลุ่มที่มีทั้งเข้าและออกหักกันก่อนเทียบ', () => {
    const groups = toSubGroups(
      match({
        bankLines: [
          line({ num: 1, direction: 'IN', amount: 10000, lineId: 1 }),
          line({ num: 1, direction: 'OUT', amount: 4000, lineId: 2 }),
        ],
        glLines: [line({ num: 1, direction: 'IN', amount: 6000, entryNo: 11 })],
      })
    );
    const summary = summarizeGroups(groups);

    expect(summary.bankSigned).toBe(6000);
    expect(summary.bankTotal).toBe(14000);
    expect(summary.difference).toBe(0);
  });

  it('ไม่มีกลุ่มเลยได้ยอด 0 ไม่ใช่ NaN', () => {
    const summary = summarizeGroups([]);
    expect(summary.bankTotal).toBe(0);
    expect(summary.difference).toBe(0);
  });
});

describe('splitByDirection — แยกขาเข้า/ขาออกของรายการ BC ล้วน', () => {
  it('แยกและรวมยอดแต่ละขาแยกกัน', () => {
    const { inLines, outLines, inTotal, outTotal } = splitByDirection([
      line({ num: 1, direction: 'IN', amount: 9800, entryNo: 1 }),
      line({ num: 1, direction: 'OUT', amount: 87400.25, entryNo: 2 }),
      line({ num: 1, direction: 'OUT', amount: 12500, entryNo: 3 }),
    ]);

    expect(inLines).toHaveLength(1);
    expect(outLines).toHaveLength(2);
    expect(inTotal).toBe(9800);
    expect(outTotal).toBe(99900.25);
  });
});

describe('offsetKind — แยกกลับรายการใน BC ออกจากที่ผู้ใช้จับคู่เอง', () => {
  it('แถว REVERSAL ที่คู่กับใบเดิมเลขเอกสารเดียวกันครบทั้งกลุ่ม = ระบบเจอให้', () => {
    const kind = offsetKind([
      line({ num: 1, direction: 'OUT', amount: 1117.76, entryNo: 1, ref: 'PVD2608-0086', accountNo: 'TW_BBL_C1' }),
      line({
        num: 1,
        direction: 'IN',
        amount: 1117.76,
        entryNo: 2,
        ref: 'PVD2608-0086',
        accountNo: 'TW_BBL_C1',
        sourceCode: 'REVERSAL',
      }),
    ]);
    expect(kind).toBe('REVERSAL');
  });

  it('แก้ด้วย JV คนละเลขเอกสาร = ผู้ใช้จับคู่เอง', () => {
    const kind = offsetKind([
      line({ num: 1, direction: 'OUT', amount: 20000, entryNo: 1, ref: 'GEN-P26-0010', accountNo: 'TW_BBL_C1' }),
      line({ num: 1, direction: 'IN', amount: 20000, entryNo: 2, ref: 'JV2608-0004', accountNo: 'TW_BBL_C1' }),
    ]);
    expect(kind).toBe('MANUAL');
  });
});

describe('cleanAccountName — ตัด #เลขบัญชี ท้ายชื่อบัญชีของ BC365', () => {
  it('ตัดเลขบัญชีท้ายชื่อออก', () => {
    expect(cleanAccountName('TRW กระแสรายวัน BBL สีลม #150-3074633')).toBe('TRW กระแสรายวัน BBL สีลม');
  });

  it('ชื่อที่ไม่มีเลขบัญชีคงเดิม และค่าว่างได้สตริงว่าง', () => {
    expect(cleanAccountName('TW_BBL_C1')).toBe('TW_BBL_C1');
    expect(cleanAccountName(null)).toBe('');
    expect(cleanAccountName(undefined)).toBe('');
  });
});
