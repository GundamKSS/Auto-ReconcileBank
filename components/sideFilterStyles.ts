/** สีปุ่มกรองทิศทางเงิน ใช้ร่วมกันใน Dashboard, History, รายงาน และรายการพัก */
export const SIDE_FILTER_ACTIVE_CLASS = {
  AR: 'border-emerald-700 bg-emerald-700 text-white shadow-md shadow-emerald-200',
  AP: 'border-red-600 bg-red-600 text-white shadow-md shadow-red-200',
  ALL: 'border-blue-500 bg-blue-500 text-white shadow-md shadow-blue-200',
} as const;

export const SIDE_FILTER_INACTIVE_CLASS = 'border-slate-200 bg-slate-100 text-slate-600 hover:bg-slate-200';
