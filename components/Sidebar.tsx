'use client';

import {
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useSidebar } from './SidebarContext';
import { clearReconcileSession } from '../lib/reconcileSession';
import { findMenuItem, menuItemsFor, normalizeRole, type Role } from '../lib/menu';
import type { UserSession } from '../lib/trwApi';

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  const { collapsed, toggleCollapsed, mobileOpen, setMobileOpen } = useSidebar();
  const [authorized, setAuthorized] = useState<boolean | null>(null);

  const [user, setUser] = useState<{ name: string; subtitle: string; initials: string } | null>(null);
  const [role, setRole] = useState<Role | null>(null);


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

  function goTo(href: string) {
    router.push(href);
    setMobileOpen(false);
  }

  return (
    <>
      {/* Mobile backdrop — กดเพื่อปิด drawer */}
      {mobileOpen && (
        <div
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden"
          aria-hidden="true"
        />
      )}

      <aside
        className={`
          fixed left-0 top-0 z-50 flex h-screen flex-col
          border-r border-slate-200/70 bg-white
          transition-all duration-300
          w-[280px] ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}
          lg:translate-x-0 ${collapsed ? 'lg:w-[82px]' : 'lg:w-[300px]'}
        `}
      >

        {/* Logo */}
        <div
          className={`
            flex h-[86px] items-center border-b border-slate-100 px-6
            ${collapsed ? 'lg:justify-center lg:px-0' : ''}
          `}
        >
          <div className="flex items-center gap-3">

            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl  shadow-lg shadow-blue-500/20">
              <img
    src="/vercel.png"
    alt="Auto Reconcile Bank"
    className="h-full w-full object-contain"
  />
            </div>

            <div className={collapsed ? 'lg:hidden' : ''}>
              <h1 className="text-[17px] font-bold leading-none text-slate-900">
                Auto Reconcile Bank
              </h1>

            </div>

          </div>
        </div>

        {/* Menu */}
        <nav className="flex-1 px-4 py-8 overflow-y-auto">

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

              // เทียบกับเมนูที่ "เจาะจงที่สุด" ของ path ปัจจุบัน ไม่ใช่ startsWith เฉยๆ
              // ไม่งั้นอยู่หน้า /reconcile/history แล้วเมนู Reconcile จะสว่างขึ้นมาด้วยพร้อมกัน
              const isActive = findMenuItem(pathname)?.href === item.href;

              return (
                <button
                  key={item.href}
                  onClick={() => goTo(item.href)}
                  title={collapsed ? item.name : undefined}
                  className={`
                    group flex w-full items-center gap-4 rounded-xl
                    px-4 py-3.5 text-left
                    transition-all duration-200

                    ${
                      isActive
                        ? 'bg-blue-100/80 text-blue-700 shadow-sm'
                        : 'text-slate-700 hover:bg-slate-100'
                    }

                    ${collapsed ? 'lg:justify-center lg:px-0' : ''}
                  `}
                >

                  <Icon
                    size={21}
                    strokeWidth={isActive ? 2.5 : 2}
                    className={`
                      shrink-0 transition-transform
                      group-hover:scale-110
                      ${
                        isActive
                          ? 'text-blue-600'
                          : 'text-slate-700'
                      }
                    `}
                  />

                  <span className={`text-[16px] font-medium ${collapsed ? 'lg:hidden' : ''}`}>
                    {item.name}
                  </span>

                </button>
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

            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-200 text-sm font-semibold text-slate-600">
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
                className="text-slate-500 transition hover:text-red-500 shrink-0"
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
          className="absolute -right-3 top-8 hidden h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:text-blue-600 lg:flex"
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
          className="absolute -right-3 top-8 flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:text-blue-600 lg:hidden"
          aria-label="Close sidebar"
        >
          <PanelLeftClose size={16} />
        </button>

      </aside>
    </>
  );
}
