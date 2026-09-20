'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Jobs now live at /tailor (home). This old path just redirects.
export default function JobsRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/tailor'); }, [router]);
  return null;
}
