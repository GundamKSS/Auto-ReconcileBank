'use client';

import { Menu, RefreshCw } from 'lucide-react';
import { useSidebar } from '@/components/SidebarContext';

export default function DashboardHeader({
  onRefresh,
  refreshing,
  updatedAt,
}: {
  onRefresh: () => void;
  refreshing: boolean;
  updatedAt: Date | null;
}) {
  const { toggleMobileOpen } = useSidebar();

  return (
    <header className="flex h-[86px] items-center justify-between gap-4 border-b border-slate-200/70 bg-white px-5 sm:px-8">
      <div className="flex min-w-0 items-center gap-4">
        <button
          onClick={toggleMobileOpen}
          className="text-slate-500 hover:text-slate-700 lg:hidden"
          aria-label="เปิด/ปิดเมนู"
        >
          <Menu size={22} />
        </button>

        <div className="flex items-center gap-3 text-[17px]">
          <span className="hidden text-slate-500 sm:inline">Home</span>
          <span className="hidden text-slate-300 sm:inline">/</span>
          <span className="font-semibold text-slate-900">Dashboard</span>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <span className="hidden text-sm text-slate-400 md:inline">
          {updatedAt ? `อัปเดตเมื่อ ${updatedAt.toLocaleTimeString('th-TH')}` : 'กำลังโหลด...'}
        </span>

        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
          <span className="hidden sm:inline">รีเฟรช</span>
        </button>
      </div>
    </header>
  );
}
