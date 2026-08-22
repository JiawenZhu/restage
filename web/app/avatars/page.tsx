'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { AuthButton } from '@/components/AuthGate';
import { useAuth } from '@/lib/auth-context';

/*
 * The enrolled faces, which is what makes enrolment one-time.
 *
 * The "Avatars" nav item used to open the capture wizard, so the only thing a
 * user could do with an enrolled face was enrol another one — no list, no
 * reuse, no delete, while /enroll promised all three. This is the missing half.
 */

interface Avatar {
  id: string;
  name: string;
  createdAt: number;
  hasVoice: boolean;
  urls: { front: string | null; left: string | null; right: string | null };
}

export default function Avatars() {
  const { user, loading: authLoading } = useAuth();
  const [avatars, setAvatars] = useState<Avatar[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/avatars', { headers: { authorization: `Bearer ${token}` } });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'could not load your avatars');
      setAvatars(json.avatars ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not load your avatars');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setLoading(false);
      setAvatars([]);
      return;
    }
    void load();
  }, [user, authLoading, load]);

  async function remove(id: string) {
    if (!user) return;
    setDeleting(id);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/avatars/${id}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'could not delete that avatar');
      setAvatars((prev) => prev.filter((a) => a.id !== id));
      try {
        localStorage.removeItem(`restage_latest_avatar:${user.uid}`);
      } catch {
        /* the cache is optional */
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not delete that avatar');
    } finally {
      setDeleting(null);
      setConfirming(null);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-[1000px] flex-1 overflow-y-auto px-8 py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[30px] font-semibold tracking-[-0.02em]">Avatars</h1>
            <p className="mt-1.5 max-w-xl text-[14px] leading-relaxed text-ink-3">
              The faces you have enrolled. Every run can use one of these — you only capture a face once.
            </p>
          </div>
          <Link href="/enroll" className="rounded-lg bg-primary px-4 py-2.5 text-[13.5px] font-semibold text-primary-ink">
            Enrol a face
          </Link>
        </div>

        {error && <p className="mt-6 text-[13px] text-crit-ink">{error}</p>}

        {authLoading || loading ? (
          <div className="mt-9 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-[230px] animate-pulse rounded-card border border-line bg-subtle" />
            ))}
          </div>
        ) : !user ? (
          <Empty
            title="Sign in to see your avatars"
            body="Enrolled faces are saved to your account so they are there next time."
            action={<AuthButton />}
          />
        ) : avatars.length === 0 ? (
          <Empty
            title="No enrolled faces yet"
            body="Capture three angles once, and every run after that can use them."
            action={
              <Link href="/enroll" className="rounded-lg bg-primary px-4 py-2.5 text-[13.5px] font-semibold text-primary-ink">
                Enrol your face
              </Link>
            }
          />
        ) : (
          <div className="mt-9 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {avatars.map((a) => (
              <div key={a.id} className="rs-enter overflow-hidden rounded-card border border-line bg-panel">
                {/* All three angles, because all three are what conditions the
                    model — showing only the front would hide half of what the
                    user gave. */}
                <div className="grid grid-cols-3 gap-px bg-line">
                  {(['left', 'front', 'right'] as const).map((which) => (
                    <div key={which} className="relative aspect-[3/4] bg-subtle">
                      {a.urls[which] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={a.urls[which]!} alt={`${which} angle`} className="h-full w-full object-cover" />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center text-[10px] text-ink-4">{which}</span>
                      )}
                      <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 py-0.5 text-[8.5px] font-bold uppercase text-white">
                        {which}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="p-3.5">
                  <p className="truncate text-[14px] font-semibold">{a.name}</p>
                  <p className="mt-0.5 text-[11.5px] text-ink-4">
                    {new Date(a.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                    {a.hasVoice && ' · voice sample'}
                  </p>

                  {confirming === a.id ? (
                    <div className="mt-3 rounded-lg border border-crit/40 bg-crit-soft/40 p-2.5">
                      <p className="text-[12px] leading-snug">
                        Delete this face and its captures? This cannot be undone.
                      </p>
                      <div className="mt-2 flex gap-1.5">
                        <button
                          type="button"
                          disabled={deleting === a.id}
                          onClick={() => remove(a.id)}
                          className="rounded-md bg-crit px-2.5 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50"
                        >
                          {deleting === a.id ? 'Deleting…' : 'Delete'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirming(null)}
                          className="rounded-md border border-line-strong px-2.5 py-1.5 text-[12px] font-semibold text-ink-2"
                        >
                          Keep
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 flex gap-1.5">
                      <Link
                        href={`/studio?avatar=${a.id}`}
                        className="flex-1 rounded-lg bg-primary py-2 text-center text-[12.5px] font-semibold text-primary-ink"
                      >
                        Use in a run
                      </Link>
                      <button
                        type="button"
                        onClick={() => setConfirming(a.id)}
                        className="rounded-lg border border-line-strong px-2.5 py-2 text-[12.5px] font-semibold text-ink-3 hover:border-crit hover:text-crit-ink"
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function Empty({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="mt-12 flex flex-col items-center rounded-card border border-dashed border-line-strong px-6 py-16 text-center">
      <p className="text-[17px] font-semibold">{title}</p>
      <p className="mt-1.5 max-w-sm text-[13.5px] leading-relaxed text-ink-3">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
