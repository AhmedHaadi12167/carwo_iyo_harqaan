'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getToken, getUser } from '@/lib/api';

export default function Home() {
  const router = useRouter();
  useEffect(() => {
    if (!getToken()) { router.replace('/login'); return; }
    router.replace(getUser()?.role === 'tailor' ? '/tailor' : '/dashboard');
  }, [router]);
  return null;
}
