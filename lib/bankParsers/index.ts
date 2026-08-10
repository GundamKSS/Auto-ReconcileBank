import { BankCode, ParseResult } from './types';
import { parseBBL } from './bbl';
import { parseSCB } from './scb';
import { parseKBank } from './kbank';

export function parseBankStatement(bankCode: BankCode, rows: unknown[][]): ParseResult {
  switch (bankCode) {
    case 'BBL':
      return parseBBL(rows);
    case 'SCB':
      return parseSCB(rows);
    case 'KBANK':
      return parseKBank(rows);
    default:
      throw new Error(`ไม่รองรับธนาคาร: ${bankCode}`);
  }
}

export * from './types';