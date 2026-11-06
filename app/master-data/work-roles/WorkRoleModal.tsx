"use client";

import HelpTooltip from '../../../components/HelpTooltip';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Loader2, Save, ShieldCheck, X } from 'lucide-react';
import { WORK_ROLES, WORK_ROLE_LABELS, normalizeEmployeeCode, type WorkRole } from '../../../lib/workRoles';
import { remarkProblem } from '../../../lib/matchRemark';
import EmployeeLookup from './EmployeeLookup';

type EditableAssignment = { employeeCode: string; roleCode: WorkRole; isActive: boolean };

export default function WorkRoleModal({ assignment, onDismiss, onSaved }: {
  assignment?: EditableAssignment;
  onDismiss: () => void;
  onSaved: (employeeCode: string, role: WorkRole, active: boolean) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const [employee, setEmployee] = useState(assignment?.employeeCode ?? '');
  const [role, setRole] = useState<WorkRole>(assignment?.roleCode ?? 'AP');
  const [active, setActive] = useState(assignment?.isActive ?? true);
  const [reason, setReason] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const element = dialog.current;
    const trigger = document.activeElement;
    const overflow = document.body.style.overflow;
    element?.showModal();
    closeButton.current?.focus();
    document.body.style.overflow = 'hidden';
    return () => {
      element?.close();
      document.body.style.overflow = overflow;
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
    };
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = normalizeEmployeeCode(employee);
    if (!code || remarkProblem(reason) || !acknowledged || saving) return;
    setSaving(true); setError('');
    try {
      const response = await fetch('/api/master/work-roles', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeCode: code, roleCode: role, isActive: active, reason }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'บันทึกไม่สำเร็จ');
      onSaved(code, role, active);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
    } finally { setSaving(false); }
  }

  const inputClass = 'mt-1.5 block min-h-11 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-base text-slate-800 outline-none transition-colors focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:opacity-50 sm:text-sm';

  return <dialog ref={dialog} aria-labelledby="work-role-modal-title"
    onCancel={(event) => { event.preventDefault(); if (!saving) onDismiss(); }}
    className="fixed m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-2xl flex-col overflow-hidden rounded-3xl border border-white/80 bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-900/30 backdrop:backdrop-blur-sm open:flex">
    <div className="flex shrink-0 items-start gap-3 border-b border-slate-100 px-5 py-5 sm:px-6">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600"><ShieldCheck size={20} /></div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <h2 id="work-role-modal-title" className="text-lg font-semibold">{assignment ? 'เปลี่ยนสิทธิ์พนักงาน' : 'กำหนดสิทธิ์'}</h2>
          <HelpTooltip label="วิธีกำหนดสิทธิ์พนักงาน">เลือกพนักงาน สิทธิ์ และสถานะ พร้อมระบุเหตุผล เปิดสิทธิ์ได้เมื่อพบ EMP code ในทะเบียนกลาง ส่วนสิทธิ์เดิมยังปิดได้แม้ทะเบียนกลางไม่พร้อมใช้งาน</HelpTooltip>
        </div>
      </div>
      <button ref={closeButton} type="button" onClick={onDismiss} disabled={saving} aria-label="ปิดหน้าต่างกำหนดสิทธิ์"
        className="flex size-9 shrink-0 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"><X size={20} /></button>
    </div>
    <form onSubmit={(event) => void save(event)} aria-busy={saving} className="flex min-h-0 flex-col">
      <div className="min-h-0 space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
        <EmployeeLookup employeeCode={employee} disabled={saving} onSelect={(selected) => {
          setEmployee(selected.employeeCode); setAcknowledged(false);
        }} />
        <fieldset disabled={saving} className="grid min-w-0 gap-4 sm:grid-cols-2">
          <label className="min-w-0 text-sm font-medium text-slate-600 sm:col-span-2">EMP code <span className="text-red-500">*</span>
            <input required maxLength={50} value={employee} onChange={(event) => { setEmployee(event.target.value); setAcknowledged(false); }} className={inputClass} placeholder="รหัสพนักงานจากระบบกลาง" />
          </label>
          <label className="min-w-0 text-sm font-medium text-slate-600">สิทธิ์
            <select value={role} onChange={(event) => { setRole(event.target.value as WorkRole); setAcknowledged(false); }} className={`${inputClass} max-w-full truncate`}>
              {WORK_ROLES.map((code) => <option key={code} value={code}>{code === 'MASTER' ? 'MASTER (ผู้ดูแลระบบ)' : WORK_ROLE_LABELS[code]}</option>)}
            </select>
          </label>
          <label className="min-w-0 text-sm font-medium text-slate-600">สถานะ
            <select value={String(active)} onChange={(event) => { setActive(event.target.value === 'true'); setAcknowledged(false); }} className={inputClass}>
              <option value="true">เปิดสิทธิ์</option><option value="false">ปิดสิทธิ์</option>
            </select>
          </label>
        </fieldset>
        <label className="block text-sm font-medium text-slate-600">เหตุผล <span className="text-red-500">*</span>
          <textarea required disabled={saving} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} className={`${inputClass} min-h-24 resize-y`} placeholder="ระบุเหตุผลในการกำหนดสิทธิ์" />
          <span className="mt-1.5 flex justify-between gap-3 text-xs font-normal text-slate-400"><span>อย่างน้อย 5 ตัวอักษร</span><span>{reason.length}/500</span></span>
        </label>
        <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-blue-100 bg-blue-50/50 p-3 text-sm leading-relaxed text-slate-700">
          <input type="checkbox" className="mt-1 size-4 shrink-0 accent-blue-500" checked={acknowledged} disabled={saving} onChange={(event) => setAcknowledged(event.target.checked)} />
          ตรวจสอบ EMP code และสิทธิ์ที่ต้องการแล้ว
        </label>
        {error && <p role="alert" className="break-words rounded-xl border border-red-100 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      </div>
      <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-4 sm:px-6">
        <button type="button" onClick={onDismiss} disabled={saving} className="min-h-11 rounded-full px-5 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 disabled:opacity-40">ยกเลิก</button>
        <button disabled={saving || !acknowledged || !normalizeEmployeeCode(employee) || Boolean(remarkProblem(reason))}
          className="flex min-h-11 items-center justify-center gap-2 rounded-full bg-blue-500 px-5 py-2 text-sm font-semibold text-white shadow-md shadow-blue-200 transition-colors hover:bg-blue-600 disabled:opacity-40 disabled:shadow-none">
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}{saving ? 'กำลังบันทึก…' : 'บันทึกสิทธิ์'}
        </button>
      </div>
    </form>
  </dialog>;
}
