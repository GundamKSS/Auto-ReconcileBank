"use client";

import { useEffect, useState } from "react";
import { Plus, PanelLeft } from "lucide-react";
import { useSidebar } from "@/components/SidebarContext";
import { loadReconcileSession, saveReconcileSession } from "../../../lib/reconcileSession";
import { currentWorkspaceUser } from "../../../lib/tabWorkspace";
import { ReconcileSession } from "./types";
import EmptyState from "./EmptyState";
import NewReconciliationModal from "./NewReconciliationModal";
import ActiveWorkspace from "./ActiveWorkspace";

export default function ReconcileWorkspace() {
  const { toggleMobileOpen } = useSidebar();
  const [workspaceUser] = useState(currentWorkspaceUser);
  const [session, setSession] = useState<ReconcileSession | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  // ตอนเปิด modal จากปุ่ม "New reconciliation" ให้เริ่มฟอร์มเปล่าๆ (ไม่ prefill ของเดิม)
  // ตอนเปิดจากปุ่ม "Edit" ในตัวงานที่ทำอยู่ ให้ prefill ค่าปัจจุบันไว้แก้ไขต่อ
  const [modalSeed, setModalSeed] = useState<ReconcileSession | null>(null);

  useEffect(() => {
    // กู้คืนงานของบัญชีผู้ใช้นี้จาก sessionStorage รวมถึงหลัง login ใหม่ในแท็บเดิม
    const saved = loadReconcileSession();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved) setSession(saved);
  }, []);

  function handleConfirm(newSession: ReconcileSession) {
    setSession(newSession);
    saveReconcileSession(newSession, workspaceUser);
    setModalOpen(false);
  }

  function openNewReconciliation() {
    setModalSeed(null);
    setModalOpen(true);
  }

  function openEditFilters() {
    setModalSeed(session);
    setModalOpen(true);
  }

  return (
    <div className="flex-1 min-w-0 flex flex-col bg-gray-50 lg:h-full lg:overflow-hidden">
      {/* ขั้นตั้งค่ายังมีปุ่มสร้างงานใหม่ แต่เมื่อเข้าสู่ workspace แล้วให้ตารางใช้พื้นที่เต็มทันที */}
      {!session && (
        <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3 bg-white border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              onClick={toggleMobileOpen}
              className="p-1.5 text-gray-400 hover:text-gray-600 shrink-0 lg:hidden"
              aria-label="เปิดหรือปิดเมนู"
            >
              <PanelLeft size={18} />
            </button>

            <div className="flex items-center gap-2 min-w-0">
              <span className="h-2 w-2 rounded-full bg-slate-300 shrink-0" />
              <h1 className="text-sm font-semibold text-slate-800 truncate">กระทบยอดธนาคาร</h1>
              <span className="text-xs text-slate-400 hidden sm:inline shrink-0">• ยังไม่ได้เลือกงวดงาน</span>
            </div>
          </div>

          <button
            onClick={openNewReconciliation}
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs sm:text-sm font-medium px-3.5 py-1.5 sm:px-4 sm:py-2 rounded-xl shrink-0 whitespace-nowrap shadow-xs transition-colors"
          >
            <Plus size={16} /> เริ่มกระทบยอดใหม่
          </button>
        </div>
      )}

      {/* Step 1: Empty state */}
      {!session && <EmptyState onStart={openNewReconciliation} />}

      {/* Step 3: Active workspace */}
      {session && (
        <ActiveWorkspace session={session} onEditFilters={openEditFilters} />
      )}

      {/* Step 2: Setup modal — ลอยทับได้ทุกสเต็ป (เปิดจากปุ่มบน chrome bar, empty state, หรือปุ่ม Edit ใน filter bar) */}
      {modalOpen && (
        <NewReconciliationModal
          initialSession={modalSeed}
          onCancel={() => setModalOpen(false)}
          onConfirm={handleConfirm}
        />
      )}
    </div>
  );
}
