'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { AuthButton } from '@/components/AuthGate';
import { useAuth } from '@/lib/auth-context';

/*
 * The enrolled faces.
 *
 * An avatar is not a profile picture — it is three angles and a voice sample,
 * and the three angles are the reason a generated face holds together when the
 * agent turns it, lights it differently, or moves it across a room. The card is
 * built to show that: the front view at full size with the two profiles beside
 * it, and hovering rotates through them so the dimensionality is something you
 * see rather than read.
 *
 * The previous version showed three equal cropped thumbnails in a row, which
 * made an avatar look like three unrelated photos.
 */

interface Avatar {
  id: string;
  name: string;
  createdAt: number;
  hasVoice: boolean;
  urls: { front: string | null; left: string | null; right: string | null };
}

const ANGLES = ['left', 'front', 'right'] as const;
type Angle = (typeof ANGLES)[number];

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
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? 'could not delete that avatar');
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
      <div className="mx-auto w-full max-w-[1080px] flex-1 overflow-y-auto px-6 py-12 sm:px-8">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div className="max-w-xl">
            <h1 className="text-[34px] font-bold tracking-[-0.03em]">Your faces</h1>
            <p className="mt-2 text-[15px] leading-relaxed text-ink-2">
              Three angles and a voice, captured once. Every run you make from here uses one of these — the profiles
              are what keep the face from drifting when the agent turns it or changes the light.
            </p>
          </div>
          {user && avatars.length > 0 && (
            <Link
              href="/enroll"
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-[13.5px] font-semibold text-primary-ink"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
                <path d="M12 5v14M5 12h14" />
              </svg>
              Enrol another
            </Link>
          )}
        </div>

        {error && (
          <p className="mt-6 rounded-card border border-crit/40 rs-tint-crit px-4 py-3 text-[13px] text-crit-ink">{error}</p>
        )}

        {authLoading || loading ? (
          <div className="mt-10 grid gap-6 sm:grid-cols-2">
            {[0, 1].map((i) => (
              <div key={i} className="h-[280px] animate-pulse rounded-card border border-line bg-subtle" />
            ))}
          </div>
        ) : avatars.length === 0 ? (
          /* Signed out or simply empty, the same explanation applies — and a
             visitor deciding whether to point a camera at their own face needs
             the reasoning more than they need a bare sign-in box. Only the
             final control differs. */
          <FirstEnrolment signedIn={!!user} />
        ) : (
          <div className="mt-10 grid gap-6 sm:grid-cols-2">
            {avatars.map((a) => (
              <AvatarCard
                key={a.id}
                avatar={a}
                confirming={confirming === a.id}
                deleting={deleting === a.id}
                onConfirm={() => setConfirming(a.id)}
                onCancel={() => setConfirming(null)}
                onDelete={() => remove(a.id)}
              />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function AvatarCard({
  avatar,
  confirming,
  deleting,
  onConfirm,
  onCancel,
  onDelete,
}: {
  avatar: Avatar;
  confirming: boolean;
  deleting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const [angle, setAngle] = useState<Angle>('front');
  const cycling = useRef<number | null>(null);

  /* Hovering turns the head. The three angles are the substance of an avatar,
     and a still front shot hides two thirds of it. */
  const startCycle = () => {
    if (cycling.current) return;
    let i = 0;
    cycling.current = window.setInterval(() => {
      i = (i + 1) % ANGLES.length;
      setAngle(ANGLES[i]);
    }, 700);
  };
  const stopCycle = () => {
    if (cycling.current) window.clearInterval(cycling.current);
    cycling.current = null;
    setAngle('front');
  };
  useEffect(() => () => { if (cycling.current) window.clearInterval(cycling.current); }, []);

  const captured = ANGLES.filter((x) => avatar.urls[x]).length;

  return (
    <div
      className="rs-enter group overflow-hidden rounded-card border border-line bg-panel transition-shadow hover:shadow-[0_18px_44px_-22px_rgba(0,0,0,0.35)]"
      onMouseEnter={startCycle}
      onMouseLeave={stopCycle}
    >
      <div className="flex gap-px bg-line">
        {/* the view being shown, large */}
        <div className="relative aspect-[4/5] flex-1 overflow-hidden bg-subtle">
          {ANGLES.map((which) =>
            avatar.urls[which] ? (
              // Every angle is mounted and cross-faded, so cycling does not
              // flash a blank frame while an image loads.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={which}
                src={avatar.urls[which]!}
                alt={`${which} angle`}
                className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-500 ${
                  angle === which ? 'opacity-100' : 'opacity-0'
                }`}
              />
            ) : null,
          )}
          <span className="absolute bottom-2.5 left-2.5 rounded-chip bg-black/65 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.1em] text-white backdrop-blur-sm">
            {angle}
          </span>
        </div>

        {/* the other two, stacked — a legend for what is being cycled */}
        <div className="flex w-[86px] shrink-0 flex-col gap-px">
          {ANGLES.filter((x) => x !== 'front').map((which) => (
            <button
              key={which}
              type="button"
              onMouseEnter={() => setAngle(which)}
              onFocus={() => setAngle(which)}
              aria-label={`Show the ${which} angle`}
              className={`relative flex-1 overflow-hidden bg-subtle outline-none ring-inset transition-opacity focus-visible:ring-2 focus-visible:ring-accent ${
                angle === which ? 'opacity-100' : 'opacity-55'
              }`}
            >
              {avatar.urls[which] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatar.urls[which]!} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-[9px] text-ink-4">missing</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold">{avatar.name}</p>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-ink-3">
              <Chip>{captured} angles</Chip>
              {avatar.hasVoice ? <Chip>voice sample</Chip> : <Chip muted>no voice</Chip>}
              <span className="tnum text-ink-4">
                {new Date(avatar.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
              </span>
            </p>
          </div>
        </div>

        {confirming ? (
          <div className="rs-enter mt-4 rounded-lg border border-crit/40 rs-tint-crit p-3">
            <p className="text-[12.5px] font-semibold text-crit-ink">Delete this face?</p>
            <p className="mt-1 text-[12px] leading-snug text-ink-2">
              The captures, and every run made from them — frames and rendered clips included — are removed for good.
            </p>
            <div className="mt-2.5 flex gap-1.5">
              <button
                type="button"
                disabled={deleting}
                onClick={onDelete}
                className="rounded-md bg-crit px-3 py-1.5 text-[12.5px] font-semibold text-white disabled:opacity-50"
              >
                {deleting ? 'Deleting…' : 'Delete everything'}
              </button>
              <button
                type="button"
                onClick={onCancel}
                className="rounded-md border border-line-strong px-3 py-1.5 text-[12.5px] font-semibold text-ink-2"
              >
                Keep it
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-4 flex gap-2">
            <Link
              href={`/studio?avatar=${avatar.id}`}
              className="flex-1 rounded-lg bg-primary py-2.5 text-center text-[13px] font-semibold text-primary-ink"
            >
              Make an ad with this face
            </Link>
            <button
              type="button"
              onClick={onConfirm}
              aria-label={`Delete ${avatar.name}`}
              className="rounded-lg border border-line-strong px-3 text-ink-3 transition-colors hover:border-crit hover:text-crit-ink"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Chip({ children, muted }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <span className={`rounded-chip border px-2 py-0.5 ${muted ? 'border-line text-ink-4' : 'border-line-strong text-ink-2'}`}>
      {children}
    </span>
  );
}

/* The empty state carries the explanation, because this is where somebody
   decides whether to point a camera at their own face. */
function FirstEnrolment({ signedIn }: { signedIn: boolean }) {
  return (
    <div className="mt-10 overflow-hidden rounded-card border border-line bg-panel">
      <div className="grid gap-8 p-8 sm:grid-cols-[minmax(0,1fr)_minmax(0,320px)] sm:items-center sm:p-10">
        <div>
          <p className="text-[11px] font-bold tracking-[0.12em] text-ink-3">ENROL ONCE</p>
          <h2 className="mt-2.5 text-[26px] font-bold leading-tight tracking-[-0.02em]">
            Three angles is what makes it hold.
          </h2>
          <p className="mt-3 text-[14.5px] leading-relaxed text-ink-2">
            One photo gives the model a single view to guess from, and the face drifts as soon as the agent turns or
            relights it. Left, straight on and right give it the geometry, so the person in the last frame is still
            the person in the first.
          </p>
          <ul className="mt-5 flex flex-col gap-2.5">
            {[
              ['Front, left and right', 'Captured automatically as you turn your head'],
              ['A short voice sample', 'Optional, and saved for voice matching later'],
              ['Yours to delete', 'Removing a face removes everything made from it'],
            ].map(([t, d]) => (
              <li key={t} className="flex gap-2.5">
                <span className="mt-[7px] block h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                <span className="text-[13.5px] leading-snug">
                  <span className="font-semibold">{t}</span>
                  <span className="text-ink-3"> — {d}</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            {signedIn ? (
              <Link
                href="/enroll"
                className="inline-flex items-center gap-2 rounded-lg bg-accent-strong px-5 py-3 text-[14px] font-semibold text-white"
              >
                Enrol your face
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </Link>
            ) : (
              <>
                <AuthButton />
                <span className="text-[13px] text-ink-3">A face is saved to your account, so it is there on any device.</span>
              </>
            )}
          </div>
        </div>

        {/* What three angles look like, drawn rather than photographed — a stock
            face here would be a stranger's likeness on a page about likeness. */}
        <div className="flex items-end justify-center gap-3">
          {[
            { label: 'left', rotate: -22, scale: 0.86 },
            { label: 'front', rotate: 0, scale: 1 },
            { label: 'right', rotate: 22, scale: 0.86 },
          ].map((v) => (
            <div key={v.label} className="flex flex-col items-center gap-2">
              <div
                className="flex items-center justify-center rounded-card border border-line bg-subtle"
                style={{
                  width: 78 * v.scale,
                  height: 98 * v.scale,
                  transform: `perspective(300px) rotateY(${v.rotate}deg)`,
                }}
              >
                <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="var(--text-faint)" strokeWidth="1.5" aria-hidden>
                  <circle cx="12" cy="8" r="4" />
                  <path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" />
                </svg>
              </div>
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-4">{v.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
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
