'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

type SidebarContextValue = {
  /** Desktop (lg+): sidebar collapsed to icon-only rail vs full width. Persisted. */
  collapsed: boolean;
  toggleCollapsed: () => void;
  /** Mobile/tablet (<lg): off-canvas drawer open state. Not persisted. */
  mobileOpen: boolean;
  setMobileOpen: (open: boolean) => void;
  toggleMobileOpen: () => void;
};

const SidebarContext = createContext<SidebarContextValue | undefined>(undefined);

const STORAGE_KEY = 'sidebar-collapsed';

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // อ่านค่าที่จำไว้หลัง mount เท่านั้น (กัน hydration mismatch เพราะ localStorage ใช้ได้แค่ฝั่ง client)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- ตั้งใจอ่าน localStorage หลัง mount เท่านั้น
    setCollapsed(localStorage.getItem(STORAGE_KEY) === '1');
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
      return next;
    });
  }

  function toggleMobileOpen() {
    setMobileOpen((prev) => !prev);
  }

  return (
    <SidebarContext.Provider
      value={{ collapsed, toggleCollapsed, mobileOpen, setMobileOpen, toggleMobileOpen }}
    >
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  const ctx = useContext(SidebarContext);
  if (!ctx) {
    throw new Error('useSidebar must be used within a SidebarProvider');
  }
  return ctx;
}
