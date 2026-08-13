"use client";

const BANKS = [
  { code: "BBL", label: "BBL", enabled: true },
  { code: "KBANK", label: "KBank", enabled: true },
  { code: "SCB", label: "SCB", enabled: true },
  { code: "KTB", label: "KTB", enabled: false },
  { code: "TTB", label: "TTB", enabled: false },
  { code: "BAY", label: "BAY", enabled: false },
];

export default function BankTabs({ selected, onSelect }: { selected: string; onSelect: (code: string) => void }) {
  return (
    <div>
      <p className="text-xs font-bold text-slate-400 mb-3 uppercase tracking-wider">Bank</p>
      <div className="flex flex-wrap gap-2">
        {BANKS.map((bank) => (
          <button
            key={bank.code}
            onClick={() => bank.enabled && onSelect(bank.code)}
            disabled={!bank.enabled}
            title={!bank.enabled ? "ยังไม่รองรับ เร็วๆ นี้" : undefined}
            className={`px-5 py-2 rounded-full text-sm font-medium transition-colors ${
              !bank.enabled
                ? "bg-slate-50 text-slate-300 cursor-not-allowed"
                : selected === bank.code
                ? "bg-blue-500 text-white shadow-md shadow-blue-200"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {bank.label}
          </button>
        ))}
      </div>
    </div>
  );
}