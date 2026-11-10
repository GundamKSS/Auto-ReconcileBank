import { NextRequest, NextResponse } from 'next/server';
import sql from 'mssql';
import { getPool } from '../../../../lib/db';
import { requireRole } from '../../../../lib/session';
import { RECONCILE_ROLES } from '../../../../lib/roles';
import { badRequest, parseIdParam } from '../../../../lib/apiInput';
import { assertDatesOpen, isoDate, PeriodClosedError, reconcilePeriodCloseReady } from '../../../../lib/periodClose';
import { assertWorkSides, WorkPermissionError } from '../../../../lib/workRolesDb';
import type { WorkDirection } from '../../../../lib/workRoles';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await requireRole(RECONCILE_ROLES);
  if (!auth.ok) return auth.response;

  try {
    const params = req.nextUrl.searchParams;
    const lineId = parseIdParam(params.get('lineId'));
    if (lineId === null) return badRequest('lineId ต้องเป็นจำนวนเต็มบวก');

    const pool = await getPool();

    // 1) ดึงรายการต้นทางฝั่งตนเอง
    const sourceResult = await pool
      .request()
      .input('lineId', sql.Int, lineId)
      .query(`
        SELECT LineId, BankCode, BankAccountNo, TranDate, Description, Debit, Credit, Balance,
               ChequeNo, Channel, RawDescription, SenderBank, SenderAccountNo, SenderAccountName,
               UPPER(MatchStatus) AS MatchStatus
        FROM BankStatementLine
        WHERE LineId = @lineId AND MatchStatus <> 'DELETED'
      `);

    if (sourceResult.recordset.length === 0) {
      return badRequest('ไม่พบรายการเดินบัญชีที่ระบุ หรือไฟล์ถูกลบไปแล้ว');
    }

    const sRow = sourceResult.recordset[0];
    if (sRow.MatchStatus !== 'UNMATCHED') {
      return badRequest('รายการนี้ถูกจับคู่หรือหักล้างไปแล้ว กรุณารีเฟรชหน้าใหม่');
    }

    const sourceDirection: WorkDirection = sRow.Credit !== null ? 'IN' : 'OUT';
    const sourceAmount = sRow.Credit !== null ? Number(sRow.Credit) : Number(sRow.Debit);
    const oppositeDirection: WorkDirection = sourceDirection === 'IN' ? 'OUT' : 'IN';

    // ตรวจสิทธิ์ว่าผู้ใช้มีสิทธิ์ในฝั่งของรายการต้นทางหรือไม่
    try {
      await assertWorkSides(auth.session, [sourceDirection], pool, 'any');
    } catch (err) {
      if (err instanceof WorkPermissionError) {
        return NextResponse.json({ error: err.message }, { status: 403 });
      }
      throw err;
    }

    const periodReady = await reconcilePeriodCloseReady();

    // ตรวจว่ารายการต้นทางอยู่ในงวดที่ปิดแล้วหรือไม่
    let sourcePeriodClosed = false;
    let sourceClosedReason: string | null = null;
    if (sRow.BankAccountNo && periodReady) {
      try {
        await assertDatesOpen(pool, sRow.BankAccountNo, [
          { date: isoDate(sRow.TranDate), direction: sourceDirection },
        ]);
      } catch (err) {
        if (err instanceof PeriodClosedError) {
          sourcePeriodClosed = true;
          sourceClosedReason = err.message;
        } else {
          throw err;
        }
      }
    }

    // 2) ค้นหารายการอีกฝั่งในบัญชีเดียวกันที่ยอดเงินเท่ากันพอดี (ต่างไม่เกินครึ่งสตางค์)
    //    รวมรายการที่ถูกหักล้างไปแล้ว (OFFSET) มาด้วยเพื่อแสดงเป็นแถวสีเทา (ไม่ให้กด) พร้อมหมายเหตุที่อีกฝั่งเขียนไว้
    const amountCondition = oppositeDirection === 'IN'
      ? 'b.Credit IS NOT NULL AND ABS(b.Credit - @amount) < 0.005'
      : 'b.Debit IS NOT NULL AND ABS(b.Debit - @amount) < 0.005';
    const candidatesQuery = `
      SELECT b.LineId, b.BankCode, b.BankAccountNo, b.TranDate, b.Description, b.Debit, b.Credit, b.Balance,
             b.ChequeNo, b.Channel, b.RawDescription, b.SenderBank, b.SenderAccountNo, b.SenderAccountName,
             UPPER(b.MatchStatus) AS MatchStatus,
             om.OffsetMatchId, om.OffsetNum, om.OffsetRemark, om.OffsetBy,
             om.CounterpartLineId, om.CounterpartDate, om.CounterpartChequeNo, om.CounterpartDescription
      FROM BankStatementLine b
      OUTER APPLY (
        SELECT TOP 1
          rm.MatchId AS OffsetMatchId,
          rml.Num AS OffsetNum,
          rm.Remark AS OffsetRemark,
          rm.CreatedBy AS OffsetBy,
          bc.LineId AS CounterpartLineId,
          bc.TranDate AS CounterpartDate,
          bc.ChequeNo AS CounterpartChequeNo,
          bc.Description AS CounterpartDescription
        FROM ReconciliationMatchLine rml
        JOIN ReconciliationMatch rm ON rm.MatchId = rml.MatchId AND rm.Status = 'ACTIVE' AND rm.MatchType = 'OFFSET'
        OUTER APPLY (
          SELECT TOP 1 b2.LineId, b2.TranDate, b2.ChequeNo, b2.Description
          FROM ReconciliationMatchLine rml2
          JOIN BankStatementLine b2 ON b2.LineId = rml2.BankLineId
          WHERE rml2.MatchId = rm.MatchId AND rml2.Num = rml.Num
            AND rml2.SourceType = 'BANK' AND rml2.Status = 'ACTIVE'
            AND rml2.BankLineId <> b.LineId
        ) bc
        WHERE b.MatchStatus = 'OFFSET'
          AND rml.SourceType = 'BANK' AND rml.BankLineId = b.LineId AND rml.Status = 'ACTIVE'
        ORDER BY rm.MatchId DESC
      ) om
      WHERE b.MatchStatus IN ('UNMATCHED', 'OFFSET')
        AND b.LineId <> @lineId
        AND ${amountCondition}
        ${sRow.BankAccountNo ? 'AND b.BankAccountNo = @bankAccountNo' : 'AND b.BankCode = @bankCode'}
      ORDER BY CASE WHEN b.MatchStatus = 'UNMATCHED' THEN 0 ELSE 1 END, b.TranDate, b.LineId
    `;

    const candidatesReq = pool
      .request()
      .input('lineId', sql.Int, lineId)
      .input('amount', sql.Decimal(18, 2), sourceAmount)
      .input('bankCode', sql.NVarChar, sRow.BankCode);
    if (sRow.BankAccountNo) {
      candidatesReq.input('bankAccountNo', sql.NVarChar, sRow.BankAccountNo);
    }

    const candidatesResult = await candidatesReq.query(candidatesQuery);

    // 3) ตรวจสอบงวดปิดของแต่ละ candidate
    const candidates = await Promise.all(
      candidatesResult.recordset.map(async (c) => {
        let isPeriodClosed = false;
        let closedReason: string | null = null;
        if (c.BankAccountNo && periodReady) {
          try {
            await assertDatesOpen(pool, c.BankAccountNo, [
              { date: isoDate(c.TranDate), direction: oppositeDirection },
            ]);
          } catch (err) {
            if (err instanceof PeriodClosedError) {
              isPeriodClosed = true;
              closedReason = err.message;
            } else {
              throw err;
            }
          }
        }

        const amount = c.Credit !== null ? Number(c.Credit) : Number(c.Debit);
        const isOffset = String(c.MatchStatus ?? 'UNMATCHED').toUpperCase() === 'OFFSET';
        const counterpartRef = c.CounterpartLineId
          ? c.CounterpartChequeNo && c.CounterpartChequeNo !== '0'
            ? `Chq ${c.CounterpartChequeNo}`
            : `L-${c.CounterpartLineId}`
          : null;
        return {
          lineId: Number(c.LineId),
          bankCode: c.BankCode,
          bankAccountNo: c.BankAccountNo,
          date: isoDate(c.TranDate),
          description: c.Description,
          debit: c.Debit !== null ? Number(c.Debit) : null,
          credit: c.Credit !== null ? Number(c.Credit) : null,
          amount,
          direction: oppositeDirection,
          chequeNo: c.ChequeNo && c.ChequeNo !== '0' ? c.ChequeNo : null,
          channel: c.Channel,
          rawDescription: c.RawDescription,
          senderBank: c.SenderBank,
          senderAccountNo: c.SenderAccountNo,
          senderAccountName: c.SenderAccountName,
          isPeriodClosed,
          closedReason,
          ...(isOffset
            ? {
                isOffset: true,
                offsetMatchId: c.OffsetMatchId !== null && c.OffsetMatchId !== undefined ? Number(c.OffsetMatchId) : null,
                offsetNum: c.OffsetNum !== null && c.OffsetNum !== undefined ? Number(c.OffsetNum) : 1,
                offsetRemark: c.OffsetRemark ?? null,
                offsetBy: c.OffsetBy ?? null,
                offsetCounterpartRef: counterpartRef,
                offsetCounterpartDate: c.CounterpartDate ? isoDate(c.CounterpartDate) : null,
                offsetCounterpartDescription: c.CounterpartDescription ?? null,
              }
            : {}),
        };
      })
    );

    return NextResponse.json({
      sourceLine: {
        lineId: Number(sRow.LineId),
        bankCode: sRow.BankCode,
        bankAccountNo: sRow.BankAccountNo,
        date: isoDate(sRow.TranDate),
        description: sRow.Description,
        debit: sRow.Debit !== null ? Number(sRow.Debit) : null,
        credit: sRow.Credit !== null ? Number(sRow.Credit) : null,
        amount: sourceAmount,
        direction: sourceDirection,
        chequeNo: sRow.ChequeNo && sRow.ChequeNo !== '0' ? sRow.ChequeNo : null,
        channel: sRow.Channel,
        rawDescription: sRow.RawDescription,
        senderBank: sRow.SenderBank,
        senderAccountNo: sRow.SenderAccountNo,
        senderAccountName: sRow.SenderAccountName,
        isPeriodClosed: sourcePeriodClosed,
        closedReason: sourceClosedReason,
      },
      candidates,
    });
  } catch (err) {
    console.error('Bank offset candidates error:', err);
    return NextResponse.json({ error: 'ไม่สามารถค้นหารายการหักล้างได้' }, { status: 500 });
  }
}
