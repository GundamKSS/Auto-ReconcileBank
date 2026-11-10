import { validateBankOffsetPair, type BankOffsetCandidate } from './bankOffset';
import { remarkProblem } from './matchRemark';

export type BankOffsetLookup = {
  sourceLineId: number;
  sourceLine: BankOffsetCandidate | null;
  candidates: BankOffsetCandidate[];
  error: string;
};

// Only the current source's response can supply a selectable counterpart.
export function bankOffsetSelection(sourceLineId: number | null, lookup: BankOffsetLookup | null,
  candidateId: number | null, reason: string) {
  const current = sourceLineId !== null && lookup?.sourceLineId === sourceLineId ? lookup : null;
  const source = current?.sourceLine?.lineId === sourceLineId ? current.sourceLine : null;
  const candidate = current?.candidates.find((line) => line.lineId === candidateId) ?? null;
  const inTotal = (source?.direction === 'IN' ? source.amount : 0) + (candidate?.direction === 'IN' ? candidate.amount : 0);
  const outTotal = (source?.direction === 'OUT' ? source.amount : 0) + (candidate?.direction === 'OUT' ? candidate.amount : 0);
  let problem: string | null = current?.error || null;
  if (!problem && (!source || !candidate)) problem = 'เลือกเงินเข้าและเงินออกอย่างละ 1 รายการ';
  if (!problem && (source?.isOffset || candidate?.isOffset)) {
    const offsetLine = source?.isOffset ? source : candidate;
    problem = offsetLine?.offsetRemark
      ? `รายการนี้ถูกหักล้างไปแล้ว (หมายเหตุ: ${offsetLine.offsetRemark})`
      : 'รายการนี้ถูกหักล้างไปแล้ว ไม่สามารถเลือกซ้ำได้';
  }
  if (!problem && (source?.isPeriodClosed || candidate?.isPeriodClosed)) {
    problem = source?.closedReason || candidate?.closedReason || 'รายการอยู่ในงวดที่ปิดแล้ว';
  }
  if (!problem && source && candidate) {
    if (source.lineId === candidate.lineId || source.bankCode !== candidate.bankCode) {
      problem = 'กรุณาเลือกคู่หักล้างในธนาคารเดียวกันที่เป็นคนละรายการ';
    } else {
      const validation = validateBankOffsetPair(source, candidate, reason);
      problem = validation.ok ? remarkProblem(reason) : validation.error;
    }
  }
  return { current, source, candidate, inTotal, outTotal, difference: inTotal - outTotal, problem };
}
