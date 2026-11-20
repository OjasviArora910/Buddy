'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { firebaseAuth } from '../../lib/firebase';

type AuthState = { user: User | null; loading: boolean };
const Context = createContext<AuthState>({ user: null, loading: true });

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, loading: true });
  useEffect(() => {
    try { return onAuthStateChanged(firebaseAuth(), (user) => setState({ user, loading: false }), () => setState({ user: null, loading: false })); }
    catch { setState({ user: null, loading: false }); }
  }, []);
  return <Context.Provider value={state}>{children}</Context.Provider>;
}

export function useAuth() { return useContext(Context); }
