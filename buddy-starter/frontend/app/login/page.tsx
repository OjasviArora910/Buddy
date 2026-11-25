'use client';
import { useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createUserWithEmailAndPassword, GoogleAuthProvider, reload, sendEmailVerification, sendPasswordResetEmail, signInWithEmailAndPassword, signInWithPopup, User, verifyBeforeUpdateEmail } from 'firebase/auth';
import { firebaseAuth } from '../../lib/firebase';
import { logClientDiagnostic, newRequestId } from '../../lib/api';

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
  if (code === 'auth/invalid-email') return 'Enter a valid email address, such as name@example.com.';
  if (code === 'auth/requires-recent-login') return 'Sign in again, then update the email address and resend the verification link.';
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
  const [showPassword, setShowPassword] = useState(false);
  const [signup, setSignup] = useState(initialSignup);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [verificationUser, setVerificationUser] = useState<User | null>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  const passwordSelection = useRef<{ start: number | null; end: number | null; direction: 'forward' | 'backward' | 'none' | null } | null>(null);

  useLayoutEffect(() => {
    if (!passwordSelection.current) return;
    const input = passwordInput.current;
    const selection = passwordSelection.current;
    passwordSelection.current = null;
    if (!input) return;
    window.requestAnimationFrame(() => {
      if (!input.isConnected) return;
      input.focus({ preventScroll: true });
      if (selection.start !== null && selection.end !== null) {
        input.setSelectionRange(selection.start, selection.end, selection.direction || 'none');
      }
    });
  }, [showPassword]);

  function togglePasswordVisibility() {
    const input = passwordInput.current;
    passwordSelection.current = input
      ? { start: input.selectionStart, end: input.selectionEnd, direction: input.selectionDirection }
      : null;
    setShowPassword((visible) => !visible);
  }

  function validEmail(value: string) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
  }

  async function emailAuth(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    const startedAt = performance.now();
    const requestId = newRequestId();
    if (!validEmail(email)) { logClientDiagnostic(signup ? 'auth.signup' : 'auth.login', 'firebase/auth', 'invalid_input', startedAt, requestId); setError('Enter a valid email address, such as name@example.com.'); setBusy(false); return; }
    if (!password) { logClientDiagnostic(signup ? 'auth.signup' : 'auth.login', 'firebase/auth', 'invalid_input', startedAt, requestId); setError(signup ? 'Choose a password with at least six characters.' : 'Enter your password.'); setBusy(false); return; }

    try {
      const auth = firebaseAuth();
      const normalizedEmail = email.trim();
      const credential = signup
        ? await createUserWithEmailAndPassword(auth, normalizedEmail, password)
        : await signInWithEmailAndPassword(auth, normalizedEmail, password);
      if (signup) {
        setVerificationUser(credential.user);
        await sendEmailVerification(credential.user, { url: `${window.location.origin}/chat?mode=account` });
        setPassword('');
        setNotice('Account created. Check your inbox for a verification link. If the address has a typo, correct it below and resend.');
      } else if (!credential.user.emailVerified) {
        setVerificationUser(credential.user);
        await sendEmailVerification(credential.user);
        setNotice('This account still needs email verification. Check your inbox, correct the address below if needed, or resend the link.');
      } else {
        await credential.user.getIdToken(true);
        router.push('/chat?mode=account');
      }
      logClientDiagnostic(signup ? 'auth.signup' : 'auth.login', 'firebase/auth', 'success', startedAt, requestId);
    } catch (authError) {
      logClientDiagnostic(signup ? 'auth.signup' : 'auth.login', 'firebase/auth', 'failed', startedAt, requestId);
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
      const startedAt = performance.now();
      const requestId = newRequestId();
      const credential = await signInWithPopup(firebaseAuth(), new GoogleAuthProvider());
      await reload(credential.user);
      await credential.user.getIdToken(true);
      logClientDiagnostic('auth.google', 'firebase/auth', 'success', startedAt, requestId);
      if (credential.user.emailVerified) router.push('/chat?mode=account');
      else { setVerificationUser(credential.user); setNotice('This account still needs email verification. Check your inbox or resend the link.'); }
    } catch (authError) {
      logClientDiagnostic('auth.google', 'firebase/auth', 'failed', performance.now(), newRequestId());
      const code = typeof authError === 'object' && authError !== null && 'code' in authError ? String((authError as { code?: unknown }).code) : '';
      setError(code === 'auth/operation-not-allowed'
        ? 'Google sign-in is not enabled for this project. Use email and password, or ask an administrator to enable it.'
        : friendlyAuthError(authError, false));
      setBusy(false);
    }
  }

  async function resendVerification() {
    if (!verificationUser || !validEmail(email)) { setError('Enter a valid email address first.'); return; }
    const startedAt = performance.now();
    const requestId = newRequestId();
    setBusy(true); setError(''); setNotice('');
    try {
      if (email.trim().toLowerCase() !== verificationUser.email?.toLowerCase()) {
        // updateEmail() is rejected when email-enumeration protection is on; this sends
        // the link to the corrected address and switches the account once it is opened.
        await verifyBeforeUpdateEmail(verificationUser, email.trim(), { url: `${window.location.origin}/chat?mode=account` });
        logClientDiagnostic('auth.verification.change_email', 'firebase/auth', 'success', startedAt, requestId);
        setNotice('We sent a verification link to the corrected address. Open it to finish; if you are asked to sign in again afterwards, use the corrected address.');
        return;
      }
      await sendEmailVerification(verificationUser, { url: `${window.location.origin}/chat?mode=account` });
      logClientDiagnostic('auth.verification.resend', 'firebase/auth', 'success', startedAt, requestId);
      setNotice('A verification link is on its way. Check your inbox and spam folder.');
    } catch (authError) {
      logClientDiagnostic('auth.verification.resend', 'firebase/auth', 'failed', startedAt, requestId);
      setError(friendlyAuthError(authError, false));
    } finally { setBusy(false); }
  }

  async function checkVerification() {
    if (!verificationUser) return;
    const startedAt = performance.now(); const requestId = newRequestId();
    setBusy(true); setError('');
    try {
      await reload(verificationUser);
      await verificationUser.getIdToken(true);
      if (verificationUser.emailVerified) {
        logClientDiagnostic('auth.verification.check', 'firebase/auth', 'verified', startedAt, requestId);
        router.push('/chat?mode=account');
      } else {
        logClientDiagnostic('auth.verification.check', 'firebase/auth', 'pending', startedAt, requestId);
        setNotice('Verification is not showing yet. Open the email link, then check again.');
      }
    } catch {
      logClientDiagnostic('auth.verification.check', 'firebase/auth', 'failed', startedAt, requestId);
      setError('We could not refresh your account. Check your connection and try again.');
    } finally { setBusy(false); }
  }

  async function resetPassword() {
    setError(''); setNotice('');
    if (!validEmail(email)) { setError('Enter a valid email address first.'); return; }
    setBusy(true);
    const startedAt = performance.now(); const requestId = newRequestId();
    try { await sendPasswordResetEmail(firebaseAuth(), email.trim()); logClientDiagnostic('auth.password_reset', 'firebase/auth', 'success', startedAt, requestId); setNotice('If that account exists, a password reset email is on its way.'); }
    catch (error) { logClientDiagnostic('auth.password_reset', 'firebase/auth', 'failed', startedAt, requestId); setError(friendlyAuthError(error, false)); }
    finally { setBusy(false); }
  }

  function toggleMode() {
    setSignup(!signup);
    setShowPassword(false);
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
        <form onSubmit={emailAuth} noValidate>
          <label>
            Email
            <input
              type="email"
              pattern="[^\\s@]+@[^\\s@]+\\.[^\\s@]+"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => { setEmail(event.target.value); setError(''); }}
              placeholder="you@example.com"
            />
          </label>
          <div className="authPassword">
            <label htmlFor="password">Password</label>
            <div className="passwordField">
              <input
                id="password"
                ref={passwordInput}
                type={showPassword ? 'text' : 'password'}
                autoComplete={signup ? 'new-password' : 'current-password'}
                required
                minLength={6}
                value={password}
                onChange={(event) => { setPassword(event.target.value); setError(''); }}
                placeholder="At least 6 characters"
              />
              <button
                className="passwordToggle"
                type="button"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                onMouseDown={(event) => event.preventDefault()}
                onClick={togglePasswordVisibility}
              >
                {showPassword ? 'Hide password' : 'Show password'}
              </button>
            </div>
          </div>
          <button className="primary" disabled={busy}>
            {busy ? 'Please wait…' : signup ? 'Create account' : 'Sign in'}
          </button>
        </form>
        {busy && <p className="success" role="status" aria-live="polite">Please wait while we securely connect your account…</p>}
        {!signup && <button className="switch" type="button" onClick={() => void resetPassword()} disabled={busy}>Forgot password?</button>}
        {error && <p role="alert" className="error">{error}</p>}
        {notice && <p role="status" className="success">{notice}</p>}
        {verificationUser && <div className="memoryActions"><button type="button" onClick={() => void resendVerification()} disabled={busy}>Resend link / correct email</button><button type="button" onClick={() => void checkVerification()} disabled={busy}>I verified — check again</button></div>}
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
