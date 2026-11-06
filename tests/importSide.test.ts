import { describe, expect, it } from 'vitest';
import { filterLinesBySide, importableSides, resolveImportSide } from '../lib/importSide';
import { effectiveWorkRoles, masterPermissions, type WorkPermissions } from '../lib/workRoles';

const perms = (...roles: WorkPermissions['roles']): WorkPermissions => ({ ready: true, employeeCode: '0012', roles: effectiveWorkRoles(roles) });
const lines = [
  { credit: 1000, debit: null, id: 'in-1' },
  { credit: null, debit: 250, id: 'out-1' },
  { credit: 40, debit: null, id: 'in-2' },
];

describe('import statement by AP / AR side', () => {
  it('AP imports only money out, AR only money in', () => {
    expect(filterLinesBySide(lines, 'OUT').map((l) => l.id)).toEqual(['out-1']);
    expect(filterLinesBySide(lines, 'IN').map((l) => l.id)).toEqual(['in-1', 'in-2']);
    expect(filterLinesBySide(lines, 'ALL')).toHaveLength(3);
  });
  it('a single-side employee gets their side without choosing', () => {
    expect(resolveImportSide(perms('AP'), null)).toEqual({ side: 'OUT' });
    expect(resolveImportSide(perms('AR'), '')).toEqual({ side: 'IN' });
  });
  it('a single-side employee cannot ask for the other side or the whole file', () => {
    expect(resolveImportSide(perms('AP'), 'IN')).toMatchObject({ status: 403 });
    expect(resolveImportSide(perms('AR'), 'ALL')).toMatchObject({ status: 403 });
  });
  it('AP+AR, MASTER and central Admin/Dev must choose every time', () => {
    for (const p of [perms('AP', 'AR'), perms('MASTER'), masterPermissions(true, null)]) {
      expect(importableSides(p)).toEqual(['OUT', 'IN', 'ALL']);
      expect(resolveImportSide(p, undefined)).toMatchObject({ status: 400 });
      expect(resolveImportSide(p, 'all')).toEqual({ side: 'ALL' });
    }
  });
  it('no AP/AR role cannot import at all', () => {
    expect(resolveImportSide(perms(), 'OUT')).toMatchObject({ status: 403 });
  });
  it('rejects unknown side values', () => {
    expect(resolveImportSide(perms('AP', 'AR'), 'BOTH')).toMatchObject({ status: 400 });
  });
  it('before roles are installed the whole file is imported as before', () => {
    expect(resolveImportSide({ ready: false, employeeCode: null, roles: [] }, undefined)).toEqual({ side: 'ALL' });
  });
});
