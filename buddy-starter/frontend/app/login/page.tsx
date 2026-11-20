'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createUserWithEmailAndPassword, GoogleAuthProvider, sendEmailVerification, sendPasswordResetEmail, signInWithEmailAndPassword, signInWithPopup } from 'firebase/auth';
import { firebaseAuth } from '../../lib/firebase';

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
      setError(authError instanceof Error ? authError.message : 'Authentication failed. Please try again.');
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
      const message = authError instanceof Error ? authError.message : 'Google sign-in failed.';
      setError(
        message.toLowerCase().includes('provider') && message.toLowerCase().includes('not enabled')
          ? 'Google sign-in is not enabled for this Firebase project. Use email and password, or enable Google in Firebase Authentication.'
          : message,
      );
      setBusy(false);
    }
  }

  async function resetPassword() {
    setError(''); setNotice('');
    if (!email.trim()) { setError('Enter your email address first.'); return; }
    try { await sendPasswordResetEmail(firebaseAuth(), email.trim()); setNotice('If that account exists, a password reset email is on its way.'); }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not send the reset email.'); }
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
        <p>{signup ? 'Create an account to save your conversations.' : 'Pick up right where you left off.'}</p>
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
              onChange={(event) => setEmail(event.target.value)}
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
              onChange={(event) => setPassword(event.target.value)}
              placeholder="At least 6 characters"
            />
          </label>
          <button className="primary" disabled={busy}>
            {busy ? 'Please wait…' : signup ? 'Create account' : 'Sign in'}
          </button>
        </form>
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
