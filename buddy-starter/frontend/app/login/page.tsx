'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabase';

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [signup, setSignup] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  async function emailAuth(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');

    try {
      const client = supabase();
      const normalizedEmail = email.trim();
      const result = signup
        ? await client.auth.signUp({
            email: normalizedEmail,
            password,
            options: {
              emailRedirectTo: `${window.location.origin}/chat?mode=account`,
            },
          })
        : await client.auth.signInWithPassword({
            email: normalizedEmail,
            password,
          });

      if (result.error) throw result.error;
      if (signup && !result.data.session) {
        setPassword('');
        setNotice('Account created. Check your email to confirm your account, then sign in.');
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
      const { error: authError } = await supabase().auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${window.location.origin}/chat?mode=account` },
      });
      if (authError) throw authError;
    } catch (authError) {
      const message = authError instanceof Error ? authError.message : 'Google sign-in failed.';
      setError(
        message.toLowerCase().includes('provider') && message.toLowerCase().includes('not enabled')
          ? 'Google sign-in is not enabled for this Supabase project. Use email and password, or enable Google in Supabase Auth settings.'
          : message,
      );
      setBusy(false);
    }
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
