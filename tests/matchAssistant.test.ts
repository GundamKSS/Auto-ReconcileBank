import { describe, it, expect } from 'vitest';
import {
  confidenceLevel,
  findNearDateMatches,
  type AssistantBankLine,
  type AssistantGlLine,
} from '../lib/matchAssistant';

const bank = (o: Partial<AssistantBankLine> & { lineId: number; date: string; amount: number }): AssistantBankLine => ({
  direction: 'IN',
  description: '',
  ref: '',
  channel: null,
  ...o,
});

const gl = (o: Partial<AssistantGlLine> & { entryNo: number; date: string; amount: number }): AssistantGlLine => ({
  direction: 'IN',
  documentNo: 'CAV2608-0011',
  accountNo: 'TW_BBL_C1',
  accountName: null,
  ...o,
});

const run = (
  bankLines: AssistantBankLine[],
  glLines: AssistantGlLine[],
  windowDays = 7,
  periodFrom = '2026-08-01',
  periodTo = '2026-08-31'
) => findNearDateMatches({ bankLines, glLines, periodFrom, periodTo, windowDays });

describe('confidenceLevel', () => {
  it('แบ่งระดับที่ 75 และ 50', () => {
    expect(confidenceLevel(100)).toBe('high');
    expect(confidenceLevel(75)).toBe('high');
    expect(confidenceLevel(74)).toBe('medium');
    expect(confidenceLevel(50)).toBe('medium');
    expect(confidenceLevel(49)).toBe('low');
    expect(confidenceLevel(5)).toBe('low');
  });
});

describe('findNearDateMatches — คู่ข้ามวันแบบ 1:1', () => {
  it('เสนอคู่ที่ยอดตรงกันพอดีแต่ลงคนละวัน (เคสตัวอย่าง Bank 20/08 กับ GL 25/08 ยอด 500.69)', () => {
    const result = run(
      [bank({ lineId: 1, date: '2026-08-20', amount: 500.69 })],
      [gl({ entryNo: 10, date: '2026-08-25', amount: 500.69 })]
    );

    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0].kind).toBe('1:1');
    expect(result.suggestions[0].suggestedEntryNo).toBe(10);
    expect(result.suggestions[0].candidates[0].dayGap).toBe(5);
    expect(result.windowDays).toBe(7);
  });

  it('ไม่เสนอคู่ที่ลงวันเดียวกัน เพราะตารางติ๊กให้อยู่แล้ว', () => {
    const result = run(
      [bank({ lineId: 1, date: '2026-08-20', amount: 500.69 })],
      [gl({ entryNo: 10, date: '2026-08-20', amount: 500.69 })]
    );

    expect(result.suggestions).toEqual([]);
    expect(result.scannedBank).toBe(1);
    expect(result.explainedSameDay).toBe(1);
  });

  it('ไม่เสนอคู่ที่ห่างเกินหน้าต่างวันที่เลือกไว้', () => {
    const lines: [AssistantBankLine[], AssistantGlLine[]] = [
      [bank({ lineId: 1, date: '2026-08-05', amount: 500.69 })],
      [gl({ entryNo: 10, date: '2026-08-20', amount: 500.69 })],
    ];

    expect(run(...lines, 7).suggestions).toEqual([]);
    expect(run(...lines, 30).suggestions).toHaveLength(1);
  });

  it('แจ้งเตือนเมื่อพบรายการทิศทางเงินสวนกัน (บันทึกผิดฝั่ง / เดบิต-เครดิตสลับด้าน)', () => {
    const result = run(
      [bank({ lineId: 1, date: '2026-08-20', amount: 500.69, direction: 'IN' })],
      [gl({ entryNo: 10, date: '2026-08-22', amount: 500.69, direction: 'OUT' })]
    );

    expect(result.suggestions).toHaveLength(1);
    const cand = result.suggestions[0].candidates[0];
    expect(cand.crossDirection).toBe(true);
    expect(cand.reasons.some((r) => r.tone === 'warn' && r.text.includes('บันทึกผิดฝั่ง'))).toBe(true);
  });

  it('ไม่เสนอคู่ที่ยอดต่างกันแม้เพียงสตางค์เดียว', () => {
    const result = run(
      [bank({ lineId: 1, date: '2026-08-20', amount: 500.69 })],
      [gl({ entryNo: 10, date: '2026-08-22', amount: 500.7 })]
    );

    expect(result.suggestions).toEqual([]);
  });

  it('ยิ่งห่างวันยิ่งคะแนนต่ำลง', () => {
    const near = run(
      [bank({ lineId: 1, date: '2026-08-20', amount: 500.69 })],
      [gl({ entryNo: 10, date: '2026-08-21', amount: 500.69 })]
    );
    const far = run(
      [bank({ lineId: 1, date: '2026-08-20', amount: 500.69 })],
      [gl({ entryNo: 10, date: '2026-08-27', amount: 500.69 })]
    );

    expect(near.suggestions[0].candidates[0].score).toBeGreaterThan(far.suggestions[0].candidates[0].score);
  });

  it('หักคะแนนหนักเมื่อมี GL ยอดเท่ากันให้เลือกหลายตัว', () => {
    const only = run(
      [bank({ lineId: 1, date: '2026-08-20', amount: 500.69 })],
      [gl({ entryNo: 10, date: '2026-08-21', amount: 500.69 })]
    );
    const many = run(
      [bank({ lineId: 1, date: '2026-08-20', amount: 500.69 })],
      [
        gl({ entryNo: 10, date: '2026-08-21', amount: 500.69 }),
        gl({ entryNo: 11, date: '2026-08-22', amount: 500.69 }),
      ]
    );

    expect(confidenceLevel(only.suggestions[0].candidates[0].score)).toBe('high');
    expect(many.suggestions[0].candidates).toHaveLength(2);
    expect(many.suggestions[0].candidates[0].score).toBeLessThan(only.suggestions[0].candidates[0].score);
  });

  it('หักคะแนนยอดเล็กเลขกลมที่มักเป็นค่าธรรมเนียมซ้ำบ่อย', () => {
    const fee = run(
      [bank({ lineId: 1, date: '2026-08-20', amount: 10 })],
      [gl({ entryNo: 10, date: '2026-08-21', amount: 10 })]
    );
    const satang = run(
      [bank({ lineId: 1, date: '2026-08-20', amount: 10.5 })],
      [gl({ entryNo: 10, date: '2026-08-21', amount: 10.5 })]
    );

    expect(fee.suggestions[0].candidates[0].score).toBeLessThan(satang.suggestions[0].candidates[0].score);
    expect(fee.suggestions[0].candidates[0].reasons.map((r) => r.text)).toContain(
      'ยอดเล็กเลขกลม มักเป็นค่าธรรมเนียมที่ซ้ำบ่อย'
    );
  });

  it('นับวันทำการแบบข้ามเสาร์-อาทิตย์: ศุกร์ → จันทร์ ห่าง 3 วันแต่เป็น 1 วันทำการ', () => {
    // 2026-08-21 เป็นวันศุกร์, 2026-08-24 เป็นวันจันทร์
    const result = run(
      [bank({ lineId: 1, date: '2026-08-21', amount: 500.69 })],
      [gl({ entryNo: 10, date: '2026-08-24', amount: 500.69 })]
    );

    expect(result.suggestions[0].candidates[0].dayGap).toBe(3);
    expect(result.suggestions[0].candidates[0].businessDays).toBe(1);
  });

  it('ติดธง outsidePeriod เมื่อ GL ลงวันที่นอกงวด แต่ยังเสนอให้เลือกได้', () => {
    const result = run(
      [bank({ lineId: 1, date: '2026-08-31', amount: 500.69 })],
      [gl({ entryNo: 10, date: '2026-09-02', amount: 500.69 })]
    );

    expect(result.suggestions[0].candidates[0].outsidePeriod).toBe(true);
  });

  it('ไม่สร้างการ์ดให้ Bank นอกงวด แต่ยังนับเป็นคู่แข่งของ GL', () => {
    const result = run(
      [
        bank({ lineId: 1, date: '2026-08-02', amount: 500.69 }),
        bank({ lineId: 2, date: '2026-07-30', amount: 500.69 }),
      ],
      [gl({ entryNo: 10, date: '2026-08-04', amount: 500.69 })]
    );

    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0].banks[0].lineId).toBe(1);
    expect(result.suggestions[0].candidates[0].reasons.map((r) => r.text)).toContain(
      'GL นี้เข้าคู่กับ Bank รายการอื่นได้อีก 1 รายการ'
    );
    expect(result.scannedBank).toBe(1);
  });

  it('GL ตัวเดียวไม่ถูกแนะนำซ้ำ 2 การ์ด', () => {
    const result = run(
      [
        bank({ lineId: 1, date: '2026-08-20', amount: 500.69 }),
        bank({ lineId: 2, date: '2026-08-21', amount: 500.69 }),
      ],
      [gl({ entryNo: 10, date: '2026-08-22', amount: 500.69 })]
    );

    const suggested = result.suggestions.map((s) => s.suggestedEntryNo);
    expect(result.suggestions).toHaveLength(2);
    expect(suggested.filter((id) => id === 10)).toHaveLength(1);
    expect(suggested).toContain(null);
  });
});

describe('findNearDateMatches — คู่ข้ามวันแบบ N:1', () => {
  it('เสนอกลุ่ม Bank หลายรายการที่รวมกันเท่ากับ GL หนึ่งรายการ', () => {
    const result = run(
      [
        bank({ lineId: 1, date: '2026-08-20', amount: 300.25 }),
        bank({ lineId: 2, date: '2026-08-21', amount: 200.44 }),
      ],
      [gl({ entryNo: 10, date: '2026-08-23', amount: 500.69 })]
    );

    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0].kind).toBe('N:1');
    expect(result.suggestions[0].banks.map((b) => b.lineId).sort()).toEqual([1, 2]);
    expect(result.suggestions[0].suggestedEntryNo).toBe(10);
  });

  it('ให้สิทธิ์คู่ 1:1 ก่อน — GL ที่มีคู่ 1:1 อยู่แล้วไม่ถูกจับเป็นกลุ่ม', () => {
    const result = run(
      [
        bank({ lineId: 1, date: '2026-08-20', amount: 500.69 }),
        bank({ lineId: 2, date: '2026-08-21', amount: 300.25 }),
        bank({ lineId: 3, date: '2026-08-21', amount: 200.44 }),
      ],
      [gl({ entryNo: 10, date: '2026-08-23', amount: 500.69 })]
    );

    expect(result.suggestions.every((s) => s.kind === '1:1')).toBe(true);
  });

  it('ไม่นับเป็นกลุ่ม N:1 ถ้ามี Bank แค่รายการเดียวที่ยอดตรง (จะเข้า 1:1 แทน)', () => {
    const result = run(
      [bank({ lineId: 1, date: '2026-08-20', amount: 500.69 })],
      [gl({ entryNo: 10, date: '2026-08-23', amount: 500.69 })]
    );

    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0].kind).toBe('1:1');
  });
});

describe('findNearDateMatches — สรุปจำนวนที่สแกน', () => {
  it('นับเฉพาะ Bank ในงวด และบอกว่ากี่รายการที่จับกลุ่มวันเดียวกันได้อยู่แล้ว', () => {
    const result = run(
      [
        bank({ lineId: 1, date: '2026-08-20', amount: 500.69 }),
        bank({ lineId: 2, date: '2026-08-22', amount: 100.5 }),
        bank({ lineId: 3, date: '2026-07-31', amount: 999 }),
      ],
      [
        gl({ entryNo: 10, date: '2026-08-20', amount: 500.69 }),
        gl({ entryNo: 11, date: '2026-08-25', amount: 100.5 }),
      ]
    );

    expect(result.scannedBank).toBe(2);
    expect(result.explainedSameDay).toBe(1);
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0].banks[0].lineId).toBe(2);
  });

  it('ไม่มีข้อมูลก็ไม่พัง', () => {
    const result = run([], []);

    expect(result).toEqual({ windowDays: 7, suggestions: [], scannedBank: 0, explainedSameDay: 0 });
  });

  it('ใส่ข้อมูลผู้โอน (sender info) ใน candidate reasons เมื่อมี sender', () => {
    const result = run(
      [
        bank({
          lineId: 1,
          date: '2026-08-20',
          amount: 500.69,
          senderBank: 'KBANK',
          senderAccountNo: '139-8-XXX43-4',
          senderAccountName: 'บจก. จินหลง มอเตอร์',
        }),
      ],
      [gl({ entryNo: 10, date: '2026-08-25', amount: 500.69 })]
    );

    expect(result.suggestions).toHaveLength(1);
    const candidate = result.suggestions[0].candidates[0];
    const senderReason = candidate.reasons.find((r) => r.text.includes('ผู้โอน'));
    expect(senderReason).toBeDefined();
    expect(senderReason?.text).toContain('KBANK · 139-8-XXX43-4 · บจก. จินหลง มอเตอร์');
  });
});

describe('findNearDateMatches — ตรวจพบรายการอยู่ต่างบัญชี (Cross-Account)', () => {
  it('แจ้งเตือนเมื่อพบ GL ยอดตรงกันแต่อยู่คนละบัญชี แม้จะลงวันเดียวกันพอดี (dayGap = 0)', () => {
    const result = findNearDateMatches({
      bankLines: [
        bank({ lineId: 1, date: '2026-08-20', amount: 15420.75, accountNo: 'TW_KBANK_C1' }),
      ],
      glLines: [
        gl({
          entryNo: 99,
          date: '2026-08-20',
          amount: 15420.75,
          accountNo: 'TW_KBANK_S1',
          accountName: 'กสิกรไทย ออมทรัพย์',
          bankCode: 'KBANK',
        }),
      ],
      periodFrom: '2026-08-01',
      periodTo: '2026-08-31',
      windowDays: 7,
      bankAccountNo: 'TW_KBANK_C1',
    });

    expect(result.suggestions).toHaveLength(1);
    const candidate = result.suggestions[0].candidates[0];
    expect(candidate.crossAccount).toBe(true);
    expect(candidate.dayGap).toBe(0);
    expect(candidate.businessDays).toBe(0);
    expect(candidate.reasons.some((r) => r.text.includes('อยู่ต่างบัญชี'))).toBe(true);
    expect(candidate.reasons.some((r) => r.text.includes('ลงวันที่เดียวกันพอดี'))).toBe(true);
  });

  it('แจ้งเตือนเมื่อพบ GL ต่างบัญชีที่ลงคนละวัน (dayGap != 0)', () => {
    const result = findNearDateMatches({
      bankLines: [
        bank({ lineId: 1, date: '2026-08-20', amount: 15420.75, accountNo: 'TW_KBANK_C1' }),
      ],
      glLines: [
        gl({
          entryNo: 99,
          date: '2026-08-22',
          amount: 15420.75,
          accountNo: 'TW_SCB_C1',
          accountName: 'ไทยพาณิชย์ กระแสรายวัน',
          bankCode: 'SCB',
        }),
      ],
      periodFrom: '2026-08-01',
      periodTo: '2026-08-31',
      windowDays: 7,
      bankAccountNo: 'TW_KBANK_C1',
    });

    expect(result.suggestions).toHaveLength(1);
    const candidate = result.suggestions[0].candidates[0];
    expect(candidate.crossAccount).toBe(true);
    expect(candidate.dayGap).toBe(2);
    expect(candidate.reasons.some((r) => r.text.includes('SCB · TW_SCB_C1'))).toBe(true);
  });

  it('ไม่ดึง GL ต่างบัญชีมาเตือนมั่ว ถ้า GL นั้นมีคู่ Statement ของบัญชีตัวเองในวันเดียวกันอยู่แล้ว', () => {
    const result = findNearDateMatches({
      bankLines: [
        bank({ lineId: 1, date: '2026-08-20', amount: 500.69, accountNo: 'TW_KBANK_C1' }),
        // Statement ของบัญชี TW_SCB_C1 เองที่มีคู่ตรงกับ GL #99 ในวันเดียวกัน
        bank({ lineId: 2, date: '2026-08-20', amount: 500.69, accountNo: 'TW_SCB_C1' }),
      ],
      glLines: [
        gl({
          entryNo: 99,
          date: '2026-08-20',
          amount: 500.69,
          accountNo: 'TW_SCB_C1',
          bankCode: 'SCB',
        }),
      ],
      periodFrom: '2026-08-01',
      periodTo: '2026-08-31',
      windowDays: 7,
      bankAccountNo: 'TW_KBANK_C1',
    });

    expect(result.suggestions).toEqual([]);
    expect(result.scannedBank).toBe(1);
    expect(result.explainedSameDay).toBe(0);
  });

  it('จัดลำดับรายการในบัญชีเดียวกันขึ้นก่อนรายการต่างบัญชีเสมอ', () => {
    const result = findNearDateMatches({
      bankLines: [
        bank({ lineId: 1, date: '2026-08-20', amount: 888.25, accountNo: 'TW_KBANK_C1' }),
      ],
      glLines: [
        gl({ entryNo: 99, date: '2026-08-20', amount: 888.25, accountNo: 'TW_KBANK_S1' }),
        gl({ entryNo: 100, date: '2026-08-22', amount: 888.25, accountNo: 'TW_KBANK_C1' }),
      ],
      periodFrom: '2026-08-01',
      periodTo: '2026-08-31',
      windowDays: 7,
      bankAccountNo: 'TW_KBANK_C1',
    });

    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0].suggestedEntryNo).toBe(100);
    expect(result.suggestions[0].candidates[0].gl.entryNo).toBe(100);
    expect(result.suggestions[0].candidates[0].crossAccount).toBeUndefined();
    expect(result.suggestions[0].candidates[1].gl.entryNo).toBe(99);
    expect(result.suggestions[0].candidates[1].crossAccount).toBe(true);
  });
});

describe('findNearDateMatches — ตรวจพบรายการบันทึกผิดฝั่ง (Cross-Direction)', () => {
  it('ตรวจจับเมื่อ Bank เป็น OUT แต่ GL เป็น IN วันเดียวกันเป๊ะ (dayGap === 0)', () => {
    const result = findNearDateMatches({
      bankLines: [
        bank({ lineId: 1, date: '2026-08-20', amount: 12500, direction: 'OUT', accountNo: 'TW_BBL_C1' }),
      ],
      glLines: [
        gl({ entryNo: 50, date: '2026-08-20', amount: 12500, direction: 'IN', accountNo: 'TW_BBL_C1' }),
      ],
      periodFrom: '2026-08-01',
      periodTo: '2026-08-31',
      windowDays: 7,
      bankAccountNo: 'TW_BBL_C1',
      activeDirection: 'OUT',
    });

    expect(result.suggestions).toHaveLength(1);
    const cand = result.suggestions[0].candidates[0];
    expect(cand.crossDirection).toBe(true);
    expect(cand.dayGap).toBe(0);
    expect(cand.reasons.some((r) => r.tone === 'warn' && r.text.includes('บันทึกผิดฝั่ง'))).toBe(true);
    expect(cand.reasons.some((r) => r.text.includes('Statement เป็นเงินออก แต่ BC365 ลงเป็นเงินเข้า'))).toBe(true);
  });

  it('ตรวจจับเมื่อ Bank เป็น IN แต่ GL เป็น OUT คนละวัน (dayGap !== 0)', () => {
    const result = findNearDateMatches({
      bankLines: [
        bank({ lineId: 1, date: '2026-08-20', amount: 7700, direction: 'IN', accountNo: 'TW_BBL_C1' }),
      ],
      glLines: [
        gl({ entryNo: 55, date: '2026-08-22', amount: 7700, direction: 'OUT', accountNo: 'TW_BBL_C1' }),
      ],
      periodFrom: '2026-08-01',
      periodTo: '2026-08-31',
      windowDays: 7,
      bankAccountNo: 'TW_BBL_C1',
      activeDirection: 'IN',
    });

    expect(result.suggestions).toHaveLength(1);
    const cand = result.suggestions[0].candidates[0];
    expect(cand.crossDirection).toBe(true);
    expect(cand.dayGap).toBe(2);
    expect(cand.reasons.some((r) => r.text.includes('Statement เป็นเงินเข้า แต่ BC365 ลงเป็นเงินออก'))).toBe(true);
  });
});

describe('findNearDateMatches — ตรวจพบ Statement อยู่ต่างบัญชี (Cross-Account Bank Statement)', () => {
  it('ตรวจจับเมื่อ GL ในบัญชีที่เลือก มียอดตรงกับ Statement ในบัญชีอื่น', () => {
    const result = findNearDateMatches({
      bankLines: [
        // Statement อยู่ที่บัญชี TW_SCB_C1
        bank({ lineId: 99, date: '2026-08-21', amount: 35000, direction: 'IN', accountNo: 'TW_SCB_C1' }),
      ],
      glLines: [
        // GL บันทึกอยู่ที่บัญชี TW_BBL_C1 (บัญชีที่กำลังกระทบยอด)
        gl({ entryNo: 70, date: '2026-08-20', amount: 35000, direction: 'IN', accountNo: 'TW_BBL_C1' }),
      ],
      periodFrom: '2026-08-01',
      periodTo: '2026-08-31',
      windowDays: 7,
      bankAccountNo: 'TW_BBL_C1',
      activeDirection: 'IN',
    });

    expect(result.suggestions).toHaveLength(1);
    const s = result.suggestions[0];
    expect(s.crossAccountBank).toBe(true);
    expect(s.banks[0].accountNo).toBe('TW_SCB_C1');
    expect(s.candidates[0].gl.entryNo).toBe(70);
    expect(s.candidates[0].reasons.some((r) => r.tone === 'warn' && r.text.includes('Statement อยู่ต่างบัญชีธนาคาร'))).toBe(true);
  });
});

describe('findNearDateMatches — การจัดลำดับความสำคัญ (Prioritization)', () => {
  it('คู่ปกติ (จับคู่ได้) ต้องขึ้นก่อนรายการแจ้งเตือน (ต่างบัญชี / บันทึกผิดฝั่ง) เสมอ', () => {
    const result = findNearDateMatches({
      bankLines: [
        // Bank #1: มีคู่ปกติ
        bank({ lineId: 1, date: '2026-08-20', amount: 1000, direction: 'IN', accountNo: 'TW_BBL_C1' }),
        // Bank #2: มีคู่แต่บันทึกผิดฝั่ง
        bank({ lineId: 2, date: '2026-08-20', amount: 2000, direction: 'IN', accountNo: 'TW_BBL_C1' }),
      ],
      glLines: [
        // GL ผิดฝั่ง (ยอด 2000 แต่เป็น OUT) - วันเดียวกัน
        gl({ entryNo: 20, date: '2026-08-20', amount: 2000, direction: 'OUT', accountNo: 'TW_BBL_C1' }),
        // GL ปกติ (ยอด 1000 ฝั่ง IN) - คนละวัน (คะแนนต่ำกว่าเพราะห่างวัน แต่เป็นคู่ปกติ)
        gl({ entryNo: 10, date: '2026-08-24', amount: 1000, direction: 'IN', accountNo: 'TW_BBL_C1' }),
      ],
      periodFrom: '2026-08-01',
      periodTo: '2026-08-31',
      windowDays: 7,
      bankAccountNo: 'TW_BBL_C1',
      activeDirection: 'IN',
    });

    expect(result.suggestions).toHaveLength(2);
    // การ์ดแรกต้องเป็น Bank #1 (คู่ปกติ) แม้ว่า Bank #2 จะห่างวันน้อยกว่า (0 วัน)
    expect(result.suggestions[0].banks[0].lineId).toBe(1);
    expect(result.suggestions[0].candidates[0].crossDirection).toBeFalsy();
    // การ์ดสองเป็นการ์ดแจ้งเตือน (Bank #2 ผิดฝั่ง)
    expect(result.suggestions[1].banks[0].lineId).toBe(2);
    expect(result.suggestions[1].candidates[0].crossDirection).toBe(true);
  });
});
