'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { getToken, getUser, clearSession, defaultRouteForRole } from '@/lib/api';
import {
  IconDashboard, IconOrders, IconPlus, IconScan, IconFabric, IconUsers,
  IconReports, IconShield, IconSearch, IconLogout, IconChevronDown, IconEdit, IconMoney, IconScissors,
  IconTrendUp, IconBranch, IconProduct,
} from '@/components/Icons';
import ThemeToggle from '@/components/ThemeToggle';
import SyncStatusBadge from '@/components/SyncStatusBadge';
import { BRAND, T } from '@/lib/labels';

// roles: undefined = everyone; otherwise only those roles see the link.
// A superadmin sees everything an admin does, plus Branches — so 'superadmin'
// is listed anywhere 'admin' is.
const NAV = [
  { href: '/dashboard', label: 'Dashboard', Icon: IconDashboard, roles: ['superadmin', 'admin', 'salesman'] },
  { href: '/orders', label: T.orders, Icon: IconOrders, roles: ['superadmin', 'admin', 'salesman', 'cashier'] },
  { href: '/orders/new', label: T.newOrder, Icon: IconPlus, roles: ['admin', 'salesman'] },
  { href: '/scan', label: 'Scan Fabric', Icon: IconScan, roles: ['admin', 'salesman'] },
  { href: '/fabrics', label: T.fabrics, Icon: IconFabric, roles: ['superadmin', 'admin', 'salesman'] },
  { href: '/products', label: T.products, Icon: IconProduct, roles: ['superadmin', 'admin', 'salesman'] },
  { href: '/tailoring', label: T.tailoring, Icon: IconScissors, roles: ['superadmin', 'admin', 'master_tailor'] },
  { href: '/tailors', label: T.tailors, Icon: IconTrendUp, roles: ['superadmin', 'admin', 'master_tailor'] },
  { href: '/customers', label: T.customers, Icon: IconUsers, roles: ['superadmin', 'admin'] },
  { href: '/reports', label: T.reports, Icon: IconReports, roles: ['superadmin', 'admin'] },
  { href: '/finance', label: T.finance, Icon: IconMoney, roles: ['superadmin', 'admin'] },
  { href: '/users', label: T.staff, Icon: IconShield, roles: ['superadmin', 'admin'] },
  { href: '/branches', label: T.branches, Icon: IconBranch, roles: ['superadmin'] },
];

const TITLES = [
  ['/dashboard', 'Dashboard'], ['/orders/new', T.newOrder], ['/orders', T.orders],
  ['/scan', 'Scan Fabric'], ['/fabrics', T.fabrics], ['/products', T.products], ['/tailoring', T.tailoring],
  ['/tailors', T.tailors], ['/customers', T.customers], ['/reports', T.reports], ['/finance', T.finance],
  ['/users', T.staff], ['/branches', T.branches], ['/profile', 'My Profile'],
];

export default function AppLayout({ children }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState(false);   // desktop: icon-only rail
  const [mobileOpen, setMobileOpen] = useState(false); // phone: slide-in drawer
  const menuRef = useRef(null);

  useEffect(() => {
    if (!getToken()) { router.replace('/login'); return; }
    const u = getUser();
    if (u?.role === 'tailor') { router.replace(defaultRouteForRole(u.role)); return; } // tailors use the mobile workspace
    setUser(u);
  }, [router]);

  useEffect(() => {
    setCollapsed(localStorage.getItem('bt_sidebar') === 'collapsed');
  }, []);

  // Close the phone drawer whenever navigation happens
  useEffect(() => { setMobileOpen(false); }, [pathname]);

  useEffect(() => {
    function onClick(e) { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  if (!user) return null;

  const pageTitle = TITLES.find(([p]) => pathname.startsWith(p))?.[1] || 'Dashboard';

  function toggleSidebar() {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem('bt_sidebar', next ? 'collapsed' : 'open');
  }

  function logout() {
    clearSession();
    router.replace('/login');
  }

  function submitSearch(e) {
    e.preventDefault();
    if (search.trim()) router.push(`/orders?search=${encodeURIComponent(search.trim())}`);
  }

  return (
    <div className="min-h-screen">
      {/* Phone backdrop when the drawer is open */}
      {mobileOpen && (
        <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setMobileOpen(false)} />
      )}

      {/* ===== Sidebar: drawer on phones, collapsible rail on desktop ===== */}
      <aside className={`fixed inset-y-0 left-0 bg-white border-r border-slate-200/80 flex flex-col z-50 no-print
                         transition-all duration-300 w-64
                         ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}
                         lg:translate-x-0 ${collapsed ? 'lg:w-[70px]' : 'lg:w-60'}`}>
        <div className={`${collapsed ? 'lg:px-2 lg:text-center' : ''} px-5 pt-6 pb-5 border-b border-slate-100`}>
          <span className={`font-script font-semibold tracking-tight text-3xl leading-none text-brand-600 block ${collapsed ? 'lg:hidden' : ''}`}>{BRAND}</span>
          <span className={`font-script font-semibold tracking-tight text-3xl leading-none text-brand-600 hidden ${collapsed ? 'lg:block' : ''}`}>T</span>
          {/* Which branch am I in? Shown permanently, because every figure on
              every page means something different depending on the answer. */}
          <span className={`text-[9.5px] tracking-[0.2em] uppercase mt-1.5 block font-semibold ${collapsed ? 'lg:hidden' : ''} ${
            user.role === 'superadmin' ? 'text-amber-600' : 'text-brand-500'}`}>
            {user.role === 'superadmin' ? T.allBranches : (user.branch_name || 'Management System')}
          </span>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {NAV.filter((n) => !n.roles || n.roles.includes(user.role)).map(({ href, label, Icon }) => {
            const active = href === '/orders'
              ? pathname === '/orders' || /^\/orders\/\d+/.test(pathname)
              : pathname.startsWith(href);
            return (
              <Link key={href} href={href} title={collapsed ? label : undefined}
                    className={`nav-item ${active ? 'nav-item-active' : ''} ${collapsed ? 'lg:justify-center lg:!px-0' : ''}`}>
                <Icon size={19} />
                <span className={collapsed ? 'lg:hidden' : ''}>{label}</span>
                {active && <span className={`ml-auto w-1.5 h-1.5 rounded-full bg-brand-600 ${collapsed ? 'lg:hidden' : ''}`} />}
              </Link>
            );
          })}
        </nav>
        <div className="p-3 border-t border-slate-100">
          <button onClick={toggleSidebar} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                  className={`nav-item w-full hidden lg:flex ${collapsed ? 'lg:justify-center lg:!px-0' : ''}`}>
            <span className={`transition-transform duration-300 ${collapsed ? 'rotate-180' : ''}`}>
              <IconChevronDown size={18} className="rotate-90" />
            </span>
            <span className={collapsed ? 'lg:hidden' : ''}>{T.collapse}</span>
          </button>
        </div>
      </aside>

      {/* ===== Topbar ===== */}
      <header className={`fixed top-0 left-0 right-0 h-16 bg-white/90 backdrop-blur border-b border-slate-200/80
                          flex items-center gap-2 sm:gap-4 px-3 sm:px-6 z-30 no-print transition-all duration-300
                          ${collapsed ? 'lg:left-[70px]' : 'lg:left-60'}`}>
        {/* Hamburger — phones only */}
        <button onClick={() => setMobileOpen(true)}
                className="lg:hidden w-10 h-10 rounded-lg border border-slate-200 bg-white flex flex-col items-center justify-center gap-1 shrink-0">
          <span className="w-4.5 h-0.5 w-5 bg-slate-600 rounded" />
          <span className="w-5 h-0.5 bg-slate-600 rounded" />
          <span className="w-5 h-0.5 bg-slate-600 rounded" />
        </button>

        <div className="min-w-0">
          <h1 className="text-[16px] sm:text-[17px] font-extrabold text-slate-800 truncate">{pageTitle}</h1>
          <p className="text-[10.5px] text-slate-400 -mt-0.5 hidden sm:block">
            {user.role === 'superadmin' ? T.allBranches : (user.branch_name || BRAND)}
            &nbsp;›&nbsp;{pageTitle}
          </p>
        </div>

        <form onSubmit={submitSearch} className="ml-auto hidden md:block relative">
          <IconSearch size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
                 placeholder="Search orders…"
                 className="w-52 xl:w-64 rounded-full border border-slate-200 bg-slate-50 pl-9 pr-4 py-2 text-sm outline-none
                            focus:border-brand-500 focus:bg-white focus:ring-4 focus:ring-brand-500/10 transition" />
        </form>

        {['admin', 'salesman'].includes(user.role) && (
          <Link href="/orders/new" className="btn-primary !py-2 !rounded-full whitespace-nowrap ml-auto md:ml-0">
            <IconPlus size={16} /> <span className="hidden sm:inline">{T.newOrder}</span>
          </Link>
        )}

        <SyncStatusBadge />
        <ThemeToggle />

        {/* User menu */}
        <div className="relative shrink-0" ref={menuRef}>
          <button onClick={() => setMenuOpen(!menuOpen)}
                  className="flex items-center gap-2.5 pl-1.5 pr-2 py-1.5 rounded-full hover:bg-slate-100 transition">
            <span className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-white flex items-center justify-center text-sm font-bold">
              {user.name?.[0]?.toUpperCase()}
            </span>
            <span className="hidden lg:block text-left">
              <span className="block text-[13px] font-bold text-slate-700 leading-tight">{user.name}</span>
              <span className="block text-[10px] text-slate-400 uppercase font-semibold">{user.role}</span>
            </span>
            <IconChevronDown size={14} className="text-slate-400 hidden sm:block" />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-12 w-48 card p-1.5 shadow-xl">
              <div className="px-3 py-2 border-b border-slate-100 mb-1 lg:hidden">
                <p className="text-sm font-bold text-slate-700">{user.name}</p>
                <p className="text-[10px] text-slate-400 uppercase">{user.role}</p>
              </div>
              <Link href="/profile" onClick={() => setMenuOpen(false)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-semibold text-slate-600 hover:bg-slate-100 transition">
                <IconEdit size={16} /> My Profile
              </Link>
              <button onClick={logout}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-semibold text-rose-600 hover:bg-rose-50 transition">
                <IconLogout size={16} /> Sign out
              </button>
            </div>
          )}
        </div>
      </header>

      {/* ===== Main — full width on phones, beside the rail on desktop ===== */}
      <main className={`pt-16 transition-all duration-300 ${collapsed ? 'lg:ml-[70px]' : 'lg:ml-60'}`}>
        <div className="p-3 sm:p-5 lg:p-7">{children}</div>
      </main>
    </div>
  );
}
