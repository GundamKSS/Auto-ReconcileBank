import { describe, it, expect } from 'vitest';
import {
  findReversalPairs,
  splitReversalPairs,
  offsetGroupProblem,
  isReversalSource,
  type OffsetCandidate,
} from '../lib/glOffset';

const entry = (o: Partial<OffsetCandidate> & { entryNo: number; signedAmount: number }): OffsetCandidate => ({
  accountNo: 'TW_BBL_C1',
  documentNo: 'PVD2608-0086',
  sourceCode: null,
  ...o,
});

describe('isReversalSource', () => {
  it('รู้จักแถวกลับรายการโดยไม่สนตัวพิมพ์และช่องว่าง', () => {
    expect(isReversalSource('REVERSAL')).toBe(true);
    expect(isReversalSource(' reversal ')).toBe(true);
  });

  it('แถวปกติไม่ใช่การกลับรายการ', () => {
    expect(isReversalSource('PURCHASES')).toBe(false);
    expect(isReversalSource(null)).toBe(false);
    expect(isReversalSource(undefined)).toBe(false);
  });
});

describe('findReversalPairs — จับคู่แถวกลับรายการกับใบเดิม', () => {
  it('จับคู่เมื่อบัญชีเดียวกัน เลขเอกสารเดียวกัน ยอดตรงข้ามกันพอดี (เคสจริง PVD2608-0086)', () => {
    const pairs = findReversalPairs([
      entry({ entryNo: 100, signedAmount: -1117.76 }),
      entry({ entryNo: 101, signedAmount: 1117.76, sourceCode: 'REVERSAL' }),
    ]);

    expect(pairs).toEqual([{ originalEntryNo: 100, reversalEntryNo: 101 }]);
  });

  it('ไม่จับคู่ข้ามเลขเอกสาร แม้ยอดจะตรงข้ามกันพอดี', () => {
    // เคสจริง BBL 31/08: CAV2608-0011 เข้า 20,000 เป็นเงินเข้าธนาคารจริง
    // ยอด/วันตรงกับ GEN-P26-0010 (ออก) แต่ห้ามหักล้างกันเอง
    const pairs = findReversalPairs([
      entry({ entryNo: 200, documentNo: 'GEN-P26-0010', signedAmount: -20000 }),
      entry({ entryNo: 201, documentNo: 'CAV2608-0011', signedAmount: 20000, sourceCode: 'REVERSAL' }),
    ]);

    expect(pairs).toEqual([]);
  });

  it('ไม่จับคู่ข้ามบัญชีธนาคาร', () => {
    const pairs = findReversalPairs([
      entry({ entryNo: 300, accountNo: 'TW_BBL_C1', signedAmount: -500 }),
      entry({ entryNo: 301, accountNo: 'TW_SCB_C1', signedAmount: 500, sourceCode: 'REVERSAL' }),
    ]);

    expect(pairs).toEqual([]);
  });

  it('ไม่จับคู่เมื่อยอดไม่ตรงข้ามกันพอดี', () => {
    const pairs = findReversalPairs([
      entry({ entryNo: 400, signedAmount: -500 }),
      entry({ entryNo: 401, signedAmount: 499.99, sourceCode: 'REVERSAL' }),
    ]);

    expect(pairs).toEqual([]);
  });

  it('ข้ามแถวที่ไม่มีเลขเอกสาร และแถวยอด 0 บาท', () => {
    const noDoc = findReversalPairs([
      entry({ entryNo: 500, documentNo: null, signedAmount: -500 }),
      entry({ entryNo: 501, documentNo: null, signedAmount: 500, sourceCode: 'REVERSAL' }),
    ]);
    const zero = findReversalPairs([
      entry({ entryNo: 600, signedAmount: 0 }),
      entry({ entryNo: 601, signedAmount: 0, sourceCode: 'REVERSAL' }),
    ]);

    expect(noDoc).toEqual([]);
    expect(zero).toEqual([]);
  });

  it('เลือกใบเดิมที่บันทึกก่อนแถวกลับรายการ แม้จะมีใบที่ Entry_No ใกล้กว่าอยู่หลัง', () => {
    const pairs = findReversalPairs([
      entry({ entryNo: 10, signedAmount: -1117.76 }),
      entry({ entryNo: 20, signedAmount: 1117.76, sourceCode: 'REVERSAL' }),
      entry({ entryNo: 21, signedAmount: -1117.76 }),
    ]);

    expect(pairs).toEqual([{ originalEntryNo: 10, reversalEntryNo: 20 }]);
  });

  it('ใบเดิมหนึ่งใบถูกใช้จับคู่ได้ครั้งเดียว — กลับรายการ 2 ครั้งต้องมีใบเดิม 2 ใบ', () => {
    const pairs = findReversalPairs([
      entry({ entryNo: 1, signedAmount: -100 }),
      entry({ entryNo: 2, signedAmount: 100, sourceCode: 'REVERSAL' }),
      entry({ entryNo: 3, signedAmount: 100, sourceCode: 'REVERSAL' }),
    ]);

    expect(pairs).toEqual([{ originalEntryNo: 1, reversalEntryNo: 2 }]);
  });

  it('แถวกลับรายการที่หาคู่ไม่ได้ ไม่ถูกเดาให้', () => {
    const pairs = findReversalPairs([entry({ entryNo: 700, signedAmount: 100, sourceCode: 'REVERSAL' })]);

    expect(pairs).toEqual([]);
  });
});

describe('splitReversalPairs — แยกคู่กลับรายการออกจากรายการทั้งหมด', () => {
  it('คืนคู่ที่เจอ และ rest คงลำดับเดิมไว้ (การติ๊กอัตโนมัติขึ้นกับลำดับรายการ)', () => {
    const items = [
      { id: 'a', e: entry({ entryNo: 1, signedAmount: -100 }) },
      { id: 'b', e: entry({ entryNo: 2, documentNo: 'PVD2608-0132', signedAmount: -250 }) },
      { id: 'c', e: entry({ entryNo: 3, signedAmount: 100, sourceCode: 'REVERSAL' }) },
      { id: 'd', e: entry({ entryNo: 4, documentNo: 'CAV2608-0011', signedAmount: 20000 }) },
    ];

    const { pairs, rest } = splitReversalPairs(items, (i) => i.e);

    expect(pairs).toHaveLength(1);
    expect(pairs[0].original.id).toBe('a');
    expect(pairs[0].reversal.id).toBe('c');
    expect(rest.map((r) => r.id)).toEqual(['b', 'd']);
  });

  it('ไม่มีคู่เลย → rest คือรายการทั้งหมดตามเดิม', () => {
    const items = [entry({ entryNo: 1, signedAmount: -100 }), entry({ entryNo: 2, signedAmount: -200 })];

    const { pairs, rest } = splitReversalPairs(items, (i) => i);

    expect(pairs).toEqual([]);
    expect(rest).toEqual(items);
  });
});

describe('offsetGroupProblem — เหตุผลที่กลุ่ม GL ยังหักล้างกันเองไม่ได้', () => {
  it('ผ่านเมื่อขาเข้ากับขาออกหักกันลงตัวพอดี', () => {
    expect(offsetGroupProblem([1117.76, -1117.76])).toBeNull();
    expect(offsetGroupProblem([1000, 117.76, -1117.76])).toBeNull();
  });

  it('ไม่ผ่านเมื่อเลือกมาทางเดียว', () => {
    const msg = 'ต้องเลือกทั้งรายการขาเข้า (IN) และขาออก (OUT) อย่างน้อยฝั่งละ 1 รายการ';

    expect(offsetGroupProblem([100, 200])).toBe(msg);
    expect(offsetGroupProblem([-100, -200])).toBe(msg);
    expect(offsetGroupProblem([])).toBe(msg);
  });

  it('ไม่ผ่านเมื่อมีรายการยอด 0 บาทปนมา', () => {
    expect(offsetGroupProblem([100, -100, 0])).toBe('มีรายการยอด 0 บาท หักล้างไม่ได้');
  });

  it('บอกยอดที่ยังต่างกันเมื่อหักกันไม่ลงตัว', () => {
    expect(offsetGroupProblem([1000, -999.44])).toBe(
      'ยอดขาเข้ากับขาออกยังต่างกัน 0.56 — ต้องเท่ากันพอดีจึงหักล้างได้'
    );
  });

  it('ยอมรับเศษ floating point ที่เล็กกว่าครึ่งสตางค์', () => {
    expect(offsetGroupProblem([0.1, 0.2, -0.3])).toBeNull();
  });
});
