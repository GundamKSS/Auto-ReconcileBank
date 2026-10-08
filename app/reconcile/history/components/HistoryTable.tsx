"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Undo2 } from "lucide-react";
import {
  AMOUNT_TOLERANCE,
  MATCH_TYPE_META,
  cleanAccountName,
  formatAmount,
  formatDMY,
  formatDateTime,
  formatSigned,
  summarizeGroups,
  type LineItem,
  type MatchRecord,
  type MatchTypeValue,
  type SubGroup,
} from "./historyModel";

export const HISTORY_TYPE_LABELS: Record<MatchTypeValue, string> = {
  MATCHED: "จับคู่แล้ว",
  OFFSET: "หักล้าง BC365",
  SUSPENSE: "พักรายการ",
  EXCLUDED: "JV ปรับปรุง",
};

function Lines({ lines, source }: { lines: LineItem[]; source: "BANK" | "GL" }) {
  if (lines.length === 0) return <p className="text-xs text-slate-400">{source === "BANK" ? "ไม่มีรายการธนาคาร" : "ไม่มีรายการ BC365"}</p>;
  return (
    <div className="divide-y divide-slate-100">
      {lines.map((line) => (
        <div key={source === "BANK" ? line.lineId : line.entryNo} className={`flex items-start gap-3 py-2 first:pt-0 last:pb-0 ${line.status === "REVERSED" ? "text-slate-400" : "text-slate-700"}`}>
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              <span className="text-slate-500">{formatDMY(line.date)}</span>
              <span className={line.direction === "IN" ? "text-emerald-700" : "text-rose-600"}>{line.direction === "IN" ? "เข้า" : "ออก"}</span>
              {line.status === "REVERSED" && <span className="text-rose-600">ยกเลิกแล้ว</span>}
            </div>
            <p className="break-words text-sm leading-relaxed">{source === "BANK" ? line.description || "—" : line.ref || "ไม่มีเลขเอกสาร"}</p>
            {source === "GL" && <p className="mt-1 break-words text-xs leading-relaxed text-slate-500">
              Entry {line.entryNo} · {line.accountNo}{line.accountName ? ` · ${cleanAccountName(line.accountName)}` : ""}
            </p>}
            {line.status === "REVERSED" && line.reversedReason && <p className="mt-1 text-xs text-rose-600">{line.reversedReason}</p>}
          </div>
          <span className="shrink-0 text-right text-sm font-medium tabular-nums">{formatAmount(line.amount)}</span>
        </div>
      ))}
      {lines.length > 1 && <div className="flex items-center justify-between gap-2 pt-2 text-xs text-slate-500">
        <span>รวม {lines.length} รายการ</span>
        <span className="font-semibold tabular-nums">{formatAmount(lines.reduce((sum, line) => sum + line.amount, 0))}</span>
      </div>}
    </div>
  );
}

function HistoryRow({ match, group, selected, onToggle, onReturn }: {
  match: MatchRecord;
  group: SubGroup;
  selected: boolean;
  onToggle: (key: string) => void;
  onReturn: (groups: SubGroup[]) => void;
}) {
  const reversed = group.status === "REVERSED";
  const selectable = MATCH_TYPE_META[match.matchType].revertable && !reversed;
  const difference = summarizeGroups([group]).difference;
  const hasDifference = match.matchType === "MATCHED" && Math.abs(difference) >= AMOUNT_TOLERANCE;
  const cell = "block px-4 py-3 align-top lg:table-cell";
  return (
    <tr className={`block border-b border-slate-200 lg:table-row ${selected ? "bg-blue-50/70" : reversed ? "bg-slate-50" : "bg-white hover:bg-slate-50/60"}`}>
      <td className="block px-4 pt-4 align-top lg:table-cell lg:w-10 lg:py-4 lg:pr-0">
        {selectable && <input type="checkbox" checked={selected} onChange={() => onToggle(group.key)} aria-label={`เลือก #${match.matchId} กลุ่ม ${group.num}`} className="size-4 cursor-pointer rounded border-slate-300 accent-blue-600" />}
      </td>
      <td className={`${cell} lg:w-[150px]`}>
        <p className="text-xs font-semibold text-slate-800">#{match.matchId} <span className="font-normal text-slate-500">· กลุ่ม {group.num}</span></p>
        <p className="mt-1.5 flex flex-wrap items-center gap-1.5"><span className="text-[11px] text-slate-500">{match.bankCode}</span><span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${MATCH_TYPE_META[match.matchType].chipClass}`}>{HISTORY_TYPE_LABELS[match.matchType]}</span></p>
        <p className="mt-1.5 text-[10px] leading-relaxed text-slate-400" title={match.createdBy ? `บันทึกโดย ${match.createdBy}` : undefined}>{formatDateTime(match.createdAt)}</p>
      </td>
      <td className={`${cell} lg:w-[30%]`}>
        <p className="mb-2 text-xs font-semibold text-slate-500 lg:hidden">ธนาคาร · บาท</p>
        <Lines lines={group.bankLines} source="BANK" />
      </td>
      <td className={`${cell} border-slate-100 lg:w-[34%] lg:border-l`}>
        <p className="mb-2 text-xs font-semibold text-slate-500 lg:hidden">BC365 · บาท</p>
        <Lines lines={group.glLines} source="GL" />
      </td>
      <td className={`${cell} lg:w-[160px]`}>
        {reversed ? <>
          <p className="text-xs font-medium text-rose-600">ยกเลิกแล้ว</p>
          {group.reversedAt && <p className="mt-1 text-[11px] text-slate-500">{formatDateTime(group.reversedAt)}</p>}
          {group.reversedBy && <p className="mt-1 text-[11px] text-slate-500">{group.reversedBy}</p>}
          {group.reversedReason && <p className="mt-1 break-words text-xs text-slate-500">{group.reversedReason}</p>}
        </> : match.matchType === "MATCHED" ? hasDifference ? <>
          <p className="text-xs text-amber-700">พักส่วนต่าง</p>
          <p className="mt-1 text-sm font-semibold tabular-nums text-amber-700">{formatSigned(difference)}</p>
        </> : <span className="text-xs font-medium text-emerald-700">ยอดตรง</span> : <span className="text-xs text-slate-500">{HISTORY_TYPE_LABELS[match.matchType]}</span>}
        {match.remark && <p className="mt-2 break-words text-xs leading-relaxed text-slate-500">{match.remark}</p>}
      </td>
      <td className={`${cell} lg:w-[115px]`}>
        {selectable ? <button type="button" onClick={() => onReturn([group])} aria-label={`ส่งกลับ #${match.matchId} กลุ่ม ${group.num}`} className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-slate-600 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700"><Undo2 size={13} /> ส่งกลับ</button>
          : !reversed && match.matchType === "SUSPENSE" ? <Link href="/suspense" className="text-xs font-medium text-blue-600 hover:underline">ไปหน้ารายการพัก</Link> : null}
      </td>
    </tr>
  );
}

export default function HistoryTable({ matches, groupsByMatchId, selectedKeys, onToggleGroup, onRequestUnmatch, loading, children, onLoadMore }: {
  matches: MatchRecord[];
  groupsByMatchId: Map<number, SubGroup[]>;
  selectedKeys: Set<string>;
  onToggleGroup: (key: string) => void;
  onRequestUnmatch: (groups: SubGroup[]) => void;
  loading: boolean;
  children: ReactNode;
  onLoadMore: () => void;
}) {
  return (
    <div aria-busy={loading} inert={loading} onScroll={(event) => {
      const { scrollTop, scrollHeight, clientHeight } = event.currentTarget;
      if (scrollHeight - scrollTop - clientHeight < 300) onLoadMore();
    }} className={`overflow-auto rounded-xl border border-slate-200 bg-white lg:max-h-[70vh] ${loading ? "opacity-50" : ""}`}>
      <table aria-label="รายการประวัติการจับคู่" className="block w-full text-left lg:table lg:min-w-[1080px]">
        <thead className="sticky top-0 z-10 hidden bg-slate-100 text-xs font-semibold text-slate-600 lg:table-header-group">
          <tr><th scope="col" className="w-10"><span className="sr-only">เลือก</span></th><th scope="col" className="px-4 py-3">อ้างอิง / กลุ่ม</th><th scope="col" className="px-4 py-3">ธนาคาร <span className="font-normal text-slate-400">· บาท</span></th><th scope="col" className="px-4 py-3">BC365 <span className="font-normal text-slate-400">· บาท</span></th><th scope="col" className="px-4 py-3">ผลการจับคู่</th><th scope="col" className="px-4 py-3">แก้ไข</th></tr>
        </thead>
        <tbody className="block lg:table-row-group">
          {matches.flatMap((match) => (groupsByMatchId.get(match.matchId) ?? []).map((group) => <HistoryRow key={group.key} match={match} group={group} selected={selectedKeys.has(group.key)} onToggle={onToggleGroup} onReturn={onRequestUnmatch} />))}
        </tbody>
      </table>
      {children}
    </div>
  );
}
