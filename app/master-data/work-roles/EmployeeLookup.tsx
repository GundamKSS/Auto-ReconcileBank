"use client";

import { useEffect, useRef, useState } from 'react';
import type { DirectoryEmployee } from '../../../lib/employeeDirectory';
import { normalizeEmployeeCode } from '../../../lib/workRoles';

type SearchResult = { employees: DirectoryEmployee[]; truncated: boolean };
async function lookup(params: URLSearchParams, signal?: AbortSignal): Promise<SearchResult> {
  const response = await fetch(`/api/master/employees?${params}`, { cache: 'no-store', signal });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'ค้นหาพนักงานไม่สำเร็จ');
  return data;
}

function EmployeeIdentity({ code }: { code: string }) {
  const [identity, setIdentity] = useState<{ employee?: DirectoryEmployee; error?: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      lookup(new URLSearchParams({ employeeCode: code }), controller.signal).then((data) => {
        if (!controller.signal.aborted) setIdentity({ employee: data.employees[0] });
      }).catch((error) => {
        if (!controller.signal.aborted) setIdentity({ error: error instanceof Error ? error.message : 'ค้นหาพนักงานไม่สำเร็จ' });
      });
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [code]);
  return <p role="status" className={`break-words text-sm ${identity?.employee ? 'text-emerald-800' : 'text-slate-600'}`}>
    {!identity ? 'กำลังตรวจสอบชื่อพนักงาน…' : identity.error || (identity.employee
      ? `${identity.employee.employeeName || 'ยังไม่ระบุชื่อ'} · ${identity.employee.employeeCode}${identity.employee.jobTitle ? ` · ${identity.employee.jobTitle}` : ''}`
      : `ไม่พบรหัส ${code} ในทะเบียนพนักงาน จึงเปิดสิทธิ์ไม่ได้ แต่ยังปิดสิทธิ์เดิมได้`)}
  </p>;
}

export default function EmployeeLookup({ employeeCode, disabled, onSelect }: {
  employeeCode: string; disabled: boolean; onSelect: (employee: DirectoryEmployee) => void;
}) {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const code = normalizeEmployeeCode(employeeCode);

  async function search() {
    if (disabled || query.trim().length < 2) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true); setResult(null); setError('');
    try {
      const data = await lookup(new URLSearchParams({ q: query.trim() }), controller.signal);
      if (!controller.signal.aborted) setResult(data);
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'ค้นหาพนักงานไม่สำเร็จ');
    } finally { if (!controller.signal.aborted) setLoading(false); }
  }

  return <div className="min-w-0 space-y-3 rounded-xl border border-blue-100 bg-blue-50/50 p-3">
    <label htmlFor="employee-directory-search" className="block text-sm font-medium">ค้นหาพนักงานจากทะเบียนกลาง</label>
    <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
      <input id="employee-directory-search" value={query} disabled={disabled} maxLength={100}
        placeholder="EMP code หรือชื่อ (อย่างน้อย 2 ตัวอักษร)"
        onChange={(event) => { request.current?.abort(); setLoading(false); setResult(null); setError(''); setQuery(event.target.value); }}
        onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void search(); } }}
        className="min-h-11 w-full min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-base outline-none transition-colors focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:opacity-50 sm:text-sm" />
      <button type="button" disabled={disabled || loading || query.trim().length < 2} onClick={() => void search()}
        className="min-h-11 shrink-0 rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-40">{loading ? 'กำลังค้นหา…' : 'ค้นหาพนักงาน'}</button>
    </div>
    {error && <p role="alert" className="break-words text-sm text-red-700">{error}</p>}
    {result && <div aria-live="polite" className="space-y-2">
      <p className="text-sm text-slate-600">{result.employees.length ? 'เลือกพนักงาน' : 'ไม่พบพนักงานที่ตรงกับคำค้น'}</p>
      {result.truncated && <p className="text-xs text-amber-800">แสดง 20 รายการแรก กรุณาระบุรหัสหรือชื่อให้ละเอียดขึ้น</p>}
      <ul className="max-h-72 space-y-2 overflow-y-auto">{result.employees.map((employee) => <li key={employee.employeeCode}>
        <button type="button" disabled={disabled || !normalizeEmployeeCode(employee.employeeCode)} onClick={() => onSelect(employee)}
          className="min-h-11 w-full break-words rounded-xl border border-slate-200 bg-white p-3 text-left text-sm transition-colors hover:border-blue-400 hover:bg-blue-50 disabled:opacity-40">
          <span className="block font-medium">{employee.employeeName || 'ยังไม่ระบุชื่อ'}</span>
          <span className="block break-all text-slate-600">{employee.employeeCode}</span>
          {employee.jobTitle && <span className="block text-xs text-slate-500">{employee.jobTitle}</span>}
        </button>
      </li>)}</ul>
    </div>}
    {code && <EmployeeIdentity key={code} code={code} />}
  </div>;
}
