'use client';
import { useEffect, useState } from 'react';

export function applyStoredTheme() {
  if (typeof window === 'undefined') return;
  const dark = localStorage.getItem('bt_theme') === 'dark';
  document.documentElement.classList.toggle('dark', dark);
}

export default function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const isDark = localStorage.getItem('bt_theme') === 'dark';
    setDark(isDark);
    document.documentElement.classList.toggle('dark', isDark);
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    localStorage.setItem('bt_theme', next ? 'dark' : 'light');
    document.documentElement.classList.toggle('dark', next);
  }

  return (
    <button onClick={toggle} title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
            className="relative w-14 h-8 rounded-full transition-colors duration-300 shrink-0
                       bg-slate-200 dark:bg-slate-700 border border-slate-300 dark:border-slate-600">
      <span className={`absolute top-0.5 w-6 h-6 rounded-full bg-white shadow flex items-center justify-center text-[13px]
                        transition-all duration-300 ${dark ? 'left-7' : 'left-0.5'}`}>
        {dark ? '🌙' : '☀️'}
      </span>
    </button>
  );
}
