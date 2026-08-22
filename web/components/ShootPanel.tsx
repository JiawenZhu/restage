'use client';

/*
 * Changing the shoot after the ad exists, and being told what that costs.
 *
 * Two pieces that only make sense together. The panel edits the look — the
 * product, the place, the light, the clothes, the face — and the modal is the
 * consequence: which shots no longer match, and whether to pay to remake them.
 *
 * Splitting the change from the regeneration is the whole design. Saving is
 * instant and free and reversible; remaking six shots is six paid generations
 * and a couple of minutes. Folding those together would mean a typo in the
 * location field silently spends both.
 */

import { useEffect, useRef, useState } from 'react';
import { useUser } from './AuthGate';
import { LOOK_FIELDS, type Impact, type LookField } from '@/lib/impact';
import type { LookBible, Run } from '@/lib/types';

const FIELD_LABEL: Record<Exclude<LookField, 'avatar'>, { label: string; hint: string }> = {
  product: { label: 'Product', hint: 'The item itself — shape, material, colour, size' },
  location: { label: 'Location', hint: 'The room, the surface, where the light comes from' },
  wardrobe: { label: 'Wardrobe', hint: 'What they wear in every shot they appear in' },
  light: { label: 'Light', hint: 'Source, direction, time of day' },
  palette: { label: 'Palette', hint: 'The few colours this ad lives in' },
};

const EDITABLE = LOOK_FIELDS.filter((f): f is Exclude<LookField, 'avatar'> => f !== 'avatar');

interface AvatarOption {
  id: string;
  name?: string;
  urls?: { front?: string | null };
}

export function ShootPanel({
  run,
  onImpact,
  onNote,
}: {
  run: Run;
  onImpact: (i: Impact & { seconds: number; label: string }) => void;
  onNote: (msg: string) => void;
}) {
  const { user } = useUser();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Partial<LookBible>>({});
  const [avatars, setAvatars] = useState<AvatarOption[]>([]);
  const [avatarId, setAvatarId] = useState<string | null>(run.avatarId ?? null);

  const look = run.look ?? null;

  /* The faces are only needed once the panel is open — fetching them on every
     workspace mount would spend a request on a control most sessions never
     touch. */
  useEffect(() => {
    if (!open || !user || avatars.length) return;
    void (async () => {
      try {
        const token = await user.getIdToken();
        const res = await fetch('/api/avatars', { headers: { authorization: `Bearer ${token}` } });
        const json = await res.json();
        if (res.ok) setAvatars(json.avatars ?? []);
      } catch {
        /* The rest of the panel still works without a face picker. */
      }
    })();
  }, [open, user, avatars.length]);

  async function call(body: Record<string, unknown>) {
    if (!user) throw new Error('sign in first');
    const token = await user.getIdToken();
    const res = await fetch(`/api/runs/${run.id}/look`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? 'that did not work');
    return json;
  }

  async function derive() {
    setBusy(true);
    try {
      const r = await call({ action: 'derive' });
      onNote(`Read the shoot from ${r.tagged} of ${r.total} shots. Check it and change anything that is wrong.`);
      setOpen(true);
    } catch (e) {
      onNote(e instanceof Error ? e.message : 'could not read this run');
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    /* Only fields the user actually touched. Sending the whole form would mark
       shots stale because somebody opened the panel and pressed Save. */
    const patch: Partial<LookBible> = {};
    for (const f of EDITABLE) {
      if (draft[f] !== undefined && draft[f] !== (look?.[f] ?? '')) patch[f] = draft[f];
    }
    const swappedFace = avatarId && avatarId !== run.avatarId ? avatarId : undefined;
    if (!Object.keys(patch).length && !swappedFace) {
      setOpen(false);
      return;
    }

    setBusy(true);
    try {
      const impact = await call({ action: 'save', look: patch, avatarId: swappedFace });
      setOpen(false);
      setDraft({});
      if (impact.shots?.length) onImpact(impact);
      else onNote(impact.summary ?? 'Saved.');
    } catch (e) {
      onNote(e instanceof Error ? e.message : 'could not save that change');
    } finally {
      setBusy(false);
    }
  }

  /* ── an older run, made before shot lists existed ───────────────────────── */
  if (!look) {
    return (
      <div className="mx-3.5 mb-3 rounded-card border border-line bg-elevated p-3">
        <p className="text-[10px] font-bold tracking-[0.1em] text-ink-3">THE SHOOT</p>
        <p className="mt-1.5 text-[12.5px] leading-snug text-ink-2">
          This run was made before shots were described. Read it once and you can swap the product, the place or
          the face — and see exactly which frames that affects.
        </p>
        <button
          type="button"
          disabled={busy || !user}
          onClick={() => void derive()}
          className="mt-2.5 rounded-lg border border-line-strong px-3 py-1.5 text-[12.5px] font-semibold text-ink-2 hover:border-accent hover:text-accent-ink disabled:opacity-40"
        >
          {busy ? 'Reading…' : 'Read this shoot'}
        </button>
      </div>
    );
  }

  return (
    <div className="mx-3.5 mb-3 rounded-card border border-line bg-elevated p-3">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-bold tracking-[0.1em] text-ink-3">THE SHOOT</p>
        <button
          type="button"
          onClick={() => {
            setDraft(open ? {} : { ...look });
            setOpen(!open);
          }}
          className="text-[11.5px] font-semibold text-accent-ink hover:underline"
        >
          {open ? 'Cancel' : 'Change'}
        </button>
      </div>

      {!open ? (
        <dl className="mt-2 flex flex-col gap-1.5">
          {EDITABLE.map((f) => (
            <div key={f} className="flex gap-2 text-[12px] leading-snug">
              <dt className="w-[62px] shrink-0 text-ink-4">{FIELD_LABEL[f].label}</dt>
              <dd className="min-w-0 flex-1 truncate text-ink-2" title={look[f]}>
                {look[f]}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <div className="mt-2.5 flex flex-col gap-2.5">
          {EDITABLE.map((f) => (
            <label key={f} className="block">
              <span className="text-[11px] font-semibold text-ink-2">{FIELD_LABEL[f].label}</span>
              <textarea
                rows={2}
                value={draft[f] ?? ''}
                maxLength={400}
                onChange={(e) => setDraft((d) => ({ ...d, [f]: e.target.value }))}
                placeholder={FIELD_LABEL[f].hint}
                className="mt-1 w-full resize-none rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-[12.5px] leading-snug outline-none focus:border-accent"
              />
            </label>
          ))}

          {avatars.length > 1 && (
            <div>
              <span className="text-[11px] font-semibold text-ink-2">Who is in it</span>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {avatars.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setAvatarId(a.id)}
                    className={`flex items-center gap-1.5 rounded-chip border px-2 py-1 text-[11.5px] ${
                      avatarId === a.id ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line text-ink-2'
                    }`}
                  >
                    {a.urls?.front && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={a.urls.front} alt="" className="h-4 w-4 rounded-full object-cover" />
                    )}
                    {a.name ?? 'Face'}
                  </button>
                ))}
              </div>
            </div>
          )}

          <button
            type="button"
            disabled={busy}
            onClick={() => void save()}
            className="rounded-lg bg-primary py-2 text-[12.5px] font-semibold text-primary-ink disabled:opacity-40"
          >
            {busy ? 'Saving…' : 'Save changes'}
          </button>
          <p className="text-[11px] leading-snug text-ink-4">
            Saving is free. Nothing is regenerated until you say so — you will be shown exactly which shots are
            affected first.
          </p>
        </div>
      )}
    </div>
  );
}

/* ── what the change broke ─────────────────────────────────────────────────── */

const KIND_WORD: Record<string, string> = {
  person: 'with you in it',
  product: 'of the product',
  detail: 'close-up',
  scene: 'of the place',
};

export function ImpactModal({
  impact,
  runId,
  onClose,
  onNote,
}: {
  impact: Impact & { seconds: number; label: string };
  runId: string;
  onClose: () => void;
  onNote: (msg: string) => void;
}) {
  const { user } = useUser();
  const [busy, setBusy] = useState(false);
  /* The definite ones start ticked; the maybes do not. Whether a shot with the
     person in it was holding the old product is not knowable from here, and
     pre-ticking it would spend the user's money on a guess. */
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set(impact.shots.filter((s) => s.certain).map((s) => s.id)),
  );
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const certain = impact.shots.filter((s) => s.certain);
  const possible = impact.shots.filter((s) => !s.certain);
  const count = picked.size;
  const seconds = count * 26;
  const time = seconds < 60 ? 'under a minute' : `about ${Math.round(seconds / 60)} minute${seconds >= 90 ? 's' : ''}`;

  async function go() {
    if (!user || !count) return;
    setBusy(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/runs/${runId}/look`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'regenerate', nodeIds: [...picked] }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'could not start');
      onNote(`Remaking ${json.rebuilding} shot${json.rebuilding === 1 ? '' : 's'} — ${json.label}.`);
      onClose();
    } catch (e) {
      onNote(e instanceof Error ? e.message : 'could not regenerate');
      setBusy(false);
    }
  }

  const Row = ({ s }: { s: Impact['shots'][number] }) => (
    <label
      className={`flex cursor-pointer gap-2.5 rounded-lg border p-2.5 ${
        picked.has(s.id) ? 'border-accent bg-accent-soft' : 'border-line'
      }`}
    >
      <input
        type="checkbox"
        checked={picked.has(s.id)}
        /*
         * Read `checked` NOW, not inside the updater.
         *
         * The updater runs when React flushes, which is after the handler
         * returns — so `e.target.checked` read in there is the checkbox's state
         * at flush time, not at click time. Tick three boxes faster than React
         * batches and the later updaters all read whatever the DOM has settled
         * on, and picks go missing. Caught by a test that ticked five in a loop
         * and got two.
         */
        onChange={(e) => {
          const on = e.target.checked;
          setPicked((p) => {
            const n = new Set(p);
            if (on) n.add(s.id);
            else n.delete(s.id);
            return n;
          });
        }}
        className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[var(--accent)]"
      />
      <span className="min-w-0">
        <span className="block text-[13px] font-semibold">
          <span className="tnum text-ink-3">{s.stepNo}</span> {s.label ?? 'Untitled shot'}
          <span className="ml-1.5 font-medium text-ink-4">— {KIND_WORD[s.shot] ?? s.shot}</span>
        </span>
        <span className="mt-0.5 block text-[11.5px] leading-snug text-ink-3">{s.because}</span>
      </span>
    </label>
  );

  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/40 p-5"
      onClick={() => !busy && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="What this change affects"
        onClick={(e) => e.stopPropagation()}
        className="rs-enter flex max-h-full w-full max-w-[520px] flex-col overflow-hidden rounded-card border border-line bg-panel shadow-[0_24px_60px_-20px_rgba(0,0,0,0.5)]"
      >
        <div className="shrink-0 border-b border-line px-5 py-4">
          <p className="text-[10.5px] font-bold tracking-[0.12em] text-ink-3">THE SHOOT CHANGED</p>
          <p className="mt-1.5 text-[14px] font-semibold leading-snug">{impact.summary}</p>
          {impact.untouched > 0 && (
            <p className="mt-1 text-[12px] text-ink-3">
              {impact.untouched} shot{impact.untouched === 1 ? '' : 's'} unaffected — nothing to pay for there.
            </p>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {certain.length > 0 && (
            <>
              <p className="text-[11px] font-bold tracking-[0.1em] text-ink-3">NO LONGER MATCHES</p>
              <div className="mt-2 flex flex-col gap-1.5">
                {certain.map((s) => (
                  <Row key={s.id} s={s} />
                ))}
              </div>
            </>
          )}

          {possible.length > 0 && (
            <>
              <p className="mt-4 text-[11px] font-bold tracking-[0.1em] text-ink-3">MIGHT — YOUR CALL</p>
              <p className="mt-1 text-[12px] leading-snug text-ink-3">
                These have you in them. Whether they show the old product is something only you can see.
              </p>
              <div className="mt-2 flex flex-col gap-1.5">
                {possible.map((s) => (
                  <Row key={s.id} s={s} />
                ))}
              </div>
            </>
          )}
        </div>

        <div className="shrink-0 border-t border-line px-5 py-3.5">
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy || !count}
              onClick={() => void go()}
              className="flex-1 rounded-lg bg-accent-strong py-2.5 text-[13px] font-semibold text-white disabled:opacity-40"
            >
              {busy
                ? 'Starting…'
                : count === 0
                  ? 'Nothing selected'
                  : `Remake ${count} shot${count === 1 ? '' : 's'} · ${time}`}
            </button>
            <button
              ref={closeRef}
              type="button"
              disabled={busy}
              onClick={onClose}
              className="rounded-lg border border-line-strong px-3.5 py-2.5 text-[13px] font-semibold text-ink-2 disabled:opacity-40"
            >
              Not now
            </button>
          </div>
          {/* The out-of-date shots stay on the canvas either way, so "not now"
              is a real option rather than a way to lose the change. */}
          <p className="mt-2 text-[11.5px] leading-snug text-ink-4">
            Leaving them is fine — they stay on the canvas marked as out of date, and you can remake them any
            time. The sequence will not render until they match.
          </p>
        </div>
      </div>
    </div>
  );
}
