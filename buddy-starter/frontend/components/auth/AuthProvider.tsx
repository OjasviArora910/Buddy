'use client';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, reload, User } from 'firebase/auth';
import { firebaseAuth } from '../../lib/firebase';

type AuthState = { user: User | null; displayName: string; loading: boolean; refreshVerification: () => Promise<boolean> };
const Context = createContext<AuthState>({ user: null, displayName: 'Your account', loading: true, refreshVerification: async () => false });

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, displayName: 'Your account', loading: true, refreshVerification: async () => false });
  const refreshVerification = useCallback(async () => {
    const auth = firebaseAuth();
    const user = auth.currentUser;
    if (!user) return false;
    await reload(user);
    await user.getIdToken(true);
    setState({ user, displayName: user.displayName?.trim() || 'Your account', loading: false, refreshVerification });
    return user.emailVerified;
  }, []);
  useEffect(() => {
    let alive = true;
    try {
      const unsubscribe = onAuthStateChanged(firebaseAuth(), (user) => setState({ user, displayName: user?.displayName?.trim() || 'Your account', loading: false, refreshVerification }), () => setState({ user: null, displayName: 'Your account', loading: false, refreshVerification }));
      const onVisible = () => { if (document.visibilityState === 'visible' && firebaseAuth().currentUser) void refreshVerification().catch(() => undefined); };
      document.addEventListener('visibilitychange', onVisible);
      return () => { alive = false; unsubscribe(); document.removeEventListener('visibilitychange', onVisible); };
    } catch {
      if (alive) setState({ user: null, displayName: 'Your account', loading: false, refreshVerification });
    }
  }, [refreshVerification]);
  return <Context.Provider value={{ ...state, refreshVerification }}>{children}</Context.Provider>;
}

export function useAuth() { return useContext(Context); }
