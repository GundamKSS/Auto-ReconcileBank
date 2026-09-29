"use client";

import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { ArrowDownLeft, ArrowUpRight, Loader2, Plus, Scale, Search, Trash2, X } from "lucide-react";
import { offsetGroupProblem } from "../../../lib/glOffset";

export type OffsetSelectionLine = {
  id: string;
  entryNo: number;
  date: string;
  ref: string;
  direction: "IN" | "OUT";
  amount: number;
};

function formatAmount(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatDMY(iso: string) {
  const [y, m, d] = new Date(iso).toISOString().slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}
function signedOf(l: OffsetSelectionLine) {
  return l.direction === "IN" ? l.amount : -l.amount;
}

/**
 * จับชนขาเข้ากับขาออกฝั่ง GL (บันทึกเป็น MatchType = 'OFFSET')
 *
 * ใช้ตอน BC คีย์ผิดฝั่งแล้วคีย์ใหม่ รายการที่ล้างกันเองจึงไม่มีเงินผ่านธนาคาร ไม่ต้องจับคู่กับ Bank
 * หน้าต่างนี้แสดง GL ทั้งขาเข้าและขาออกไว้ข้างกัน ผู้ใช้จึงไม่ต้องสลับแท็บ IN/OUT ไปมาเหมือนบนตารางหลัก
 * และพักกลุ่มที่ดุลแล้วไว้ได้หลายกลุ่ม ก่อนกดยืนยันทีเดียว (1 กลุ่ม = 1 กลุ่มย่อยที่ยกเลิกแยกกันได้ภายหลัง)
 *
 * แต่ละกลุ่มต้องมีทั้ง IN และ OUT และยอดสุทธิเป็น 0 พอดี — กติกาเดียวกับ lib/glOffset.ts และด่านฝั่ง server
 * ฝั่ง Bank Statement จับชนแบบนี้ไม่ได้ เพราะเป็นข้อมูลจากธนาคาร ห้ามแก้
 */
export default function OffsetConfirmModal({
  lines,
  initialSelectedIds,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  /** GL ที่ยังค้างจับคู่ทั้งสองทิศ */
  lines: OffsetSelectionLine[];
  /** รายการที่ติ๊กไว้บนตารางหลัก — ยกมาเป็นกลุ่มตั้งต้นให้เลย */
  initialSelectedIds: string[];
  busy: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: (groups: number[][]) => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set(initialSelectedIds));
  const [groups, setGroups] = useState<string[][]>([]);
  const [query, setQuery] = useState("");

  const byId = useMemo(() => new Map(lines.map((l) => [l.id, l])), [lines]);
  // รายการที่พักไว้ในกลุ่มแล้วต้องไม่ถูกเลือกซ้ำในกลุ่มอื่น
  const staged = useMemo(() => new Set(groups.flat()), [groups]);

  const available = useMemo(() => {
    const q = query.trim().toLowerCase();
    return lines
      .filter((l) => !staged.has(l.id))
      .filter((l) => (q ? l.ref.toLowerCase().includes(q) || formatAmount(l.amount).includes(q) : true))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : b.amount - a.amount));
  }, [lines, staged, query]);

  const pickedLines = useMemo(
    () => [...picked].map((id) => byId.get(id)).filter((l): l is OffsetSelectionLine => Boolean(l) && !staged.has(l!.id)),
    [picked, byId, staged]
  );
  const totalIn = pickedLines.filter((l) => l.direction === "IN").reduce((s, l) => s + l.amount, 0);
  const totalOut = pickedLines.filter((l) => l.direction === "OUT").reduce((s, l) => s + l.amount, 0);
  const totalDiff = totalIn - totalOut;
  const groupProblem = pickedLines.length === 0 ? "ยังไม่ได้เลือกรายการ" : offsetGroupProblem(pickedLines.map(signedOf));
  const canAddGroup = pickedLines.length >= 2 && groupProblem === null;

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function addGroup() {
    if (!canAddGroup) return;
    setGroups((prev) => [...prev, pickedLines.map((l) => l.id)]);
    setPicked(new Set());
  }

  function removeGroup(index: number) {
    setGroups((prev) => prev.filter((_, i) => i !== index));
  }

  // กลุ่มที่พักไว้ + กลุ่มที่กำลังเลือกอยู่ถ้าดุลแล้ว (ไม่ต้องบังคับให้กด "เพิ่มเป็นกลุ่ม" ก่อนเมื่อมีกลุ่มเดียว)
  const groupsToSave = canAddGroup ? [...groups, pickedLines.map((l) => l.id)] : groups;
  const totalRows = groupsToSave.reduce((s, g) => s + g.length, 0);

  function confirm() {
    if (groupsToSave.length === 0 || busy) return;
    onConfirm(groupsToSave.map((g) => g.map((id) => byId.get(id)!.entryNo)));
  }

  function column(direction: "IN" | "OUT") {
    const isIn = direction === "IN";
    const items = available.filter((l) => l.direction === direction);
    const pickedCount = items.filter((l) => picked.has(l.id)).length;
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="mb-1.5 flex items-center gap-1.5">
          {isIn ? (
            <ArrowDownLeft size={13} className="text-purple-600" />
          ) : (
            <ArrowUpRight size={13} className="text-red-500" />
          )}
          <p className="text-xs font-semibold text-gray-700">
            {isIn ? "ขาเข้า (IN)" : "ขาออก (OUT)"}{" "}
            <span className="font-normal text-gray-400">
              {pickedCount > 0 ? `เลือก ${pickedCount}/${items.length}` : `${items.length} รายการ`}
            </span>
          </p>
        </div>
        <ul className="min-h-0 flex-1 divide-y divide-gray-100 overflow-y-auto rounded-xl border border-gray-100">
          {items.length === 0 && <li className="px-3 py-3 text-xs text-gray-400">ไม่มีรายการ</li>}
          {items.map((l) => {
            const isPicked = picked.has(l.id);
            return (
              <li key={l.id}>
                <label
                  className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs transition-colors ${
                    isPicked ? "bg-teal-50/70" : "hover:bg-gray-50"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isPicked}
                    onChange={() => toggle(l.id)}
                    className="h-3.5 w-3.5 shrink-0 rounded border-gray-300"
                  />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="text-gray-400">{formatDMY(l.date)}</span>{" "}
                    <span className="text-gray-700">{l.ref}</span>
                  </span>
                  <span className="shrink-0 tabular-nums text-gray-900">{formatAmount(l.amount)}</span>
                </label>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  const modal = (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4 backdrop-blur-md"
      onClick={() => !busy && onCancel()}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="offset-confirm-title"
        initial={{ opacity: 0, scale: 0.94, y: 14 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 6, transition: { duration: 0.15 } }}
        transition={{ type: "spring", stiffness: 420, damping: 26 }}
        className="flex h-[85vh] w-full max-w-4xl flex-col rounded-2xl border border-white/70 bg-white/95 shadow-2xl backdrop-blur-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-gray-100 px-5 py-4">
          <div>
            <h2 id="offset-confirm-title" className="text-base font-semibold text-gray-900">
              หักล้างเงินเข้ากับเงินออกใน BC365
            </h2>
            <p className="mt-0.5 text-xs text-gray-500">
              เลือกรายการเงินเข้าและเงินออกใน BC365 ที่หักล้างกันจนสุทธิเป็นศูนย์ โดยไม่มีเงินผ่านธนาคาร สามารถจัดหลายกลุ่มก่อนยืนยันได้
            </p>
          </div>
          <button
            onClick={() => !busy && onCancel()}
            disabled={busy}
            aria-label="ปิด"
            className="text-gray-400 transition-transform hover:text-gray-600 active:scale-90 disabled:opacity-40"
          >
            <X size={18} />
          </button>
        </div>

        <div className="shrink-0 px-5 pt-3">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ค้นหาเลขเอกสารหรือยอดเงิน"
              className="w-full rounded-lg border border-gray-200 py-1.5 pl-8 pr-3 text-xs focus:border-teal-400 focus:outline-none"
            />
          </div>
        </div>

        <div className="flex min-h-0 flex-1 gap-4 px-5 py-3">
          {column("IN")}
          {column("OUT")}
        </div>

        {groups.length > 0 && (
          <div className="shrink-0 border-t border-gray-100 px-5 py-2">
            <p className="mb-1 text-[11px] font-semibold text-gray-500">กลุ่มที่พักไว้ ({groups.length})</p>
            <ul className="flex max-h-24 flex-col gap-1 overflow-y-auto">
              {groups.map((g, i) => {
                const items = g.map((id) => byId.get(id)!);
                const sum = items.filter((l) => l.direction === "IN").reduce((s, l) => s + l.amount, 0);
                return (
                  <li key={i} className="flex items-center justify-between gap-2 rounded-lg bg-teal-50/70 px-2.5 py-1 text-xs">
                    <span className="min-w-0 truncate text-teal-900">
                      กลุ่ม {i + 1}: {items.map((l) => `${l.direction} ${l.ref}`).join(" · ")}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="tabular-nums text-teal-800">{formatAmount(sum)}</span>
                      <button
                        onClick={() => removeGroup(i)}
                        disabled={busy}
                        aria-label={`ลบกลุ่ม ${i + 1}`}
                        className="text-teal-700 hover:text-red-600 disabled:opacity-40"
                      >
                        <Trash2 size={12} />
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <div className="shrink-0 rounded-b-2xl border-t border-gray-100 bg-gray-50/60 px-5 py-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex flex-wrap items-end gap-x-5 gap-y-1 text-xs">
              <span className="text-gray-500">
                รวมเงินเข้า <b className="ml-1 tabular-nums text-gray-900">{formatAmount(totalIn)}</b>
              </span>
              <span className="text-gray-500">
                รวมเงินออก <b className="ml-1 tabular-nums text-gray-900">{formatAmount(totalOut)}</b>
              </span>
              <span className="text-gray-500">
                ผลต่างรวม{" "}
                <b className={`ml-1 tabular-nums ${Math.abs(totalDiff) < 0.005 ? "text-teal-700" : "text-red-600"}`}>
                  {formatAmount(Math.abs(totalDiff))}
                </b>
              </span>
              {pickedLines.length > 0 && groupProblem && <span className="text-amber-700">{groupProblem}</span>}
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={addGroup}
                disabled={!canAddGroup || busy}
                title={canAddGroup ? "เก็บกลุ่มนี้เพื่อเลือกกลุ่มถัดไป" : (groupProblem ?? undefined)}
                className="flex items-center gap-1 rounded-full border border-teal-200 bg-white px-3 py-1.5 text-xs font-medium text-teal-700 hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Plus size={12} /> เพิ่มเป็นกลุ่ม
              </button>
              <button
                onClick={() => !busy && onCancel()}
                disabled={busy}
                className="rounded-full px-3 py-1.5 text-sm text-gray-600 transition-all hover:bg-gray-100 active:scale-95 disabled:opacity-40"
              >
                ยกเลิก
              </button>
              <button
                onClick={confirm}
                disabled={groupsToSave.length === 0 || busy}
                className="flex items-center gap-1.5 rounded-full bg-teal-600 px-5 py-2 text-sm font-medium text-white transition-all hover:bg-teal-700 active:scale-95 disabled:opacity-40 disabled:active:scale-100"
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Scale size={14} />}
                ยืนยันหักล้าง {groupsToSave.length} กลุ่ม ({totalRows} รายการ)
              </button>
            </div>
          </div>
          {error && <p className="mt-1.5 text-xs text-red-600">{error}</p>}
        </div>
      </motion.div>
    </motion.div>
  );

  return createPortal(modal, document.body);
}
