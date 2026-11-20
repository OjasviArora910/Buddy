'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from './AuthProvider';

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  useEffect(() => { if (!loading && (!user || !user.emailVerified)) router.replace('/login'); }, [loading, user, router]);
  if (loading || !user || !user.emailVerified) return <main className="centerPage"><p>Checking your sign-in…</p></main>;
  return children;
}
