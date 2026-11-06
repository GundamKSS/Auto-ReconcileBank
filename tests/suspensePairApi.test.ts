import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({
  query: vi.fn(), begin: vi.fn(), commit: vi.fn(), rollback: vi.fn(),
  auth: vi.fn(), permissions: vi.fn(), workSides: vi.fn(), datesOpen: vi.fn(), periodReady: vi.fn(),
  cancelled: vi.fn(), accountReady: vi.fn(),
}));
vi.mock('mssql', () => {
  class Request {
    input() { return this; }
    query = h.query;
  }
  class Transaction { begin = h.begin; commit = h.commit; rollback = h.rollback; }
  return { default: { Request, Transaction, Int: 'int', BigInt: 'bigint', NVarChar: 'nvarchar' } };
});
vi.mock('../lib/db', () => ({ getPool: vi.fn(async () => ({ request: () => new (class { input() { return this; } query = h.query; })() })) }));
vi.mock('../lib/session', () => ({ requireRole: h.auth, auditActor: () => 'tester (tester)' }));
vi.mock('../lib/bankAccountDb', () => ({ bankAccountColumnsReady: h.accountReady }));
vi.mock('../lib/cancelledGl', () => ({ cancelledGlEntryNos: h.cancelled }));
// ใช้ findBlockingClosedPeriod กับ isoDate ตัวจริง แทนเฉพาะส่วนที่ต่อ DB
vi.mock('../lib/periodClose', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/periodClose')>()),
  assertDatesOpen: h.datesOpen,
  reconcilePeriodCloseReady: h.periodReady,
}));
vi.mock('../lib/workRolesDb', () => ({
  assertWorkSides: h.workSides,
  readWorkPermissions: h.permissions,
  WorkPermissionError: class extends Error { status = 403; },
}));

import { GET, POST } from '../app/api/reconcile/suspense-pair/route';
import { WorkPermissionError } from '../lib/workRolesDb';

const ACC = 'TW_BBL_C1';
// เช็คจ่าย 31,030.00 ลง BC365 29/09 พักไว้ใน Match #7 แล้วธนาคารตัดเช็ค 05/10
const suspendedRow = {
  MatchId: 7, Entry_No: 1, Posting_Date: new Date('2026-09-29T00:00:00Z'), Bank_Account_No: ACC,
  Debit_Amount_LCY: 0, Credit_Amount_LCY: 31030,
};
const bankRow = {
  LineId: 50, BankCode: 'BBL', BankAccountNo: ACC, TranDate: new Date('2026-10-05T00:00:00Z'),
  Description: 'CHQ CLEARING', ChequeNo: '000124', Debit: 31030, Credit: null, MatchStatus: 'UNMATCHED',
};
// งวด ก.ย. ของบัญชีนี้ปิดแล้ว
const septemberClosed = {
  BankAccountNo: ACC, PeriodStart: new Date('2026-09-01T00:00:00Z'), PeriodEnd: new Date('2026-09-30T00:00:00Z'), ClosedBy: 'master',
};

const getRequest = (qs: string) => new NextRequest(`http://localhost/api/reconcile/suspense-pair?${qs}`);
const postRequest = (body: unknown) => new NextRequest('http://localhost/api/reconcile/suspense-pair', {
  method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
});
const pairBody = { matchId: 7, entryNo: 1, bankLineId: 50 };

beforeEach(() => {
  vi.clearAllMocks();
  h.query.mockReset();
  h.datesOpen.mockReset();
  h.workSides.mockReset();
  h.auth.mockResolvedValue({ ok: true, session: { username: 'tester', role: 'Admin' } });
  h.permissions.mockResolvedValue({ ready: false, employeeCode: null, roles: [] });
  h.cancelled.mockResolvedValue(new Set());
  h.accountReady.mockResolvedValue(true);
  h.periodReady.mockResolvedValue(true);
  h.datesOpen.mockResolvedValue(undefined);
  h.workSides.mockResolvedValue(undefined);
});

describe('GET suspense pair suggestions (mocked DB, read only)', () => {
  function mockSuggestion(closedRows: unknown[] = []) {
    h.query
      .mockResolvedValueOnce({ recordset: [suspendedRow] }) // รายการพักที่ขอ
      .mockResolvedValueOnce({ recordset: [bankRow] }) // statement ยอดเดียวกัน
      .mockResolvedValueOnce({ recordset: [{ ...suspendedRow, MatchType: 'SUSPENSE' }] }) // BC365 ยอดเดียวกัน
      .mockResolvedValueOnce({ recordset: closedRows }); // งวดที่ปิดแล้ว
  }

  it('ตอบ 400 เมื่อไม่ส่ง entryNos หรือส่งค่าที่ไม่ใช่เลข', async () => {
    expect((await GET(getRequest(''))).status).toBe(400);
    expect((await GET(getRequest('entryNos=1,abc'))).status).toBe(400);
    expect(h.query).not.toHaveBeenCalled();
  });

  it('ตอบ 400 เมื่อ limit อยู่นอกช่วง 1 ถึง 50', async () => {
    expect((await GET(getRequest('entryNos=1&limit=0'))).status).toBe(400);
    expect((await GET(getRequest('entryNos=1&limit=51'))).status).toBe(400);
  });

  it('เสนอ statement เดือนถัดไปให้รายการพัก', async () => {
    mockSuggestion();

    const response = await GET(getRequest('entryNos=1&limit=50'));
    expect(response.status).toBe(200);
    const { items } = await response.json();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ entryNo: 1, matchId: 7, total: 1, closedPeriod: null });
    expect(items[0].candidates[0]).toMatchObject({
      recommended: true,
      level: 'high',
      bank: { lineId: 50, date: '2026-10-05', direction: 'OUT', amount: 31030, chequeNo: '000124' },
    });
    expect(h.query.mock.calls[1][0]).toContain("b.MatchStatus = 'UNMATCHED'");
  });

  it('บอกงวดที่ปิดแล้วของรายการพัก ให้หน้าจอเตือนก่อนยืนยัน', async () => {
    mockSuggestion([septemberClosed]);
    const { items } = await (await GET(getRequest('entryNos=1'))).json();
    expect(items[0].closedPeriod).toEqual({ periodStart: '2026-09-01', periodEnd: '2026-09-30' });
  });

  it('สิทธิ์ AP เห็นเฉพาะรายการพักเงินออก รายการพักเงินเข้าไม่ถูกส่งกลับ', async () => {
    h.permissions.mockResolvedValue({ ready: true, employeeCode: 'E1', roles: ['AP'] });
    h.query.mockResolvedValueOnce({ recordset: [{ ...suspendedRow, Debit_Amount_LCY: 31030, Credit_Amount_LCY: 0 }] });

    const { items } = await (await GET(getRequest('entryNos=1'))).json();
    expect(items).toEqual([]);
    expect(h.query).toHaveBeenCalledOnce();
  });

  it('รายการพักที่ถูกกลับรายการใน BC365 แล้วไม่ได้รับคำแนะนำ', async () => {
    h.cancelled.mockResolvedValue(new Set([1]));
    h.query.mockResolvedValueOnce({ recordset: [suspendedRow] });

    const { items } = await (await GET(getRequest('entryNos=1'))).json();
    expect(items).toEqual([]);
  });

  it('รายการพักที่ถูกกลับรายการแล้ว ไม่นับเป็นคู่แข่งของรายการพักอื่น', async () => {
    h.cancelled.mockResolvedValue(new Set([9]));
    const reversed = { ...suspendedRow, MatchId: 9, Entry_No: 9, Posting_Date: new Date('2026-10-04T00:00:00Z'), MatchType: 'SUSPENSE' };
    h.query
      .mockResolvedValueOnce({ recordset: [suspendedRow] })
      .mockResolvedValueOnce({ recordset: [bankRow] })
      .mockResolvedValueOnce({ recordset: [{ ...suspendedRow, MatchType: 'SUSPENSE' }, reversed] })
      .mockResolvedValueOnce({ recordset: [] });

    const { items } = await (await GET(getRequest('entryNos=1'))).json();
    expect(items[0].candidates[0].recommended).toBe(true);
    expect(items[0].candidates[0].reasons.some((r: { text: string }) => r.text.startsWith('มีรายการพักอื่น'))).toBe(false);
  });
});

describe('POST suspense pair (mocked DB; no financial data writes)', () => {
  // closedRows = แถวงวดที่ปิดแล้วที่อ่านหลังล็อกบัญชี, null = ยังไม่ได้รัน sql/008 จึงไม่มีการอ่าน
  function mockHappyPath(closedRows: unknown[] | null = [], remainingLines = 0) {
    h.query
      .mockResolvedValueOnce({ recordset: [suspendedRow] }) // รายการพัก
      .mockResolvedValueOnce({ recordset: [bankRow] }); // statement
    if (closedRows) h.query.mockResolvedValueOnce({ recordset: closedRows });
    h.query
      .mockResolvedValueOnce({ rowsAffected: [1] }) // ลบบรรทัดออกจากรายการพัก
      .mockResolvedValueOnce({ recordset: [{ cnt: remainingLines }] }); // บรรทัดที่เหลือในรายการพัก
    if (remainingLines === 0) h.query.mockResolvedValueOnce({ rowsAffected: [1] }); // ลบหัวรายการพัก
    h.query
      .mockResolvedValueOnce({ rowsAffected: [1] }) // statement เป็น MATCHED
      .mockResolvedValueOnce({ recordset: [{ MatchId: 99 }] }) // หัวคู่ใหม่
      .mockResolvedValueOnce({ rowsAffected: [1, 1] }); // บรรทัดของคู่ใหม่
  }
  const sqlText = () => h.query.mock.calls.map((c) => String(c[0]));

  it('ย้ายรายการพักไปจับคู่กับ statement ใน transaction เดียว', async () => {
    mockHappyPath();
    const response = await POST(postRequest(pairBody));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ matchId: 99, clearedSuspenseMatchId: 7, bankAccountNo: ACC });
    // ตรวจ statement ก่อน (ได้ล็อกบัญชี) แล้วค่อยตรวจรายการพักที่งวดยังไม่ปิด
    expect(h.datesOpen.mock.calls.map((c) => c[2])).toEqual([
      [{ date: '2026-10-05', direction: 'OUT' }],
      [{ date: '2026-09-29', direction: 'OUT' }],
    ]);
    expect(h.workSides).toHaveBeenCalledWith(expect.anything(), ['OUT'], expect.anything());
    expect(sqlText()[2]).toContain('ReconciliationPeriodClose');
    expect(sqlText()[3]).toContain('DELETE FROM ReconciliationMatchLine');
    expect(sqlText()[6]).toContain("MatchStatus = 'UNMATCHED'");
    expect(sqlText()[7]).toContain("'MATCHED'");
    expect(h.commit).toHaveBeenCalledOnce();
    expect(h.rollback).not.toHaveBeenCalled();
  });

  it('รายการพักอยู่ในงวดที่ปิดแล้ว จับคู่กับ statement งวดที่ยังเปิดได้', async () => {
    mockHappyPath([septemberClosed]);
    const response = await POST(postRequest(pairBody));

    expect(response.status).toBe(200);
    // ตรวจเฉพาะวันที่ของ statement ไม่ตรวจวันที่ของรายการพักซึ่งอยู่ในงวดที่ปิด
    expect(h.datesOpen).toHaveBeenCalledOnce();
    expect(h.datesOpen.mock.calls[0][2]).toEqual([{ date: '2026-10-05', direction: 'OUT' }]);
    expect(h.commit).toHaveBeenCalledOnce();
  });

  it('รายการพักที่งวดยังไม่ปิดแต่ฝั่งนั้นยืนยันงานแล้ว ยังจับคู่ไม่ได้', async () => {
    h.query
      .mockResolvedValueOnce({ recordset: [suspendedRow] })
      .mockResolvedValueOnce({ recordset: [bankRow] })
      .mockResolvedValueOnce({ recordset: [] });
    h.datesOpen
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('งาน AP (เงินออก) ช่วง 2026-09-01 ถึง 2026-09-30 ยืนยันแล้วโดย ap'));

    const response = await POST(postRequest(pairBody));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain('ยืนยันแล้ว');
    expect(h.query).toHaveBeenCalledTimes(3);
    expect(h.rollback).toHaveBeenCalledOnce();
    expect(h.commit).not.toHaveBeenCalled();
  });

  it('statement อยู่ในงวดที่ปิดแล้ว จับคู่ไม่ได้ แม้รายการพักจะอยู่ในงวดที่ปิดแล้วเหมือนกัน', async () => {
    h.query.mockResolvedValueOnce({ recordset: [suspendedRow] }).mockResolvedValueOnce({ recordset: [bankRow] });
    h.datesOpen.mockRejectedValue(new Error('งวด 2026-10-01 ถึง 2026-10-31 ของบัญชีนี้ปิดแล้ว'));

    const response = await POST(postRequest(pairBody));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain('ปิดแล้ว');
    expect(h.query).toHaveBeenCalledTimes(2);
    expect(h.rollback).toHaveBeenCalledOnce();
  });

  it('ยังมีบรรทัดอื่นเหลือในรายการพัก ไม่ลบหัวรายการพัก', async () => {
    mockHappyPath([], 2);
    const response = await POST(postRequest(pairBody));
    expect(response.status).toBe(200);
    expect((await response.json()).clearedSuspenseMatchId).toBeNull();
    expect(sqlText().some((s) => s.includes('DELETE FROM ReconciliationMatch WHERE'))).toBe(false);
  });

  it('ตอบ 400 เมื่อ body ไม่ครบหรือไม่ใช่จำนวนเต็มบวก', async () => {
    expect((await POST(postRequest({ matchId: 7, entryNo: 1 }))).status).toBe(400);
    expect((await POST(postRequest({ ...pairBody, bankLineId: -1 }))).status).toBe(400);
    expect((await POST(postRequest({ ...pairBody, entryNo: '1' }))).status).toBe(400);
    expect(h.begin).not.toHaveBeenCalled();
  });

  it('ไม่พบรายการพักแล้ว (ถูกคืนไปก่อน) ตอบ 409', async () => {
    h.query.mockResolvedValueOnce({ recordset: [] });
    const response = await POST(postRequest(pairBody));
    expect(response.status).toBe(409);
    expect(h.rollback).toHaveBeenCalledOnce();
    expect(h.commit).not.toHaveBeenCalled();
  });

  it.each([
    ['statement ถูกจับคู่ไปแล้ว', { MatchStatus: 'MATCHED' }],
    ['statement ถูกลบไฟล์แล้ว', { MatchStatus: 'DELETED' }],
    ['statement ต่างบัญชี', { BankAccountNo: 'PV_BBL_S1' }],
    ['statement ยังไม่ระบุบัญชี', { BankAccountNo: null }],
    ['statement เป็นเงินเข้า', { Credit: 31030, Debit: null }],
    ['ยอดต่างกัน 1 สตางค์', { Debit: 31030.01 }],
  ])('ปฏิเสธเมื่อ%s และไม่เขียนอะไรเลย', async (_label, patch) => {
    h.query.mockResolvedValueOnce({ recordset: [suspendedRow] }).mockResolvedValueOnce({ recordset: [{ ...bankRow, ...patch }] });
    const response = await POST(postRequest(pairBody));
    expect(response.status).toBe(409);
    expect(h.query).toHaveBeenCalledTimes(2);
    expect(h.rollback).toHaveBeenCalledOnce();
    expect(h.commit).not.toHaveBeenCalled();
  });

  it('รายการ BC365 ที่ถูกกลับรายการแล้ว จับคู่ไม่ได้', async () => {
    h.cancelled.mockResolvedValue(new Set([1]));
    h.query.mockResolvedValueOnce({ recordset: [suspendedRow] });
    expect((await POST(postRequest(pairBody))).status).toBe(409);
    expect(h.rollback).toHaveBeenCalledOnce();
  });

  it('ยังไม่ได้รัน sql/008 ข้ามด่านปิดงวด แต่ยังตรวจสิทธิ์ฝั่งเสมอ', async () => {
    h.periodReady.mockResolvedValue(false);
    mockHappyPath(null);
    expect((await POST(postRequest(pairBody))).status).toBe(200);
    expect(h.datesOpen).not.toHaveBeenCalled();
    expect(sqlText().some((s) => s.includes('ReconciliationPeriodClose'))).toBe(false);
    expect(h.workSides).toHaveBeenCalledOnce();
  });

  it('ไม่มีสิทธิ์ฝั่งนั้น ตอบ 403', async () => {
    h.query
      .mockResolvedValueOnce({ recordset: [suspendedRow] })
      .mockResolvedValueOnce({ recordset: [bankRow] })
      .mockResolvedValueOnce({ recordset: [] });
    h.workSides.mockRejectedValue(new WorkPermissionError('EMP code E1 ไม่มีสิทธิ์ AP'));
    const response = await POST(postRequest(pairBody));
    expect(response.status).toBe(403);
    expect(h.rollback).toHaveBeenCalledOnce();
  });

  it('statement ถูกจับคู่ตัดหน้าระหว่างบันทึก ยกเลิกทั้งหมด', async () => {
    h.query
      .mockResolvedValueOnce({ recordset: [suspendedRow] })
      .mockResolvedValueOnce({ recordset: [bankRow] })
      .mockResolvedValueOnce({ recordset: [] })
      .mockResolvedValueOnce({ rowsAffected: [1] })
      .mockResolvedValueOnce({ recordset: [{ cnt: 0 }] })
      .mockResolvedValueOnce({ rowsAffected: [1] })
      .mockResolvedValueOnce({ rowsAffected: [0] });

    const response = await POST(postRequest(pairBody));
    expect(response.status).toBe(409);
    expect(h.rollback).toHaveBeenCalledOnce();
    expect(h.commit).not.toHaveBeenCalled();
  });
});
