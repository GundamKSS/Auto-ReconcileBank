import { describe, it, expect } from 'vitest';
import {
  sideLabelOf,
  suspenseBalanceParts,
  toUnifiedLines,
  visibleLines,
  type MatchRecord,
  type RawGlLine,
} from '../app/suspense/components/suspenseModel';

function gl(entryNo: number, direction: 'IN' | 'OUT', amount: number, num = 1): RawGlLine {
  return { entryNo, num, date: '2026-08-11', ref: `PV${entryNo}`, accountName: 'TW_BBL_C1', direction, amount };
}

function lineSuspense(glLines: RawGlLine[]): MatchRecord {
  return {
    matchId: 10,
    bankCode: 'BBL',
    matchType: 'SUSPENSE',
    suspenseKind: 'LINE',
    createdBy: 'tester',
    createdAt: '2026-09-15T04:12:00.000Z',
    bankLines: [],
    glLines,
  };
}

// พักส่วนต่าง = คู่ที่จับไว้แล้วแต่ยอดสองฝั่งไม่เท่ากัน (MATCHED + หมายเหตุ)
function differenceSuspense(): MatchRecord {
  return {
    matchId: 20,
    bankCode: 'BBL',
    matchType: 'MATCHED',
    suspenseKind: 'DIFFERENCE',
    suspenseDifference: 100,
    suspenseDirection: 'IN',
    remark: 'ค่าธรรมเนียมธนาคารยังไม่ลงบัญชี',
    createdBy: 'tester',
    createdAt: '2026-09-15T04:12:00.000Z',
    bankLines: [{ lineId: 1, num: 1, date: '2026-08-11', description: 'SMART', direction: 'IN', amount: 1100 }],
    glLines: [gl(99, 'IN', 1000)],
  };
}

describe('visibleLines', () => {
  it('แท็บทั้งหมด = เห็นทุกบรรทัด', () => {
    const match = lineSuspense([gl(1, 'IN', 500), gl(2, 'OUT', 300)]);
    expect(visibleLines(match, 'ALL')).toHaveLength(2);
  });

  it('แท็บฝั่งรับ/จ่าย = เห็นเฉพาะบรรทัดของฝั่งนั้น', () => {
    const match = lineSuspense([gl(1, 'IN', 500), gl(2, 'OUT', 300), gl(3, 'IN', 20)]);

    const incoming = visibleLines(match, 'IN');
    expect(incoming.map((l) => l.refId)).toEqual([1, 3]);
    expect(incoming.every((l) => l.direction === 'IN')).toBe(true);

    const outgoing = visibleLines(match, 'OUT');
    expect(outgoing.map((l) => l.refId)).toEqual([2]);
  });

  it('Match ที่พักไว้ทั้งสองทิศโผล่ทั้งสองแท็บ แต่คนละบรรทัดกัน — คืนฝั่งรับต้องไม่ลากฝั่งจ่ายไปด้วย', () => {
    const match = lineSuspense([gl(1, 'IN', 500), gl(2, 'OUT', 300)]);
    const inKeys = visibleLines(match, 'IN').map((l) => l.key);
    const outKeys = visibleLines(match, 'OUT').map((l) => l.key);

    expect(inKeys.length).toBe(1);
    expect(outKeys.length).toBe(1);
    expect(inKeys.some((k) => outKeys.includes(k))).toBe(false);
    expect([...inKeys, ...outKeys].sort()).toEqual(toUnifiedLines(match).map((l) => l.key).sort());
  });

  it('พักส่วนต่างเห็นครบทั้งสองฝั่งเสมอ ไม่ว่าอยู่แท็บไหน — ต้องเทียบ Bank กับ BC ได้', () => {
    const match = differenceSuspense();
    expect(visibleLines(match, 'ALL')).toHaveLength(2);
    expect(visibleLines(match, 'IN')).toHaveLength(2);
    expect(visibleLines(match, 'OUT')).toHaveLength(2);
  });
});

describe('sideLabelOf', () => {
  it('ป้ายอ่านจากบรรทัดที่แสดงอยู่จริง', () => {
    const match = lineSuspense([gl(1, 'IN', 500), gl(2, 'OUT', 300)]);

    expect(sideLabelOf(visibleLines(match, 'ALL')).label).toBe('รับ + จ่าย');
    expect(sideLabelOf(visibleLines(match, 'IN')).label).toBe('รับ');
    expect(sideLabelOf(visibleLines(match, 'OUT')).label).toBe('จ่าย');
    expect(sideLabelOf([]).label).toBeNull();
  });
});

describe('suspenseBalanceParts', () => {
  function balance(glSuspenseNet: number, suspenseDifference: number, difference: number) {
    return { difference, breakdown: { glSuspense: { net: glSuspenseNet }, suspenseDifference } };
  }

  it('ยังไม่มีข้อมูลยอดคงเหลือ = ว่างทุกช่อง ไม่ใช่ 0', () => {
    expect(suspenseBalanceParts(null)).toEqual({ difference: null, explained: null, rest: null });
    expect(suspenseBalanceParts(balance(0, 0, null as unknown as number))).toEqual({
      difference: null,
      explained: null,
      rest: null,
    });
  });

  it('พักทั้งรายการเข้าสูตรด้วยเครื่องหมายลบ ส่วนพักส่วนต่างเข้าด้วยเครื่องหมายบวก', () => {
    // BC พักไว้ขาออก 50,000 (net −50,000 ตามทิศทาง BC) → อธิบายยอดพักโอนได้ +50,000
    expect(suspenseBalanceParts(balance(-50000, 0, 50000)).explained).toBe(50000);
    expect(suspenseBalanceParts(balance(0, 1234.56, 1234.56)).explained).toBe(1234.56);
  });

  it('อธิบายด้วยรายการในหน้านี้ + ส่วนที่เหลือ = ยอดพักโอนปลายงวดเสมอ', () => {
    const cases = [
      balance(-50000, 1234.56, 261685.82),
      balance(12000.5, 0, -3000),
      balance(0, 0, 0),
    ];
    for (const b of cases) {
      const parts = suspenseBalanceParts(b);
      expect(parts.explained! + parts.rest!).toBeCloseTo(parts.difference!, 2);
    }
  });

  it('ปัดทศนิยม 2 ตำแหน่ง ไม่ปล่อยเศษ floating point ออกหน้าจอ', () => {
    const parts = suspenseBalanceParts(balance(-0.1, 0.2, 0.3));
    expect(parts.explained).toBe(0.3);
    expect(parts.rest).toBe(0);
  });
});
