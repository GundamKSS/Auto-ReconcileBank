import { describe, expect, it } from 'vitest';
import { validateBankOffsetPair } from '../lib/bankOffset';

describe('validateBankOffsetPair (Bank statement offset / เช็คเด้ง)', () => {
  it('accepts valid 1:1 pair with matching amount, opposite directions, and remark', () => {
    const result = validateBankOffsetPair(
      { amount: 200000, direction: 'OUT', bankAccountNo: 'TW_BBL_C1' },
      { amount: 200000, direction: 'IN', bankAccountNo: 'TW_BBL_C1' },
      'เช็คเด้ง เลขที่ 12345678'
    );
    expect(result).toEqual({ ok: true });
  });

  it('rejects pairs with same direction', () => {
    const result = validateBankOffsetPair(
      { amount: 200000, direction: 'OUT', bankAccountNo: 'TW_BBL_C1' },
      { amount: 200000, direction: 'OUT', bankAccountNo: 'TW_BBL_C1' },
      'เช็คเด้ง'
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('คนละฝั่ง');
    }
  });

  it('rejects pairs with different amounts', () => {
    const result = validateBankOffsetPair(
      { amount: 200000, direction: 'OUT', bankAccountNo: 'TW_BBL_C1' },
      { amount: 150000, direction: 'IN', bankAccountNo: 'TW_BBL_C1' },
      'เช็คเด้ง'
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('ยอดเงินสองฝั่งไม่เท่ากัน');
    }
  });

  it('rejects pairs across different bank accounts', () => {
    const result = validateBankOffsetPair(
      { amount: 200000, direction: 'OUT', bankAccountNo: 'TW_BBL_C1' },
      { amount: 200000, direction: 'IN', bankAccountNo: 'PV_BBL_S1' },
      'เช็คเด้ง'
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('บัญชีธนาคารเดียวกัน');
    }
  });

  it('requires a non-empty remark', () => {
    const result = validateBankOffsetPair(
      { amount: 200000, direction: 'OUT', bankAccountNo: 'TW_BBL_C1' },
      { amount: 200000, direction: 'IN', bankAccountNo: 'TW_BBL_C1' },
      '   '
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('ระบุเหตุผล');
    }
  });

  it('tolerates difference within half a satang', () => {
    const result = validateBankOffsetPair(
      { amount: 200000.002, direction: 'OUT', bankAccountNo: 'TW_BBL_C1' },
      { amount: 200000.004, direction: 'IN', bankAccountNo: 'TW_BBL_C1' },
      'เช็คเด้ง'
    );
    expect(result).toEqual({ ok: true });
  });
});
