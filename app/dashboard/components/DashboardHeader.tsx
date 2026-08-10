'use client';

import {
  Search,
  Bell,
  Plus,
  Menu,
} from 'lucide-react';
import { useSidebar } from '@/components/SidebarContext';

export default function DashboardHeader() {
  const { toggleMobileOpen } = useSidebar();

  return (
    <header className="flex h-[86px] items-center justify-between border-b border-slate-200/70 bg-white px-8">

      {/* Breadcrumb */}
      <div className="flex items-center gap-4">

        <button
          onClick={toggleMobileOpen}
          className="text-slate-500 hover:text-slate-700 lg:hidden"
          aria-label="Toggle sidebar"
        >
          <Menu size={22} />
        </button>

        <div className="flex items-center gap-3 text-[17px]">
          <span className="text-slate-500">
            Home
          </span>

          <span className="text-slate-300">
            /
          </span>

          <span className="font-semibold text-slate-900">
            Dashboard
          </span>
        </div>

      </div>

      {/* Right */}
      <div className="flex items-center gap-5">

        {/* Search */}
        <div className="hidden items-center gap-3 rounded-full border border-slate-100 bg-slate-50 px-4 py-2.5 md:flex md:w-[320px]">

          <Search
            size={19}
            className="text-slate-400"
          />

          <input
            type="text"
            placeholder="Search transactions, references..."
            className="w-full bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"
          />

        </div>

        {/* Notification */}
        <button className="relative text-slate-600 transition hover:text-blue-600">

          <Bell size={22} />

          <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-red-500" />

        </button>

        {/* New Reconciliation */}
        <button className="flex items-center gap-2 rounded-full bg-gradient-to-r from-sky-500 to-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-500/20 transition hover:-translate-y-0.5 hover:shadow-xl">

          <Plus size={19} />

          <span className="hidden sm:inline">
            New reconciliation
          </span>

        </button>

      </div>

    </header>
  );
}