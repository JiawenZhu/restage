'use client';

import { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { signInWithGoogle, signOutUser, watchAuth } from '@/lib/firebase';

/*
 * Sign-in is required before a run because every API route verifies an ID token
 * and every Firestore path is scoped to a uid. The gate exists so that is a
 * visible step rather than a 401 the user has to interpret.
 */
export function useUser() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const unsub = watchAuth((u: User | null) => {
      setUser(u);
      setReady(true);
    });
    return () => unsub();
  }, []);
  return { user, ready };
}

export function AuthButton() {
  const { user, ready } = useUser();
  const [busy, setBusy] = useState(false);

  if (!ready) return <span className="text-[13px] text-ink-4">…</span>;

  if (!user) {
    return (
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await signInWithGoogle();
          } catch (err: any) {
            console.error('Sign in error:', err);
          } finally {
            setBusy(false);
          }
        }}
        className="rounded-lg bg-primary px-4 py-2 text-[13px] font-semibold text-primary-ink disabled:opacity-60"
      >
        {busy ? 'Signing in…' : 'Sign in with Google'}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2.5">
      <span className="max-w-[160px] truncate text-[13px] text-ink-3">{user.email}</span>
      <button
        type="button"
        onClick={() => signOutUser()}
        className="rounded-lg border border-line-strong px-3 py-1.5 text-[12.5px] font-medium text-ink-2 hover:bg-subtle"
      >
        Sign out
      </button>
    </div>
  );
}
