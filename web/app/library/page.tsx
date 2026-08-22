'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { AuthButton } from '@/components/AuthGate';
import { useAuth } from '@/lib/auth-context';
import { ALL_TEMPLATES } from '@/lib/templates';

/*
 * Everything the user has made, newest first. Each card links to its own
 * /studio/[runId] — the same live workspace, which keeps working after the run
 * finishes because the tree is stored, not replayed.
 *
 * This page reads only the signed-in user's runs. It used to request
 * `?uid=all`, and the endpoint answered honestly: with everyone's runs.
 */

interface RunCard {
  id: string;
  /** A label the user chose. The goal is what the planner was given; this is
   *  what they call it. Absent on every run made before renaming existed. */
  title?: string | null;
  goal: string;
  templateId?: string | null;
  aspect: '9:16' | '16:9';
  seconds: number;
  status: string;
  stepCount: number;
  frameCount: number;
  videoUrl?: string;
  createdAt: number;
  updatedAt: number;
  thumbUrl?: string;
}

type Filter = 'all' | 'video' | 'running';

/* Every state where the agent still has work to do. The filter used to test
   only 'running' and 'planning', so a run that was rendering — the longest,
   most worth-watching phase — was missing from "Still running". This set is
   also what decides whether the page keeps polling. */
const IN_FLIGHT = new Set(['planning', 'running', 'rendering']);

/* A detached background task can die without ever writing a terminal status, so
   a card would pulse "Running" forever. updatedAt makes the silence visible. */
const STALL_AFTER_MS = 10 * 60 * 1000;
const isStalled = (r: RunCard) =>
  IN_FLIGHT.has(r.status) && Date.now() - (r.updatedAt || r.createdAt || 0) > STALL_AFTER_MS;

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  planning: { text: 'Planning', cls: 'border-accent/40 text-accent-ink' },
  running: { text: 'Running', cls: 'border-accent/40 text-accent-ink' },
  'awaiting-approval': { text: 'Ready to render', cls: 'border-warn/40 text-warn-ink' },
  rendering: { text: 'Rendering', cls: 'border-accent/40 text-accent-ink' },
  complete: { text: 'Clip ready', cls: 'border-good/40 text-good-ink' },
  completed: { text: 'Clip ready', cls: 'border-good/40 text-good-ink' },
  failed: { text: 'Failed', cls: 'border-crit/40 text-crit-ink' },
};

function whenever(ms: number) {
  if (!ms) return '';
  const mins = Math.round((Date.now() - ms) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function Library() {
  const { user, loading: authLoading } = useAuth();
  const [runs, setRuns] = useState<RunCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  /* Which card is mid-edit, which is one click from being destroyed, and what
     to say when one of those goes wrong. Held here rather than in the card so
     that opening a second menu closes the first, and so a confirmation cannot
     survive a re-render into a different card. */
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [cardBusy, setCardBusy] = useState<string | null>(null);
  const [cardError, setCardError] = useState<string | null>(null);

  const load = useCallback(
    async (quiet = false) => {
      if (!user) return;
      if (!quiet) setLoading(true);
      try {
        const token = await user.getIdToken();
        const res = await fetch('/api/runs', { headers: { authorization: `Bearer ${token}` } });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? 'could not load your library');
        setRuns(json.runs ?? []);
        setError(null);
      } catch (e) {
        // A failed background refresh must not replace a list that is on screen
        // and still readable.
        if (!quiet) setError(e instanceof Error ? e.message : 'could not load your library');
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [user],
  );

  async function authed(path: string, init: RequestInit) {
    if (!user) throw new Error('sign in first');
    const token = await user.getIdToken();
    const res = await fetch(path, {
      ...init,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error ?? 'that did not work');
    return json;
  }

  async function saveTitle(id: string, title: string) {
    const clean = title.trim();
    setRenaming(null);
    const current = runs.find((r) => r.id === id);
    if (!current || (current.title ?? '') === clean) return;
    setCardBusy(id);
    setCardError(null);
    /* Optimistic. The name is the user's own words being echoed back, so there
       is nothing to wait for and a spinner on a text label reads as a fault. */
    const prev = runs;
    setRuns((rs) => rs.map((r) => (r.id === id ? { ...r, title: clean || null } : r)));
    try {
      // Emptying the box clears the name and the card goes back to its goal.
      await authed(`/api/runs/${id}`, { method: 'PATCH', body: JSON.stringify({ title: clean || null }) });
    } catch (e) {
      setRuns(prev);
      setCardError(e instanceof Error ? e.message : 'could not rename that run');
    } finally {
      setCardBusy(null);
    }
  }

  async function destroy(id: string) {
    setConfirming(null);
    setCardBusy(id);
    setCardError(null);
    try {
      const gone = await authed(`/api/runs/${id}`, { method: 'DELETE' });
      /* Not optimistic, unlike a rename. This one cannot be put back, so the
         card stays on screen until the server confirms it is really gone —
         removing it first and restoring it on failure would flash a deletion
         that did not happen. */
      setRuns((rs) => rs.filter((r) => r.id !== id));
      if (gone?.clips > 0) {
        setCardError(`Deleted, along with ${gone.clips} rendered clip${gone.clips > 1 ? 's' : ''}.`);
      }
    } catch (e) {
      setCardError(e instanceof Error ? e.message : 'could not delete that run');
    } finally {
      setCardBusy(null);
    }
  }

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setLoading(false);
      setRuns([]);
      return;
    }
    void load();
  }, [user, authLoading, load]);

  /*
   * A run takes minutes, and the library fetched once — so a card that said
   * "Running" when the page loaded still said it after the clip was finished.
   * Poll only while something is actually in flight, and stop as soon as
   * nothing is: an idle library should cost nothing.
   */
  // Only poll for runs that are actually moving — a stalled one will not change.
  const anyInFlight = runs.some((r) => IN_FLIGHT.has(r.status) && !isStalled(r));
  useEffect(() => {
    if (!anyInFlight || !user) return;
    const t = setInterval(() => void load(true), 8000);
    return () => clearInterval(t);
  }, [anyInFlight, user, load]);

  const shown = runs.filter((r) =>
    filter === 'video' ? !!r.videoUrl : filter === 'running' ? IN_FLIGHT.has(r.status) : true,
  );

  const counts = {
    all: runs.length,
    video: runs.filter((r) => r.videoUrl).length,
    running: runs.filter((r) => IN_FLIGHT.has(r.status)).length,
  };

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-[1180px] flex-1 overflow-y-auto px-8 py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[30px] font-semibold tracking-[-0.02em]">Library</h1>
            <p className="mt-1.5 text-[14px] text-ink-3">
              Every run you have made. Open one to see the whole tree — including the attempts that were discarded.
            </p>
          </div>
          <Link
            href="/studio"
            className="rounded-lg bg-primary px-4 py-2.5 text-[13.5px] font-semibold text-primary-ink"
          >
            New run
          </Link>
        </div>

        {user && runs.length > 0 && (
          <div className="mt-6 flex gap-1.5 border-b border-line pb-3">
            {(
              [
                ['all', 'All'],
                ['video', 'With a clip'],
                ['running', 'Still running'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={`rounded-chip px-3 py-1.5 text-[12.5px] font-medium ${
                  filter === key ? 'bg-primary text-primary-ink' : 'text-ink-3 hover:bg-subtle'
                }`}
              >
                {label} <span className="tnum opacity-60">{counts[key]}</span>
              </button>
            ))}
          </div>
        )}

        {authLoading || loading ? (
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-[260px] animate-pulse rounded-card border border-line bg-subtle" />
            ))}
          </div>
        ) : !user ? (
          <Empty
            title="Sign in to see your library"
            body="Your runs are saved to your account, so you can come back to any of them and keep working."
            action={<AuthButton />}
          />
        ) : error ? (
          <Empty title="That did not load" body={error} />
        ) : shown.length === 0 ? (
          <Empty
            title={runs.length ? 'Nothing matches that filter' : 'No runs yet'}
            body={
              runs.length
                ? 'Try another filter.'
                : 'Start one and it will appear here — with its plan, every frame, and the critic’s notes.'
            }
            action={
              !runs.length ? (
                <Link href="/studio" className="rounded-lg bg-primary px-4 py-2.5 text-[13.5px] font-semibold text-primary-ink">
                  Start your first run
                </Link>
              ) : undefined
            }
          />
        ) : (
          <>
          {/* Shown, not logged. A refused delete and a successful one look
              identical from the outside otherwise: the menu closes, the card
              stays, and nothing says why. */}
          {cardError && (
            <div className="mt-5 flex items-center justify-between gap-3 rounded-card border border-line bg-subtle px-4 py-2.5">
              <p className="text-[12.5px] text-ink-2">{cardError}</p>
              <button
                type="button"
                onClick={() => setCardError(null)}
                className="shrink-0 text-[12px] font-semibold text-ink-3 underline"
              >
                Dismiss
              </button>
            </div>
          )}
          <div className="mt-7 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((r) => {
              const stalled = isStalled(r);
              const badge = stalled
                ? { text: 'Stopped', cls: 'border-warn/40 text-warn-ink' }
                : (STATUS_LABEL[r.status] ?? { text: r.status, cls: 'border-line-strong text-ink-3' });
              return (
                <div
                  key={r.id}
                  className={`rs-enter group flex flex-col overflow-hidden rounded-card border bg-panel transition-colors ${
                    confirming === r.id ? 'border-crit/50' : 'border-line hover:border-line-strong'
                  } ${cardBusy === r.id ? 'opacity-60' : ''}`}
                >
                  {/*
                    The link covers the picture and the name, and stops there.
                    This whole card used to be one <Link>, which is why it had no
                    actions: a button inside an anchor is invalid, and clicking
                    one navigates instead of acting. The footer sits outside it.
                  */}
                  <Link href={`/studio/${r.id}`} className="flex flex-1 flex-col">
                    <div className="relative flex aspect-[16/10] items-center justify-center overflow-hidden bg-subtle">
                      {r.thumbUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={r.thumbUrl}
                          alt=""
                          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                        />
                      ) : (
                        // text-ink-4 measured 4.32 on this tint against a 4.5
                        // requirement — the faintest tier is for text on the
                        // canvas, not on a filled placeholder.
                        <span className="text-[12px] text-ink-3">no frames yet</span>
                      )}

                      {r.videoUrl && (
                        <span className="absolute inset-0 flex items-center justify-center bg-black/25">
                          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/65">
                            <svg width="17" height="17" viewBox="0 0 24 24" fill="#fff" className="ml-0.5" aria-hidden>
                              <path d="M8 5v14l11-7z" />
                            </svg>
                          </span>
                        </span>
                      )}

                      <span className="absolute left-2.5 top-2.5 flex gap-1.5">
                        <span className="rounded bg-black/65 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                          {r.aspect}
                        </span>
                        {/* Which template made this. The id was stored on every run
                            from the start and shown nowhere. */}
                        {r.templateId && (
                          <span className="rounded bg-black/65 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                            {ALL_TEMPLATES.find((t) => t.id === r.templateId)?.name ?? r.templateId}
                          </span>
                        )}
                      </span>
                    </div>

                    <div className="flex flex-1 flex-col px-3.5 pt-3.5">
                      <p className="line-clamp-2 text-[14px] font-semibold leading-snug">{r.title || r.goal}</p>
                      {/* Both, when they differ. A renamed card should still be
                          able to tell you what it was actually made from. */}
                      {r.title && (
                        <p className="mt-1 line-clamp-1 text-[11.5px] text-ink-4">{r.goal}</p>
                      )}
                    </div>
                  </Link>

                  {renaming?.id === r.id ? (
                    <form
                      className="px-3.5 pb-3.5 pt-3"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void saveTitle(r.id, renaming.value);
                      }}
                    >
                      <input
                        autoFocus
                        value={renaming.value}
                        maxLength={120}
                        onChange={(e) => setRenaming({ id: r.id, value: e.target.value })}
                        onKeyDown={(e) => e.key === 'Escape' && setRenaming(null)}
                        onBlur={() => void saveTitle(r.id, renaming.value)}
                        className="w-full rounded-lg border border-accent bg-canvas px-2.5 py-1.5 text-[13.5px] outline-none"
                        aria-label="Name this run"
                      />
                      <p className="mt-1.5 text-[11px] text-ink-4">Enter to save, Esc to cancel</p>
                    </form>
                  ) : (
                    <div className="flex items-center justify-between gap-2 px-3.5 pb-3.5 pt-3">
                      <span className={`flex shrink-0 items-center gap-1.5 rounded-chip border px-2 py-0.5 text-[10.5px] font-bold tracking-[0.04em] ${badge.cls}`}>
                        {IN_FLIGHT.has(r.status) && !stalled && (
                          <span className="rs-cursor block h-[5px] w-[5px] rounded-full bg-current" />
                        )}
                        {badge.text}
                      </span>

                      <span className="tnum truncate text-[11.5px] text-ink-4">
                        {r.stepCount > 0 && `${r.stepCount} steps · `}
                        {whenever(r.updatedAt || r.createdAt)}
                      </span>

                      {/*
                        Always visible, not revealed on hover. A control that
                        only exists under a cursor does not exist on a phone,
                        and "I cannot delete this" is the report that follows.
                      */}
                      <span className="ml-auto flex shrink-0 items-center gap-0.5">
                        <button
                          type="button"
                          aria-label={`Rename ${r.title || r.goal}`}
                          disabled={cardBusy === r.id}
                          onClick={() => {
                            setConfirming(null);
                            setRenaming({ id: r.id, value: r.title || r.goal });
                          }}
                          className="rounded p-1.5 text-ink-4 hover:bg-subtle hover:text-ink-2 disabled:opacity-40"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          aria-label={confirming === r.id ? `Confirm deleting ${r.title || r.goal}` : `Delete ${r.title || r.goal}`}
                          disabled={cardBusy === r.id}
                          onClick={() => (confirming === r.id ? void destroy(r.id) : setConfirming(r.id))}
                          className={`rounded px-1.5 py-1.5 text-[11.5px] font-semibold disabled:opacity-40 ${
                            confirming === r.id
                              ? 'bg-crit-soft text-crit-ink'
                              : 'text-ink-4 hover:bg-subtle hover:text-crit-ink'
                          }`}
                        >
                          {confirming === r.id ? (
                            'Really delete?'
                          ) : (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                              <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
                            </svg>
                          )}
                        </button>
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          </>
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
