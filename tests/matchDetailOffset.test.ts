import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import MatchDetail from '../app/reconcile/history/components/MatchDetail';
import { toSubGroups, type LineItem, type MatchRecord } from '../app/reconcile/history/components/historyModel';

function renderOffset(source: 'BANK' | 'GL') {
  const lines: LineItem[] = (['IN', 'OUT'] as const).map((direction, index) => ({
    num: 1, date: '2026-10-01', direction, amount: 1250,
    description: `รายการทดสอบ${direction}`, ref: `REF${index}`,
    ...(source === 'BANK' ? { lineId: index + 1 } : { entryNo: index + 1 }),
    status: 'ACTIVE', reversedAt: null, reversedBy: null, reversedReason: null,
  }));
  const match: MatchRecord = {
    matchId: 100, bankCode: 'BBL', matchType: 'OFFSET', createdBy: 'tester',
    createdAt: '2026-10-01T00:00:00Z', status: 'ACTIVE',
    reversedAt: null, reversedBy: null, reversedReason: null,
    bankLines: source === 'BANK' ? lines : [], glLines: source === 'GL' ? lines : [],
  };
  return renderToStaticMarkup(createElement(MatchDetail, {
    match, groups: toSubGroups(match), selectedKeys: new Set<string>(), onToggleGroup: vi.fn(), revertable: true,
  }));
}

describe('offset history detail', () => {
  it('shows both bank lines under bank headings for a bank offset', () => {
    const html = renderOffset('BANK');
    expect(html).toContain('ธนาคาร · เงินเข้า');
    expect(html).toContain('ธนาคาร · เงินออก');
    expect(html).toContain('รายการทดสอบIN');
    expect(html).toContain('รายการทดสอบOUT');
    expect(html).toContain('1,250.00');
    expect(html).not.toContain('BC365 · เงินเข้า');
    expect(html).not.toContain('ไม่มีรายการขาเข้า');
  });

  it('keeps BC365 offset lines under BC365 headings', () => {
    const html = renderOffset('GL');
    expect(html).toContain('BC365 · เงินเข้า');
    expect(html).toContain('BC365 · เงินออก');
    expect(html).toContain('1,250.00');
    expect(html).not.toContain('ธนาคาร · เงินเข้า');
  });
});
