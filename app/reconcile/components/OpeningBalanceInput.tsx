"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

import { formatAmount } from '../../../lib/formatAmount';
/** แปลงข้อความที่ผู้ใช้พิมพ์ (มีคอมมา/ลบนำหน้าได้) เป็นตัวเลข — คืน null ถ้าไม่ใช่ตัวเลข */
export function parseAmountInput(raw: string): number | null {
  const cleaned = raw.replace(/,/g, "").trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Number(cleaned);
}

/**
 * ช่องกรอกยอดยกมาฝั่ง GL ของงวด — ใช้ทั้งตอนสร้างงานกระทบยอดใหม่และในหน้าสรุปยอดคงเหลือ
 * มียอดที่ระบบเสนอให้กดใช้ได้ (ยอดยกมางวดก่อน + การเคลื่อนไหว GL ระหว่างทาง)
 */
export default function OpeningBalanceInput({
  value,
  onChange,
  suggestion,
  suggestionFrom,
  saving,
  onSave,
}: {
  value: string;
  onChange: (v: string) => void;
  suggestion: number | null;
  suggestionFrom: string | null;
  saving?: boolean;
  onSave?: () => void;
}) {
  const [touched, setTouched] = useState(false);
  const invalid = value.trim() !== "" && parseAmountInput(value) === null;

  return (
    <div>
      <div className="flex items-center gap-2">
        <input
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => setTouched(true)}
          placeholder="เช่น 88,225.86"
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm tabular-nums focus:border-blue-400 focus:outline-none bg-white"
        />
        {onSave && (
          <button
            type="button"
            onClick={onSave}
            disabled={saving || invalid || value.trim() === ""}
            className="flex shrink-0 items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
          >
            {saving && <Loader2 size={12} className="animate-spin" />}
            บันทึก
          </button>
        )}
      </div>
      {touched && invalid && <p className="text-xs text-amber-700 mt-1">กรอกเป็นตัวเลข ทศนิยมไม่เกิน 2 ตำแหน่ง</p>}
      {suggestion !== null && (
        <button
          type="button"
          onClick={() => onChange(formatAmount(suggestion))}
          className="mt-1 text-left text-xs text-blue-700 hover:underline"
          title="ยอดยกมาที่บันทึกไว้ของงวดอื่น ± ยอดเคลื่อนไหว GL ระหว่างทาง"
        >
          ใช้ยอดที่ระบบคำนวณจากงวด {suggestionFrom}: {formatAmount(suggestion)}
        </button>
      )}
    </div>
  );
}
