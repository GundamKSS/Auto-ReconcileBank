import { describe, expect, it } from 'vitest';
import { matchesQuery, type OffsetSelectionLine } from '../app/reconcile/components/OffsetConfirmModal';

const line: OffsetSelectionLine = { id: 'g1', entryNo: 1, date: '2026-09-03', ref: 'PVD2608-0066', direction: 'IN', amount: 261685.82 };
describe('offset modal per-side search', () => {
  it('matches document numbers case-insensitively', () => {
    expect(matchesQuery(line, 'pvd2608')).toBe(true);
    expect(matchesQuery(line, 'JV999')).toBe(false);
  });
  it('matches amounts typed with or without thousands separators', () => {
    expect(matchesQuery(line, '261,685.82')).toBe(true);
    expect(matchesQuery(line, '261685.82')).toBe(true);
    expect(matchesQuery(line, '685.8')).toBe(true);
    expect(matchesQuery(line, '999.00')).toBe(false);
  });
  it('an empty box shows everything', () => {
    expect(matchesQuery(line, '  ')).toBe(true);
  });
});
