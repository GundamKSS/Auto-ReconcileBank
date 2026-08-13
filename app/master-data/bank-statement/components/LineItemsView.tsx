"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Pencil, Trash2, Plus, Check, X, Loader2, Lock } from "lucide-react";
import { ImportBatch } from "./ImportBatchList";

type Line = {
  LineId: number;
  ImportId: number;
  BankCode: string;
  TranDate: string;
  Description: string | null;
  Debit: number | null;
  Credit: number | null;
  Balance: number | null;
  ChequeNo: string | null;
  Channel: string | null;
  MatchStatus: "UNMATCHED" | "MATCHED" | "SUSPENSE";
};

type EditForm = {
  tranDate: string;
  description: string;
  debit: string;
  credit: string;
  balance: string;
  chequeNo: string;
  channel: string;
};

function formatAmount(n: number | null) {
  if (n === null || n === undefined) return "-";
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function toDateInput(iso: string) {
  return iso ? iso.slice(0, 10) : "";
}
function emptyForm(): EditForm {
  return { tranDate: "", description: "", debit: "", credit: "", balance: "", chequeNo: "", channel: "" };
}
function lineToForm(l: Line): EditForm {
  return {
    tranDate: toDateInput(l.TranDate),
    description: l.Description ?? "",
    debit: l.Debit !== null ? String(l.Debit) : "",
    credit: l.Credit !== null ? String(l.Credit) : "",
    balance: l.Balance !== null ? String(l.Balance) : "",
    chequeNo: l.ChequeNo ?? "",
    channel: l.Channel ?? "",
  };
}

function StatusBadge({ status }: { status: Line["MatchStatus"] }) {
  const map = {
    UNMATCHED: "bg-gray-100 text-gray-500",
    MATCHED: "bg-green-100 text-green-700",
    SUSPENSE: "bg-amber-100 text-amber-700",
  };
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${map[status] ?? map.UNMATCHED}`}>
      {status}
    </span>
  );
}

export default function LineItemsView({ batch, onBack }: { batch: ImportBatch; onBack: () => void }) {
  const [lines, setLines] = useState<Line[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<EditForm>(emptyForm());
  const [busyId, setBusyId] = useState<number | "new" | null>(null);
  const [adding, setAdding] = useState(false);
  const [addForm, setAddForm] = useState<EditForm>(emptyForm());

  async function loadLines() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/master/bank-statement/lines?importId=${batch.ImportId}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "โหลดรายการไม่สำเร็จ");
        return;
      }
      setLines(data.lines);
    } catch {
      setError("เชื่อมต่อ server ไม่ได้");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // โหลดรายการใหม่ทุกครั้งที่เปลี่ยนไฟล์ที่เลือกดู — fetch-on-mount ปกติ
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadLines();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batch.ImportId]);

  function startEdit(line: Line) {
    setEditingId(line.LineId);
    setEditForm(lineToForm(line));
    setError("");
  }
  function cancelEdit() {
    setEditingId(null);
    setError("");
  }

  async function saveEdit(lineId: number) {
    setBusyId(lineId);
    setError("");
    try {
      const res = await fetch(`/api/master/bank-statement/lines/${lineId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tranDate: editForm.tranDate,
          description: editForm.description || null,
          debit: editForm.debit ? Number(editForm.debit) : null,
          credit: editForm.credit ? Number(editForm.credit) : null,
          balance: editForm.balance ? Number(editForm.balance) : null,
          chequeNo: editForm.chequeNo || null,
          channel: editForm.channel || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "แก้ไขไม่สำเร็จ");
        return;
      }
      setEditingId(null);
      await loadLines();
    } catch {
      setError("เชื่อมต่อ server ไม่ได้");
    } finally {
      setBusyId(null);
    }
  }

  async function deleteLine(line: Line) {
    if (!confirm(`ลบรายการ "${line.Description}" วันที่ ${toDateInput(line.TranDate)} ใช่ไหม?`)) return;
    setBusyId(line.LineId);
    setError("");
    try {
      const res = await fetch(`/api/master/bank-statement/lines/${line.LineId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "ลบไม่สำเร็จ");
        return;
      }
      await loadLines();
    } catch {
      setError("เชื่อมต่อ server ไม่ได้");
    } finally {
      setBusyId(null);
    }
  }

  async function submitAdd() {
    if (!addForm.tranDate || (!addForm.debit && !addForm.credit)) {
      setError("กรุณากรอกวันที่และยอดเงินอย่างน้อย 1 ฝั่ง");
      return;
    }
    setBusyId("new");
    setError("");
    try {
      const res = await fetch(`/api/master/bank-statement/lines`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          importId: batch.ImportId,
          bankCode: batch.BankCode,
          tranDate: addForm.tranDate,
          description: addForm.description || null,
          debit: addForm.debit ? Number(addForm.debit) : null,
          credit: addForm.credit ? Number(addForm.credit) : null,
          balance: addForm.balance ? Number(addForm.balance) : null,
          chequeNo: addForm.chequeNo || null,
          channel: addForm.channel || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "เพิ่มรายการไม่สำเร็จ");
        return;
      }
      setAdding(false);
      setAddForm(emptyForm());
      await loadLines();
    } catch {
      setError("เชื่อมต่อ server ไม่ได้");
    } finally {
      setBusyId(null);
    }
  }

  const inputCls = "border border-gray-200 rounded-md px-2 py-1 text-sm w-full";

  return (
    <div>
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-4 -ml-1 px-1 py-0.5 rounded-md hover:bg-gray-50 transition-colors">
        <ArrowLeft size={14} /> กลับไปเลือกไฟล์
      </button>

      <div className="flex items-center justify-between mb-5 flex-wrap gap-3 pb-5 border-b border-gray-100">
        <div>
          <h2 className="text-lg font-bold text-gray-900">{batch.FileName}</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            {toDateInput(batch.PeriodStart)} – {toDateInput(batch.PeriodEnd)} ·{" "}
            <span className="text-gray-500 font-medium">{lines.length.toLocaleString()} รายการ</span>
          </p>
        </div>
        <button
          onClick={() => {
            setAdding(true);
            setAddForm({ ...emptyForm(), tranDate: toDateInput(batch.PeriodEnd) });
          }}
          className="flex items-center gap-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-full transition-colors shadow-sm shadow-blue-500/20"
        >
          <Plus size={14} /> เพิ่มรายการ
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      <div className="border border-gray-200 rounded-2xl overflow-x-auto">
        <table className="w-full text-sm min-w-[900px]">
          <thead className="bg-gray-50 border-b border-gray-200 text-gray-500 text-xs uppercase tracking-wide">
            <tr>
              <th className="px-3 py-3 text-left">วันที่</th>
              <th className="px-3 py-3 text-left">รายละเอียด</th>
              <th className="px-3 py-3 text-right">ถอน/Debit</th>
              <th className="px-3 py-3 text-right">ฝาก/Credit</th>
              <th className="px-3 py-3 text-right">คงเหลือ</th>
              <th className="px-3 py-3 text-left">เลขเช็ค</th>
              <th className="px-3 py-3 text-left">ช่องทาง</th>
              <th className="px-3 py-3 text-center">สถานะ</th>
              <th className="px-3 py-3 text-center">จัดการ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading && (
              <tr>
                <td colSpan={9} className="px-3 py-10 text-center text-gray-400">
                  <Loader2 size={16} className="animate-spin inline mr-2" /> กำลังโหลด...
                </td>
              </tr>
            )}

            {adding && (
              <tr className="bg-blue-50/50">
                <td className="px-3 py-2">
                  <input type="date" className={inputCls} value={addForm.tranDate} onChange={(e) => setAddForm({ ...addForm, tranDate: e.target.value })} />
                </td>
                <td className="px-3 py-2">
                  <input className={inputCls} placeholder="รายละเอียด" value={addForm.description} onChange={(e) => setAddForm({ ...addForm, description: e.target.value })} />
                </td>
                <td className="px-3 py-2">
                  <input className={inputCls + " text-right"} placeholder="0.00" value={addForm.debit} onChange={(e) => setAddForm({ ...addForm, debit: e.target.value })} />
                </td>
                <td className="px-3 py-2">
                  <input className={inputCls + " text-right"} placeholder="0.00" value={addForm.credit} onChange={(e) => setAddForm({ ...addForm, credit: e.target.value })} />
                </td>
                <td className="px-3 py-2">
                  <input className={inputCls + " text-right"} placeholder="0.00" value={addForm.balance} onChange={(e) => setAddForm({ ...addForm, balance: e.target.value })} />
                </td>
                <td className="px-3 py-2">
                  <input className={inputCls} value={addForm.chequeNo} onChange={(e) => setAddForm({ ...addForm, chequeNo: e.target.value })} />
                </td>
                <td className="px-3 py-2">
                  <input className={inputCls} value={addForm.channel} onChange={(e) => setAddForm({ ...addForm, channel: e.target.value })} />
                </td>
                <td className="px-3 py-2"></td>
                <td className="px-3 py-2">
                  <div className="flex items-center justify-center gap-1">
                    <button onClick={submitAdd} disabled={busyId === "new"} className="p-1.5 text-green-600 hover:bg-green-50 rounded-md">
                      {busyId === "new" ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                    </button>
                    <button onClick={() => setAdding(false)} className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-md">
                      <X size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            )}

            {!loading &&
              lines.map((l) => {
                const locked = l.MatchStatus !== "UNMATCHED";
                const isEditing = editingId === l.LineId;

                if (isEditing) {
                  return (
                    <tr key={l.LineId} className="bg-blue-50/50">
                      <td className="px-3 py-2">
                        <input type="date" className={inputCls} value={editForm.tranDate} onChange={(e) => setEditForm({ ...editForm, tranDate: e.target.value })} />
                      </td>
                      <td className="px-3 py-2">
                        <input className={inputCls} value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} />
                      </td>
                      <td className="px-3 py-2">
                        <input className={inputCls + " text-right"} value={editForm.debit} onChange={(e) => setEditForm({ ...editForm, debit: e.target.value })} />
                      </td>
                      <td className="px-3 py-2">
                        <input className={inputCls + " text-right"} value={editForm.credit} onChange={(e) => setEditForm({ ...editForm, credit: e.target.value })} />
                      </td>
                      <td className="px-3 py-2">
                        <input className={inputCls + " text-right"} value={editForm.balance} onChange={(e) => setEditForm({ ...editForm, balance: e.target.value })} />
                      </td>
                      <td className="px-3 py-2">
                        <input className={inputCls} value={editForm.chequeNo} onChange={(e) => setEditForm({ ...editForm, chequeNo: e.target.value })} />
                      </td>
                      <td className="px-3 py-2">
                        <input className={inputCls} value={editForm.channel} onChange={(e) => setEditForm({ ...editForm, channel: e.target.value })} />
                      </td>
                      <td className="px-3 py-2 text-center">
                        <StatusBadge status={l.MatchStatus} />
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => saveEdit(l.LineId)} disabled={busyId === l.LineId} className="p-1.5 text-green-600 hover:bg-green-50 rounded-md">
                            {busyId === l.LineId ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                          </button>
                          <button onClick={cancelEdit} className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-md">
                            <X size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                }

                return (
                  <tr key={l.LineId} className="hover:bg-gray-50">
                    <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{toDateInput(l.TranDate)}</td>
                    <td className="px-3 py-2 text-gray-800 max-w-[260px] truncate">{l.Description}</td>
                    <td className="px-3 py-2 text-right text-red-600 tabular-nums">{formatAmount(l.Debit)}</td>
                    <td className="px-3 py-2 text-right text-teal-700 tabular-nums">{formatAmount(l.Credit)}</td>
                    <td className="px-3 py-2 text-right text-gray-500 tabular-nums">{formatAmount(l.Balance)}</td>
                    <td className="px-3 py-2 text-gray-500">{l.ChequeNo || "-"}</td>
                    <td className="px-3 py-2 text-gray-500">{l.Channel || "-"}</td>
                    <td className="px-3 py-2 text-center">
                      <StatusBadge status={l.MatchStatus} />
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-center gap-1">
                        {locked ? (
                          <span title="รายการนี้จับคู่ไปแล้ว แก้ไข/ลบไม่ได้" className="p-1.5 text-gray-300">
                            <Lock size={14} />
                          </span>
                        ) : (
                          <>
                            <button onClick={() => startEdit(l)} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-md">
                              <Pencil size={14} />
                            </button>
                            <button
                              onClick={() => deleteLine(l)}
                              disabled={busyId === l.LineId}
                              className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-md disabled:opacity-50"
                            >
                              {busyId === l.LineId ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}

            {!loading && lines.length === 0 && !adding && (
              <tr>
                <td colSpan={9} className="px-3 py-10 text-center text-gray-400">
                  ไม่มีรายการในไฟล์นี้
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}