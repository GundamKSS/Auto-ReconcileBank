import { describe, expect, it } from 'vitest';
import { suspenseSelectionProblem } from '../lib/suspenseSelection';

describe('suspenseSelectionProblem', () => {
  it('requires at least one BC365 entry', () => {
    expect(suspenseSelectionProblem(0, 0)).not.toBeNull();
  });

  it.each([1, 8, 217])('allows BC365-only selection of %i entries', (count) => {
    expect(suspenseSelectionProblem(0, count)).toBeNull();
  });

  it('rejects bank-only selection', () => {
    expect(suspenseSelectionProblem(2, 0)).not.toBeNull();
  });

  it.each([[1, 1], [2, 1], [1, 8], [8, 8]])(
    'rejects both sides selected (%i bank, %i BC365), regardless of amounts',
    (bankCount, glCount) => {
      expect(suspenseSelectionProblem(bankCount, glCount)).toContain('ยกเลิกการเลือกฝั่งธนาคาร');
    },
  );
});
