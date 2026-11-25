'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { sendEmailVerification } from 'firebase/auth';
import { logout } from '../../lib/auth';
import { useAuth } from './AuthProvider';

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, refreshVerification } = useAuth();
  const router = useRouter();
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!loading && !user) router.replace('/login'); }, [loading, user, router]);
  if (loading || !user) return <main className="centerPage"><p>Checking your sign-in…</p></main>;
  if (!user.emailVerified) return <main className="centerPage"><section className="authCard"><h1>Check your inbox</h1><p>Verify {user.email || 'your email address'} to open your account chats and memories. If the address has a typo, sign out and use the correct address.</p><button className="primary" type="button" disabled={busy} onClick={() => { setBusy(true); void sendEmailVerification(user).then(() => setNotice('A new verification link is on its way.')).catch(() => setNotice('We could not send the link. Check your connection and try again.')).finally(() => setBusy(false)); }}>Resend verification link</button><button className="google" type="button" disabled={busy} onClick={() => { setBusy(true); void refreshVerification().then((verified) => setNotice(verified ? 'Your email is verified.' : 'Still waiting for verification. Open the email link, then check again.')).catch(() => setNotice('We could not refresh your account yet. Try again.')).finally(() => setBusy(false)); }}>I verified my email — check again</button>{notice && <p className="success" role="status">{notice}</p>}<button className="switch" type="button" onClick={() => { void logout().then(() => router.push('/login')); }}>Sign out or use another email</button></section></main>;
  return children;
}
