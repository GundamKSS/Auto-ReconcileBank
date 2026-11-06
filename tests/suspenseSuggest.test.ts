import { describe, it, expect } from 'vitest';
import {
  pairKey,
  suggestStatementPairs,
  type OpenGlLine,
  type StatementLine,
  type SuspendedGlLine,
} from '../lib/suspenseSuggest';

const ACC = 'TW_BBL_C1';

const target = (o: Partial<SuspendedGlLine> & { date: string; amount: number }): SuspendedGlLine => ({
  entryNo: 1,
  matchId: 7,
  accountNo: ACC,
  direction: 'OUT',
  ...o,
});

const bank = (o: Partial<StatementLine> & { lineId: number; date: string; amount: number }): StatementLine => ({
  accountNo: ACC,
  direction: 'OUT',
  description: 'CHQ CLEARING',
  chequeNo: null,
  ...o,
});

const open = (o: Partial<OpenGlLine> & { entryNo: number; date: string; amount: number }): OpenGlLine => ({
  accountNo: ACC,
  direction: 'OUT',
  ...o,
});

const run = (
  t: SuspendedGlLine,
  statementLines: StatementLine[],
  extra: { suspendedGl?: SuspendedGlLine[]; openGl?: OpenGlLine[]; limit?: number } = {}
) =>
  suggestStatementPairs({
    target: t,
    statementLines,
    suspendedGl: extra.suspendedGl ?? [t],
    openGl: extra.openGl ?? [],
    limit: extra.limit,
  });

describe('pairKey', () => {
  it('รวมบัญชี ทิศทาง และยอดเป็นสตางค์', () => {
    expect(pairKey({ accountNo: ACC, direction: 'IN', amount: 1117.76 })).toBe(`${ACC}|IN|111776`);
  });
});

describe('suggestStatementPairs', () => {
  it('เสนอ statement เดือนถัดไปที่ยอดตรงกันพอดี (เช็คจ่าย 29/09 ธนาคารตัด 05/10)', () => {
    const result = run(target({ date: '2026-09-29', amount: 31030 }), [bank({ lineId: 50, date: '2026-10-05', amount: 31030 })]);

    expect(result.total).toBe(1);
    const [c] = result.candidates;
    expect(c.bank.lineId).toBe(50);
    expect(c.dayGap).toBe(6);
    expect(c.businessDays).toBe(4);
    expect(c.sameMonth).toBe(false);
    // 100 − 4 วันทำการ × 2 − เลขกลม 5
    expect(c.score).toBe(87);
    expect(c.level).toBe('high');
    expect(c.recommended).toBe(true);
    expect(c.reasons.map((r) => r.text)).toEqual([
      'ยอดเงินตรงกันพอดี',
      'ธนาคารลงหลัง BC365 6 วัน (4 วันทำการ)',
      'ยอดนี้มีใน statement รายการเดียว',
    ]);
  });

  it('ไม่เสนอ statement ต่างบัญชี ต่างทิศทาง หรือยอดต่างกันแม้แต่สตางค์เดียว', () => {
    const result = run(target({ date: '2026-09-29', amount: 31030 }), [
      bank({ lineId: 1, date: '2026-10-05', amount: 31030, accountNo: 'PV_BBL_S1' }),
      bank({ lineId: 2, date: '2026-10-05', amount: 31030, direction: 'IN' }),
      bank({ lineId: 3, date: '2026-10-05', amount: 31030.01 }),
    ]);
    expect(result.total).toBe(0);
    expect(result.candidates).toEqual([]);
  });

  it('มีหลายรายการให้เลือก แนะนำตัวที่วันที่ใกล้กว่าและเตือนให้ตรวจ', () => {
    const result = run(target({ date: '2026-09-30', amount: 1117.76 }), [
      bank({ lineId: 2, date: '2026-10-20', amount: 1117.76 }),
      bank({ lineId: 1, date: '2026-10-01', amount: 1117.76 }),
    ]);

    expect(result.candidates.map((c) => c.bank.lineId)).toEqual([1, 2]);
    expect(result.candidates.map((c) => c.score)).toEqual([83, 57]);
    expect(result.candidates[0].recommended).toBe(true);
    expect(result.candidates[1].recommended).toBe(false);
    expect(result.candidates[0].reasons.map((r) => r.text)).toContain('ยอดนี้มีใน statement 2 รายการ ตรวจให้ถูกรายการ');
  });

  it('คะแนนเท่ากันแยกไม่ออก ไม่แนะนำรายการใดเลย', () => {
    const result = run(target({ date: '2026-09-30', amount: 2500.25 }), [
      bank({ lineId: 1, date: '2026-10-02', amount: 2500.25 }),
      bank({ lineId: 2, date: '2026-10-02', amount: 2500.25 }),
    ]);
    expect(result.total).toBe(2);
    expect(result.candidates.every((c) => !c.recommended)).toBe(true);
  });

  it('statement ที่มี BC365 ยอดเท่ากันรอจับคู่อยู่ใกล้ๆ ถูกหักคะแนนและไม่แนะนำ', () => {
    const result = run(
      target({ date: '2026-08-20', amount: 5350 }),
      [bank({ lineId: 9, date: '2026-09-10', amount: 5350 })],
      { openGl: [open({ entryNo: 300, date: '2026-09-09', amount: 5350 }), open({ entryNo: 301, date: '2026-07-01', amount: 5350 })] }
    );

    const [c] = result.candidates;
    // 100 − 15 วันทำการ × 2 − BC365 ใกล้ statement 1 รายการ × 30 − เลขกลม 5
    expect(c.score).toBe(35);
    expect(c.level).toBe('low');
    expect(c.recommended).toBe(false);
    expect(c.reasons.some((r) => r.tone === 'warn' && r.text.includes('อาจเป็นคู่ของรายการนั้น'))).toBe(true);
  });

  it('รายการพักอื่นยอดเท่ากันที่วันที่ใกล้ statement กว่า ได้คะแนนสูงกว่า', () => {
    const older = target({ entryNo: 1, matchId: 7, date: '2026-08-03', amount: 2000.5 });
    const newer = target({ entryNo: 2, matchId: 8, date: '2026-09-25', amount: 2000.5 });
    const statement = [bank({ lineId: 70, date: '2026-10-01', amount: 2000.5 })];
    const suspendedGl = [older, newer];

    const forNewer = run(newer, statement, { suspendedGl }).candidates[0];
    const forOlder = run(older, statement, { suspendedGl }).candidates[0];

    expect(forNewer.score).toBe(92);
    expect(forNewer.recommended).toBe(true);
    expect(forOlder.score).toBe(35);
    expect(forOlder.recommended).toBe(false);
    expect(forOlder.reasons.some((r) => r.text.startsWith('มีรายการพักอื่นยอดเท่ากัน 1 รายการ'))).toBe(true);
  });

  it('statement บรรทัดเดียวถูกแนะนำให้รายการพักได้อย่างมากรายการเดียว', () => {
    const statement = [bank({ lineId: 80, date: '2026-10-01', amount: 4500.25 })];

    // ห่างเท่ากันทั้งสองรายการ ระบบแยกไม่ออก ไม่แนะนำใครเลย
    const a = target({ entryNo: 1, matchId: 7, date: '2026-09-30', amount: 4500.25 });
    const b = target({ entryNo: 2, matchId: 8, date: '2026-10-02', amount: 4500.25 });
    expect(run(a, statement, { suspendedGl: [a, b] }).candidates[0].recommended).toBe(false);
    expect(run(b, statement, { suspendedGl: [a, b] }).candidates[0].recommended).toBe(false);

    // รายการที่ใกล้กว่าได้คำแนะนำ รายการที่ไกลกว่าไม่ได้ แม้คะแนนจะยังอยู่ระดับปานกลาง
    const far = target({ entryNo: 3, matchId: 9, date: '2026-09-29', amount: 4500.25 });
    const near = target({ entryNo: 4, matchId: 10, date: '2026-09-30', amount: 4500.25 });
    const forFar = run(far, statement, { suspendedGl: [far, near] }).candidates[0];
    const forNear = run(near, statement, { suspendedGl: [far, near] }).candidates[0];
    expect(forFar.level).toBe('medium');
    expect(forFar.recommended).toBe(false);
    expect(forNear.recommended).toBe(true);
  });

  it('ยอดเล็กเลขกลมที่ซ้ำหลายรายการ ความมั่นใจต่ำและไม่แนะนำ', () => {
    const result = run(
      target({ date: '2026-08-10', amount: 10 }),
      [1, 2, 3, 4].map((lineId) => bank({ lineId, date: '2026-08-10', amount: 10 }))
    );
    expect(result.candidates.every((c) => c.level === 'low' && !c.recommended)).toBe(true);
    expect(result.candidates[0].reasons.map((r) => r.text)).toContain('ยอดเล็กเลขกลม มักเป็นค่าธรรมเนียมที่ซ้ำบ่อย');
  });

  it('ตัดจำนวนรายการตาม limit แต่ total ยังนับครบ', () => {
    const lines = [1, 2, 3, 4, 5].map((lineId) => bank({ lineId, date: `2026-10-0${lineId}`, amount: 777.77 }));
    const result = run(target({ date: '2026-09-30', amount: 777.77 }), lines, { limit: 2 });
    expect(result.total).toBe(5);
    expect(result.candidates).toHaveLength(2);
  });

  it('วันเดียวกันและเดือนเดียวกัน', () => {
    const [c] = run(target({ date: '2026-09-15', amount: 640.5 }), [bank({ lineId: 1, date: '2026-09-15', amount: 640.5 })]).candidates;
    expect(c.dayGap).toBe(0);
    expect(c.businessDays).toBe(0);
    expect(c.sameMonth).toBe(true);
    expect(c.reasons.map((r) => r.text)).toContain('ลงวันเดียวกัน');
    expect(c.score).toBe(100);
  });

  it('ต่างกันแค่เสาร์กับอาทิตย์ยังนับ 1 วันทำการ', () => {
    const [c] = run(target({ date: '2026-08-01', amount: 640.5 }), [bank({ lineId: 1, date: '2026-08-02', amount: 640.5 })]).candidates;
    expect(c.businessDays).toBe(1);
    expect(c.reasons.map((r) => r.text)).toContain('ธนาคารลงหลัง BC365 1 วัน');
  });

  it('ธนาคารลงก่อน BC365 ก็เสนอได้ (statement เดือนก่อนที่ยังไม่จับคู่)', () => {
    const [c] = run(target({ date: '2026-09-02', amount: 640.5, direction: 'IN' }), [
      bank({ lineId: 1, date: '2026-08-31', amount: 640.5, direction: 'IN' }),
    ]).candidates;
    expect(c.dayGap).toBe(-2);
    expect(c.reasons.map((r) => r.text)).toContain('ธนาคารลงก่อน BC365 2 วัน');
  });

  it('รายการพักยอด 0 ไม่มีคู่ให้เสนอ', () => {
    const result = run(target({ date: '2026-09-15', amount: 0 }), [bank({ lineId: 1, date: '2026-09-15', amount: 0 })]);
    expect(result.total).toBe(0);
  });
});
