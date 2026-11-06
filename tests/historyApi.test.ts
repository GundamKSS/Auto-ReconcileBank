import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({ auth: vi.fn(), pool: vi.fn(), query: vi.fn(), permissions: vi.fn(), groups: 123 }));
vi.mock('mssql', () => ({ default: { Int: 'int', NVarChar: 'nvarchar', Date: 'date', DateTime2: 'datetime' } }));
vi.mock('../lib/db', () => ({ getPool: h.pool }));
vi.mock('../lib/session', () => ({ requireRole: h.auth }));
vi.mock('../lib/workRolesDb', () => ({ readWorkPermissions: h.permissions }));
vi.mock('../lib/reconcileExtrasDb', () => ({ reconcileExtrasReady: vi.fn().mockResolvedValue(true) }));
vi.mock('../lib/bankAccountDb', () => ({ statementSenderColumnsReady: vi.fn().mockResolvedValue(true) }));
import { GET } from '../app/api/history/route';
import { appendHistoryPage, toSubGroups, type MatchRecord } from '../app/reconcile/history/components/historyModel';

const request = (query = '') => new NextRequest(`http://localhost/api/history?${query}`);
const header = { MatchId: 7, BankCode: 'BBL', MatchType: 'MATCHED', CreatedAt: new Date('2026-08-15'), CreatedBy: 'tester', Status: 'ACTIVE' };

beforeEach(() => {
  vi.clearAllMocks();
  h.groups = 123;
  h.auth.mockResolvedValue({ ok: true, session: {} });
  h.permissions.mockResolvedValue({ ready: true, employeeCode: null, roles: ['MASTER'] });
  h.pool.mockResolvedValue({ request: () => {
    const inputs: Record<string, unknown> = {};
    return { input(name: string, _type: unknown, value: unknown) { inputs[name] = value; return this; },
      query: (sql: string) => h.query(sql, inputs) };
  } });
  h.query.mockReset().mockImplementation(async (sql: string, inputs: Record<string, unknown>) => {
    if (sql.includes('OFFSET @offset')) return { recordset: sql.includes('pageGroup.Num')
      ? Array.from({ length: h.groups }, (_, i) => ({ MatchId: 7, Num: i + 1 })).slice(Number(inputs.offset), Number(inputs.offset) + Number(inputs.limit))
      : [{ MatchId: 7 }] };
    if (sql.includes('SELECT MatchId, BankCode')) return { recordset: [header] };
    const groups = Object.keys(inputs).filter((key) => key.startsWith('pageNum')).map((key) => Number(inputs[key]));
    const nums = groups.length ? groups : Array.from({ length: h.groups }, (_, i) => i + 1);
    if (sql.includes('SELECT rm.MatchId, rml.Num') && sql.includes('bsl.LineId')) return { recordset: nums.flatMap((num) => [
      { MatchId: 7, Num: num, Status: 'ACTIVE', LineId: num * 10, TranDate: new Date('2026-08-15'), Credit: num === 50 ? 30 : 100, Debit: null },
      ...(num === 50 ? [{ MatchId: 7, Num: num, Status: 'ACTIVE', LineId: num * 10 + 1, TranDate: new Date('2026-08-15'), Credit: 70, Debit: null }] : []),
    ]) };
    if (sql.includes('SELECT rm.MatchId, rml.Num') && sql.includes('e.Entry_No')) return { recordset: nums.map((num) => ({
      MatchId: 7, Num: num, Status: 'ACTIVE', Entry_No: num, Posting_Date: new Date('2026-08-15'), Debit_Amount_LCY: 100, Credit_Amount_LCY: 0,
    })) };
    if (sql.includes('AS AllCount')) return { recordset: [{ AllCount: 1, ArCount: 1, ApCount: 0 }] };
    if (sql.includes('AS Cnt')) return { recordset: [{ MatchType: 'MATCHED', Cnt: 1 }] };
    if (sql.includes('SELECT DISTINCT BankCode')) return { recordset: [{ BankCode: 'BBL' }] };
    throw new Error('Unexpected SQL in test');
  });
});

describe('history row pagination', () => {
  it.each([401, 403])('rejects unauthorized requests before reading the database (%s)', async (status) => {
    h.auth.mockResolvedValue({ ok: false, response: new Response(null, { status }) });
    expect((await GET(request('pageBy=group'))).status).toBe(status);
    expect(h.pool).not.toHaveBeenCalled();
  });

  it.each(['offset=-1', 'offset=0.5', 'offset=NaN', 'offset=2147483647', 'pageBy=invalid'])('rejects malformed pagination: %s', async (query) => {
    expect((await GET(request(query))).status).toBe(400);
    expect(h.query).not.toHaveBeenCalled();
  });

  it('returns exactly 50 displayed groups even when all groups belong to one Match', async () => {
    const response = await GET(request('pageBy=group'));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.matches).toHaveLength(1);
    const groups = toSubGroups(data.matches[0]);
    expect(groups).toHaveLength(50);
    expect(groups.map((g) => g.num)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    expect(groups[49].bankLines).toHaveLength(2);
    expect(groups[49].bankTotal).toBe(100);
    expect(groups[49].glTotal).toBe(100);
    expect(data).toMatchObject({ total: 1, hasMore: true, nextOffset: 50 });
    const [sql, inputs] = h.query.mock.calls[0];
    expect(inputs).toMatchObject({ offset: 0, limit: 51 });
    expect(sql).toContain('pageGroup.Num ASC');
    const detail = h.query.mock.calls.find(([query]) => query.includes('bsl.LineId') && query.includes('SELECT rm.MatchId, rml.Num'))!;
    expect(detail[0]).toContain('rml.Num = @pageNum49');
    expect(detail[1].pageNum49).toBe(50);
    expect(detail[1]).not.toHaveProperty('pageNum50');
  });

  it('appends the next 50 groups from the same Match without duplicate rows or missing lines', async () => {
    const first = await (await GET(request('pageBy=group'))).json();
    h.query.mockClear();
    const second = await (await GET(request('pageBy=group&offset=50'))).json();
    const merged = appendHistoryPage(first.matches, second.matches);
    expect(merged).toHaveLength(1);
    expect(toSubGroups(merged[0])).toHaveLength(100);
    expect(second.nextOffset).toBe(100);
    expect(second).not.toHaveProperty('total');
    expect(h.query.mock.calls.some(([sql]) => sql.includes('AS AllCount') || sql.includes('AS Cnt'))).toBe(false);
    expect(appendHistoryPage(merged, second.matches)).toEqual(merged);
  });

  it('ends after the final partial page and handles a scroll past the end', async () => {
    const last = await (await GET(request('pageBy=group&offset=100'))).json();
    expect(toSubGroups(last.matches[0])).toHaveLength(23);
    expect(last).toMatchObject({ hasMore: false, nextOffset: null });
    h.query.mockClear();
    const empty = await (await GET(request('pageBy=group&offset=150'))).json();
    expect(empty).toEqual({ matches: [], hasMore: false, nextOffset: null });
    expect(h.query).toHaveBeenCalledTimes(1);
  });

  it('does not request an extra page when exactly 50 rows remain', async () => {
    h.groups = 50;
    const data = await (await GET(request('pageBy=group'))).json();
    expect(data.hasMore).toBe(false);
    expect(data.nextOffset).toBeNull();
  });

  it('preserves Match pagination for the suspense page and existing callers', async () => {
    const data = await (await GET(request())).json();
    expect(toSubGroups(data.matches[0])).toHaveLength(123);
    expect(data).not.toHaveProperty('nextOffset');
    expect(h.query.mock.calls[0][1].limit).toBe(50);
    expect(h.query.mock.calls[0][0]).not.toContain('CROSS APPLY');
  });

  it('keeps date/search filters parameterized and enforces AP permissions while paging groups', async () => {
    h.permissions.mockResolvedValue({ ready: true, employeeCode: 'AP001', roles: ['AP'] });
    await GET(request('pageBy=group&dateBasis=GL&from=2026-08-01&to=2026-08-31&q=invoice'));
    const [sql, inputs] = h.query.mock.calls[0];
    expect(inputs).toMatchObject({ glFrom: new Date('2026-08-01'), glTo: new Date('2026-08-31'), q: '%invoice%' });
    expect(sql).toContain('p_b.Credit IS NULL');
    expect(sql).toContain('@q');
    expect(sql).not.toContain('invoice');
  });

  it('merges pages without mutating previously selected groups or the original page', async () => {
    const first = await (await GET(request('pageBy=group'))).json();
    const previous: MatchRecord[] = first.matches;
    const savedGroup = toSubGroups(previous[0])[0];
    const second = await (await GET(request('pageBy=group&offset=50'))).json();
    const merged = appendHistoryPage(previous, second.matches);
    expect(toSubGroups(previous[0])).toHaveLength(50);
    expect(toSubGroups(merged[0])[0]).toEqual(savedGroup);
  });
});
