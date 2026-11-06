"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Search, Undo2 } from "lucide-react";
import { cleanAccountName, formatAmount, formatDateTime, formatDMY, formatSigned } from "../../reconcile/history/components/historyModel";
import type { PairSuggestion } from "../../../lib/suspenseSuggest";
import { visibleLines, type MatchRecord, type RawGlLine, type SideTab, type UnifiedLine } from "./suspenseModel";

// ป้ายใต้รายการพัก BC365: ระบบหา statement ที่ยอดตรงกันให้แล้ว (ทุกเดือนของบัญชีเดียวกัน) กดเพื่อดูและยืนยันคู่
function PairHint({ hint, onOpen }: { hint: PairSuggestion | undefined; onOpen: () => void }) {
  if (!hint) return null;
  if (hint.total === 0) return <p className="mt-1.5 text-[11px] text-slate-400">ยังไม่พบยอดนี้ใน statement</p>;
  const best = hint.candidates[0];
  const recommended = Boolean(best?.recommended);
  const more = hint.total - 1;
  const label = recommended
    ? `น่าจะตรงกับ statement วันที่ ${formatDMY(best.bank.date)}${more > 0 ? ` และอีก ${more} รายการ` : ""}`
    : `พบยอดนี้ใน statement ${hint.total} รายการ`;
  const tone = !recommended
    ? "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
    : best.level === "high"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
      : "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100";
  return (
    <button type="button" onClick={onOpen} className={`mt-1.5 inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-left text-[11px] font-medium ${tone}`}>
      <Search size={11} className="shrink-0" />
      <span className="min-w-0">{label}</span>
      <ArrowRight size={11} className="shrink-0" />
    </button>
  );
}

function AgingBadge({ createdAt }: { createdAt: string }) {
  const [now] = useState(() => Date.now());
  const days = Math.max(0, Math.floor((now - new Date(createdAt).getTime()) / 86400000));
  const color = days < 7 ? "bg-emerald-100 text-emerald-700" : days < 30 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700";
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${color}`}>พักมา {days} วัน</span>;
}

function SuspenseLines({ lines, source, match, selected, selectable, onToggleLine, pairHints, onFindPair }: {
  lines: UnifiedLine[];
  source: "BANK" | "GL";
  match: MatchRecord;
  selected: Set<string>;
  selectable: boolean;
  onToggleLine: (key: string) => void;
  pairHints?: Map<number, PairSuggestion>;
  onFindPair?: (match: MatchRecord, gl: RawGlLine) => void;
}) {
  if (lines.length === 0) return <p className="text-xs text-slate-400">{source === "BANK" ? "ไม่มีรายการธนาคาร" : "ไม่มีรายการ BC365"}</p>;
  const glById = new Map(match.glLines.map((line) => [line.entryNo, line]));
  return (
    <div className="divide-y divide-slate-100">
      {lines.map((line) => {
        const gl = source === "GL" ? glById.get(line.refId) : undefined;
        return (
          <div key={line.key} className="flex items-start gap-3 py-2 text-slate-700 first:pt-0 last:pb-0">
            {selectable && <input type="checkbox" checked={selected.has(line.key)} onChange={() => onToggleLine(line.key)} aria-label={`เลือก #${match.matchId} ${source === "BANK" ? "ธนาคาร" : "BC365"} ${line.refId}`} className="mt-0.5 size-4 shrink-0 cursor-pointer rounded border-slate-300 accent-blue-600" />}
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                <span className="text-slate-500">{formatDMY(line.date)}</span>
                <span className={line.direction === "IN" ? "text-emerald-700" : "text-rose-600"}>{line.direction === "IN" ? "เข้า" : "ออก"}</span>
              </div>
              <p className="break-words text-sm leading-relaxed">{source === "BANK" ? line.detail : gl?.ref || "ไม่มีเลขเอกสาร"}</p>
              {gl && <p className="mt-1 break-words text-xs leading-relaxed text-slate-500">{[`Entry ${gl.entryNo}`, gl.accountNo, cleanAccountName(gl.accountName)].filter(Boolean).join(" · ")}</p>}
              {gl && pairHints && onFindPair && match.suspenseKind !== "DIFFERENCE" && <PairHint hint={pairHints.get(gl.entryNo)} onOpen={() => onFindPair(match, gl)} />}
            </div>
            <span className="shrink-0 text-right text-sm font-medium tabular-nums">{formatAmount(line.amount)}</span>
          </div>
        );
      })}
      {lines.length > 1 && <div className="flex items-center justify-between gap-2 pt-2 text-xs text-slate-500"><span>รวม {lines.length} รายการ</span><span className="font-semibold tabular-nums">{formatAmount(lines.reduce((sum, line) => sum + line.amount, 0))}</span></div>}
    </div>
  );
}

function SuspenseRow({ match, num, lines, readOnly, selected, onToggleLine, onToggleLines, onRequestReturn, pairHints, onFindPair }: {
  match: MatchRecord;
  num: number;
  lines: UnifiedLine[];
  // ไม่มีสิทธิ์ AP/AR — เห็นรายการแต่เลือก/คืนไปจับคู่ไม่ได้
  readOnly: boolean;
  selected: Set<string>;
  onToggleLine: (key: string) => void;
  onToggleLines: (lines: UnifiedLine[]) => void;
  onRequestReturn: (lines: UnifiedLine[]) => void;
  pairHints?: Map<number, PairSuggestion>;
  onFindPair?: (match: MatchRecord, gl: RawGlLine) => void;
}) {
  const differenceSuspense = match.suspenseKind === "DIFFERENCE";
  const canSelect = !differenceSuspense && !readOnly;
  const selectedCount = lines.filter((line) => selected.has(line.key)).length;
  const allSelected = lines.length > 0 && selectedCount === lines.length;
  const checkboxRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (checkboxRef.current) checkboxRef.current.indeterminate = selectedCount > 0 && !allSelected;
  }, [selectedCount, allSelected]);
  const bankLines = lines.filter((line) => line.sourceType === "BANK");
  const glLines = lines.filter((line) => line.sourceType === "GL");
  const signedTotal = (items: UnifiedLine[]) => items.reduce((sum, line) => sum + (line.direction === "IN" ? line.amount : -line.amount), 0);
  const difference = Math.round((Math.abs(signedTotal(bankLines)) - Math.abs(signedTotal(glLines))) * 100) / 100;
  const cell = "block px-4 py-3 align-top lg:table-cell";
  return (
    <tr className={`block border-b border-slate-200 lg:table-row ${selectedCount > 0 ? "bg-blue-50/70" : "bg-white hover:bg-slate-50/60"}`}>
      <td className="block px-4 pt-4 align-top lg:table-cell lg:w-10 lg:py-4 lg:pr-0">
        {canSelect && <input ref={checkboxRef} type="checkbox" checked={allSelected} onChange={() => onToggleLines(lines)} aria-label={`เลือก #${match.matchId} กลุ่ม ${num}`} className="size-4 cursor-pointer rounded border-slate-300 accent-blue-600" />}
      </td>
      <td className={`${cell} lg:w-[150px]`}>
        <p className="text-xs font-semibold text-slate-800">#{match.matchId} <span className="font-normal text-slate-500">· กลุ่ม {num}</span></p>
        <p className="mt-1.5 flex flex-wrap items-center gap-1.5"><span className="text-[11px] text-slate-500">{match.bankCode}</span><span className="inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">{differenceSuspense ? "พักส่วนต่าง" : "พักทั้งรายการ"}</span></p>
        <p className="mt-1.5 text-[10px] leading-relaxed text-slate-400" title={match.createdBy ? `บันทึกโดย ${match.createdBy}` : undefined}>{formatDateTime(match.createdAt)}</p>
        <p className="mt-2"><AgingBadge createdAt={match.createdAt} /></p>
      </td>
      <td className={`${cell} lg:w-[30%]`}>
        <p className="mb-2 text-xs font-semibold text-slate-500 lg:hidden">ธนาคาร · บาท</p>
        <SuspenseLines lines={bankLines} source="BANK" match={match} selected={selected} selectable={canSelect && lines.length > 1} onToggleLine={onToggleLine} />
      </td>
      <td className={`${cell} border-slate-100 lg:w-[34%] lg:border-l`}>
        <p className="mb-2 text-xs font-semibold text-slate-500 lg:hidden">BC365 · บาท</p>
        <SuspenseLines lines={glLines} source="GL" match={match} selected={selected} selectable={canSelect && lines.length > 1} onToggleLine={onToggleLine} pairHints={pairHints} onFindPair={onFindPair} />
      </td>
      <td className={`${cell} lg:w-[160px]`}>
        {differenceSuspense ? <><p className="text-xs text-amber-700">{Math.abs(difference) >= 0.005 ? "พักส่วนต่าง" : "ยอดตรง"}</p><p className="mt-1 text-sm font-semibold tabular-nums text-amber-700">{formatSigned(difference)}</p></> : <span className="text-xs text-slate-500">พักทั้งรายการ</span>}
        {match.remark && <p className="mt-2 break-words text-xs leading-relaxed text-slate-500">{match.remark}</p>}
      </td>
      <td className={`${cell} lg:w-[115px]`}>
        {differenceSuspense ? <Link href="/reconcile/history" className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline">ดูคู่ที่จับไว้ <ArrowRight size={13} className="shrink-0" /></Link> : <button type="button" onClick={() => onRequestReturn(lines)} disabled={readOnly} title={readOnly ? "ไม่มีสิทธิ์ AP / AR — ดูได้อย่างเดียว" : undefined} aria-label={`คืนไปจับคู่ #${match.matchId} กลุ่ม ${num}`} className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-slate-600 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-slate-200 disabled:hover:bg-white disabled:hover:text-slate-600"><Undo2 size={13} /> คืนไปจับคู่</button>}
      </td>
    </tr>
  );
}

export default function SuspenseTable({ matches, sideTab, readOnly, selected, onToggleLine, onToggleLines, onRequestReturn, loading, onLoadMore, children, pairHints, onFindPair }: {
  matches: MatchRecord[];
  sideTab: SideTab;
  readOnly: boolean;
  selected: Set<string>;
  onToggleLine: (key: string) => void;
  onToggleLines: (lines: UnifiedLine[]) => void;
  onRequestReturn: (lines: UnifiedLine[]) => void;
  loading: boolean;
  onLoadMore: () => void;
  children: ReactNode;
  pairHints?: Map<number, PairSuggestion>;
  onFindPair?: (match: MatchRecord, gl: RawGlLine) => void;
}) {
  return (
    <div aria-busy={loading} inert={loading} onScroll={(event) => {
      const { scrollTop, scrollHeight, clientHeight } = event.currentTarget;
      if (scrollHeight - scrollTop - clientHeight < 300) onLoadMore();
    }} className={`overflow-auto rounded-xl border border-slate-200 bg-white lg:max-h-[70vh] ${loading ? "opacity-50" : ""}`}>
      <table aria-label="รายการพัก" className="block w-full text-left lg:table lg:min-w-[1080px]">
        <thead className="sticky top-0 z-10 hidden bg-slate-100 text-xs font-semibold text-slate-600 lg:table-header-group">
          <tr><th scope="col" className="w-10"><span className="sr-only">เลือก</span></th><th scope="col" className="px-4 py-3">อ้างอิง / กลุ่ม</th><th scope="col" className="px-4 py-3">ธนาคาร <span className="font-normal text-slate-400">· บาท</span></th><th scope="col" className="px-4 py-3">BC365 <span className="font-normal text-slate-400">· บาท</span></th><th scope="col" className="px-4 py-3">รายการพัก / หมายเหตุ</th><th scope="col" className="px-4 py-3">แก้ไข</th></tr>
        </thead>
        <tbody className="block lg:table-row-group">
          {matches.flatMap((match) => {
            const groups = new Map<number, UnifiedLine[]>();
            for (const line of visibleLines(match, sideTab)) {
              const group = groups.get(line.num) ?? [];
              group.push(line);
              groups.set(line.num, group);
            }
            return [...groups].sort(([a], [b]) => a - b).map(([num, lines]) => <SuspenseRow key={`${match.matchId}:${num}`} match={match} num={num} lines={lines} readOnly={readOnly} selected={selected} onToggleLine={onToggleLine} onToggleLines={onToggleLines} onRequestReturn={onRequestReturn} pairHints={pairHints} onFindPair={onFindPair} />);
          })}
        </tbody>
      </table>
      {children}
    </div>
  );
}
