"use client";

import { useEffect, useState } from "react";
import { ChevronRight, ChevronDown, Loader2, ArrowDownLeft, ArrowUpRight } from "lucide-react";

type LineItem = {
  num: number;
  date: string;
  description?: string;
  ref?: string;
  accountName?: string;
  direction: "IN" | "OUT";
  amount: number;
};

type MatchRecord = {
  matchId: number;
  bankCode: string;
  matchType: "MATCHED" | "SUSPENSE";
  createdBy: string | null;
  createdAt: string;
  bankLines: LineItem[];
  glLines: LineItem[];
};

const GROUP_COLORS = [
  "border-purple-300 bg-purple-50",
  "border-orange-300 bg-orange-50",
  "border-cyan-300 bg-cyan-50",
  "border-pink-300 bg-pink-50",
  "border-lime-300 bg-lime-50",
  "border-indigo-300 bg-indigo-50",
];
const GROUP_BADGE_COLORS = [
  "bg-purple-100 text-purple-700",
  "bg-orange-100 text-orange-700",
  "bg-cyan-100 text-cyan-700",
  "bg-pink-100 text-pink-700",
  "bg-lime-100 text-lime-700",
  "bg-indigo-100 text-indigo-700",
];

function formatAmount(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
}
function formatDate(iso: string) {
  return new Date(iso).toISOString().slice(0, 10);
}

function DirectionBadge({ direction }: { direction: "IN" | "OUT" }) {
  const isIn = direction === "IN";
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full ${
        isIn ? "bg-purple-50 text-purple-700" : "bg-red-50 text-red-600"
      }`}
    >
      {isIn ? <ArrowDownLeft size={11} /> : <ArrowUpRight size={11} />}
      {direction}
    </span>
  );
}

function SubGroupBlock({
  num,
  colorIdx,
  bankLines,
  glLines,
}: {
  num: number;
  colorIdx: number;
  bankLines: LineItem[];
  glLines: LineItem[];
}) {
  const bankTotal = bankLines.reduce((s, l) => s + l.amount, 0);
  const glTotal = glLines.reduce((s, l) => s + l.amount, 0);
  const balanced = Math.abs(bankTotal - glTotal) < 0.005;

  return (
    <div className={`border-l-4 rounded-lg ${GROUP_COLORS[colorIdx % GROUP_COLORS.length]} p-3`}>
      <div className="flex items-center gap-2 mb-2">
        <span
          className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
            GROUP_BADGE_COLORS[colorIdx % GROUP_BADGE_COLORS.length]
          }`}
        >
          กลุ่ม {num}
        </span>
        <span className="text-xs text-gray-500">
          {bankLines.length} bank : {glLines.length} GL
        </span>
        {!balanced && <span className="text-[11px] text-red-500 font-medium">ยอดไม่ตรง!</span>}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          {bankLines.map((l, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <span className="text-xs text-gray-400 w-16 shrink-0">{formatDate(l.date)}</span>
              <DirectionBadge direction={l.direction} />
              <span className="flex-1 min-w-0 truncate text-gray-700">{l.description}</span>
              <span className="tabular-nums text-gray-900">{formatAmount(l.amount)}</span>
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-1.5">
          {glLines.map((l, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <span className="text-xs text-gray-400 w-16 shrink-0">{formatDate(l.date)}</span>
              <DirectionBadge direction={l.direction} />
              <span className="flex-1 min-w-0 truncate text-gray-700">
                {l.ref} · {l.accountName}
              </span>
              <span className="tabular-nums text-gray-900">{formatAmount(l.amount)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MatchCard({ match }: { match: MatchRecord }) {
  const [expanded, setExpanded] = useState(false);
  const bankTotal = match.bankLines.reduce((s, l) => s + l.amount, 0);
  const glTotal = match.glLines.reduce((s, l) => s + l.amount, 0);

  // แยกกลุ่มย่อยตาม Num (แต่ละกลุ่ม = 1 cluster ที่บาลานซ์กันเอง ไม่ว่าจะ 1:1, 1:N, N:1)
  const nums = Array.from(new Set([...match.bankLines.map((l) => l.num), ...match.glLines.map((l) => l.num)])).sort(
    (a, b) => a - b
  );

  return (
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 text-left"
      >
        {expanded ? (
          <ChevronDown size={14} className="text-gray-400 shrink-0" />
        ) : (
          <ChevronRight size={14} className="text-gray-400 shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <span className="text-sm font-medium text-gray-900">Match #{match.matchId}</span>
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
              {match.bankCode}
            </span>
            <span
              className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                match.matchType === "MATCHED" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
              }`}
            >
              {match.matchType === "MATCHED" ? "MATCHED" : "SUSPENSE"}
            </span>
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
              {nums.length} กลุ่มย่อย
            </span>
          </div>
          <p className="text-xs text-gray-400">
            {formatDateTime(match.createdAt)} · Bank {match.bankLines.length} รายการ · GL {match.glLines.length}{" "}
            รายการ
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-semibold text-gray-900 tabular-nums">{formatAmount(bankTotal)}</p>
          {Math.abs(bankTotal - glTotal) >= 0.005 && (
            <p className="text-[11px] text-red-500">GL {formatAmount(glTotal)}</p>
          )}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-gray-100 p-3 flex flex-col gap-2 bg-gray-50/50">
          {nums.map((num, idx) => (
            <SubGroupBlock
              key={num}
              num={num}
              colorIdx={idx}
              bankLines={match.bankLines.filter((l) => l.num === num)}
              glLines={match.glLines.filter((l) => l.num === num)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function MatchHistory() {
  const [matches, setMatches] = useState<MatchRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [bankFilter, setBankFilter] = useState("ALL");

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError("");
      try {
        const res = await fetch("/api/reconcile/history");
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "โหลดข้อมูลไม่สำเร็จ");
          return;
        }
        setMatches(data.matches);
      } catch {
        setError("เชื่อมต่อ server ไม่ได้");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const banks = ["ALL", ...Array.from(new Set(matches.map((m) => m.bankCode)))];
  const filtered = bankFilter === "ALL" ? matches : matches.filter((m) => m.bankCode === bankFilter);

  return (
    <div className="flex-1 min-w-0 p-4 sm:p-6">
      <h1 className="text-xl sm:text-2xl font-bold text-gray-900 mb-1">ประวัติการจับคู่ (Match History)</h1>
      <p className="text-sm text-gray-500 mb-5">
        ย้อนดูได้ว่า Match แต่ละครั้งจับคู่รายการไหนกับรายการไหนบ้าง แยกตามกลุ่มย่อย (Num) ในแต่ละ MatchId
      </p>

      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

      <div className="flex items-center gap-1.5 mb-4">
        {banks.map((b) => (
          <button
            key={b}
            onClick={() => setBankFilter(b)}
            className={`text-xs font-medium px-3 py-1.5 rounded-full transition-colors ${
              bankFilter === b ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
            }`}
          >
            {b}
          </button>
        ))}
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-gray-400 py-10 justify-center">
          <Loader2 size={16} className="animate-spin" /> กำลังโหลด...
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div className="text-center text-sm text-gray-400 py-10">ยังไม่มีประวัติการจับคู่</div>
      )}

      <div className="flex flex-col gap-3">
        {filtered.map((m) => (
          <MatchCard key={m.matchId} match={m} />
        ))}
      </div>
    </div>
  );
}