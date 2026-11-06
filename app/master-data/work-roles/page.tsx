"use client";

import HelpTooltip from '../../../components/HelpTooltip';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, CheckCircle2, History, Loader2, Menu, Pencil, Plus, RefreshCw, Search, ShieldCheck, Users } from 'lucide-react';
import MainContent from '../../../components/MainContent';
import { useSidebar } from '../../../components/SidebarContext';
import { WORK_ROLE_LABELS, type WorkRole } from '../../../lib/workRoles';
import WorkRoleModal from './WorkRoleModal';

type Assignment = { employeeCode: string; employeeName?: string | null; roleCode: WorkRole; isActive: boolean; updatedBy: string; updatedAt: string };
type RoleEvent = { eventId: number; employeeCode: string; employeeName?: string | null; roleCode: WorkRole; isActive: boolean; actor: string; reason: string; createdAt: string };
type RoleData = { roles: Assignment[]; history: RoleEvent[]; truncated: boolean; directoryWarning?: string };

async function fetchWorkRoles(code: string, signal?: AbortSignal): Promise<RoleData> {
  const res = await fetch(`/api/master/work-roles${code ? `?employeeCode=${encodeURIComponent(code)}` : ''}`, { cache: 'no-store', signal });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'โหลดข้อมูลไม่สำเร็จ');
  return data;
}

export default function WorkRolesPage() {
  const { toggleMobileOpen, mobileOpen } = useSidebar();
  const [roles, setRoles] = useState<Assignment[]>([]);
  const [history, setHistory] = useState<RoleEvent[]>([]);
  const [filter, setFilter] = useState('');
  const [view, setView] = useState<'roles' | 'history'>('roles');
  const [editor, setEditor] = useState<{ assignment?: Assignment } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [truncated, setTruncated] = useState(false);
  const [directoryWarning, setDirectoryWarning] = useState('');
  const sequence = useRef(0);
  const load = useCallback(async (code = '', signal?: AbortSignal) => {
    const id = ++sequence.current;
    try {
      const data = await fetchWorkRoles(code, signal);
      if (id !== sequence.current || signal?.aborted) return;
      setError('');
      setRoles(data.roles); setHistory(data.history); setTruncated(data.truncated);
      setDirectoryWarning(data.directoryWarning || '');
    } catch (err) {
      if (id === sequence.current && !signal?.aborted) { setRoles([]); setHistory([]); setError(err instanceof Error ? err.message : 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'); }
    } finally { if (id === sequence.current && !signal?.aborted) setLoading(false); }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const id = ++sequence.current;
    const current = () => !controller.signal.aborted && id === sequence.current;
    fetchWorkRoles('', controller.signal).then((data) => {
      if (!current()) return;
      setRoles(data.roles); setHistory(data.history); setTruncated(data.truncated); setError('');
      setDirectoryWarning(data.directoryWarning || '');
    }).catch((err) => {
      if (current()) setError(err instanceof Error ? err.message : 'โหลดข้อมูลไม่สำเร็จ');
    }).finally(() => { if (current()) setLoading(false); });
    return () => controller.abort();
  }, []);
  function reload() { setLoading(true); setError(''); void load(filter.trim()); }

  function openEditor(assignment?: Assignment) {
    setMessage('');
    setEditor({ assignment });
  }

  function selectTab(next: 'roles' | 'history') {
    setView(next);
  }

  const tabs = [
    { key: 'roles', label: 'สิทธิ์ที่กำหนดไว้', icon: Users },
    { key: 'history', label: 'ประวัติเปลี่ยนสิทธิ์', icon: History },
  ] as const;

  return <MainContent className="min-h-screen bg-[#f8fafc]">
    <main className="w-full min-w-0 space-y-6 px-3 py-4 sm:p-6 xl:p-8">
      <header className="flex min-w-0 flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <button type="button" onClick={toggleMobileOpen} aria-label="เปิดเมนูหลัก" aria-expanded={mobileOpen}
            className="flex size-11 shrink-0 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 lg:hidden"><Menu size={22} /></button>
          <div className="hidden size-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-blue-600 shadow-lg shadow-blue-500/20 sm:flex">
            <ShieldCheck size={22} className="text-white" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5"><h1 className="break-words text-xl font-bold tracking-tight text-slate-900 sm:text-3xl">สิทธิ์พนักงาน</h1>
              <HelpTooltip label="เกี่ยวกับสิทธิ์ยืนยันงาน">สำหรับผู้ใช้ที่เป็น User ในระบบกลาง: AP = เงินออก, AR = เงินเข้า, MASTER = ทำได้ทุกอย่าง (รวมเปิดงวดและให้สิทธิ์) ไม่ได้รับสิทธิ์ = ดูภาพรวม/รายงานเท่านั้น · Dev และ Admin ระบบกลางทำได้ทุกอย่างโดยไม่ต้องกำหนดที่นี่ · AP และ AR ยืนยันงานครบ = ปิดงวดทันที</HelpTooltip>
            </div>
          </div>
        </div>
        <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
          <button type="button" onClick={reload} disabled={loading} aria-label="โหลดข้อมูลใหม่"
            className="flex size-11 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 disabled:opacity-40"><RefreshCw size={17} className={loading ? 'animate-spin' : ''} /></button>
          <button type="button" onClick={() => openEditor()}
            className="flex min-h-11 items-center justify-center gap-2 rounded-full bg-blue-500 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-blue-200 transition-colors hover:bg-blue-600"><Plus size={17} />กำหนดสิทธิ์</button>
        </div>
      </header>

      {error && <p role="alert" className="break-words rounded-xl border border-red-100 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {message && <p role="status" className="flex items-start gap-2 break-words rounded-xl border border-emerald-100 bg-emerald-50 p-3 text-sm text-emerald-700"><CheckCircle2 size={18} className="shrink-0" />{message}</p>}
      {directoryWarning && <p role="status" className="break-words rounded-xl border border-amber-100 bg-amber-50 p-3 text-sm text-amber-800">{directoryWarning}</p>}

      <section className="min-w-0 rounded-[20px] border border-white/80 bg-white p-3 shadow-[0_10px_35px_rgba(30,64,175,0.06)] sm:p-6">
        <div className="flex min-w-0 flex-col justify-between gap-4 border-b border-slate-100 pb-5 xl:flex-row xl:items-center">
          <div role="tablist" aria-label="ข้อมูลสิทธิ์พนักงาน" className="inline-flex min-w-0 self-start rounded-2xl border border-slate-200 bg-white p-1 shadow-sm">
            {tabs.map(({ key, label, icon: Icon }, index) => <button key={key} id={`work-roles-tab-${key}`} type="button" role="tab"
              aria-selected={view === key} aria-controls={`work-roles-panel-${key}`} tabIndex={view === key ? 0 : -1}
              onClick={() => selectTab(key)}
              onKeyDown={(event) => {
                const target = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs[1]
                  : event.key === 'ArrowLeft' || event.key === 'ArrowRight' ? tabs[1 - index] : null;
                if (target) { event.preventDefault(); selectTab(target.key); document.getElementById(`work-roles-tab-${target.key}`)?.focus(); }
              }}
              className={`flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold transition-colors sm:px-4 sm:text-sm ${view === key ? 'bg-blue-500 text-white shadow-md shadow-blue-200' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'}`}>
              <Icon size={16} className="hidden shrink-0 sm:block" /><span>{label}</span>
            </button>)}
          </div>
          <form onSubmit={(event) => { event.preventDefault(); reload(); }} className="flex min-w-0 gap-2 xl:w-80">
            <div className="relative min-w-0 flex-1">
              <Search size={16} className="pointer-events-none absolute left-3 top-3.5 text-slate-400" />
              <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="ค้นหาด้วย EMP code เต็ม" aria-label="ค้นหา EMP code"
                className="min-h-11 w-full min-w-0 rounded-xl border border-slate-200 bg-slate-50/50 py-2 pl-9 pr-3 text-base outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 sm:text-sm" />
            </div>
            <button disabled={loading} className="min-h-11 shrink-0 rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-40">ค้นหา</button>
          </form>
        </div>

        <div id="work-roles-panel-roles" role="tabpanel" aria-labelledby="work-roles-tab-roles" hidden={view !== 'roles'} tabIndex={0} className="pt-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold text-slate-800">สิทธิ์ที่กำหนดไว้</h2>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-500">{loading ? 'กำลังโหลด…' : `${roles.length}${truncated ? '+' : ''} รายการ`}</span>
          </div>
          {truncated && <p className="mb-3 rounded-lg bg-amber-50 p-2 text-xs text-amber-700">แสดง 200 รายการแรก กรุณาค้นหาด้วย EMP code เพื่อดูพนักงานที่ต้องการ</p>}
          {loading ? <LoadingState /> : <>
            <div className="space-y-3 md:hidden">{roles.map((assignment) => <article key={`${assignment.employeeCode}:${assignment.roleCode}`} className="min-w-0 rounded-2xl border border-slate-200 p-4">
              <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="break-words font-semibold text-slate-800">{assignment.employeeName || 'ไม่พบชื่อในทะเบียนพนักงาน'}</p><p className="mt-1 break-all text-xs text-slate-400">EMP {assignment.employeeCode}</p></div><StatusBadge active={assignment.isActive} /></div>
              <p className="mt-3 break-words text-sm text-slate-600"><RoleBadge role={assignment.roleCode} /> <span className="ml-1">{WORK_ROLE_LABELS[assignment.roleCode]}</span></p>
              <p className="mt-3 break-words text-xs text-slate-400">แก้ไขโดย {assignment.updatedBy}</p>
              <button onClick={() => openEditor(assignment)} className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-blue-100 bg-blue-50/50 text-sm font-medium text-blue-600"><Pencil size={14} />เปลี่ยนสิทธิ์</button>
            </article>)}</div>
            <div className="hidden max-w-full overflow-x-auto md:block"><table className="w-full min-w-[680px] table-fixed text-left text-sm">
              <thead><tr className="border-y border-slate-100 bg-slate-50/80 text-xs font-semibold text-slate-400"><th className="w-[32%] rounded-l-xl px-4 py-3">พนักงาน / EMP code</th><th className="w-24 px-3 py-3">สิทธิ์</th><th className="w-28 px-3 py-3">สถานะ</th><th className="px-3 py-3">แก้ไขโดย</th><th className="w-32 rounded-r-xl px-3 py-3 text-right">จัดการ</th></tr></thead>
              <tbody className="divide-y divide-slate-100">{roles.map((assignment) => <tr key={`${assignment.employeeCode}:${assignment.roleCode}`} className="transition-colors hover:bg-blue-50/40">
                <td className="px-4 py-4"><p className="break-words font-medium text-slate-800">{assignment.employeeName || 'ไม่พบชื่อในทะเบียนพนักงาน'}</p><p className="mt-1 break-all text-xs text-slate-400">{assignment.employeeCode}</p></td>
                <td className="px-3 py-4"><RoleBadge role={assignment.roleCode} /></td><td className="px-3 py-4"><StatusBadge active={assignment.isActive} /></td>
                <td className="break-words px-3 py-4 text-slate-500">{assignment.updatedBy}</td>
                <td className="px-3 py-4 text-right"><button onClick={() => openEditor(assignment)} aria-label={`เปลี่ยนสิทธิ์ ${assignment.employeeCode} ${assignment.roleCode}`} className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-xs font-medium text-blue-500 transition-colors hover:bg-blue-50"><Pencil size={13} />เปลี่ยนสิทธิ์</button></td>
              </tr>)}</tbody>
            </table></div>
            {!roles.length && <EmptyState icon="roles" text="ไม่พบสิทธิ์ที่กำหนดไว้" detail="ค้นหาด้วย EMP code หรือกดกำหนดสิทธิ์เพื่อกำหนดสิทธิ์พนักงาน" />}
          </>}
        </div>

        <div id="work-roles-panel-history" role="tabpanel" aria-labelledby="work-roles-tab-history" hidden={view !== 'history'} tabIndex={0} className="pt-5">
          <div className="mb-5 flex items-center gap-2"><h2 className="font-semibold text-slate-800">ประวัติเปลี่ยนสิทธิ์</h2><span className="text-xs text-slate-400">สูงสุด 50 รายการ</span></div>
          {loading ? <LoadingState /> : history.length ? <div className="space-y-3">{history.map((event) => <article key={event.eventId} className="flex min-w-0 items-start gap-3 rounded-2xl border border-slate-100 p-4 transition-colors hover:bg-slate-50/50 sm:gap-4">
            <div className={`flex size-9 shrink-0 items-center justify-center rounded-full ${event.isActive ? 'bg-emerald-50 text-emerald-500' : 'bg-slate-100 text-slate-400'}`}><History size={17} /></div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-2"><p className="break-words text-sm font-semibold text-slate-800">{event.employeeName || event.employeeCode}</p><time dateTime={event.createdAt} className="text-xs text-slate-400">{new Date(event.createdAt).toLocaleString('th-TH')}</time></div>
              <div className="mt-2 flex flex-wrap items-center gap-2"><span className="break-all text-xs text-slate-400">EMP {event.employeeCode}</span><RoleBadge role={event.roleCode} /><StatusBadge active={event.isActive} />{event.employeeName && <span className="text-xs text-slate-400">ชื่อปัจจุบัน</span>}</div>
              <p className="mt-3 whitespace-pre-wrap break-words rounded-xl bg-slate-50 px-3 py-2.5 text-sm leading-relaxed text-slate-600">{event.reason}</p>
              <p className="mt-2 break-words text-xs text-slate-400">แก้ไขโดย {event.actor}</p>
            </div>
          </article>)}</div> : <EmptyState icon="history" text="ยังไม่มีประวัติเปลี่ยนสิทธิ์" detail="เมื่อมีการกำหนดสิทธิ์ ระบบจะแสดงประวัติที่นี่" />}
        </div>
      </section>
    </main>
    {editor && <WorkRoleModal assignment={editor.assignment} onDismiss={() => setEditor(null)} onSaved={(code, role, active) => {
      setEditor(null); setView('roles'); setFilter(code);
      setMessage(`บันทึก ${code} · ${role} · ${active ? 'เปิดสิทธิ์' : 'ปิดสิทธิ์'} แล้ว`);
      setLoading(true); void load(code);
    }} />}
  </MainContent>;
}

function RoleBadge({ role }: { role: WorkRole }) {
  const color = role === 'AP' ? 'bg-blue-50 text-blue-600' : role === 'AR' ? 'bg-violet-50 text-violet-600'
    : role === 'MASTER' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700';
  return <span title={WORK_ROLE_LABELS[role]} className={`inline-flex rounded-lg px-2 py-1 text-xs font-semibold ${color}`}>{role}</span>;
}

function StatusBadge({ active }: { active: boolean }) {
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${active ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>{active && <Check size={12} />}{active ? 'เปิดสิทธิ์' : 'ปิดสิทธิ์'}</span>;
}

function LoadingState() {
  return <div role="status" className="flex items-center justify-center gap-2 py-16 text-sm text-slate-400"><Loader2 size={18} className="animate-spin" />กำลังโหลดข้อมูล…</div>;
}

function EmptyState({ icon, text, detail }: { icon: 'roles' | 'history'; text: string; detail: string }) {
  const Icon = icon === 'roles' ? ShieldCheck : History;
  return <div className="flex flex-col items-center px-4 py-12 text-center"><div className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-slate-50 text-slate-300"><Icon size={24} /></div><p className="text-sm font-medium text-slate-500">{text}</p><p className="mt-1 max-w-sm text-xs leading-relaxed text-slate-400">{detail}</p></div>;
}
