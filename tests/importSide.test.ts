import { describe, expect, it } from 'vitest';
import { filterLinesBySide, importableSides, resolveImportSide } from '../lib/importSide';
import { effectiveWorkRoles, masterPermissions, type WorkPermissions } from '../lib/workRoles';

const perms = (...roles: WorkPermissions['roles']): WorkPermissions => ({
  ready: true,
  employeeCode: '0012',
  roles: effectiveWorkRoles(roles),
});

const lines = [
  { credit: 1000, debit: null, id: 'in-1' },
  { credit: null, debit: 250, id: 'out-1' },
  { credit: 40, debit: null, id: 'in-2' },
];

describe('import statement whole file (AP/AR)', () => {
  it('filters lines properly when side is specified', () => {
    expect(filterLinesBySide(lines, 'OUT').map((l) => l.id)).toEqual(['out-1']);
    expect(filterLinesBySide(lines, 'IN').map((l) => l.id)).toEqual(['in-1', 'in-2']);
    expect(filterLinesBySide(lines, 'ALL')).toHaveLength(3);
  });

  it('AP, AR, and MASTER all import the whole file (ALL)', () => {
    expect(importableSides(perms('AP'))).toEqual(['ALL']);
    expect(resolveImportSide(perms('AP'), null)).toEqual({ side: 'ALL' });

    expect(importableSides(perms('AR'))).toEqual(['ALL']);
    expect(resolveImportSide(perms('AR'), '')).toEqual({ side: 'ALL' });

    expect(importableSides(perms('AP', 'AR'))).toEqual(['ALL']);
    expect(resolveImportSide(perms('AP', 'AR'), undefined)).toEqual({ side: 'ALL' });

    expect(importableSides(perms('MASTER'))).toEqual(['ALL']);
    expect(resolveImportSide(perms('MASTER'), 'ALL')).toEqual({ side: 'ALL' });

    expect(importableSides(masterPermissions(true, null))).toEqual(['ALL']);
    expect(resolveImportSide(masterPermissions(true, null), undefined)).toEqual({ side: 'ALL' });
  });

  it('no AP/AR role cannot import at all', () => {
    expect(importableSides(perms())).toEqual([]);
    expect(resolveImportSide(perms(), 'ALL')).toMatchObject({ status: 403 });
  });

  it('before roles are installed the whole file is imported', () => {
    expect(importableSides({ ready: false, employeeCode: null, roles: [] })).toEqual(['ALL']);
    expect(resolveImportSide({ ready: false, employeeCode: null, roles: [] }, undefined)).toEqual({ side: 'ALL' });
  });
});
