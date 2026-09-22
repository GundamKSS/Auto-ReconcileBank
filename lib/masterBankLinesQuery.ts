import sql from 'mssql';
import { parseDateRange, parseIdParam } from './apiInput';

// query กลางของรายการในไฟล์ Bank Statement หน้า Master Data — ใช้ร่วมกันระหว่าง "สรุปรายวัน"
// (/api/master/bank-statement/days) กับ "รายการในวัน" (/api/master/bank-statement/lines)
// ให้ตัวกรองสองชุดตรงกันเสมอ ยอดรวมของวันจะได้เท่ากับรายการที่กางดู
//
// ไม่กรอง MatchStatus เป็นค่าเริ่มต้น เพราะเป็นหน้า master data ต้องเห็นครบทุกสถานะ
// ฝาก/ถอนแยกด้วย Credit IS NOT NULL แบบเดียวกับ /api/reconcile/data — ทุกบรรทัดมีช่องใดช่องหนึ่งเท่านั้น

const STATUS_VALUES = new Set(['UNMATCHED', 'MATCHED', 'SUSPENSE']);

export type BankLineFilters = {
  importId: number;
  from: Date | null;
  to: Date | null;
  channel: string | null;
  status: string | null;
};

export function parseBankLineFilters(params: URLSearchParams): { error: string } | BankLineFilters {
  const raw = params.get('importId');
  if (!raw) return { error: 'ต้องระบุ importId' };
  // ค่าอย่าง "abc" ต้องได้ 400 ไม่ใช่รายการว่างพร้อม 200 — ไม่งั้นแยกไม่ออกว่าไฟล์ไม่มีรายการหรือส่ง id ผิด
  const importId = parseIdParam(raw);
  if (importId === null) return { error: 'importId ต้องเป็นจำนวนเต็มบวก' };

  const range = parseDateRange(params.get('from'), params.get('to'));
  if ('error' in range) return range;

  const status = params.get('status')?.trim().toUpperCase() || null;
  if (status && !STATUS_VALUES.has(status)) return { error: 'status ต้องเป็น UNMATCHED, MATCHED หรือ SUSPENSE' };

  return {
    importId,
    from: range.from,
    to: range.to,
    channel: params.get('channel')?.trim() || null,
    status,
  };
}

export function bankLineWhere(f: BankLineFilters) {
  return `
    WHERE ImportId = @importId
      ${f.from ? 'AND TranDate >= @from' : ''}
      ${f.to ? 'AND TranDate <= @to' : ''}
      ${f.channel ? 'AND Channel = @channel' : ''}
      ${f.status ? 'AND UPPER(MatchStatus) = @status' : ''}
  `;
}

export function bindBankLineFilters(request: sql.Request, f: BankLineFilters) {
  request.input('importId', sql.Int, f.importId);
  if (f.from) request.input('from', sql.Date, f.from);
  if (f.to) request.input('to', sql.Date, f.to);
  if (f.channel) request.input('channel', sql.NVarChar, f.channel);
  if (f.status) request.input('status', sql.NVarChar, f.status);
  return request;
}
