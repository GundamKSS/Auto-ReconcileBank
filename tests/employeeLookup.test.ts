import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ index: 0, values: [] as unknown[] }));
vi.mock('react', async (original) => {
  const react = await original<typeof import('react')>();
  return { ...react, useState: (initial: unknown) => react.useState(
    state.index < state.values.length ? state.values[state.index++] : initial,
  ) };
});
import EmployeeLookup from '../app/master-data/work-roles/EmployeeLookup';
const render = (disabled = false, employeeCode = '') => renderToStaticMarkup(createElement(EmployeeLookup, {
  employeeCode, disabled, onSelect: vi.fn(),
}));
beforeEach(() => { state.index = 0; state.values = []; });

describe('employee lookup presentation', () => {
  it('keeps search separate from the surrounding role-save form', () => {
    const html = render();
    expect(html).toContain('ค้นหาพนักงานจากทะเบียนกลาง');
    expect(html).toContain('EMP code หรือชื่อ');
    expect(html).toContain('type="button"');
    expect(html).not.toContain('<form');
    expect(html).toContain('min-w-0');
  });
  it('shows code, full name, job title and truncation without implying a grant', () => {
    state.values = ['ทดสอบ', { employees: [{ employeeCode: '0007', employeeName: 'ชื่อ ทดสอบ', jobTitle: 'บัญชี' }], truncated: true }, false, ''];
    const html = render();
    expect(html).toContain('ชื่อ ทดสอบ'); expect(html).toContain('0007'); expect(html).toContain('บัญชี');
    expect(html).toContain('เลือกพนักงาน'); expect(html).toContain('20 รายการแรก');
    expect(html).not.toContain('type="submit"');
  });
  it('disables search and selection while saving permissions', () => {
    state.values = ['ทดสอบ', { employees: [{ employeeCode: '0007', employeeName: 'ชื่อ ทดสอบ', jobTitle: '' }], truncated: false }, false, ''];
    expect(render(true).match(/<button type="button" disabled=""/g)).toHaveLength(2);
  });
  it('distinguishes no matches from an unavailable directory', () => {
    state.values = ['ทดสอบ', { employees: [], truncated: false }, false, ''];
    expect(render()).toContain('ไม่พบพนักงานที่ตรงกับคำค้น');
    state.index = 0; state.values = ['ทดสอบ', null, false, 'ค้นหาพนักงานไม่ได้'];
    expect(render()).toContain('role="alert"');
  });
});
