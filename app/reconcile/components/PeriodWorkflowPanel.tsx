"use client";

import HelpTooltip from '../../../components/HelpTooltip';
import { useState } from 'react';
import { CheckCircle2, Loader2, Lock } from 'lucide-react';
import { approvalsComplete, workLabel, type WorkDirection } from '../../../lib/periodWorkflow';
import type { BalanceData } from './balanceTypes';
import { checksForDirection, warningCount, type PeriodCheck } from '../../../lib/periodCloseChecks';
import { directionWorkRole, hasWorkRole } from '../../../lib/workRoles';

export type WorkApprovalAction = {
  direction: WorkDirection;
  reopen: boolean;
  note: string;
  periodStart: string;
  periodEnd: string;
};

// ลำดับที่อ่านง่ายที่สุดคือข้อที่ต้องแก้ก่อน แล้วค่อยข้อที่ยังตรวจไม่ได้ ปิดท้ายด้วยข้อที่ผ่าน
const LEVEL_ORDER: Record<PeriodCheck['level'], number> = { warn: 0, unknown: 1, ok: 2 };

/**
 * ผลตรวจเงื่อนไขปิดงวดตามสเปก (docs/spec-matching-period-close.md ข้อ 48)
 * ตอนนี้เป็นคำเตือนอย่างเดียว ปุ่มยืนยันยังกดได้ตามเดิม
 */
function CheckList({ checks }: { checks: PeriodCheck[] }) {
  if (checks.length === 0) return null;
  const sorted = [...checks].sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
  return (
    <ul className="space-y-1.5">
      {sorted.map((check) => (
        <li
          key={`${check.item}-${check.direction ?? 'ALL'}`}
          className={`rounded-lg border px-2.5 py-2 ${
            check.level === 'warn'
              ? 'border-amber-200 bg-amber-50 text-amber-900'
              : check.level === 'unknown'
                ? 'border-slate-200 bg-white text-slate-600'
                : 'border-emerald-200 bg-emerald-50 text-emerald-900'
          }`}
        >
          <p className="font-medium">
            <span className="mr-1.5 rounded bg-white/70 px-1 text-[10px] font-semibold">ข้อ {check.item}</span>
            {check.title}
          </p>
          <p className="mt-0.5 leading-relaxed opacity-80">{check.detail}</p>
        </li>
      ))}
    </ul>
  );
}

export default function PeriodWorkflowPanel({ data, onWorkApproval, onClosePeriod, onReopenPeriod }: {
  data: BalanceData;
  onWorkApproval: (action: WorkApprovalAction) => Promise<string | null>;
  onClosePeriod: () => Promise<string | null>;
  onReopenPeriod: (reason: string) => Promise<string | null>;
}) {
  const [action, setAction] = useState<WorkDirection | 'CLOSE' | 'REOPEN' | null>(null);
  const [note, setNote] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const closed = data.periodClose?.status === 'CLOSED';
  const approvals = data.workApproval?.approvals ?? [];
  const checks = data.checks ?? [];
  const ready = data.workApproval?.ready === true;
  const permissions = data.workApproval?.permissions;
  // เปิดงวดคืน (และปิดงวดที่ค้างจากก่อนปิดอัตโนมัติ) = Master Admin: Dev/Admin ระบบกลาง หรือ User ที่ได้ MASTER
  const canMaster = hasWorkRole(permissions, 'MASTER');
  const permissionHint = !permissions?.ready ? 'ต้องติดตั้งสิทธิ์พนักงาน (sql/010_employee_work_roles.sql) ก่อน'
    : !permissions.employeeCode && permissions.roles.length === 0 ? 'ไม่พบ EMP code กรุณาเข้าสู่ระบบใหม่ หรือติดต่อผู้ดูแลระบบ'
      : `${permissions.employeeCode ? `EMP code ${permissions.employeeCode} · ` : ''}สิทธิ์: ${permissions.roles.join(', ') || 'ยังไม่ได้รับสิทธิ์ยืนยันงาน'}`;
  const complete = approvalsComplete(approvals, data.period.from, data.period.to);
  const remaining = data.adjustment.remaining;
  const settled = remaining !== null && Number.isFinite(remaining) && Math.abs(remaining) < 0.005;
  const problem = !ready ? 'ยังไม่ได้ติดตั้งโครงสร้างยืนยันงาน AP/AR (sql/009_period_work_approval.sql)'
    : !settled ? 'ผลต่างคงเหลือหลังปรับปรุงต้องเป็นศูนย์ก่อนยืนยันฝั่งสุดท้าย (AP และ AR ยืนยันครบ = ปิดงวดทันที)'
      : !complete ? 'รอ AP และ AR ยืนยันงานครบในช่วงวันที่เดียวกัน — ยืนยันครบแล้วงวดจะปิดอัตโนมัติ' : null;
  const selected = approvals.find((a) => a.direction === action);
  // อีกฝั่งยืนยันไว้แล้ว — การยืนยันครั้งนี้จะปิดงวดรวมทันที
  const closesPeriod = (action === 'IN' || action === 'OUT') && !selected && approvals.some((a) => a.direction !== action);

  function select(next: typeof action) {
    setAction(next); setNote(''); setAcknowledged(false); setError('');
  }
  async function submit() {
    if (!action || busy || !acknowledged || (action !== 'CLOSE' && !note.trim())) return;
    if (!hasWorkRole(permissions, action === 'CLOSE' || action === 'REOPEN' ? 'MASTER' : directionWorkRole(action))) {
      setError('ไม่มีสิทธิ์ดำเนินการนี้ กรุณาติดต่อผู้ดูแลระบบ'); return;
    }
    setBusy(true); setError('');
    try {
      const message = action === 'CLOSE' ? await onClosePeriod()
        : action === 'REOPEN' ? await onReopenPeriod(note.trim())
          : await onWorkApproval({ direction: action, reopen: Boolean(selected), note: note.trim(),
            periodStart: selected?.periodStart ?? data.period.from, periodEnd: selected?.periodEnd ?? data.period.to });
      if (message) setError(message);
      else select(null);
    } catch {
      setError('บันทึกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
    } finally { setBusy(false); }
  }

  return (
    <section className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs" aria-label="การยืนยันงานและปิดงวด">
      <div className="flex items-center gap-1"><h3 className="font-semibold text-slate-800">ยืนยันงาน AP / AR และปิดงวดรวม</h3>
        <HelpTooltip label="ขั้นตอนยืนยันงานและปิดงวด">ตรวจสอบรายการจับคู่และรายการค้าง แล้วให้ AP และ AR ยืนยันงานในช่วงวันที่เดียวกัน เมื่อยืนยันครบทั้งสองฝั่ง (และผลต่างหลังปรับปรุงเป็นศูนย์) งวดจะปิดทันที เปิดงวดคืนได้เฉพาะ Master Admin</HelpTooltip>
      </div>
      <p className="mt-1 text-slate-500">{data.period.from} ถึง {data.period.to}</p>
      <p className="mt-1 text-slate-500">{permissionHint}</p>
      {closed ? (
        <div className="mt-3 flex items-center justify-between gap-3 text-emerald-800">
          <span><Lock size={13} className="mr-1 inline" />ปิดงวดรวมแล้ว โดย {data.periodClose?.closedBy}
            <span className="mt-1 block">{data.periodClose?.periodStart} ถึง {data.periodClose?.periodEnd}</span>
          </span>
          <button disabled={busy || !ready || !canMaster} title={!canMaster ? 'ต้องเป็น Master Admin' : undefined} onClick={() => select('REOPEN')} className="rounded-lg border bg-white px-3 py-2 disabled:opacity-40">เปิดงวดรวมอีกครั้ง</button>
        </div>
      ) : (
        <>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {(['OUT', 'IN'] as const).map((direction) => {
              const approval = approvals.find((a) => a.direction === direction);
              const canAct = hasWorkRole(permissions, directionWorkRole(direction));
              // ข้อ 48 บอกสถานะของฝั่งนี้ก่อนกด ยังไม่บล็อกปุ่ม เพราะตกลงกันว่าเตือนก่อน
              const sideWarnings = warningCount(checksForDirection(checks, direction));
              return (
                <div key={direction} className={`rounded-lg border p-3 ${approval ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-white'}`}>
                  <p className="font-semibold">{workLabel(direction)} · {approval ? 'ยืนยันแล้ว' : 'ยังไม่ยืนยัน'}</p>
                  {checks.length > 0 && (
                    <p className={`mt-1 ${sideWarnings > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
                      {sideWarnings > 0
                        ? `ตามสเปกใหม่มีคำเตือน ${sideWarnings} ข้อ กดยืนยันเพื่อดูรายละเอียด`
                        : 'ผ่านทุกข้อที่ระบบตรวจได้ตามสเปกใหม่'}
                    </p>
                  )}
                  {approval ? <>
                    <p className="mt-1 text-slate-600">โดย {approval.confirmedBy} · {new Date(approval.confirmedAt).toLocaleString('th-TH')}</p>
                    <p className="mt-1 text-slate-600">{approval.periodStart} ถึง {approval.periodEnd}</p>
                    <p className="mt-1 break-words text-slate-600">{approval.note}</p>
                  </> : null}
                  <button disabled={busy || !ready || !canAct}
                    title={!canAct ? `ต้องมีสิทธิ์ ${directionWorkRole(direction)}` : undefined}
                    onClick={() => select(direction)} className="mt-2 rounded-lg border border-slate-200 bg-white px-3 py-2 font-medium disabled:cursor-not-allowed disabled:opacity-40">
                    {approval ? 'เปิดงานฝั่งนี้อีกครั้ง' : `ยืนยันงาน ${direction === 'OUT' ? 'AP' : 'AR'}`}
                  </button>
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-slate-600">{problem ?? 'AP/AR ยืนยันครบ และยอดพร้อมปิดงวดรวม'}</p>
            {/* ปกติไม่เห็นปุ่มนี้: ยืนยันครบ = ปิดอัตโนมัติ เหลือไว้ให้ Master Admin ปิดงวดที่ยืนยันครบไว้ก่อนเปลี่ยนระบบ */}
            {complete && <button disabled={busy || Boolean(problem) || !canMaster} title={!canMaster ? 'ต้องเป็น Master Admin' : undefined} onClick={() => select('CLOSE')} className="shrink-0 rounded-lg bg-emerald-600 px-3 py-2 font-medium text-white disabled:cursor-not-allowed disabled:opacity-40">
              <Lock size={13} className="mr-1 inline" />ปิดงวดรวม
            </button>}
          </div>
        </>
      )}
      {!ready && closed && <p className="mt-2 text-amber-700">{problem}</p>}
      {action && <div className="mt-3 space-y-2 border-t border-slate-200 pt-3">
        <p className="font-medium text-slate-800">
          {action === 'CLOSE' ? 'ยืนยันปิดงวดรวม — ล็อกทั้ง AP และ AR'
            : action === 'REOPEN' ? 'เปิดงวดรวม — ยกเลิกการยืนยันทั้ง AP/AR และต้องตรวจสอบยืนยันใหม่'
              : selected ? `เปิดงาน ${workLabel(action)} — อีกฝั่งยังคงสถานะเดิม`
                : closesPeriod ? `ยืนยันงาน ${workLabel(action)} — อีกฝั่งยืนยันแล้ว ยืนยันครั้งนี้จะปิดงวดรวมทันที`
                  : `ยืนยันงาน ${workLabel(action)} — ล็อกการแก้ไขฝั่งนี้`}
        </p>
        {(action === 'IN' || action === 'OUT') && !selected && checks.length > 0 && <>
          <p className="text-slate-600">ผลตรวจตามสเปกใหม่ของฝั่งนี้ ยังไม่บล็อกการยืนยัน ใช้ดูว่าเหลืออะไรก่อนยืนยัน</p>
          <CheckList checks={checksForDirection(checks, action)} />
        </>}
        {action !== 'CLOSE' && <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} disabled={busy}
          aria-label="หมายเหตุการยืนยันหรือเหตุผลเปิดงาน" placeholder="ระบุผลการตรวจสอบและเหตุผลรายการค้าง หรือเหตุผลที่เปิดงานอีกครั้ง (จำเป็น)"
          className="min-h-16 w-full rounded-lg border border-slate-300 bg-white p-2" />}
        <label className="flex items-start gap-2 text-slate-700">
          <input type="checkbox" checked={acknowledged} disabled={busy} onChange={(e) => setAcknowledged(e.target.checked)} />
          {action === 'CLOSE' || action === 'IN' && !selected || action === 'OUT' && !selected
            ? 'ตรวจสอบรายการและรายการค้างแล้ว รวมถึงรายการที่ไม่มีความเคลื่อนไหว และยืนยันดำเนินการ'
            : 'รับทราบว่าต้องตรวจสอบและยืนยันงานใหม่ก่อนปิดงวดรวม'}
        </label>
        <div className="flex gap-2">
          <button onClick={submit} disabled={busy || !acknowledged || action !== 'CLOSE' && !note.trim()}
            className="flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-white disabled:opacity-40">
            {busy ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}ยืนยัน
          </button>
          <button onClick={() => select(null)} disabled={busy} className="rounded-lg border px-3 py-2">ยกเลิก</button>
        </div>
      </div>}
      {error && <p role="alert" className="mt-2 text-red-600">{error}</p>}
    </section>
  );
}
