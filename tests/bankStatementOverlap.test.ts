import { beforeEach, describe, expect, it, vi } from 'vitest';
import type sql from 'mssql';
import type { NormalizedStatementLine } from '../lib/bankParsers/types';

const h = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock('mssql', () => {
  class Request {
    input() {
      return this;
    }
    query = h.query;
  }
  class Transaction {}
  return {
    default: {
      Request,
      Transaction,
      NVarChar: 'nvarchar',
      Date: 'date',
    },
  };
});

import { findOverlapWithImportedLines } from '../lib/bankStatementOverlap';

function makeLine(overrides: Partial<NormalizedStatementLine>): NormalizedStatementLine {
  return {
    tranDate: '2026-08-01',
    description: 'SMART',
    debit: null,
    credit: null,
    balance: 1000,
    chequeNo: null,
    channel: 'Auto',
    rawDescription: 'SMART',
    senderBank: null,
    senderAccountNo: null,
    senderAccountName: null,
    ...overrides,
  };
}

describe('findOverlapWithImportedLines (UPSERT classification)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('classifies existing rows with NULL Debit/Credit into linesToUpdate instead of newLines', async () => {
    h.query.mockResolvedValueOnce({
      recordset: [
        {
          LineId: 753,
          ImportId: 3,
          TranDate: new Date('2026-08-01T00:00:00.000Z'),
          Description: 'Fee Receive by Funds Transfer',
          Debit: null,
          Credit: null,
          Balance: 35565.86,
          FileName: 'BBL4633 (8) IT.xlsx',
          ImportedAt: '2026-11-04T14:00:30.240Z',
        },
        {
          LineId: 751,
          ImportId: 3,
          TranDate: new Date('2026-08-01T00:00:00.000Z'),
          Description: 'BBL.CARD',
          Debit: null,
          Credit: 3000,
          Balance: 107575.86,
          FileName: 'BBL4633 (8) IT.xlsx',
          ImportedAt: '2026-11-04T14:00:30.240Z',
        },
      ],
    });

    const fileLines: NormalizedStatementLine[] = [
      makeLine({
        tranDate: '2026-08-01',
        description: 'BBL.CARD',
        debit: null,
        credit: 3000,
        balance: 107575.86,
      }),
      makeLine({
        tranDate: '2026-08-01',
        description: 'Fee Receive by Funds Transfer',
        debit: 10,
        credit: null,
        balance: 35565.86,
      }),
      makeLine({
        tranDate: '2026-08-02',
        description: 'NEW TRANSFER',
        debit: 500,
        credit: null,
        balance: 35065.86,
      }),
    ];

    const result = await findOverlapWithImportedLines(
      {} as unknown as sql.ConnectionPool,
      'BBL',
      fileLines,
      '2026-08-01',
      '2026-08-02',
      'TW_BBL_C1'
    );

    // 1 row already has Credit = 3000 -> skipped
    expect(result.overlapCount).toBe(1);
    // 1 row had Debit = null, Credit = null in DB -> matched by (TranDate, Balance, Description) for UPDATE
    expect(result.updateCount).toBe(1);
    expect(result.linesToUpdate).toHaveLength(1);
    expect(result.linesToUpdate[0].lineId).toBe(753);
    expect(result.linesToUpdate[0].line.debit).toBe(10);
    // 1 genuinely new row -> INSERT
    expect(result.newLines).toHaveLength(1);
    expect(result.newLines[0].description).toBe('NEW TRANSFER');
  });
});
