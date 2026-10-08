import { describe, expect, it } from 'vitest';
import { splitByCoverage } from '../lib/statementCoverage';
import type { ReportSummary, SummaryBucket } from '../app/api/reports/reconciliation/query';

function bucket(over: Partial<SummaryBucket> & { bankCode: string }): SummaryBucket {
  return {
    status: 'UNMATCHED',
    rows: 0,
    matches: 0,
    bankLines: 0,
    glLines: 0,
    bankIn: 0,
    bankOut: 0,
    bankNet: 0,
    glIn: 0,
    glOut: 0,
    glNet: 0,
    diff: 0,
    ...over,
  };
}

function summary(buckets: SummaryBucket[]): ReportSummary {
  return {
    total: buckets.reduce((s, b) => s + b.rows, 0),
    buckets,
    totals: {
      rows: 0,
      matches: 0,
      bankLines: 0,
      glLines: 0,
      bankIn: 0,
      bankOut: 0,
      bankNet: 0,
      glIn: 0,
      glOut: 0,
      glNet: 0,
      diff: buckets.reduce((s, b) => s + b.diff, 0),
    },
  };
}

describe('splitByCoverage', () => {
  // เคสจริงจากข้อมูลเดือน ส.ค. 2569: นำเข้าเฉพาะ statement ของ BBL
  // ผลต่างรวม -89,511,749.41 แต่ 86,871,962.16 เป็นแค่ธนาคารที่ยังไม่ได้นำเข้าไฟล์
  const august = summary([
    bucket({ bankCode: 'BBL', glLines: 265, glNet: 22977188.2, diff: -2639787.25 }),
    bucket({ bankCode: 'KBANK', glLines: 599, glNet: 31146933.19, diff: -31146933.19 }),
    bucket({ bankCode: 'SCB', glLines: 277, glNet: 43725028.97, diff: -43725028.97 }),
    bucket({ bankCode: 'KTB', glLines: 1, glNet: 12000000, diff: -12000000 }),
  ]);

  it('แยกผลต่างจริงออกจากธนาคารที่ยังไม่ได้นำเข้า statement', () => {
    const r = splitByCoverage(august, new Set(['BBL']));
    expect(r.reconcilableDiff).toBe(-2639787.25);
    expect(r.pendingImportNet).toBe(86871962.16);
    expect(r.pendingImport.map((p) => p.bankCode)).toEqual(['SCB', 'KBANK', 'KTB']); // เรียงตามยอดมากไปน้อย
  });

  it('สองส่วนรวมกันแล้วต้องเท่ากับผลต่างรวมเดิมเสมอ', () => {
    const r = splitByCoverage(august, new Set(['BBL']));
    expect(r.reconcilableDiff - r.pendingImportNet).toBeCloseTo(august.totals.diff, 2);
  });

  it('นำเข้าครบทุกธนาคาร = ไม่มีรายการค้างนำเข้า ผลต่างจริงเท่ากับผลต่างรวม', () => {
    const r = splitByCoverage(august, new Set(['BBL', 'KBANK', 'SCB', 'KTB']));
    expect(r.pendingImport).toEqual([]);
    expect(r.pendingImportNet).toBe(0);
    expect(r.reconcilableDiff).toBeCloseTo(august.totals.diff, 2);
  });

  it('ยังไม่ได้นำเข้าเลยสักธนาคาร = ผลต่างจริงเป็น 0 ไม่ใช่ตัวเลขมหาศาล', () => {
    const r = splitByCoverage(august, new Set());
    expect(r.reconcilableDiff).toBe(0);
    expect(r.pendingImport).toHaveLength(4);
  });

  // ธนาคารเดียวกันมีหลาย bucket (จับคู่แล้ว / รอจับคู่ / พักรายการ) ต้องยุบรวมเป็นแถวเดียว
  it('รวม bucket หลายสถานะของธนาคารเดียวกันเข้าด้วยกัน', () => {
    const r = splitByCoverage(
      summary([
        bucket({ bankCode: 'SCB', status: 'UNMATCHED', glLines: 10, glNet: 100, diff: -100 }),
        bucket({ bankCode: 'SCB', status: 'SUSPENSE', glLines: 5, glNet: 50, diff: -50 }),
      ]),
      new Set(['BBL'])
    );
    expect(r.pendingImport).toEqual([{ bankCode: 'SCB', glLines: 15, glNet: 150 }]);
  });
});
