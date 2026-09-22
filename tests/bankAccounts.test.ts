import { describe, it, expect } from 'vitest';
import {
  extractDisplayNo,
  shortAccountLabel,
  fullAccountLabel,
  guessAccountFromFileName,
  type BankAccountOption,
} from '../lib/bankAccounts';

const account = (o: Partial<BankAccountOption> & { bankAccountNo: string }): BankAccountOption => ({
  bankCode: 'BBL',
  accountName: null,
  displayNo: null,
  ...o,
});

const SCB = account({
  bankAccountNo: 'TW_SCB_C1',
  bankCode: 'SCB',
  accountName: 'TRW กระแสรายวัน SCB เฉลิมนคร #037-3-029725',
  displayNo: '037-3-029725',
});
const BBL = account({
  bankAccountNo: 'TW_BBL_C1',
  bankCode: 'BBL',
  accountName: 'TRW กระแสรายวัน BBL #150-3074633',
  displayNo: '150-3074633',
});

describe('extractDisplayNo — แกะเลขบัญชีจากชื่อบัญชี BC365', () => {
  it('รับรูปแบบเลขบัญชีที่เจอจริงได้ทุกแบบ ไม่ fix จำนวนหลัก', () => {
    expect(extractDisplayNo('TRW กระแสรายวัน SCB เฉลิมนคร #037-3-029725')).toBe('037-3-029725');
    expect(extractDisplayNo('TRW BBL #150-3074633')).toBe('150-3074633');
    expect(extractDisplayNo('TRW KBANK #027-2-37773-3')).toBe('027-2-37773-3');
    expect(extractDisplayNo('บัญชีย่อย #490-9')).toBe('490-9');
  });

  it('ยอมให้มีช่องว่างคั่นหลัง # และท้ายชื่อ', () => {
    expect(extractDisplayNo('TRW SCB # 037-3-029725  ')).toBe('037-3-029725');
  });

  it('ตัดขีดกลางที่ค้างท้ายทิ้ง', () => {
    expect(extractDisplayNo('TRW SCB #037-3-029725-')).toBe('037-3-029725');
  });

  it('คืน null เมื่อชื่อบัญชีไม่ได้ใส่เลขบัญชีไว้', () => {
    expect(extractDisplayNo('TRW กระแสรายวัน SCB เฉลิมนคร')).toBeNull();
    expect(extractDisplayNo(null)).toBeNull();
    expect(extractDisplayNo(undefined)).toBeNull();
    expect(extractDisplayNo('')).toBeNull();
  });

  it('คืน null เมื่อ # ไม่ได้อยู่ท้ายชื่อ', () => {
    expect(extractDisplayNo('บัญชี #037-3-029725 (ปิดแล้ว)')).toBeNull();
  });
});

describe('ป้ายชื่อบัญชี', () => {
  it('ป้ายสั้นใช้เลขท้าย 4 หลัก โดยไม่สนว่าขีดกลางคั่นตรงไหน', () => {
    expect(shortAccountLabel(SCB)).toBe('SCB ···9725');
    expect(shortAccountLabel(BBL)).toBe('BBL ···4633');
  });

  it('ป้ายสั้นถอยไปใช้รหัส BC365 เมื่อยังไม่มีเลขบัญชี', () => {
    expect(shortAccountLabel(account({ bankAccountNo: 'TW_SCB_C1', bankCode: 'SCB' }))).toBe('TW_SCB_C1');
  });

  it('ป้ายเต็มใช้ชื่อบัญชี ถ้าไม่มีก็ถอยไปใช้รหัส BC365 (ยังไม่ได้รัน sql/006)', () => {
    expect(fullAccountLabel(SCB)).toBe('TRW กระแสรายวัน SCB เฉลิมนคร #037-3-029725');
    expect(fullAccountLabel(account({ bankAccountNo: 'TW_SCB_C1', accountName: '   ' }))).toBe('TW_SCB_C1');
  });
});

describe('guessAccountFromFileName — เดาบัญชีจากชื่อไฟล์', () => {
  const accounts = [SCB, BBL];

  it('เดาถูกจากเลขท้ายบัญชีที่ผู้ใช้ตั้งไว้ในชื่อไฟล์', () => {
    expect(guessAccountFromFileName('9725 8.26.XLSX', accounts)?.bankAccountNo).toBe('TW_SCB_C1');
    expect(guessAccountFromFileName('BBL4633 (8) IT.xlsx', accounts)?.bankAccountNo).toBe('TW_BBL_C1');
  });

  it('ตัดนามสกุลไฟล์ทิ้งก่อนเทียบ', () => {
    // '.xlsx' ไม่มีตัวเลข แต่กันเคสนามสกุลอย่าง .xls1234 ที่จะกลายเป็นเลขให้เทียบ
    expect(guessAccountFromFileName('statement.9725', accounts)).toBeNull();
  });

  it('คืน null เมื่อกำกวม ตรงได้หลายบัญชี — ให้ผู้ใช้เลือกเอง ดีกว่าเลือกผิดเงียบๆ', () => {
    const twin = account({
      bankAccountNo: 'TW_KBANK_C1',
      bankCode: 'KBANK',
      displayNo: '111-2-229725',
    });

    expect(guessAccountFromFileName('9725 8.26.xlsx', [...accounts, twin])).toBeNull();
  });

  it('คืน null เมื่อชื่อไฟล์ไม่มีกลุ่มตัวเลข 4 หลักขึ้นไป', () => {
    expect(guessAccountFromFileName('statement.xlsx', accounts)).toBeNull();
    expect(guessAccountFromFileName('BBL 8-26.xlsx', accounts)).toBeNull();
  });

  it('ไม่เดาจากบัญชีที่เลขสั้นกว่า 6 หลัก เพราะชนเลขปี/เดือนได้ง่าย', () => {
    const shortAccount = account({ bankAccountNo: 'TW_SUB', bankCode: 'BBL', displayNo: '490-9' });

    expect(guessAccountFromFileName('4909 statement.xlsx', [shortAccount])).toBeNull();
  });

  it('คืน null เมื่อไม่มีบัญชีให้เทียบเลย', () => {
    expect(guessAccountFromFileName('9725 8.26.xlsx', [])).toBeNull();
  });
});
