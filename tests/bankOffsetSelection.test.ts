import { describe, expect, it } from 'vitest';
import { bankOffsetSelection, type BankOffsetLookup } from '../lib/bankOffsetSelection';
import type { BankOffsetCandidate } from '../lib/bankOffset';

const line = (lineId: number, direction: 'IN' | 'OUT', extra = {}): BankOffsetCandidate => ({
  lineId, direction, amount: 2500, bankCode: 'BBL', bankAccountNo: 'TEST_BBL', date: '2026-11-01',
  description: 'รายการทดสอบ', debit: direction === 'OUT' ? 2500 : null, credit: direction === 'IN' ? 2500 : null,
  chequeNo: null, channel: null, rawDescription: null, senderBank: null, senderAccountNo: null, senderAccountName: null, ...extra,
});
const lookup = (source = line(1, 'IN'), target = line(2, 'OUT')): BankOffsetLookup => ({
  sourceLineId: source.lineId, sourceLine: source, candidates: [target], error: '',
});
describe('bank offset two-column selection', () => {
  it.each(['IN', 'OUT'] as const)('supports either starting side (%s), with one choice in each column', (direction) => {
    const selected = bankOffsetSelection(1, lookup(line(1, direction), line(2, direction === 'IN' ? 'OUT' : 'IN')), 2, 'ธนาคารตัดคืน');
    expect(selected.problem).toBeNull();
    expect(selected.inTotal).toBe(2500); expect(selected.outTotal).toBe(2500); expect(selected.difference).toBe(0);
  });
  it('clears amounts when nothing is selected, even with an old response', () => {
    const selected = bankOffsetSelection(null, lookup(), 2, 'ธนาคารตัดคืน');
    expect(selected.candidate).toBeNull(); expect(selected.inTotal).toBe(0); expect(selected.outTotal).toBe(0);
    expect(selected.problem).not.toBeNull();
  });
  it('rejects an old candidate after the source changes or while fetching', () => {
    for (const data of [lookup(), null]) {
      const selected = bankOffsetSelection(3, data, 2, 'ธนาคารตัดคืน');
      expect(selected.current).toBeNull(); expect(selected.candidate).toBeNull(); expect(selected.problem).not.toBeNull();
    }
  });
  it('does not select a candidate absent from the latest response', () => {
    expect(bankOffsetSelection(1, lookup(), 99, 'ธนาคารตัดคืน').candidate).toBeNull();
  });
  it('shows the actual difference instead of hard-coding net zero', () => {
    const selected = bankOffsetSelection(1, lookup(line(1, 'IN'), line(2, 'OUT', { amount: 2000 })), 2, 'ธนาคารตัดคืน');
    expect(selected.difference).toBe(500); expect(selected.problem).toContain('ไม่เท่ากัน');
  });
  it.each(['source', 'candidate'])('blocks a closed %s period', (side) => {
    const data = lookup();
    (side === 'source' ? data.sourceLine! : data.candidates[0]).isPeriodClosed = true;
    expect(bankOffsetSelection(1, data, 2, 'ธนาคารตัดคืน').problem).toContain('ปิดแล้ว');
  });
  it.each([{ bankAccountNo: 'ANOTHER_ACCOUNT' }, { bankCode: 'SCB' }, { direction: 'IN' }, { lineId: 1 }])('blocks an invalid counterpart: %j', (extra) => {
    const target = line(2, 'OUT', extra);
    expect(bankOffsetSelection(1, lookup(line(1, 'IN'), target), target.lineId, 'ธนาคารตัดคืน').problem).not.toBeNull();
  });
  it.each(['', 'คืน', 'ก'.repeat(501)])('requires a server-compatible reason', (reason) => {
    expect(bankOffsetSelection(1, lookup(), 2, reason).problem).not.toBeNull();
  });
  it('cannot confirm a failed lookup', () => {
    expect(bankOffsetSelection(1, { sourceLineId: 1, sourceLine: null, candidates: [], error: 'โหลดไม่สำเร็จ' }, 2, 'ธนาคารตัดคืน').problem).toBe('โหลดไม่สำเร็จ');
  });
});
