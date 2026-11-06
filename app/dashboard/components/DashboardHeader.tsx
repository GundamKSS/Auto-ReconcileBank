'use client';

import { LayoutDashboard, Menu, RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { useSidebar } from '@/components/SidebarContext';

export default function DashboardHeader({
  onRefresh,
  refreshing,
  updatedAt,
  subtitle,
  action,
}: {
  onRefresh: () => void;
  refreshing: boolean;
  updatedAt: Date | null;
  subtitle: string;
  action: ReactNode;
}) {
  const { toggleMobileOpen, mobileOpen } = useSidebar();

  return (
    <header className="mb-6 flex min-w-0 flex-wrap items-start justify-between gap-4">
      <div className="flex min-w-0 items-start gap-3">
        <button
          type="button"
          onClick={toggleMobileOpen}
          className="flex size-11 shrink-0 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 lg:hidden"
          aria-label="เปิดเมนูหลัก"
          aria-expanded={mobileOpen}
        >
          <Menu size={22} />
        </button>

        <div className="hidden size-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-blue-600 shadow-lg shadow-blue-500/20 sm:flex">
          <LayoutDashboard size={22} className="text-white" />
        </div>
        <div className="min-w-0">
          <h1 className="break-words text-xl font-bold tracking-tight text-slate-900 sm:text-3xl">สรุปประจำเดือน</h1>
          <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
        </div>
      </div>

      <div className="flex w-full flex-col items-end gap-2 sm:w-auto">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            aria-label="โหลดข้อมูลใหม่"
            className="flex size-11 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 disabled:opacity-40"
          >
            <RefreshCw size={17} className={refreshing ? 'animate-spin' : ''} />
          </button>
          {action}
        </div>
        <span className="min-h-4 text-xs text-slate-400">{updatedAt ? `อัปเดตเมื่อ ${updatedAt.toLocaleTimeString('th-TH')}` : '\u00a0'}</span>
      </div>
    </header>
  );
}
