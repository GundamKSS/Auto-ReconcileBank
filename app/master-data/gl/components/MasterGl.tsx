"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Menu,
  Database,
  Lock,
  Loader2,
  SlidersHorizontal,
  X,
  Search,
  ArrowDownLeft,
  ArrowUpRight,
  Scale,
} from "lucide-react";
import { useSidebar } from "@/components/SidebarContext";
import MasterDataTabs from "../../components/MasterDataTabs";
import StickySummaryBar from "../../components/StickySummaryBar";
import DayTable, { type DaySummary } from "../../components/DayTable";
import { useOffsetList } from "../../components/useOffsetList";
import { STICKY_VARS, stickyTop, useStickyHeight } from "../../components/useSticky";
import { useSessionState } from "../../../../hooks/useSessionState";
import { type BankAccountOption, fullAccountLabel, shortAccountLabel } from "../../../../lib/bankAccounts";
import GlDayDetail from "./GlDayDetail";
import { type GlStatus, SOURCE_LABEL } from "./glDisplay";

type Status = GlStatus;

type Summary = {
  entryCount: number;
  inCount: number;
  inAmount: number;
  outCount: number;
  outAmount: number;
  statusCounts: Record<Status, number>;
};

const BANK_ORDER = ["BBL", "KBANK", "SCB", "KTB", "TTB", "BAY"];
const BANK_LABEL: Record<string, string> = { KBANK: "KBank" };

const isStatusFilter = (v: unknown): v is "" | Status =>
  v === "" || v === "UNMATCHED" || v === "MATCHED" || v === "SUSPENSE" || v === "EXCLUDED";
const isDirectionFilter = (v: unknown): v is string => v === "" || v === "IN" || v === "OUT";
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

const STATUS_TABS: { key: "" | Status; label: string }[] = [
  { key: "", label: "ทั้งหมด" },
  { key: "UNMATCHED", label: "รอจับคู่" },
  { key: "MATCHED", label: "จับคู่แล้ว" },
  { key: "SUSPENSE", label: "พักรายการ" },
  { key: "EXCLUDED", label: "JV ปรับปรุง" },
];

// รายการ GL ของบัญชีธนาคาร (BankAccountLedgerEntries) — ฝั่งตรงข้ามของหน้า Master Data · Bank Statement
// อ่านอย่างเดียวเสมอ เพราะข้อมูล sync มาจาก BC365 แก้ในนี้ไปก็ถูก sync รอบหน้าทับ
// แสดงเป็นรายวัน (วันที่ผ่านรายการ) พร้อมยอดรวมของวัน แล้วกดกางดูรายการของวันนั้น
// ตารางวันโหลดทีละ 50 วันแบบ infinite scroll ส่วนรายการในวันโหลดทีละ 50 ด้วยปุ่ม (วันสิ้นเดือนมีได้เป็นร้อยรายการ)
export default function MasterGl() {
  const { toggleMobileOpen } = useSidebar();

  const [accounts, setAccounts] = useState<BankAccountOption[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [accountsError, setAccountsError] = useState("");
  // บัญชีและตัวกรองทั้งหมดจำไว้ตลอดแท็บนี้ — สลับไปหน้า Bank Statement แล้วกลับมาเจอชุดเดิมไว้เทียบกัน
  // bankCode ว่าง = ยังไม่รู้ธนาคาร รอรายชื่อบัญชีโหลดเสร็จแล้วเลือกธนาคารแรกให้
  const [bankCode, setBankCode] = useSessionState("master-data:gl:bankCode", "");
  // "" = ทุกบัญชีของธนาคารที่เลือก
  const [bankAccountNo, setBankAccountNo] = useSessionState("master-data:gl:bankAccountNo", "");

  const [filterFrom, setFilterFrom] = useSessionState("master-data:gl:from", "");
  const [filterTo, setFilterTo] = useSessionState("master-data:gl:to", "");
  const [filterDirection, setFilterDirection] = useSessionState("master-data:gl:direction", "", isDirectionFilter);
  const [filterSource, setFilterSource] = useSessionState("master-data:gl:sourceCode", "");
  const [filterStatus, setFilterStatus] = useSessionState<"" | Status>("master-data:gl:status", "", isStatusFilter);
  const [searchInput, setSearchInput] = useSessionState("master-data:gl:search", "");
  // เริ่มจากคำค้นที่จำไว้เลย ไม่ต้องรอ debounce รอบแรก — ไม่งั้นโหลดสองรอบ (ไม่มีคำค้น แล้วมีคำค้น)
  const [q, setQ] = useState(() => searchInput.trim());

  // วันที่กางดูอยู่ — จำไว้เหมือนตัวกรอง แต่ล้างเมื่อเปลี่ยนธนาคาร/บัญชี (วันเดียวกันของบัญชีอื่นไม่เกี่ยวกัน)
  const [openDays, setOpenDays] = useSessionState<string[]>("master-data:gl:openDays", [], isStringArray);

  // แท็บสถานะตรึงต่อใต้การ์ดสรุป — วัดความสูงไว้ให้หัวตารางตรึงต่อท้ายได้พอดี
  const [tabsBar, setTabsBar] = useState<HTMLDivElement | null>(null);
  useStickyHeight(tabsBar, STICKY_VARS.tabs);

  useEffect(() => {
    let cancelled = false;
    async function loadAccounts() {
      try {
        const res = await fetch("/api/master/bank-accounts");
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setAccountsError(data.error || "โหลดรายชื่อบัญชีไม่สำเร็จ");
          return;
        }
        const list: BankAccountOption[] = data.accounts;
        setAccounts(list);
        const firstBank = BANK_ORDER.find((code) => list.some((a) => a.bankCode === code)) ?? list[0]?.bankCode ?? "";
        // ธนาคาร/บัญชีที่จำไว้ต้องยังมีอยู่ใน mapping — ไม่มีแล้วถอยไปธนาคารแรก ทุกบัญชี
        setBankCode((prev) => (list.some((a) => a.bankCode === prev) ? prev : firstBank));
        setBankAccountNo((prev) => (list.some((a) => a.bankAccountNo === prev) ? prev : ""));
      } catch {
        if (!cancelled) setAccountsError("ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาตรวจสอบการเชื่อมต่อ");
      } finally {
        if (!cancelled) setAccountsLoading(false);
      }
    }
    loadAccounts();
    return () => {
      cancelled = true;
    };
    // setter จาก useSessionState คือ setter ของ useState ข้างใน — ค่าคงที่ ใส่ไว้ก็ไม่ทำให้โหลดซ้ำ
  }, [setBankCode, setBankAccountNo]);

  // ธนาคารที่มีบัญชี mapping ไว้จริง — KTB ไม่มีตัวแกะ statement แต่ฝั่ง GL มีรายการให้ดูได้
  const banks = useMemo(() => {
    const codes = [...new Set(accounts.map((a) => a.bankCode).filter((c): c is string => Boolean(c)))];
    return codes.sort((a, b) => {
      const ia = BANK_ORDER.indexOf(a);
      const ib = BANK_ORDER.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
    });
  }, [accounts]);
  const bankAccounts = useMemo(() => accounts.filter((a) => a.bankCode === bankCode), [accounts, bankCode]);
  const selectedAccount = bankAccounts.find((a) => a.bankAccountNo === bankAccountNo) ?? null;

  // เปลี่ยนธนาคาร/บัญชีแล้วล้างตัวกรองสมุดรายวัน — ตัวเลือกผูกกับบัญชี ค่าเดิมอาจไม่มีในบัญชีใหม่แล้วได้ตารางว่างเงียบๆ
  function selectBank(code: string) {
    setBankCode(code);
    setBankAccountNo("");
    setFilterSource("");
    setOpenDays([]);
  }
  function selectAccount(no: string) {
    setBankAccountNo(no);
    setFilterSource("");
    setOpenDays([]);
  }

  // หน่วงคำค้นก่อนยิง API ไม่ให้โหลดใหม่ทุกตัวอักษร (เหมือนหน้า Reports/Suspense)
  useEffect(() => {
    const t = setTimeout(() => setQ(searchInput.trim()), 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  const hasActiveFilters = Boolean(filterFrom || filterTo || filterDirection || filterSource || searchInput);
  function clearFilters() {
    setFilterFrom("");
    setFilterTo("");
    setFilterDirection("");
    setFilterSource("");
    setSearchInput("");
    setQ("");
  }

  const params = useMemo(() => {
    if (!bankCode) return null;
    const p = new URLSearchParams({ bankCode });
    if (bankAccountNo) p.set("bankAccountNo", bankAccountNo);
    if (filterFrom) p.set("from", filterFrom);
    if (filterTo) p.set("to", filterTo);
    if (filterDirection) p.set("direction", filterDirection);
    if (filterSource) p.set("sourceCode", filterSource);
    if (filterStatus) p.set("status", filterStatus);
    if (q) p.set("q", q);
    return p.toString();
  }, [bankCode, bankAccountNo, filterFrom, filterTo, filterDirection, filterSource, filterStatus, q]);

  const {
    items: days,
    total: totalDays,
    firstPage,
    loading,
    loadingMore,
    error,
    hasMore,
    loadMore,
  } = useOffsetList<DaySummary>(params === null ? null : `/api/master/gl/days?${params}`, "days");
  const summary = (firstPage?.summary as Summary | undefined) ?? null;
  const sourceOptions = (firstPage?.sourceCodes as string[] | undefined) ?? [];

  const showAccountColumn = !bankAccountNo;
  const net = summary ? summary.inAmount - summary.outAmount : 0;
  const statusTotal = summary
    ? summary.statusCounts.UNMATCHED + summary.statusCounts.MATCHED + summary.statusCounts.SUSPENSE + summary.statusCounts.OFFSET + summary.statusCounts.EXCLUDED
    : null;

  return (
    <div className="min-h-screen bg-[#f8fafc] p-8">
      <div className="mb-2 flex items-start gap-3">
        <button
          onClick={toggleMobileOpen}
          className="mt-1 text-slate-500 hover:text-slate-700 lg:hidden"
          aria-label="เปิดหรือปิดเมนู"
        >
          <Menu size={22} />
        </button>
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-blue-600 shadow-lg shadow-blue-500/20">
            <Database size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">จัดการข้อมูล · รายการบัญชี BC365</h1>
            <p className="mt-1 text-[15px] text-slate-500">
              ตรวจสอบรายการเงินเข้าและเงินออกของบัญชีธนาคารที่ดึงมาจาก BC365
            </p>
          </div>
        </div>
      </div>

      <MasterDataTabs />

      <section className="rounded-[20px] border border-white/80 bg-white p-6 shadow-[0_10px_35px_rgba(30,64,175,0.06)]">
        {accountsError && (
          <div className="mb-5 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{accountsError}</div>
        )}

        {accountsLoading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-gray-400">
            <Loader2 size={16} className="animate-spin" /> กำลังโหลด...
          </div>
        ) : banks.length === 0 ? (
          !accountsError && (
            <p className="py-16 text-center text-sm text-gray-400">ยังไม่มีบัญชีธนาคารที่เชื่อมโยงกับ BC365 กรุณาติดต่อผู้ดูแลระบบ</p>
          )
        ) : (
          <>
            <div className="mb-2 flex flex-col gap-4 border-b border-gray-100 pb-5">
              <div>
                <p className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400">ธนาคาร</p>
                <div className="flex flex-wrap gap-2">
                  {banks.map((code) => (
                    <button
                      key={code}
                      onClick={() => selectBank(code)}
                      className={`rounded-full px-5 py-2 text-sm font-medium transition-colors ${
                        bankCode === code
                          ? "bg-blue-500 text-white shadow-md shadow-blue-200"
                          : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                      }`}
                    >
                      {BANK_LABEL[code] ?? code}
                    </button>
                  ))}
                </div>
              </div>

              {bankAccounts.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">บัญชี</p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => selectAccount("")}
                      className={`rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors ${
                        !bankAccountNo
                          ? "border-blue-300 bg-blue-50 text-blue-700"
                          : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                      }`}
                    >
                      ทุกบัญชี ({bankAccounts.length})
                    </button>
                    {bankAccounts.map((a) => (
                      <button
                        key={a.bankAccountNo}
                        onClick={() => selectAccount(a.bankAccountNo)}
                        title={`${fullAccountLabel(a)} (${a.bankAccountNo})`}
                        className={`rounded-full border px-3.5 py-1.5 text-xs font-medium tabular-nums transition-colors ${
                          bankAccountNo === a.bankAccountNo
                            ? "border-blue-300 bg-blue-50 text-blue-700"
                            : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                        }`}
                      >
                        {shortAccountLabel(a)}
                      </button>
                    ))}
                  </div>
                  {selectedAccount && (
                    <p className="mt-2 text-xs text-slate-500">
                      {fullAccountLabel(selectedAccount)} <span className="text-slate-400">· {selectedAccount.bankAccountNo}</span>
                    </p>
                  )}
                </div>
              )}

              <p className="flex items-center gap-1.5 text-xs text-slate-500">
                <Lock size={12} className="shrink-0" />
                หน้านี้ใช้ดูข้อมูลเท่านั้น หากต้องการแก้ไข ให้ปรับข้อมูลใน BC365 แล้วดึงข้อมูลใหม่ที่หน้า “นำเข้าข้อมูล” หรือ “กระทบยอด”
              </p>
            </div>

            <StickySummaryBar
              className="mb-2"
              loading={loading}
              items={[
                { key: "in", icon: <ArrowDownLeft size={16} />, label: "รับเข้า · Debit", tone: "in", amount: summary?.inAmount, count: summary?.inCount },
                { key: "out", icon: <ArrowUpRight size={16} />, label: "จ่ายออก · Credit", tone: "out", amount: summary?.outAmount, count: summary?.outCount },
                {
                  key: "net",
                  icon: <Scale size={16} />,
                  label: "สุทธิ (รับ − จ่าย)",
                  tone: net < 0 ? "out" : "net",
                  amount: summary ? net : undefined,
                  count: summary ? summary.entryCount : undefined,
                },
              ]}
            />

            <div className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-gray-100 bg-gray-50/60 p-3.5">
              <div className="flex items-center gap-1.5 pb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">
                <SlidersHorizontal size={13} /> กรอง
              </div>
              <div className="flex min-w-[220px] flex-1 flex-col gap-1">
                <label className="text-[11px] font-medium text-gray-500">ค้นหา</label>
                <div className="relative">
                  <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="search"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    placeholder="เลขที่เอกสาร / Entry No / ยอดเงิน"
                    className="w-full rounded-lg border border-gray-200 bg-white py-1.5 pl-8 pr-2.5 text-sm text-gray-700"
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-medium text-gray-500">จากวันที่ผ่านรายการ</label>
                <input
                  type="date"
                  value={filterFrom}
                  onChange={(e) => setFilterFrom(e.target.value)}
                  className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-700"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-medium text-gray-500">ถึงวันที่</label>
                <input
                  type="date"
                  value={filterTo}
                  onChange={(e) => setFilterTo(e.target.value)}
                  className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-700"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-medium text-gray-500">รับ/จ่าย</label>
                <select
                  value={filterDirection}
                  onChange={(e) => setFilterDirection(e.target.value)}
                  className="min-w-[110px] rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-700"
                >
                  <option value="">ทั้งหมด</option>
                  <option value="IN">รับเข้า</option>
                  <option value="OUT">จ่ายออก</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-medium text-gray-500">สมุดรายวัน</label>
                <select
                  value={filterSource}
                  onChange={(e) => setFilterSource(e.target.value)}
                  className="min-w-[150px] rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-700"
                >
                  <option value="">ทั้งหมด</option>
                  {sourceOptions.map((code) => (
                    <option key={code} value={code}>
                      {SOURCE_LABEL[code] ? `${SOURCE_LABEL[code]} (${code})` : code}
                    </option>
                  ))}
                </select>
              </div>
              {hasActiveFilters && (
                <button
                  onClick={clearFilters}
                  className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-blue-600 transition-colors hover:bg-blue-50 hover:text-blue-700"
                >
                  <X size={12} /> ล้างตัวกรอง
                </button>
              )}
            </div>

            <div
              ref={setTabsBar}
              role="tablist"
              aria-label="สถานะ"
              className="sticky z-20 mb-4 flex gap-1 overflow-x-auto border-b border-gray-100 bg-white"
              style={{ top: stickyTop(STICKY_VARS.nav, STICKY_VARS.cards) }}
            >
              {STATUS_TABS.map(({ key, label }) => {
                const active = filterStatus === key;
                const count = !summary ? null : key === "" ? statusTotal : summary.statusCounts[key];
                return (
                  <button
                    key={key || "ALL"}
                    role="tab"
                    aria-selected={active}
                    onClick={() => setFilterStatus(key)}
                    className={`-mb-px inline-flex shrink-0 items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors ${
                      active ? "border-blue-500 text-blue-600" : "border-transparent text-gray-400 hover:text-gray-700"
                    }`}
                  >
                    {label}
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[11px] font-medium tabular-nums ${
                        active ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {count === null ? "…" : count.toLocaleString()}
                    </span>
                  </button>
                );
              })}
            </div>

            {error && (
              <div className="mb-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
            )}

            <DayTable
              days={days}
              totalDays={totalDays}
              loading={loading}
              loadingMore={loadingMore}
              hasMore={hasMore}
              loadMore={loadMore}
              error={error}
              amountColumns={[
                { key: "in", label: "รับ/Debit" },
                { key: "out", label: "จ่าย/Credit" },
              ]}
              showUnmatched={!filterStatus}
              openDays={openDays}
              onOpenDaysChange={setOpenDays}
              tableClassName={`w-full text-sm ${showAccountColumn ? "min-w-[860px]" : "min-w-[760px]"}`}
              top={stickyTop(STICKY_VARS.nav, STICKY_VARS.cards, STICKY_VARS.tabs)}
              emptyState={
                hasActiveFilters || filterStatus ? (
                  <>
                    ไม่พบรายการที่ตรงกับตัวกรอง —{" "}
                    <button
                      onClick={() => {
                        clearFilters();
                        setFilterStatus("");
                      }}
                      className="font-medium text-blue-600 hover:underline"
                    >
                      ล้างตัวกรอง
                    </button>
                  </>
                ) : (
                  "ยังไม่มีรายการบัญชี BC365 ของบัญชีนี้"
                )
              }
              renderDetail={(day) => <GlDayDetail params={params ?? ""} day={day} showAccount={showAccountColumn} />}
            />
          </>
        )}
      </section>

    </div>
  );
}
