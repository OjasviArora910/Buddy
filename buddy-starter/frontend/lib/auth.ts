'use client';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { firebaseAuth } from './firebase';

export async function currentUser(): Promise<User | null> {
  const auth = firebaseAuth();
  if (auth.currentUser) return auth.currentUser;
  return new Promise((resolve, reject) => {
    const unsubscribe = onAuthStateChanged(auth, (user) => { unsubscribe(); resolve(user); }, (error) => { unsubscribe(); reject(error); });
  });
}

export async function idToken(): Promise<string | null> {
  const user = await currentUser();
  return user ? user.getIdToken() : null;
}

export async function logout(): Promise<void> { await signOut(firebaseAuth()); }

// Small compatibility surface while the existing screens migrate to Firebase tokens.
export function authClient() {
  return { auth: {
    getSession: async () => {
      const user = await currentUser();
      return { data: { session: user ? { access_token: await user.getIdToken() } : null } };
    },
    signOut: logout,
  } };
}
