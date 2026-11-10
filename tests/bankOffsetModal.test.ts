import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const state = vi.hoisted(() => ({ index: 0, values: [] as unknown[] }));
vi.mock('react', async (original) => {
  const react = await original<typeof import('react')>();
  return { ...react, useState: (initial: unknown) => react.useState(state.index < state.values.length ? state.values[state.index++] : initial) };
});
vi.mock('react-dom', async (original) => ({ ...await original<typeof import('react-dom')>(), createPortal: (node: ReactNode) => node }));
vi.mock('framer-motion', () => ({ motion: { div: (props: Record<string, unknown>) => createElement('div', Object.fromEntries(Object.entries(props).filter(([key]) => !['initial', 'animate', 'exit'].includes(key)))) } }));
import BankOffsetModal, { type BankModalLine } from '../app/reconcile/components/BankOffsetModal';
import type { BankOffsetLookup } from '../lib/bankOffsetSelection';
import type { BankOffsetCandidate } from '../lib/bankOffset';

const source: BankModalLine = { id: 'bank-1', lineId: 1, bankCode: 'BBL', accountNo: 'TEST_BBL', date: '2026-11-01', ref: 'L-1',
  direction: 'IN', description: 'รายการรับเงินทดสอบ', amount: 2500, senderAccountName: 'บริษัท ทดสอบชื่อผู้โอนที่ยาวเพื่อทดสอบการตัดบรรทัด จำกัด', senderAccountNo: 'XXX-X-12345-X' };
const asCandidate = (line: BankModalLine): BankOffsetCandidate => ({ ...line, bankAccountNo: line.accountNo,
  debit: line.direction === 'OUT' ? line.amount : null, credit: line.direction === 'IN' ? line.amount : null,
  description: line.description, chequeNo: null, channel: null, rawDescription: null,
  senderBank: null, senderAccountName: line.senderAccountName ?? null, senderAccountNo: line.senderAccountNo ?? null });
const data = (): BankOffsetLookup => ({ sourceLineId: 1, sourceLine: asCandidate(source), candidates: [asCandidate({ ...source, lineId: 2, direction: 'OUT', description: 'รายการธนาคารตัดคืนทดสอบ' })], error: '' });
function render(extra = {}) {
  state.index = 0;
  return renderToStaticMarkup(createElement(BankOffsetModal, { isOpen: true, onClose: vi.fn(), initialLine: null, availableLines: [source], sourceDirection: 'IN', busy: false, onConfirm: vi.fn(), ...extra }));
}
beforeEach(() => { state.index = 0; state.values = []; vi.stubGlobal('document', { body: {} }); });
afterEach(() => vi.unstubAllGlobals());
describe('bank offset dialog layout', () => {
  it('shows fixed IN/OUT columns with checkboxes, not a source dropdown', () => {
    const html = render();
    expect(html).toContain('md:grid-cols-2'); expect(html).toContain('aria-label="เงินเข้า (AR)"'); expect(html).toContain('aria-label="เงินออก (AP)"');
    expect(html).toContain('type="checkbox"'); expect(html).not.toContain('<select');
    expect(html).toContain('role="dialog"'); expect(html).toContain('อย่างละ 1 รายการ');
    expect(html).toContain('disabled="" title="เลือกเงินเข้าและเงินออก');
  });
  it('shows independent selections and sender details on both sides', () => {
    state.values = [1, data(), 2, 'ธนาคารตัดคืน', '', '', 0, false];
    const html = render();
    expect(html.match(/checked=""/g)).toHaveLength(2);
    expect(html).toContain(source.senderAccountName); expect(html).toContain('XXX-X-12345-X');
    expect(html).toContain('ยืนยันหักล้าง 2 รายการ'); expect(html).not.toContain('disabled=""');
  });
  it('keeps selected rows visible when searching for another item', () => {
    state.values = [1, data(), 2, 'ธนาคารตัดคืน', 'ไม่ตรงกับรายการใดเลย', '', 0, false];
    expect(render().match(/checked=""/g)).toHaveLength(2);
  });
  it('does not show or confirm an old candidate when switching sources', () => {
    state.values = [3, data(), 2, 'ธนาคารตัดคืน', '', '', 0, false];
    const html = render({ availableLines: [{ ...source, lineId: 3 }] });
    expect(html).toContain('กำลังค้นหาคู่หักล้าง'); expect(html).not.toContain('รายการธนาคารตัดคืนทดสอบ');
    expect(html).not.toContain('ยืนยันหักล้าง 2 รายการ');
  });
  it('keeps IN on the left when starting from AP/OUT', () => {
    const html = render({ sourceDirection: 'OUT', availableLines: [{ ...source, direction: 'OUT' }] });
    expect(html.indexOf('aria-label="เงินเข้า (AR)"')).toBeLessThan(html.indexOf('aria-label="เงินออก (AP)"'));
    expect(html).toContain('เลือกเงินออก (AP) L-1');
  });
  it('disables closed candidates and confirmation', () => {
    const closed = data(); closed.candidates[0].isPeriodClosed = true;
    state.values = [1, closed, 2, 'ธนาคารตัดคืน', '', '', 0, false];
    const html = render(); expect(html).toContain('งวดปิดแล้ว'); expect(html).toContain('disabled="" aria-label="เลือกเงินออก');
  });
  it('renders already-offset items in grey, disabled, with the other side remark', () => {
    const withOffset = data();
    withOffset.candidates.push({
      ...asCandidate({ ...source, lineId: 9, direction: 'OUT', description: 'Correction for Clearing Cheque Deposit' }),
      isOffset: true,
      offsetMatchId: 405,
      offsetRemark: 'อย่าลืมใส่',
      offsetBy: 'ap_user',
      offsetCounterpartRef: 'Chq 00000000',
      offsetCounterpartDate: '2026-10-05',
    });
    state.values = [1, withOffset, null, '', '', '', 0, false];
    const html = render();
    expect(html).toContain('หักล้างแล้ว #405');
    expect(html).toContain('อย่าลืมใส่');
    expect(html).toContain('คู่กับ Chq 00000000 (05/10/2026)');
    expect(html).toContain('cursor-not-allowed bg-slate-100/90 text-slate-400');
  });
  it('locks both selectors and the reason during submission', () => {
    state.values = [1, data(), 2, 'ธนาคารตัดคืน', '', '', 0, false];
    const html = render({ busy: true });
    expect(html.match(/disabled="" aria-label="เลือกเงิน/g)).toHaveLength(2);
    expect(html).toContain('rows="2" disabled=""');
  });
  it('can generate an inert responsive preview using synthetic data only', () => {
    const output = process.env.BANK_OFFSET_LAYOUT_PREVIEW;
    if (!output) return;
    state.values = [1, data(), 2, 'ธนาคารตัดคืน', '', '', 0, false];
    const css = readdirSync('.next/static/css').filter((name) => name.endsWith('.css')).map((name) => readFileSync(join('.next/static/css', name), 'utf8')).join('\n');
    writeFileSync(join(output, 'bank-offset.html'), `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bank offset layout — synthetic preview</title><style>${css}</style></head><body>${render()}</body></html>`);
  });
});
