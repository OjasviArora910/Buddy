'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createUserWithEmailAndPassword, GoogleAuthProvider, sendEmailVerification, sendPasswordResetEmail, signInWithEmailAndPassword, signInWithPopup } from 'firebase/auth';
import { firebaseAuth } from '../../lib/firebase';

function friendlyAuthError(error: unknown, signingUp: boolean): string {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : '';
  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
    return 'Those sign-in details did not match. Check your email and password, or reset your password.';
  }
  if (code === 'auth/email-already-in-use') return 'An account already uses this email. Try signing in instead.';
  if (code === 'auth/weak-password') return 'Choose a stronger password with at least six characters.';
  if (code === 'auth/too-many-requests') return 'Too many attempts. Wait a little while, then try again.';
  if (code === 'auth/network-request-failed') return 'Connection problem. Check your internet connection and try again.';
  if (code === 'auth/popup-closed-by-user') return 'Google sign-in was closed before it finished. Try again when you are ready.';
  if (code === 'auth/popup-blocked') return 'Your browser blocked the Google sign-in window. Allow the popup or use email and password.';
  return signingUp
    ? 'We could not create your account. Check your details and connection, then try again.'
    : 'We could not sign you in. Check your details and connection, then try again.';
}

export default function Login({ initialSignup = false }: { initialSignup?: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [signup, setSignup] = useState(initialSignup);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  async function emailAuth(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');

    try {
      const auth = firebaseAuth();
      const normalizedEmail = email.trim();
      const credential = signup
        ? await createUserWithEmailAndPassword(auth, normalizedEmail, password)
        : await signInWithEmailAndPassword(auth, normalizedEmail, password);
      if (signup) {
        await sendEmailVerification(credential.user, { url: `${window.location.origin}/chat?mode=account` });
        setPassword('');
        setNotice('Account created. Check your email to verify it, then sign in.');
      } else if (!credential.user.emailVerified) {
        await sendEmailVerification(credential.user);
        setNotice('Please verify your email. We sent another verification link.');
      } else {
        router.push('/chat?mode=account');
      }
    } catch (authError) {
      setError(friendlyAuthError(authError, signup));
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    setError('');
    setNotice('');
    setBusy(true);

    try {
      await signInWithPopup(firebaseAuth(), new GoogleAuthProvider());
      router.push('/chat?mode=account');
    } catch (authError) {
      const code = typeof authError === 'object' && authError !== null && 'code' in authError ? String((authError as { code?: unknown }).code) : '';
      setError(code === 'auth/operation-not-allowed'
        ? 'Google sign-in is not enabled for this project. Use email and password, or ask an administrator to enable it.'
        : friendlyAuthError(authError, false));
      setBusy(false);
    }
  }

  async function resetPassword() {
    setError(''); setNotice('');
    if (!email.trim()) { setError('Enter your email address first.'); return; }
    setBusy(true);
    try { await sendPasswordResetEmail(firebaseAuth(), email.trim()); setNotice('If that account exists, a password reset email is on its way.'); }
    catch (error) { setError(friendlyAuthError(error, false)); }
    finally { setBusy(false); }
  }

  function toggleMode() {
    setSignup(!signup);
    setError('');
    setNotice('');
  }

  return (
    <main className="centerPage">
      <div className="authCard">
        <Link className="back" href="/">← Back</Link>
        <div className="brand centerBrand">buddy<span className="branddot">.</span></div>
        <h1>{signup ? 'Create your space' : 'Welcome back'}</h1>
        <p>{signup ? 'Create a space for your conversations and saved details.' : 'Sign in to reopen your conversations and saved details.'}</p>
        <button className="google" type="button" onClick={google} disabled={busy}>
          Continue with Google
        </button>
        <div className="or">or use your email</div>
        <form onSubmit={emailAuth}>
          <label>
            Email
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => { setEmail(event.target.value); setError(''); }}
              placeholder="you@example.com"
            />
          </label>
          <label>
            Password
            <input
              type="password"
              autoComplete={signup ? 'new-password' : 'current-password'}
              required
              minLength={6}
              value={password}
              onChange={(event) => { setPassword(event.target.value); setError(''); }}
              placeholder="At least 6 characters"
            />
          </label>
          <button className="primary" disabled={busy}>
            {busy ? 'Please wait…' : signup ? 'Create account' : 'Sign in'}
          </button>
        </form>
        {busy && <p className="success" role="status" aria-live="polite">Please wait while we securely connect your account…</p>}
        {!signup && <button className="switch" type="button" onClick={() => void resetPassword()} disabled={busy}>Forgot password?</button>}
        {error && <p role="alert" className="error">{error}</p>}
        {notice && <p role="status" className="success">{notice}</p>}
        <p className="switch">
          {signup ? 'Already have an account?' : 'New to Buddy?'}{' '}
          <button type="button" onClick={toggleMode} disabled={busy}>
            {signup ? 'Sign in' : 'Create account'}
          </button>
        </p>
      </div>
    </main>
  );
}
