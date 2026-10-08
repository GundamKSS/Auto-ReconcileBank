import { describe, expect, it } from 'vitest';
import { buildReportCte, parseFilters, type ReportFilters } from '../app/api/reports/reconciliation/query';

function filters(over: Partial<ReportFilters> = {}): ReportFilters {
  return {
    from: '2026-08-01',
    to: '2026-08-31',
    basis: 'BANK',
    status: 'ALL',
    side: 'AR',
    bankCode: null,
    bankAccountNo: null,
    q: null,
    ...over,
  };
}

describe('parseFilters — ตัวกรองบัญชีธนาคาร', () => {
  it('อ่าน bankAccountNo จาก query string', () => {
    const f = parseFilters(new URLSearchParams('bankAccountNo=TW_BBL_C1'));
    expect(f.bankAccountNo).toBe('TW_BBL_C1');
  });

  it('ถือว่า ALL และค่าว่าง เท่ากับไม่กรอง', () => {
    expect(parseFilters(new URLSearchParams('bankAccountNo=ALL')).bankAccountNo).toBeNull();
    expect(parseFilters(new URLSearchParams('bankAccountNo=')).bankAccountNo).toBeNull();
    expect(parseFilters(new URLSearchParams('')).bankAccountNo).toBeNull();
  });
});

describe('buildReportCte — ตัวกรองบัญชีธนาคาร', () => {
  it('ไม่ใส่บัญชี = ไม่มีเงื่อนไขบัญชีใน SQL เลย', () => {
    expect(buildReportCte(filters())).not.toContain('@bankAccountNo');
  });

  // รายงานต้องแคบได้ถึงระดับบัญชีให้ตรงกับหน้ากระทบยอดซึ่งทำงานทีละบัญชี
  // ถ้ากรองไม่ครบทั้ง 3 ทาง จะมีรายการของบัญชีอื่นหลุดเข้ามาในรายงานโดยไม่รู้ตัว
  it('กรองครบทั้งรายการที่จับคู่แล้ว รายการธนาคารค้าง และรายการ BC365 ค้าง', () => {
    const sql = buildReportCte(filters({ bankAccountNo: 'TW_BBL_C1' }));
    expect(sql).toContain('rm.BankAccountNo = @bankAccountNo');   // กลุ่มที่จับคู่แล้ว (หัวบันทึก)
    expect(sql).toContain('bsl.BankAccountNo = @bankAccountNo');  // รายการเดินบัญชีธนาคารที่ยังค้าง
    expect(sql).toContain('e.Bank_Account_No = @bankAccountNo');  // รายการ BC365 ที่ยังค้าง
  });

  it('กรองบัญชีได้แม้สถานะเป็น UNMATCHED อย่างเดียว', () => {
    const sql = buildReportCte(filters({ status: 'UNMATCHED', bankAccountNo: 'TW_BBL_C1' }));
    expect(sql).toContain('bsl.BankAccountNo = @bankAccountNo');
    expect(sql).toContain('e.Bank_Account_No = @bankAccountNo');
  });

  it('ใช้ร่วมกับตัวกรองธนาคารได้ ไม่ทับกัน', () => {
    const sql = buildReportCte(filters({ bankCode: 'BBL', bankAccountNo: 'TW_BBL_C1' }));
    expect(sql).toContain('rm.BankCode = @bankCode');
    expect(sql).toContain('rm.BankAccountNo = @bankAccountNo');
  });

  it('ชื่อพารามิเตอร์มาจากโค้ดเราเองเสมอ ไม่ได้เอาค่าที่ส่งมาไปต่อสตริง', () => {
    const sql = buildReportCte(filters({ bankAccountNo: "X'; DROP TABLE BankStatementLine; --" }));
    expect(sql).not.toContain('DROP TABLE');
    expect(sql).toContain('@bankAccountNo');
  });
});
