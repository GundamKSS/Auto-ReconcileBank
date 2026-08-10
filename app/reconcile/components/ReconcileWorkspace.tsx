"use client";

import { useState } from "react";
import { Search, Bell, Plus, PanelLeft } from "lucide-react";
import { useSidebar } from "@/components/SidebarContext";
import { ReconcileSession } from "./types";
import EmptyState from "./EmptyState";
import NewReconciliationModal from "./NewReconciliationModal";
import ActiveWorkspace from "./ActiveWorkspace";

export default function ReconcileWorkspace() {
  const { toggleMobileOpen } = useSidebar();
  const [session, setSession] = useState<ReconcileSession | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  function handleConfirm(newSession: ReconcileSession) {
    setSession(newSession);
    setModalOpen(false);
  }

  return (
    <div className="flex-1 min-w-0 flex flex-col bg-gray-50 lg:h-full lg:overflow-hidden">
      {/* App chrome bar — คงที่ทุกสเต็ป (Empty / Modal / Active) */}
      <div className="flex items-center gap-3 px-4 sm:px-6 py-3 bg-white border-b border-gray-100 flex-wrap shrink-0">
        <button
          onClick={toggleMobileOpen}
          className="p-1.5 text-gray-400 hover:text-gray-600 shrink-0 lg:hidden"
          aria-label="Toggle sidebar"
        >
          <PanelLeft size={18} />
        </button>
        <div className="flex items-center gap-1.5 text-sm text-gray-500 shrink-0">
          <span>Home</span>
          <span>/</span>
          <span className="text-gray-900 font-medium">Reconcile</span>
        </div>
        <div className="flex-1 min-w-[160px] order-3 sm:order-none">
          <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 max-w-md">
            <Search size={16} className="text-gray-400 shrink-0" />
            <input
              placeholder="Search transactions, references..."
              className="bg-transparent text-sm outline-none w-full placeholder:text-gray-400"
            />
          </div>
        </div>
        <button className="relative p-2 text-gray-400 hover:text-gray-600 shrink-0" aria-label="Notifications">
          <Bell size={18} />
          <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-red-500 rounded-full" />
        </button>
        <button
          onClick={() => setModalOpen(true)}
          className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg shrink-0 whitespace-nowrap"
        >
          <Plus size={16} /> New reconciliation
        </button>
      </div>

      {/* Step 1: Empty state */}
      {!session && <EmptyState onStart={() => setModalOpen(true)} />}

      {/* Step 3: Active workspace */}
      {session && <ActiveWorkspace session={session} onEditFilters={() => setModalOpen(true)} />}

      {/* Step 2: Setup modal — ลอยทับได้ทุกสเต็ป (เปิดจากปุ่มบน chrome bar, empty state, หรือปุ่ม Edit ใน filter bar) */}
      {modalOpen && (
        <NewReconciliationModal
          initialSession={session}
          onCancel={() => setModalOpen(false)}
          onConfirm={handleConfirm}
        />
      )}
    </div>
  );
}