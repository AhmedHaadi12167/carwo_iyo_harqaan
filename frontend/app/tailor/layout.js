'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { getToken, getUser } from '@/lib/api';
import { IconOrders, IconScissors, IconUsers } from '@/components/Icons';
import ThemeToggle from '@/components/ThemeToggle';
import { BRAND } from '@/lib/labels';

const TABS = [
  { href: '/tailor', label: 'My Jobs', Icon: IconScissors, exact: false, home: true },
  { href: '/tailor/profile', label: 'Profile', Icon: IconUsers },
];

export default function TailorLayout({ children }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState(null);

  useEffect(() => {
    if (!getToken()) { router.replace('/login'); return; }
    const u = getUser();
    if (u?.role !== 'tailor') { router.replace('/dashboard'); return; }
    setUser(u);
  }, [router]);

  if (!user) return null;

  return (
    <div className="min-h-screen pb-24">
      {/* Sticky mobile header */}
      <header className="sticky top-0 z-40 bg-white/95 dark:bg-transparent backdrop-blur border-b border-slate-200 px-4 py-3 flex items-center justify-between">
        <div>
          <span className="font-script font-semibold tracking-tight text-2xl text-brand-600 leading-none block">{BRAND}</span>
          <span className="text-[9px] tracking-[0.18em] uppercase text-slate-400 font-bold">Tailor Workspace</span>
        </div>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <Link href="/tailor/profile" title="My profile"
                className="w-9 h-9 rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-white flex items-center justify-center text-sm font-bold
                           ring-2 ring-transparent hover:ring-brand-300 active:scale-95 transition">
            {user.name?.[0]?.toUpperCase()}
          </Link>
        </div>
      </header>

      {/* Content — phone-first, comfortable on any screen */}
      <main className="max-w-lg mx-auto px-4 py-4">{children}</main>

      {/* Bottom navigation — thumb-friendly */}
      <nav className="fixed bottom-0 inset-x-0 z-40 bg-white dark:bg-transparent border-t border-slate-200
                      pb-[env(safe-area-inset-bottom)]">
        <div className="max-w-lg mx-auto grid grid-cols-2">
          {TABS.map(({ href, label, Icon, home }) => {
            const active = home ? !pathname.startsWith('/tailor/profile') : pathname.startsWith(href);
            return (
              <Link key={href} href={href}
                    className={`flex flex-col items-center gap-1 py-2.5 text-[11px] font-bold transition
                      ${active ? 'text-brand-600' : 'text-slate-400 hover:text-slate-600'}`}>
                <span className={`px-4 py-1 rounded-full transition ${active ? 'bg-brand-600/10' : ''}`}>
                  <Icon size={22} />
                </span>
                {label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
