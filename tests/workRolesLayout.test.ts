import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const state = vi.hoisted(() => ({ collapsed: false, mobileOpen: false, arrayIndex: 0, view: 'roles' }));
vi.mock('../components/SidebarContext', () => ({
  useSidebar: () => ({ collapsed: state.collapsed, mobileOpen: state.mobileOpen, toggleMobileOpen: vi.fn() }),
}));
vi.mock('react', async (original) => {
  const react = await original<typeof import('react')>();
  return { ...react, useState: (initial: unknown) => react.useState(Array.isArray(initial)
    ? state.arrayIndex++ === 0
      ? [{ employeeCode: 'TEST_EMPLOYEE_CODE_'.repeat(2), employeeName: 'ชื่อพนักงาน นามสกุลทดสอบ', roleCode: 'AP', isActive: true, updatedBy: 'ชื่อผู้ทดสอบที่ยาวสำหรับตรวจการตัดบรรทัด'.repeat(3), updatedAt: '2026-10-17' }]
      : [{ eventId: 1, employeeCode: 'TEST001', roleCode: 'AP', isActive: true, actor: 'ผู้ทดสอบ', reason: 'หมายเหตุทดสอบ'.repeat(30), createdAt: '2026-10-17T00:00:00Z' }]
    : initial === true && state.arrayIndex === 2 ? false : initial === 'roles' ? state.view : initial) };
});
import WorkRolesPage from '../app/master-data/work-roles/page';
import WorkRoleModal from '../app/master-data/work-roles/WorkRoleModal';

beforeEach(() => { state.collapsed = false; state.mobileOpen = false; state.arrayIndex = 0; state.view = 'roles'; });
const render = () => { state.arrayIndex = 0; return renderToStaticMarkup(createElement(WorkRolesPage)); };

describe('employee-role page layout', () => {
  it('uses the shared content shell with the expanded sidebar offset', () => {
    expect(render()).toContain('lg:pl-[300px]');
  });
  it('follows the collapsed sidebar instead of retaining a hard-coded margin', () => {
    state.collapsed = true;
    const html = render();
    expect(html).toContain('lg:pl-[82px]');
    expect(html).not.toContain('lg:pl-[300px]');
  });
  it('exposes a mobile menu button with drawer state', () => {
    expect(render()).toContain('aria-label="เปิดเมนูหลัก" aria-expanded="false"');
    state.mobileOpen = true;
    expect(render()).toContain('aria-label="เปิดเมนูหลัก" aria-expanded="true"');
  });
  it('renders readable cards on mobile and a locally scrollable table on larger screens', () => {
    const html = render();
    expect(html).toContain('space-y-3 md:hidden');
    expect(html).toContain('hidden max-w-full overflow-x-auto md:block');
    expect(html).toContain('เปลี่ยนสิทธิ์');
    expect(html).toContain('ชื่อพนักงาน นามสกุลทดสอบ');
    expect(html).not.toContain('ค้นหาพนักงานจากทะเบียนกลาง');
    expect(html).not.toContain('<dialog');
  });
  it('shows assignments first and connects both tabs to their panels', () => {
    const html = render();
    expect(html).toContain('id="work-roles-tab-roles" type="button" role="tab" aria-selected="true"');
    expect(html).toContain('id="work-roles-tab-history" type="button" role="tab" aria-selected="false"');
    expect(html).toContain('id="work-roles-panel-history" role="tabpanel" aria-labelledby="work-roles-tab-history" hidden=""');
    state.view = 'history';
    const history = render();
    expect(history).toContain('id="work-roles-tab-history" type="button" role="tab" aria-selected="true"');
    expect(history).toContain('id="work-roles-panel-roles" role="tabpanel" aria-labelledby="work-roles-tab-roles" hidden=""');
    expect(history).toContain('หมายเหตุทดสอบ');
  });
  it('moves employee lookup and required confirmation into a labelled modal', () => {
    const html = renderToStaticMarkup(createElement(WorkRoleModal, { onDismiss: vi.fn(), onSaved: vi.fn() }));
    expect(html).toContain('<dialog');
    expect(html).toContain('aria-labelledby="work-role-modal-title"');
    expect(html).toContain('ค้นหาพนักงานจากทะเบียนกลาง');
    expect(html).toContain('ตรวจสอบ EMP code และสิทธิ์ที่ต้องการแล้ว');
    expect(html).toMatch(/<button disabled=""[^>]*>[\s\S]*?บันทึกสิทธิ์/);
  });
  it('prefills the employee, role and status when editing an assignment', () => {
    const html = renderToStaticMarkup(createElement(WorkRoleModal, {
      assignment: { employeeCode: 'EMP001', roleCode: 'MASTER', isActive: false }, onDismiss: vi.fn(), onSaved: vi.fn(),
    }));
    expect(html).toContain('value="EMP001"');
    expect(html).toContain('<option value="MASTER" selected=""');
    expect(html).toContain('<option value="false" selected=""');
    expect(html).toContain('เปลี่ยนสิทธิ์พนักงาน');
  });
  it('can generate an isolated, inert layout preview without authentication or API access', () => {
    const output = process.env.WORK_ROLES_LAYOUT_PREVIEW;
    if (!output) return;
    const css = readdirSync('.next/static/css').filter((name) => name.endsWith('.css'))
      .map((name) => readFileSync(join('.next/static/css', name), 'utf8')).join('\n');
    for (const collapsed of [false, true]) {
      state.collapsed = collapsed;
      const html = render();
      // Generated test artifact only. No scripts, credentials, cookies, or live data.
      writeFileSync(join(output, `${collapsed ? 'collapsed' : 'expanded'}.html`),
        `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Isolated work-role layout test</title><style>${css}</style></head><body><aside class="fixed inset-y-0 left-0 hidden border-r bg-white p-4 lg:block ${collapsed ? 'w-[82px]' : 'w-[300px]'}">Sidebar<br>จำลอง</aside>${html}</body></html>`);
    }
  });
});
