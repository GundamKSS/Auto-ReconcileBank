'use client';

import {
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useSidebar } from './SidebarContext';
import { clearReconcileSession } from '../lib/reconcileSession';
import { findMenuItem, menuItemsFor, normalizeRole, type Role } from '../lib/menu';
import type { UserSession } from '../lib/trwApi';

const SPRING = { type: 'spring', stiffness: 520, damping: 38, mass: 0.9 } as const;

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  const { collapsed, toggleCollapsed, mobileOpen, setMobileOpen } = useSidebar();
  const [authorized, setAuthorized] = useState<boolean | null>(null);

  const [user, setUser] = useState<{ name: string; subtitle: string; initials: string } | null>(null);
  const [role, setRole] = useState<Role | null>(null);

  // เมนูที่เพิ่งกด แต่หน้ายังโหลดไม่เสร็จ — ให้แถบไฮไลต์ย้ายไปทันทีที่กด ไม่ต้องรอ server
  // จำ path ตอนกดไว้ด้วย: พอ path เปลี่ยน (ไปถึงแล้ว หรือถูกพาไปที่อื่น) ค่านี้ก็หมดความหมาย
  const [pending, setPending] = useState<{ from: string; href: string } | null>(null);
  const [lastPathname, setLastPathname] = useState(pathname);
  if (lastPathname !== pathname) {
    setLastPathname(pathname);
    setPending(null);
  }

  useEffect(() => {
    // อ่าน session จาก localStorage (external source) ตอน mount แล้ว sync เข้า state — ไม่มีทาง derive ระหว่าง render ได้
    /* eslint-disable react-hooks/set-state-in-effect */
    const u = localStorage.getItem('user');
    if (!u) {
      router.push('/login');
      return;
    }
    try {
      const parsed = JSON.parse(u) as UserSession;
      // session รูปแบบเก่า (ก่อนย้ายมา /auth/auth_permission_prog) ไม่มีคีย์ roleProg เลย
      // ถ้าปล่อยไว้จะกลายเป็นสิทธิ์ User ทั้งที่จริงเป็น Admin — บังคับ login ใหม่ให้จบ
      if (parsed.roleProg === undefined) {
        localStorage.removeItem('user');
        localStorage.removeItem('lastActivity');
        router.push('/login');
        return;
      }
      const name = parsed.displayName || parsed.username;
      // บรรทัดรองใช้ตำแหน่งงาน (role) เช่น "Accounting" ไม่ใช่สิทธิ์ในโปรแกรม (roleProg)
      const subtitle = parsed.role ?? '';
      // ย่อจากคำแรกของแต่ละคำในชื่อ ถ้าไม่มีชื่อค่อยถอยไปใช้ username
      const words = name.split(/\s+/).filter(Boolean).slice(0, 2);
      const initials = words.length
        ? words.map((w) => w[0]).join('').toUpperCase()
        : (parsed.username?.slice(0, 2).toUpperCase() ?? 'NA');
      setUser({ name, subtitle, initials });
      setRole(normalizeRole(parsed.roleProg));
      setAuthorized(true);
    } catch (err) {
      console.error('Failed to parse user from localStorage', err);
      router.push('/login');
    }
    // setAuthorized(true) อยู่ในเส้นทางสำเร็จ (ในบล็อก try) แล้ว — ไม่เรียกซ้ำตรงนี้
    // เพราะจะทำให้เคส parse ไม่ผ่าน/ไม่มี session กลายเป็น authorized ค้างไว้ด้วย
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [router]);

  // ปิด mobile drawer อัตโนมัติทุกครั้งที่เปลี่ยนหน้า
  useEffect(() => {
    setMobileOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  if (authorized === null || role === null) return null;

  const visibleItems = menuItemsFor(role);
  // เทียบกับเมนูที่ "เจาะจงที่สุด" ของ path ปัจจุบัน ไม่ใช่ startsWith เฉยๆ
  // ไม่งั้นอยู่หน้า /reconcile/history แล้วเมนู Reconcile จะสว่างขึ้นมาด้วยพร้อมกัน
  const currentHref = findMenuItem(pathname)?.href;
  const activeHref = pending?.href ?? currentHref;
  const navigating = pending !== null && pending.href !== currentHref;

  async function handleLogout() {
    // ล้าง session cookie ฝั่ง server ด้วย — ถ้าล้างแค่ localStorage ตัว cookie จะยังใช้เรียก API ได้
    // จนกว่าจะหมดอายุเอง ซึ่งเท่ากับยังไม่ได้ออกจากระบบจริง
    try {
      await fetch('/api/logout', { method: 'POST' });
    } catch {
      // ต่อ server ไม่ได้ก็ยังต้องพาผู้ใช้ออกจากหน้าจอให้ได้ตามปกติ
    }
    localStorage.removeItem('user');
    localStorage.removeItem('lastActivity');
    clearReconcileSession();

    router.push('/login');
  }

  function handleNavigate(e: React.MouseEvent, href: string) {
    // เปิดแท็บใหม่ (Cmd/Ctrl/Shift/คลิกกลาง) — หน้านี้ไม่ได้เปลี่ยน ไม่ต้องย้ายไฮไลต์
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    setPending({ from: pathname, href });
    setMobileOpen(false);
  }

  return (
    <>
      {/* แถบความคืบหน้าบนสุด — โผล่เฉพาะตอนหน้าใหม่ใช้เวลาโหลด (หน่วงไว้นิดนึง หน้าที่มาเร็วจะไม่กระพริบ) */}
      <AnimatePresence>
        {navigating && (
          <motion.div
            key="nav-progress"
            initial={{ scaleX: 0, opacity: 0 }}
            animate={{
              scaleX: 0.85,
              opacity: 1,
              transition: {
                scaleX: { duration: 2.4, ease: [0.1, 0.6, 0.2, 1] },
                opacity: { duration: 0.15, delay: 0.12 },
              },
            }}
            exit={{ scaleX: 1, opacity: 0, transition: { duration: 0.35, ease: 'easeOut' } }}
            style={{ transformOrigin: '0 50%' }}
            className="pointer-events-none fixed inset-x-0 top-0 z-[70] h-[3px] bg-gradient-to-r from-sky-400 via-blue-500 to-blue-600 shadow-[0_0_10px_rgba(37,99,235,0.6)]"
          />
        )}
      </AnimatePresence>

      {/* Mobile backdrop — กดเพื่อปิด drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            key="sidebar-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setMobileOpen(false)}
            className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-[2px] lg:hidden"
            aria-hidden="true"
          />
        )}
      </AnimatePresence>

      <aside
        className={`
          sidebar-enter
          fixed left-0 top-0 z-50 flex h-screen flex-col
          border-r border-slate-200/70 bg-white
          transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]
          w-[280px] ${mobileOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'}
          lg:translate-x-0 lg:shadow-none ${collapsed ? 'lg:w-[82px]' : 'lg:w-[300px]'}
        `}
      >

        {/* Logo */}
        <div
          className={`
            flex h-[86px] items-center border-b border-slate-100 px-6
            ${collapsed ? 'lg:justify-center lg:px-0' : ''}
          `}
        >
          <Link
            href="/dashboard"
            onClick={(e) => handleNavigate(e, '/dashboard')}
            className="group flex items-center gap-3"
            aria-label="Auto Reconcile Bank — กลับหน้า Dashboard"
          >
            <motion.img
              src="/logo.svg"
              alt=""
              width={44}
              height={44}
              whileHover={{ rotate: -20, scale: 1.06 }}
              transition={{ type: 'spring', stiffness: 400, damping: 14 }}
              className="h-11 w-11 shrink-0 rounded-[13px] shadow-lg shadow-blue-500/25"
            />

            <div className={`min-w-0 ${collapsed ? 'lg:hidden' : ''}`}>
              <h1 className="whitespace-nowrap text-[17px] font-bold leading-tight text-slate-900">
                Auto Reconcile Bank
              </h1>
              <p className="mt-0.5 whitespace-nowrap text-xs font-medium text-slate-500">
                ระบบกระทบยอดธนาคาร
              </p>
            </div>
          </Link>
        </div>

        {/* Menu */}
        <nav className="flex-1 px-4 py-8 overflow-y-auto overflow-x-hidden">

          <p
            className={`mb-4 px-4 text-xs font-bold uppercase tracking-[0.18em] text-slate-500 ${
              collapsed ? 'lg:hidden' : ''
            }`}
          >
            Workspace
          </p>

          <div className="space-y-2">

            {visibleItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeHref === item.href;

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={(e) => handleNavigate(e, item.href)}
                  title={collapsed ? item.name : undefined}
                  aria-current={isActive ? 'page' : undefined}
                  className={`
                    group relative flex w-full items-center gap-4 rounded-xl
                    px-4 py-3.5 text-left
                    transition-colors duration-200

                    ${
                      isActive
                        ? 'text-blue-700'
                        : 'text-slate-700 hover:bg-slate-100'
                    }

                    ${collapsed ? 'lg:justify-center lg:px-0' : ''}
                  `}
                >
                  {/* ไฮไลต์เมนูที่เลือก — ตัวเดียวกันเลื่อนไปมาระหว่างเมนู (layoutId) แทนการกระพริบเปลี่ยนสี */}
                  {isActive && (
                    <motion.span
                      layoutId="sidebar-active-pill"
                      transition={SPRING}
                      className="absolute inset-0 rounded-xl bg-blue-100/80 shadow-sm"
                    />
                  )}

                  <motion.span
                    // เปลี่ยน key ตอนสถานะ active เปลี่ยน → ไอคอนที่เพิ่งถูกเลือกเด้งหนึ่งที
                    key={isActive ? 'active' : 'idle'}
                    initial={isActive ? { scale: 0.6, rotate: -12 } : false}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 15 }}
                    className="relative shrink-0"
                  >
                    <Icon
                      size={21}
                      strokeWidth={isActive ? 2.5 : 2}
                      className={`
                        transition-transform duration-200
                        group-hover:scale-110
                        ${isActive ? 'text-blue-600' : 'text-slate-700'}
                      `}
                    />
                  </motion.span>

                  <span className={`relative whitespace-nowrap text-[16px] font-medium ${collapsed ? 'lg:hidden' : ''}`}>
                    {item.name}
                  </span>

                </Link>
              );
            })}

          </div>

        </nav>

        {/* User */}
        <div className="border-t border-slate-100 p-4">

          <div
            className={`
              flex items-center gap-3
              ${collapsed ? 'lg:justify-center' : ''}
            `}
          >

            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sky-100 to-blue-200 text-sm font-semibold text-blue-700">
              {user?.initials}
            </div>

            <div className={`flex min-w-0 flex-1 items-center gap-3 ${collapsed ? 'lg:hidden' : ''}`}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-slate-800">
                  {user?.name}
                </p>

                <p className="truncate text-xs text-slate-500">
                  {user?.subtitle}
                </p>
              </div>

              <button
                onClick={handleLogout}
                className="shrink-0 rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-red-50 hover:text-red-500"
                title="Logout"
              >
                <LogOut size={20} />
              </button>
            </div>

          </div>

        </div>

        {/* Collapse button — desktop เท่านั้น (พับ/ขยาย sidebar) */}
        <button
          onClick={toggleCollapsed}
          className="absolute -right-3 top-8 hidden h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition-colors hover:border-blue-200 hover:text-blue-600 lg:flex"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? (
            <PanelLeftOpen size={16} />
          ) : (
            <PanelLeftClose size={16} />
          )}
        </button>

        {/* Close button — mobile เท่านั้น (ปิด drawer) */}
        <button
          onClick={() => setMobileOpen(false)}
          className="absolute -right-3 top-8 flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition-colors hover:text-blue-600 lg:hidden"
          aria-label="Close sidebar"
        >
          <PanelLeftClose size={16} />
        </button>

      </aside>
    </>
  );
}
