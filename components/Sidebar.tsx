'use client';

import {
  LayoutDashboard,
  Upload,
  GitCompareArrows,
  Database,
  WalletCards,
  BarChart3,
  Settings,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useSidebar } from './SidebarContext';
import { clearReconcileSession } from '../lib/reconcileSession';

const menuItems = [
  {
    name: 'Dashboard',
    href: '/dashboard',
    icon: LayoutDashboard,
  },
  {
    name: 'Import',
    href: '/import',
    icon: Upload,
  },
  {
    name: 'Reconcile',
    href: '/reconcile',
    icon: GitCompareArrows,
  },
  {
    name: 'Master Data',
    href: '/master-data/bank-statement',
    icon: Database,
  },
  {
    name: 'Suspense',
    href: '/suspense',
    icon: WalletCards,
  },
  {
    name: 'Reports',
    href: '/reports',
    icon: BarChart3,
  },
  // {
  //   name: 'Settings',
  //   href: '/settings',
  //   icon: Settings,
  // },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  const { collapsed, toggleCollapsed, mobileOpen, setMobileOpen } = useSidebar();
  const [authorized, setAuthorized] = useState<boolean | null>(null);

  const [user, setUser] = useState<{ name: string; email: string; initials: string } | null>(null);


  useEffect(() => {
    // อ่าน session จาก localStorage (external source) ตอน mount แล้ว sync เข้า state — ไม่มีทาง derive ระหว่าง render ได้
    /* eslint-disable react-hooks/set-state-in-effect */
    const u = localStorage.getItem('user');
    if (!u) {
      router.push('/login');
      return;
    }
    try {
      const parsed = JSON.parse(u);
      const emp = parsed.employee;
      const name = emp
        ? `${emp.First_Name ?? ''} ${emp.Last_Name ?? ''}`.trim() || parsed.username
        : parsed.username;
      const email = emp?.E_Mail ?? parsed.email ?? '';
      let initials = 'NA';
      if (emp?.First_Name || emp?.Last_Name) {
        initials = `${(emp.First_Name?.[0] ?? '')}${(emp.Last_Name?.[0] ?? '')}`.toUpperCase();
      } else if (parsed.username) {
        initials = parsed.username.slice(0, 2).toUpperCase();
      }
      setUser({ name, email, initials });
      setAuthorized(true);
    } catch (err) {
      console.error('Failed to parse user from localStorage', err);
      router.push('/login');
    }
    setAuthorized(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [router]);

  // ปิด mobile drawer อัตโนมัติทุกครั้งที่เปลี่ยนหน้า
  useEffect(() => {
    setMobileOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  if (authorized === null) return null;

  function handleLogout() {
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

            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-blue-600 shadow-lg shadow-blue-500/20">
              <WalletCards
                size={23}
                className="text-white"
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

            {menuItems.map((item) => {
              const Icon = item.icon;

              const isActive =
                pathname === item.href ||
                pathname.startsWith(`${item.href}/`);

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
                  {user?.email}
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
