"use client";

import HelpTooltip from "../../../../components/HelpTooltip";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Database, Loader2, Lock, Menu, Plus, RefreshCw, Search, X } from "lucide-react";
import { useSidebar } from "@/components/SidebarContext";
import MasterDataTabs from "../../components/MasterDataTabs";
import { type BankAccountOption, fullAccountLabel, STATEMENT_BANK_CODES } from "../../../../lib/bankAccounts";
import AddBankAccountModal, { type GlCandidate } from "./AddBankAccountModal";
import AccountStatusModal from "./AccountStatusModal";

export type AccountRow = BankAccountOption & {
  createdAt: string | null;
  createdBy: string | null;
  statusChangedAt: string | null;
  statusChangedBy: string | null;
  glEntryCount: number;
};

type ManageData = {
  accounts: AccountRow[];
  candidates: GlCandidate[];
  canManage: boolean;
  statusReady: boolean;
  statusHint: string | null;
};

async function fetchManageData(signal?: AbortSignal): Promise<ManageData> {
  const res = await fetch("/api/master/bank-accounts/manage", { cache: "no-store", signal });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "โหลดรายชื่อบัญชีธนาคารไม่สำเร็จ");
  return data;
}

type StatusFilter = "all" | "active" | "closed";
const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "ทั้งหมด" },
  { key: "active", label: "ใช้งาน" },
  { key: "closed", label: "ปิดบัญชี" },
];
const BANK_ORDER = ["BBL", "KBANK", "SCB", "KTB", "TTB", "BAY"];
const BANK_LABEL: Record<string, string> = { KBANK: "KBank" };

function formatDateTime(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" }) : "";
}

export default function MasterBankAccounts() {
  const { toggleMobileOpen } = useSidebar();
  const [data, setData] = useState<ManageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [adding, setAdding] = useState(false);
  const [statusTarget, setStatusTarget] = useState<AccountRow | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [bankFilter, setBankFilter] = useState("");
  const [search, setSearch] = useState("");
  const sequence = useRef(0);

  const load = useCallback(async (signal?: AbortSignal) => {
    const id = ++sequence.current;
    try {
      const next = await fetchManageData(signal);
      if (id !== sequence.current || signal?.aborted) return;
      setData(next);
      setError("");
    } catch (err) {
      if (id === sequence.current && !signal?.aborted) setError(err instanceof Error ? err.message : "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้");
    } finally {
      if (id === sequence.current && !signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const id = ++sequence.current;
    const current = () => !controller.signal.aborted && id === sequence.current;
    fetchManageData(controller.signal)
      .then((next) => { if (current()) { setData(next); setError(""); } })
      .catch((err) => { if (current()) setError(err instanceof Error ? err.message : "โหลดข้อมูลไม่สำเร็จ"); })
      .finally(() => { if (current()) setLoading(false); });
    return () => controller.abort();
  }, []);

  function reload() {
    setLoading(true);
    void load();
  }

  const accounts = useMemo(() => data?.accounts ?? [], [data]);
  const canManage = Boolean(data?.canManage);
  const closedCount = accounts.filter((a) => a.isActive === false).length;

  const banks = useMemo(() => {
    const codes = [...new Set(accounts.map((a) => a.bankCode).filter((c): c is string => Boolean(c)))];
    return codes.sort((a, b) => {
      const ia = BANK_ORDER.indexOf(a);
      const ib = BANK_ORDER.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
    });
  }, [accounts]);

  // กรองฝั่งหน้าจอ — บัญชีมีไม่กี่สิบแถว ไม่ต้องยิง API ใหม่
  const visibleAccounts = useMemo(() => {
    const q = search.trim().toLowerCase();
    const qDigits = q.replace(/\D/g, "");
    return accounts.filter((a) => {
      const active = a.isActive !== false;
      if (statusFilter === "active" && !active) return false;
      if (statusFilter === "closed" && active) return false;
      if (bankFilter && a.bankCode !== bankFilter) return false;
      if (!q) return true;
      if (a.bankAccountNo.toLowerCase().includes(q) || (a.accountName ?? "").toLowerCase().includes(q)) return true;
      // ค้นเลขบัญชีได้โดยไม่สนขีดกลาง เช่น '0373029725' เจอ '037-3-029725'
      return qDigits.length >= 3 && (a.displayNo ?? "").replace(/\D/g, "").includes(qDigits);
    });
  }, [accounts, statusFilter, bankFilter, search]);

  const hasFilters = statusFilter !== "all" || Boolean(bankFilter) || Boolean(search.trim());
  function clearFilters() {
    setStatusFilter("all");
    setBankFilter("");
    setSearch("");
  }

  return (
    <div className="min-h-screen bg-[#f8fafc] p-8">
      <div className="mb-2 flex items-start gap-3">
        <button onClick={toggleMobileOpen} className="mt-1 text-slate-500 hover:text-slate-700 lg:hidden" aria-label="เปิดหรือปิดเมนู">
          <Menu size={22} />
        </button>
        <div className="flex flex-1 flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-blue-600 shadow-lg shadow-blue-500/20">
              <Database size={20} className="text-white" />
            </div>
            <div className="flex items-center gap-1.5">
              <h1 className="text-3xl font-bold tracking-tight text-slate-900">จัดการข้อมูล · บัญชีธนาคาร</h1>
              <HelpTooltip label="เกี่ยวกับบัญชีธนาคาร">
                บัญชีที่ใช้นำเข้า statement และกระทบยอด เพิ่มบัญชีใหม่ได้จากรหัสบัญชีที่มีใน BC365 แล้วเท่านั้น
                ปิดบัญชี = นำเข้า statement ใหม่ไม่ได้ แต่ข้อมูลเดิมยังกระทบยอดและดูรายงานได้ และเปิดบัญชีกลับได้
              </HelpTooltip>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={reload} disabled={loading} aria-label="โหลดข้อมูลใหม่"
              className="flex size-11 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 disabled:opacity-40">
              <RefreshCw size={17} className={loading ? "animate-spin" : ""} />
            </button>
            {canManage && (
              <button type="button" onClick={() => { setMessage(""); setAdding(true); }}
                className="flex min-h-11 items-center gap-2 rounded-full bg-blue-500 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-blue-200 transition-colors hover:bg-blue-600">
                <Plus size={17} />เพิ่มบัญชี
              </button>
            )}
          </div>
        </div>
      </div>

      <MasterDataTabs />

      <section className="space-y-4 rounded-[20px] border border-white/80 bg-white p-6 shadow-[0_10px_35px_rgba(30,64,175,0.06)]">
        {error && <p role="alert" className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
        {message && (
          <p role="status" className="flex items-start gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            <CheckCircle2 size={18} className="shrink-0" />{message}
          </p>
        )}
        {data?.statusHint && canManage && (
          <p role="status" className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-800">{data.statusHint}</p>
        )}

        <div className="flex flex-col gap-4 border-b border-slate-100 pb-5">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">สถานะ</p>
              <div className="flex flex-wrap gap-2">
                {STATUS_FILTERS.map(({ key, label }) => (
                  <button key={key} type="button" onClick={() => setStatusFilter(key)} aria-pressed={statusFilter === key}
                    className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                      statusFilter === key ? "bg-blue-500 text-white shadow-md shadow-blue-200" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">ธนาคาร</p>
              <div className="flex flex-wrap gap-2">
                {["", ...banks].map((code) => (
                  <button key={code || "all"} type="button" onClick={() => setBankFilter(code)} aria-pressed={bankFilter === code}
                    className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                      bankFilter === code ? "bg-blue-500 text-white shadow-md shadow-blue-200" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}>
                    {code ? BANK_LABEL[code] ?? code : "ทุกธนาคาร"}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1 sm:max-w-sm">
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} aria-label="ค้นหาบัญชี"
                placeholder="ค้นหาชื่อบัญชี เลขบัญชี หรือรหัส BC365"
                className="min-h-10 w-full rounded-xl border border-slate-200 bg-slate-50/50 py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" />
            </div>
            {hasFilters && (
              <button type="button" onClick={clearFilters}
                className="flex min-h-10 items-center gap-1 rounded-xl px-3 text-sm font-medium text-slate-500 hover:bg-slate-100">
                <X size={14} />ล้างตัวกรอง
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold text-slate-800">บัญชีที่ผูกไว้</h2>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-500">
            {loading && !data
              ? "กำลังโหลด…"
              : `${hasFilters ? `แสดง ${visibleAccounts.length} จาก ` : ""}${accounts.length} บัญชี${closedCount ? ` · ปิดแล้ว ${closedCount}` : ""}`}
          </span>
        </div>

        {loading && !data ? (
          <div role="status" className="flex items-center justify-center gap-2 py-16 text-sm text-slate-400">
            <Loader2 size={16} className="animate-spin" /> กำลังโหลด...
          </div>
        ) : accounts.length === 0 ? (
          <p className="py-16 text-center text-sm text-slate-400">ยังไม่มีบัญชีธนาคาร</p>
        ) : visibleAccounts.length === 0 ? (
          <p className="py-16 text-center text-sm text-slate-400">ไม่พบบัญชีที่ตรงกับตัวกรอง</p>
        ) : (
          <div className="max-w-full overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead>
                <tr className="border-y border-slate-100 bg-slate-50/80 text-xs font-semibold text-slate-400">
                  <th className="rounded-l-xl px-4 py-3">บัญชี</th>
                  <th className="px-3 py-3">ธนาคาร</th>
                  <th className="px-3 py-3 text-right">ไฟล์ที่นำเข้า</th>
                  <th className="px-3 py-3 text-right">รายการ GL</th>
                  <th className="px-3 py-3">สถานะ</th>
                  {canManage && <th className="rounded-r-xl px-3 py-3 text-right">จัดการ</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleAccounts.map((a) => {
                  const active = a.isActive !== false;
                  const noParser = !STATEMENT_BANK_CODES.includes(a.bankCode ?? "");
                  return (
                    <tr key={a.bankAccountNo} className={`transition-colors hover:bg-blue-50/40 ${active ? "" : "bg-slate-50/60"}`}>
                      <td className="px-4 py-3.5">
                        <p className={`font-medium ${active ? "text-slate-800" : "text-slate-500"}`}>{fullAccountLabel(a)}</p>
                        <p className="mt-0.5 font-mono text-xs text-slate-400">
                          {a.bankAccountNo}{a.createdBy ? ` · เพิ่มโดย ${a.createdBy}` : ""}
                        </p>
                      </td>
                      <td className="px-3 py-3.5">
                        <span className="font-medium text-slate-700">{a.bankCode}</span>
                        {noParser && <p className="mt-0.5 text-[11px] text-amber-600">ยังอ่านไฟล์ statement ไม่ได้</p>}
                      </td>
                      <td className="px-3 py-3.5 text-right tabular-nums text-slate-600">{a.importCount ?? 0}</td>
                      <td className="px-3 py-3.5 text-right tabular-nums text-slate-600">{a.glEntryCount.toLocaleString("th-TH")}</td>
                      <td className="px-3 py-3.5">
                        <StatusBadge active={active} />
                        {a.statusChangedAt && (
                          <p className="mt-1 text-[11px] text-slate-400">
                            {formatDateTime(a.statusChangedAt)}{a.statusChangedBy ? ` · ${a.statusChangedBy}` : ""}
                          </p>
                        )}
                      </td>
                      {canManage && (
                        <td className="px-3 py-3.5 text-right">
                          <button type="button" onClick={() => { setMessage(""); setStatusTarget(a); }}
                            disabled={!data?.statusReady}
                            title={data?.statusReady ? undefined : data?.statusHint ?? undefined}
                            className={`inline-flex min-h-9 items-center rounded-full border px-3.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                              active ? "border-rose-200 bg-rose-50/50 text-rose-600 hover:bg-rose-100" : "border-emerald-200 bg-emerald-50/50 text-emerald-600 hover:bg-emerald-100"
                            }`}>
                            {active ? "ปิดบัญชี" : "เปิดบัญชี"}
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {!canManage && data && (
          <p className="flex items-center gap-1.5 text-xs text-slate-500">
            <Lock size={12} className="shrink-0" />
            ดูข้อมูลเท่านั้น — เพิ่มหรือปิดบัญชีได้เฉพาะผู้ดูแล (Admin / MASTER)
          </p>
        )}
      </section>

      {adding && (
        <AddBankAccountModal
          candidates={data?.candidates ?? []}
          onDismiss={() => setAdding(false)}
          onSaved={(label) => {
            setAdding(false);
            setMessage(`เพิ่มบัญชี ${label} แล้ว`);
            reload();
          }}
        />
      )}
      {statusTarget && (
        <AccountStatusModal
          account={statusTarget}
          onDismiss={() => setStatusTarget(null)}
          onSaved={(active) => {
            setMessage(`${active ? "เปิด" : "ปิด"}บัญชี ${fullAccountLabel(statusTarget)} แล้ว`);
            setStatusTarget(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${active ? "bg-emerald-50 text-emerald-600" : "bg-slate-200 text-slate-500"}`}>
      {active ? "ใช้งาน" : "ปิดบัญชี"}
    </span>
  );
}
