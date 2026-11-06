import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({
  auth: vi.fn(), pool: vi.fn(), query: vi.fn(), account: vi.fn(), permissions: vi.fn(), coverage: vi.fn(),
}));
vi.mock('mssql', () => ({ default: { Date: 'date', Bit: 'bit', VarChar: () => 'varchar', NVarChar: 'nvarchar' } }));
vi.mock('../lib/db', () => ({ getPool: h.pool }));
vi.mock('../lib/session', () => ({ requireRole: h.auth }));
vi.mock('../lib/bankAccountDb', () => ({ resolveAccountFilter: h.account }));
vi.mock('../lib/workRolesDb', () => ({ readWorkPermissions: h.permissions }));
vi.mock('../lib/statementCoverage', async (original) => ({
  ...await original<typeof import('../lib/statementCoverage')>(), loadBanksWithStatement: h.coverage,
}));
import { GET } from '../app/api/dashboard/summary/route';

const request = (query = '') => new NextRequest(`http://localhost/api/dashboard/summary?month=2026-08&${query}`);
const summaryRows = [
  { Direction: 'IN', Status: 'MATCHED', BankCode: 'BBL', Rows_: 2, Matches_: 1, BankLines_: 2, GlLines_: 2, BankNet_: 100, GlNet_: 100 },
  { Direction: 'OUT', Status: 'UNMATCHED', BankCode: 'SCB', Rows_: 3, Matches_: 0, BankLines_: 1, GlLines_: 2, BankNet_: -50, GlNet_: -40 },
];
const monthlyResult = { recordsets: [summaryRows,
  [{ EffDate: new Date('2026-08-01'), Status: 'MATCHED', Lines_: 4, BankIn_: 100, BankOut_: 0 }],
  [{ Status: 'UNMATCHED', Bucket_: 0, Rows_: 3, BankAmount_: 50, GlAmount_: 40 }],
  [{ RowKey: 'U1', Status: 'UNMATCHED', BankCode: 'SCB', EffDate: new Date('2026-08-01'), Amount_: 50, Direction_: 'OUT', Side_: 'BANK', Label_: 'รายการทดสอบ' }],
  [{ BankCode: 'BBL' }, { BankCode: 'SCB' }],
] };
const trendResult = { recordset: [{ Month_: new Date('2026-07-01'), Status: 'MATCHED', Lines_: 2, BankNet_: 90, GlNet_: 90 }] };

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue({ ok: true, session: {} });
  h.permissions.mockResolvedValue({ ready: true, employeeCode: null, roles: ['MASTER'] });
  h.account.mockResolvedValue({ ok: true, bankCode: null, bankAccountNo: null });
  h.coverage.mockResolvedValue(new Set(['BBL', 'SCB']));
  h.query.mockReset().mockImplementation(async (sql: string) => sql.includes('SELECT * INTO #Scoped') ? monthlyResult : trendResult);
  h.pool.mockResolvedValue({ request: () => {
    const inputs: Record<string, unknown> = {};
    return { input(name: string, _type: unknown, value: unknown) { inputs[name] = value; return this; },
      query: (sql: string) => h.query(sql, inputs) };
  } });
});

describe('progressive dashboard API', () => {
  it.each(['all', 'overview', 'trend'])('enforces login before any database access for %s', async (section) => {
    h.auth.mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) });
    expect((await GET(request(`section=${section}`))).status).toBe(401);
    expect(h.pool).not.toHaveBeenCalled();
    expect(h.account).not.toHaveBeenCalled();
    expect(h.coverage).not.toHaveBeenCalled();
  });

  it('rejects an unknown section before querying', async () => {
    expect((await GET(request('section=unknown'))).status).toBe(400);
    expect(h.pool).not.toHaveBeenCalled();
  });

  it('returns monthly cards without starting or waiting for historical queries', async () => {
    h.query.mockImplementation(async (sql: string) => {
      if (!sql.includes('SELECT * INTO #Scoped')) throw new Error('Historical query must not run');
      return monthlyResult;
    });
    const response = await GET(request('section=overview'));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.summary.totals).toMatchObject({ bankNet: 100, glNet: 100, diff: 0 });
    expect(data.sideCounts).toEqual({ AR: 4, AP: 3 });
    expect(data.trend).toEqual([]);
    expect(data.daily[0].date).toBe('2026-08-01');
    expect(data.aging[0]).toMatchObject({ bucket: 0, bankAmount: 50, glAmount: 40 });
    expect(data.outstanding[0].rowKey).toBe('U1');
    expect(data.bankCodes).toEqual(['BBL', 'SCB']);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(h.query).toHaveBeenCalledTimes(1);
  });

  it('loads history independently without repeating the monthly batch or coverage query', async () => {
    const data = await (await GET(request('section=trend&trendMonths=12&side=AP'))).json();
    expect(data).toMatchObject({ side: 'AP', trendMonths: 12, trend: [{ month: '2026-07', lines: 2, diff: 0 }] });
    expect(data).not.toHaveProperty('summary');
    expect(h.query).toHaveBeenCalledTimes(1);
    expect(h.query.mock.calls[0][1]).toMatchObject({ from: new Date('2025-09-01'), to: new Date('2026-08-31'), direction: 'OUT' });
    expect(h.query.mock.calls[0][0]).not.toContain('SELECT * INTO #Scoped');
    expect(h.coverage).not.toHaveBeenCalled();
  });

  it('can fetch just current and previous month when only KPI comparisons need history', async () => {
    const data = await (await GET(request('section=trend&trendMonths=2'))).json();
    expect(data.trendMonths).toBe(2);
    expect(h.query.mock.calls[0][1].from).toEqual(new Date('2026-07-01'));
  });

  it('preserves the full response for existing callers without section', async () => {
    const data = await (await GET(request())).json();
    expect(data.summary.totals.diff).toBe(0);
    expect(data.trend[0].lines).toBe(2);
    expect(h.query).toHaveBeenCalledTimes(2);
    expect(h.coverage).toHaveBeenCalledOnce();
  });

  it.each(['overview', 'trend'])('restricts %s to the employee’s own side', async (section) => {
    h.permissions.mockResolvedValue({ ready: true, employeeCode: 'AP001', roles: ['AP'] });
    const data = await (await GET(request(`section=${section}&side=AR`))).json();
    expect(data.side).toBe('AP');
    expect(data.lockedSides).toEqual(['AR', 'ALL']);
    expect(h.query.mock.calls[0][1].direction).toBe('OUT');
    if (section === 'overview') {
      expect(data.sideCounts).toEqual({ AR: 0, AP: 3 });
      expect(data.summary.buckets.every((b: { bankCode: string }) => b.bankCode === 'SCB')).toBe(true);
    }
  });

  it('preserves bank/account filtering in the background request using parameters', async () => {
    h.account.mockResolvedValue({ ok: true, bankCode: 'BBL', bankAccountNo: 'ACC01' });
    await GET(request('section=trend&bankAccountNo=ACC01&bankCode=SCB'));
    const [sql, inputs] = h.query.mock.calls[0];
    expect(inputs).toMatchObject({ bankCode: 'BBL', bankAccountNo: 'ACC01' });
    expect(sql).toContain('@bankCode');
    expect(sql).not.toContain('ACC01');
  });

  it('rejects an invalid bank account before either data query', async () => {
    h.account.mockResolvedValue({ ok: false, error: 'ไม่พบบัญชี' });
    expect((await GET(request('section=trend&bankAccountNo=UNKNOWN'))).status).toBe(400);
    expect(h.query).not.toHaveBeenCalled();
  });

  it('returns a safe background error and leaves a separate overview request successful', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    h.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT * INTO #Scoped')) return monthlyResult;
      throw new Error('private connection details');
    });
    const response = await GET(request('section=trend'));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('private connection');
    expect((await GET(request('section=overview'))).status).toBe(200);
    log.mockRestore();
  });
});
