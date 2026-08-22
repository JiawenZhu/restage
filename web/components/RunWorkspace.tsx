'use client';

import { useEffect, useState } from 'react';
import { VersionTree } from './VersionTree';
import { useUser } from './AuthGate';
import { PromptComposer } from './PromptComposer';
import { lineageOf, rebuildEstimate, shotPlan, type LineageNode } from '@/lib/sequence';
import { ImpactModal, ShootPanel } from './ShootPanel';
import { StoryboardPlayer } from './StoryboardPlayer';
import type { Impact } from '@/lib/impact';
import type { Run, TreeNode } from '@/lib/types';

/*
 * Three panes, one page. Selection lives here because the tree and the inspector
 * are two views of the same thing — hoisting it any higher would make the whole
 * route a client component for no gain.
 */
const EDIT_KEYWORDS = [
  'warmer light',
  'cooler light',
  'closer crop',
  'wider shot',
  'more candid',
  'hold the product higher',
  'look at the camera',
  'natural skin texture',
  'keep the exact face',
];

export function RunWorkspace({ run, nodes }: { run: Run; nodes: TreeNode[] }) {
  const [pinned, setPinned] = useState<string | null>(null);
  const [regenTarget, setRegenTarget] = useState<TreeNode | null>(null);
  /*
   * Out-of-date shots are read from the TREE, not remembered from the last
   * action.
   *
   * This used to be state set by whatever call reported staleness, which made
   * the offer to rebuild survive exactly as long as the page did. Change the
   * product, choose "not now", reload — and the frames still said "needs
   * rebuilding" while nothing anywhere offered to rebuild them, with the
   * sequence render refusing until they were fixed. A dead end reachable by
   * pressing refresh.
   *
   * Deriving it means the bar is simply true whenever the tree says it is.
   */
  const [dismissedStale, setDismissedStale] = useState('');
  /* The preview costs nothing, so it lives at the workspace level and is
     reachable whenever there is a sequence to watch. */
  const [previewing, setPreviewing] = useState(false);
  const [busySeq, setBusySeq] = useState(false);
  const [seqMsg, setSeqMsg] = useState<{ text: string; bad: boolean } | null>(null);
  /* Raised when a change to the shoot invalidates work. Held at this level, not
     inside the panel, because the modal covers the canvas rather than the
     sidebar it was triggered from. */
  const [impact, setImpact] = useState<(Impact & { seconds: number; label: string }) | null>(null);

  /*
   * Re-evaluate "has this stalled?" while the page sits open.
   *
   * isStalled() compares run.updatedAt against Date.now() AT RENDER TIME, and
   * a run whose background task has died produces no snapshot updates — so
   * nothing re-renders, the comparison is never made again, and the stall
   * banner never appears. The one state where the product most needs to speak
   * up was the one state that guaranteed its silence: you saw it only if you
   * happened to reload. A slow tick is enough, since the threshold is ten
   * minutes and the check is arithmetic on two numbers already in memory.
   */
  const [, tick] = useState(0);
  useEffect(() => {
    if (!isLive(run)) return;
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, [run.status, run.updatedAt]);
  const { user } = useUser();

  async function sequenceAction(body: Record<string, unknown>) {
    if (!user) return;
    setBusySeq(true);
    setSeqMsg(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/runs/${run.id}/sequence`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'that did not work');
      /* Deleting a frame takes the clips rendered from it too — they are
         artefacts of that one frame and mean nothing without it. Silently
         removing three things when the user asked to remove one is the kind of
         surprise that makes people stop trusting a delete button. */
      if (typeof json.deleted === 'number') {
        setSeqMsg({
          text:
            json.clips > 0
              ? `Deleted — along with ${json.clips} clip${json.clips > 1 ? 's' : ''} rendered from it.`
              : 'Deleted.',
          bad: false,
        });
      }
    } catch (e) {
      /* Shown, not logged.
         Every failure here went to console.error and nowhere else, so a refused
         delete and a successful one looked identical from the user's side: the
         menu closed, the frame stayed where it was, and nothing said why. That
         is most of what "I cannot delete images" feels like from the outside. */
      setSeqMsg({ text: e instanceof Error ? e.message : 'that did not work', bad: true });
    } finally {
      setBusySeq(false);
    }
  }

  /*
   * Until the user pins one, follow the agent — but to the newest node that has
   * something to READ, not simply the newest.
   *
   * Selecting a node that is still generating left the inspector empty for the
   * twenty seconds a frame takes, and what the user wants during that wait is
   * exactly what it was hiding: the critic's verdict on the step that just
   * finished. The generating node still carries its pulsing ring, so "the agent
   * is here now" is not lost by not selecting it.
   */
  /* The cut, in order, for the preview. Same walk the renderer uses, so what
     you watch is what would be built. */
  const previewShots = lineageOf(nodes as unknown as LineageNode[]).filter(
    (n) => n.frameUrl,
  ) as unknown as TreeNode[];

  const staleFrames = nodes.filter(
    (n) => n.kind === 'frame' && n.stale && !n.discarded && !n.removedFromSequence,
  );
  const staleKey = staleFrames.map((n) => n.id).sort().join(',');

  const readable = [...nodes]
    .reverse()
    .find((n) => n.status !== 'generating' && (n.frameUrl || n.criticNotes));
  const newest = readable?.id ?? (nodes.length ? nodes[nodes.length - 1].id : null);
  const selectedId = pinned ?? newest;
  const selected = nodes.find((n) => n.id === selectedId) ?? null;

  return (
    /* 700px of fixed side panels meant the canvas had negative width on a
       tablet and the page scrolled sideways. Below lg the three panes stack. */
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <PlanPanel run={run} onImpact={setImpact} onNote={(t) => setSeqMsg({ text: t, bad: false })} />

      <section className="relative min-h-[380px] min-w-0 flex-1">
        <VersionTree
          nodes={nodes}
          aspect={run.aspect}
          selectedId={selectedId}
          onSelect={setPinned}
          onRegenerate={(id) => setRegenTarget(nodes.find((n) => n.id === id) ?? null)}
          onSwapIn={(id) => {
            // The alternate replaces whichever frame sits at its step.
            const alt = nodes.find((n) => n.id === id);
            const target = nodes.find(
              (n) => n.id !== id && n.kind === 'frame' && n.parentId === alt?.parentId && !n.discarded,
            );
            if (alt && target) void sequenceAction({ action: 'swap', targetId: target.id, replacementId: id });
          }}
          onDisconnect={(id: string) => void sequenceAction({ action: 'disconnect', nodeId: id })}
          onReconnect={(id: string) => void sequenceAction({ action: 'reconnect', nodeId: id })}
          onDelete={(id: string) => void sequenceAction({ action: 'delete', nodeId: id })}
          storageKey={run.id}
        />

        {seqMsg && (
          <div
            className={`absolute inset-x-0 bottom-0 z-20 flex items-center justify-between gap-3 border-t px-4 py-2.5 ${
              seqMsg.bad ? 'border-crit/40 bg-crit-soft' : 'border-line bg-subtle'
            }`}
          >
            <p className={`text-[12.5px] ${seqMsg.bad ? 'text-crit-ink' : 'text-ink-2'}`}>{seqMsg.text}</p>
            <button
              type="button"
              onClick={() => setSeqMsg(null)}
              className={`shrink-0 text-[12px] font-semibold underline ${seqMsg.bad ? 'text-crit-ink' : 'text-ink-3'}`}
            >
              Dismiss
            </button>
          </div>
        )}

        {staleFrames.length > 0 && dismissedStale !== staleKey && (
          <RebuildBar
            steps={[...new Set(staleFrames.map((n) => n.stepNo))].sort((a, b) => a - b)}
            label={rebuildEstimate(staleFrames.length).label}
            busy={busySeq}
            onRebuild={() => void sequenceAction({ action: 'rebuild' })}
            /* Dismissal is keyed to WHICH shots are stale, so hiding the bar
               once does not hide it again when something new goes out of date. */
            onDismiss={() => setDismissedStale(staleKey)}
          />
        )}
        {regenTarget && (
          <RegeneratePanel run={run} node={regenTarget} onClose={() => setRegenTarget(null)} />
        )}
        {/* Watching the cut costs nothing, so it sits on the canvas rather than
            behind a node selection — it is a question about the whole ad. */}
        {previewShots.length > 1 && !previewing && (
          <button
            type="button"
            onClick={() => setPreviewing(true)}
            className="absolute right-3 top-3 z-20 flex items-center gap-1.5 rounded-lg border border-line-strong bg-panel/95 px-2.5 py-1.5 text-[12px] font-semibold text-ink-2 shadow-sm backdrop-blur-sm hover:border-accent hover:text-accent-ink"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M8 5v14l11-7z" /></svg>
            Watch it · {previewShots.length} shots
          </button>
        )}

        {previewing && (
          <StoryboardPlayer
            run={run}
            shots={previewShots}
            seconds={run.seconds ?? 8}
            onClose={() => setPreviewing(false)}
          />
        )}
        {impact && (
          <ImpactModal
            impact={impact}
            runId={run.id}
            onClose={() => setImpact(null)}
            onNote={(t) => setSeqMsg({ text: t, bad: false })}
          />
        )}
      </section>

      <Inspector
        node={selected}
        run={run}
        nodes={nodes}
        onRegenerate={(id) => setRegenTarget(nodes.find((n) => n.id === id) ?? null)}
      />
    </div>
  );
}

const STEP_GLYPH: Record<string, { cls: string; icon: React.ReactNode }> = {
  done: {
    cls: 'bg-good',
    icon: (
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--primary-ink)" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
    ),
  },
  retried: {
    cls: 'bg-warn',
    icon: (
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--primary-ink)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M1 4v6h6" /><path d="M3.5 15a9 9 0 1 0 2.1-9.4L1 10" /></svg>
    ),
  },
  // A step that produced nothing usable. It used to be reported as 'retried',
  // which claimed a second attempt had landed when the run had moved on without
  // one.
  abandoned: {
    cls: 'bg-crit',
    icon: (
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--primary-ink)" strokeWidth="3.2" strokeLinecap="round" aria-hidden><path d="M18 6L6 18M6 6l12 12" /></svg>
    ),
  },
};

/*
 * A run whose detached background task dies — the process restarts, the request
 * is torn down — keeps whatever status it had, forever. The workspace then
 * pulses "Decomposing the goal…" at somebody indefinitely with nothing to click
 * and nothing to explain it.
 *
 * touch() stamps updatedAt on every write, so silence is measurable without any
 * new infrastructure. Ten minutes is comfortably longer than the slowest step
 * observed (a frame plus two judges, about 40s) and short enough to notice.
 */
const STALL_AFTER_MS = 10 * 60 * 1000;

/** The states in which the agent still has work to do. */
function isLive(run: Run): boolean {
  return run.status === 'planning' || run.status === 'running' || run.status === 'rendering';
}

function isStalled(run: Run): boolean {
  return isLive(run) && Date.now() - (run.updatedAt || run.createdAt || 0) > STALL_AFTER_MS;
}

function PlanPanel({
  run,
  onImpact,
  onNote,
}: {
  run: Run;
  onImpact: (i: Impact & { seconds: number; label: string }) => void;
  onNote: (msg: string) => void;
}) {
  const stalled = isStalled(run);
  const live = isLive(run);
  return (
    <aside className="flex w-full shrink-0 flex-col border-b border-line bg-panel lg:max-h-none lg:w-[300px] lg:border-b-0 lg:border-r">
      <div className="flex items-baseline justify-between px-[18px] pb-3 pt-[18px]">
        <p className="text-[11px] font-bold tracking-[0.12em] text-ink-3">PLAN</p>
        {live && !stalled && <Remaining run={run} />}
      </div>

      {run.status === 'planning' && !stalled && (
        <div className="flex items-center gap-2.5 px-[18px] pb-3">
          <span className="rs-cursor block h-[7px] w-[7px] rounded-full bg-accent" />
          <span className="text-[13px] text-ink-2">Decomposing the goal…</span>
        </div>
      )}

      {stalled && (
        <div className="rs-tint-warn mx-3.5 mb-3 rounded-card border border-warn/40 p-3">
          <p className="text-[11px] font-bold tracking-[0.1em] text-warn-ink">NO PROGRESS</p>
          <p className="mt-1.5 text-[12.5px] leading-snug text-ink-2">
            Nothing has changed here for over ten minutes, so this run has most likely stopped. The frames it did
            produce are on the canvas and can still be rendered.
          </p>
        </div>
      )}

      {/* A failed run used to render as an empty plan, forever — the same screen
          as a slow one. */}
      {run.status === 'failed' && (
        <div className="mx-3.5 mb-3 rounded-card border border-crit/40 rs-tint-crit p-3">
          <p className="text-[11px] font-bold tracking-[0.1em] text-crit-ink">RUN STOPPED</p>
          <p className="mt-1.5 text-[12.5px] leading-snug text-ink-2">
            {run.failureReason || 'Something went wrong and the run could not continue.'}
          </p>
        </div>
      )}

      {/* The shoot every shot belongs to, and the one place it can be changed.
          Above the line and below the plan because it is the thing the plan was
          executed against. */}
      <ShootPanel run={run} onImpact={onImpact} onNote={onNote} />

      {/* What the person is going to say. It was generated on every run and
          shown on none of them — the user's own face delivering a line they
          never read. */}
      {run.audioScript && (
        <div className="mx-3.5 mb-3 rounded-card border border-line bg-elevated p-3">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-bold tracking-[0.1em] text-ink-3">THE LINE</p>
            {run.audioUrl && (
              <audio src={run.audioUrl} controls className="h-6 w-[130px]" preload="none" />
            )}
          </div>
          <p className="mt-1.5 text-[12.5px] leading-snug text-ink-2">“{run.audioScript}”</p>
        </div>
      )}

      <div className="relative flex flex-1 flex-col gap-0.5 overflow-y-auto px-3.5 pb-3">
        <span className="absolute bottom-3.5 left-[27px] top-3.5 w-px bg-line" />

        {run.plan.map((s) => {
          const glyph = STEP_GLYPH[s.status];
          const running = s.status === 'running';
          return (
            <div key={s.stepNo} className={`relative flex gap-2.5 rounded-lg p-2.5 ${running ? 'bg-accent-soft' : ''}`}>
              {running && <span className="absolute bottom-1.5 left-0 top-1.5 w-0.5 rounded bg-accent" />}
              <span
                className={`z-10 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                  glyph ? glyph.cls : running ? 'rs-cursor border-2 border-accent bg-panel' : 'border border-line-strong bg-panel'
                }`}
              >
                {glyph?.icon}
              </span>
              <div className="min-w-0">
                {/* What this shot is OF, when it is not the person.
                    The plan is the first place the mix is visible, and the mix
                    is the thing that decides whether this comes out as an ad or
                    as six photographs of one face. */}
                {s.shot && s.shot !== 'person' && (
                  <span className="mb-1 inline-block rounded bg-subtle px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.09em] text-ink-3">
                    {s.shot}
                  </span>
                )}
                <p className={`text-[13.5px] font-semibold ${s.status === 'pending' ? 'text-ink-3' : ''}`}>{s.instruction}</p>
                {/* Never truncated to nothing: the rationale is what proves the
                    agent reasoned rather than pattern-matched. */}
                <p className={`mt-0.5 text-xs leading-snug ${running ? 'text-ink-2' : s.status === 'pending' ? 'text-ink-4' : 'text-ink-3'}`}>
                  {s.rationale}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

/*
 * How much longer.
 *
 * A run measured 220 and 264 seconds across two real executions, and the screen
 * said only "step 4 is generating" — leaving somebody to guess whether they had
 * twenty seconds left or four minutes. Waiting is fine; not knowing how long is
 * what makes people leave.
 *
 * The estimate comes from the run's OWN pace, not a constant: elapsed time
 * divided by steps finished, applied to steps remaining. That way a slow run
 * says so instead of insisting on an average it is not meeting. Before the
 * first step lands there is nothing to divide, so it says the honest thing.
 */
function Remaining({ run }: { run: Run }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, []);

  const total = run.plan.length;
  const done = run.plan.filter((s) => s.status === 'done' || s.status === 'retried' || s.status === 'abandoned').length;

  if (run.status === 'rendering') {
    return <span className="tnum text-[11px] text-ink-3">rendering · about a minute</span>;
  }
  if (!total || done === 0) {
    return <span className="tnum text-[11px] text-ink-3">a few minutes</span>;
  }

  const elapsed = Date.now() - (run.createdAt || Date.now());
  const perStep = elapsed / done;
  const left = Math.max(0, Math.round((perStep * (total - done)) / 1000));
  const label = left < 45 ? 'under a minute' : `about ${Math.ceil(left / 60)} min`;

  return (
    <span className="tnum text-[11px] text-ink-3">
      {done}/{total} · {label} left
    </span>
  );
}

const VERDICT_STYLE = {
  met: { border: 'border-good/35', text: 'text-good-ink', label: 'CRITIC · ACHIEVED' },
  partial: { border: 'border-warn/35', text: 'text-warn-ink', label: 'CRITIC · PARTIAL' },
  failed: { border: 'border-crit/35', text: 'text-crit-ink', label: 'CRITIC · REJECTED' },
} as const;

function Inspector({
  node,
  run,
  nodes,
  onRegenerate,
}: {
  node: TreeNode | null;
  run: Run;
  nodes: TreeNode[];
  onRegenerate?: (id: string) => void;
}) {
  const { user } = useUser();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * The clip's stored URL is an API path that requires a bearer token, and a
   * browser never sends one on a media request — it sends cookies. Handing it
   * straight to <video src> produced a black player and a download link that
   * navigated to a 401 JSON page. So the token is used here, once, to exchange
   * it for a short-lived R2 URL the element can actually load.
   */
  /* Defaults to the length chosen on /studio before the run. The right length
     is only really knowable once the frames exist, so it can be changed here —
     but the earlier choice is the starting point, not a constant. */
  const [lengthChoice, setLengthChoice] = useState<4 | 8 | 16 | 24 | 32>(
    ([4, 8, 16, 24, 32] as const).includes(run.seconds as 4) ? (run.seconds as 4) : 8,
  );
  const [playable, setPlayable] = useState<{ nodeId: string; url: string } | null>(null);
  const [clipError, setClipError] = useState<string | null>(null);
  /*
   * Above the early return, with every other hook.
   *
   * This was declared further down, past `if (!node) return …`. Hooks must run
   * in the same order on every render, and that ordering made the count depend
   * on whether anything was selected: an Inspector with no node ran five hooks,
   * and the render immediately after a node appeared ran six. React throws
   * "rendered more hooks than during the previous render" and takes the
   * workspace down with it.
   *
   * That is not an edge case, it is the opening seconds of every run — the tree
   * is empty until the first node arrives over the snapshot listener, so the
   * transition it crashes on is the one that happens every single time.
   */
  const [engineChoice, setEngineChoice] = useState<'veo' | 'omni'>((run.videoEngine as 'veo' | 'omni') || 'veo');
  const videoNodeId = node?.kind === 'video' && node.status === 'achieved' ? node.id : null;

  useEffect(() => {
    if (!videoNodeId || !user) return;
    if (playable?.nodeId === videoNodeId) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await user.getIdToken();
        const res = await fetch(`/api/runs/${run.id}/video?nodeId=${videoNodeId}`, {
          headers: { authorization: `Bearer ${token}` },
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? 'could not load the clip');
        if (!cancelled) {
          setPlayable({ nodeId: videoNodeId, url: json.url });
          setClipError(null);
        }
      } catch (e) {
        if (!cancelled) setClipError(e instanceof Error ? e.message : 'could not load the clip');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [videoNodeId, user, run.id, playable?.nodeId]);

  async function judge(status: 'rejected' | 'achieved') {
    if (!user || !node) return;
    setBusy(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/runs/${run.id}/nodes/${node.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'could not save that');
      // The change arrives back through the live subscription.
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not save that');
    } finally {
      setBusy(false);
    }
  }

  async function downloadClip() {
    if (!user || !videoNodeId) return;
    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/runs/${run.id}/video?nodeId=${videoNodeId}&download=1`, {
        headers: { authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'could not prepare the download');
      window.location.href = json.url;
    } catch (e) {
      setClipError(e instanceof Error ? e.message : 'could not prepare the download');
    }
  }

  if (!node) {
    return (
      <aside className="w-full shrink-0 border-t border-line bg-panel p-[18px] lg:w-[400px] lg:border-l lg:border-t-0">
        <p className="text-[13px] leading-relaxed text-ink-4">Select a node to see what produced it.</p>
      </aside>
    );
  }

  const v = node.verdict ? VERDICT_STYLE[node.verdict] : null;
  /* A run stuck in 'rendering' has a dead background task — the stall banner
     says its frames "can still be rendered", so the controls that would do that
     must not stay disabled and labelled "Rendering…". */
  const rendering = run.status === 'rendering' && !isStalled(run);
  // Rendering the same frame twice buys a second clip for nothing, so a frame
  // that already has a video child says so instead of offering again.
  /*
   * A FAILED render is not a clip.
   *
   * This matched any video child regardless of status, and the failure path
   * leaves the node in place with its parentId intact — so one Veo error, one
   * unreachable R2, or one poll timeout disabled the Render button forever, on
   * the exact frame the user had approved, behind the words "Already rendered
   * — the clip is on the tree" when no clip existed. The only escape was paying
   * to regenerate a frame that was already good.
   */
  const failedRender = nodes.some((n) => n.kind === 'video' && n.parentId === node?.id && n.status === 'failed');
  const alreadyRendered = nodes.some(
    (n) => n.kind === 'video' && n.parentId === node?.id && n.status !== 'failed',
  );

  /* The same walk the renderer runs, not a second guess at it. This was a flat
     filter plus a has-children test, which is not a walk: on an edited tree it
     counted shots the server would not render, so the button promised one ad
     and the queue built another. */
  const sequence = lineageOf(nodes as unknown as LineageNode[]).filter((n) => n.frameUrl);
  const sequenceLength = sequence.length;
  const staleInSequence = sequence.some((n) => n.stale);
  /* shotPlan, not a second copy of its arithmetic. It also reports whether the
     chosen length actually survives the division, which the hand-rolled version
     could not and so never mentioned. */
  const plan = shotPlan(lengthChoice, sequenceLength);
  const perShot = plan.perShot;
  /*
   * Rendering again is allowed.
   *
   * This also demanded !alreadyRendered, which quietly made the first render the
   * only one: the moment a frame had a clip hanging off it, the render button,
   * the whole-sequence panel and the engine picker all disappeared from that
   * frame for good. On a finished run every frame in the chain has a clip, so
   * there was no way to re-render at a different length, and no way to try the
   * other engine at all — the picker existed on nodes that could never use it.
   * Each render writes its own video node, so re-rendering overwrites nothing.
   */
  const canRender = node.kind === 'frame' && !!node.frameUrl && !rendering && run.status !== 'planning';


  async function renderVideo(mode: 'frame' | 'sequence' = 'frame') {
    if (!user || !node) return;
    setBusy(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/runs/${run.id}/render`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(
          mode === 'sequence'
            ? { mode: 'sequence', seconds: lengthChoice, engine: engineChoice }
            : { mode: 'frame', nodeId: node.id, seconds: lengthChoice, engine: engineChoice },
        ),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'render failed to start');
      // The new video node lands via the live subscription; nothing else to do.
    } catch (e) {
      setError(e instanceof Error ? e.message : 'render failed to start');
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="flex w-full shrink-0 flex-col border-t border-line bg-panel lg:w-[400px] lg:border-l lg:border-t-0">
      <p className="px-[18px] pb-3 pt-[18px] text-[11px] font-bold tracking-[0.12em] text-ink-3">
        {node.kind === 'avatar' ? 'SOURCE AVATAR' : node.kind === 'video' ? 'RENDERED CLIP' : `STEP ${node.stepNo}`}
      </p>

      <div className="min-h-0 flex-1 overflow-y-auto px-[18px] pb-4">
        {node.kind === 'video' && node.status === 'failed' ? (
          /* A failed render used to render as a finished clip: the poster frame
             with a play badge, labelled "RENDERED CLIP", while the reason sat
             unread in criticNotes. */
          <div className="rounded-card border border-crit/40 rs-tint-crit p-3.5">
            <p className="text-[11px] font-bold tracking-[0.08em] text-crit-ink">RENDER FAILED</p>
            <p className="mt-2 text-[13px] leading-relaxed">
              {node.criticNotes || 'The clip could not be rendered.'}
            </p>
          </div>
        ) : node.kind === 'video' && node.status === 'achieved' ? (
          playable?.nodeId === node.id ? (
            <video
              src={playable.url}
              poster={node.frameUrl}
              controls
              autoPlay
              loop
              muted
              playsInline
              className="w-full rounded-card border border-line bg-black"
            />
          ) : (
            <div className="flex h-40 items-center justify-center rounded-card border border-line bg-subtle">
              <span className="text-[12px] text-ink-3">{clipError ?? 'Loading the clip…'}</span>
            </div>
          )
        ) : node.frameUrl ? (
          /* object-contain, never object-cover: a 9:16 frame in a smaller box
             was being cropped, and the crop took the face — the one thing the
             whole product is about showing. Contain shows the entire frame. */
          <div className="flex items-center justify-center overflow-hidden rounded-card border border-line bg-subtle">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={node.frameUrl} alt="" className="max-h-[440px] w-auto max-w-full object-contain" />
          </div>
        ) : (
          <div className="flex h-40 items-center justify-center rounded-card border border-line bg-subtle">
            <span className="flex items-center gap-2 text-[12px] text-ink-3">
              <span className="rs-cursor block h-[6px] w-[6px] rounded-full bg-accent" />
              generating…
            </span>
          </div>
        )}

        {node.kind === 'video' && node.status === 'achieved' && node.captioned && (
          <p className="mt-3 flex items-center gap-2 text-[12.5px] text-ink-3">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <rect x="2" y="5" width="20" height="14" rx="2" /><path d="M6 12h5M14 12h4M6 15h9" />
            </svg>
            Captions burned in — social video is watched on mute.
          </p>
        )}

        {/*
          Anything true about this clip that the user did not get.

          Both of these were already being written onto the node and neither was
          ever rendered — the render route takes care to record why a voiceover
          was dropped, and that sentence went into Firestore and stopped there.
          A clip that quietly lacks the line the workspace showed you, or that
          came back four seconds shorter than you asked, has to say so on the
          clip itself.
        */}
        {node.kind === 'video' && node.status === 'achieved' && (node.audioNote || node.engineNote) && (
          <div className="mt-3 flex flex-col gap-1.5">
            {[node.audioNote, node.engineNote].filter(Boolean).map((note) => (
              <p key={note} className="flex gap-2 text-[12.5px] leading-snug text-warn-ink">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="mt-[2px] shrink-0" aria-hidden>
                  <circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16.5v.01" />
                </svg>
                {note}
              </p>
            ))}
          </div>
        )}

        {node.kind === 'video' && node.status === 'generating' && (
          <p className="mt-3 flex items-center gap-2 text-[13px] text-ink-2">
            <span className="rs-cursor block h-[6px] w-[6px] rounded-full bg-accent" />
            {node.engine === 'omni' ? 'Rendering — about 20 seconds.' : 'Rendering — about 40 seconds.'}
          </p>
        )}

        {node.instruction && (
          <>
            <p className="mt-3.5 text-[10.5px] font-bold tracking-[0.12em] text-ink-3">INSTRUCTION</p>
            <p className="mt-1 text-[13.5px] leading-snug">{node.instruction}</p>
          </>
        )}

        {node.rationale && (
          <>
            <p className="mt-3.5 text-[10.5px] font-bold tracking-[0.12em] text-ink-3">WHY</p>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{node.rationale}</p>
          </>
        )}

        {v && node.criticNotes && (
          <div className={`mt-4 rounded-card border bg-elevated p-3.5 ${v.border}`}>
            <span className={`text-[11.5px] font-bold tracking-[0.06em] ${v.text}`}>{v.label}</span>
            <p className="mt-2.5 text-[13px] leading-relaxed">{node.criticNotes}</p>
            {node.criticRubric && (
              <p className="mt-2.5 text-xs text-ink-3">
                Judged against: <span className="text-ink-2">{node.criticRubric}</span>
              </p>
            )}
            {/* What moved that nobody asked to move. This is the difference
                between "the agent retried, who knows why" and a reason — and
                on a storyboard it is usually the reason the six frames stopped
                looking like one take. */}
            {node.continuityHeld === false && node.continuityBreaks && (
              <p className="mt-2.5 border-t border-line pt-2.5 text-xs leading-relaxed text-warn-ink">
                <span className="font-semibold">Drifted from the frame before:</span>{' '}
                <span className="text-ink-2">{node.continuityBreaks}</span>
              </p>
            )}
          </div>
        )}
      </div>

      {/* shrink-0: the action bar is the point of the panel and must not be
          the thing that gets squeezed when the notes above it run long. */}
      <div className="flex shrink-0 flex-col gap-2 border-t border-line px-[18px] py-3.5">
        {(error || clipError) && <p className="text-[12.5px] text-crit-ink">{error ?? clipError}</p>}

        {/* The human verdict. The critic catches gross identity swaps but not
            subtle drift — measured on a real run where both verifiers passed a
            frame the user rejected on sight. */}
        {node.kind === 'frame' && node.frameUrl && (
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              disabled={busy || !user}
              title={!user ? 'Sign in to judge frames' : undefined}
              onClick={() => judge(node.status === 'rejected' ? 'achieved' : 'rejected')}
              className={`rounded-lg border py-2.5 text-[12.5px] font-semibold disabled:opacity-40 ${
                node.status === 'rejected'
                  ? 'border-crit bg-crit-soft text-crit-ink'
                  : 'border-line-strong text-ink-2 hover:border-crit hover:text-crit-ink'
              }`}
            >
              {node.status === 'rejected' ? 'Rejected — undo' : 'Reject this frame'}
            </button>
            <button
              type="button"
              disabled={busy || !user}
              title={!user ? 'Sign in to regenerate' : undefined}
              onClick={() => onRegenerate?.(node.id)}
              className="rounded-lg border border-line-strong py-2.5 text-[12.5px] font-semibold text-ink-2 hover:border-accent hover:text-accent-ink disabled:opacity-40"
            >
              Try again
            </button>
          </div>
        )}

        {/* The sequence is the storyboard: every frame animated in order, which
            is a multi-shot ad rather than one held moment. */}
        {node.kind === 'frame' && sequenceLength > 1 && !rendering && (
          <div className="rounded-card border border-line bg-elevated p-3">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-[11px] font-bold tracking-[0.1em] text-ink-3">THE WHOLE SEQUENCE</p>
              <span className="tnum text-[11px] text-ink-4">{sequenceLength} shots</span>
            </div>
            <p className="mt-1.5 text-[12.5px] leading-snug text-ink-2">
              Animate every frame in order — {perShot}s each, about {plan.total}s in total.
            </p>
            {/* The model will not go below 4s a shot, so enough shots push the
                total past what was asked. Said here rather than discovered in
                the finished file. */}
            {!plan.honoursRequest && (
              <p className="mt-1 text-[12px] leading-snug text-warn-ink">
                {sequenceLength} shots will not fit in {lengthChoice}s — 4s is the shortest shot the model makes.
              </p>
            )}

            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              {([8, 16, 24, 32] as const).map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setLengthChoice(n)}
                  className={`rounded-chip px-2.5 py-1 text-[12px] font-medium ${
                    lengthChoice === n ? 'bg-primary text-primary-ink' : 'border border-line-strong text-ink-2'
                  }`}
                >
                  {n}s
                </button>
              ))}
            </div>

            <button
              type="button"
              disabled={busy || !user || staleInSequence}
              onClick={() => renderVideo('sequence')}
              title={staleInSequence ? 'Rebuild the out-of-date steps first' : undefined}
              className="mt-3 w-full rounded-lg bg-accent-strong py-2.5 text-[13px] font-semibold text-white disabled:opacity-40"
            >
              {staleInSequence
                ? 'Rebuild the sequence first'
                : `Render all ${sequenceLength} shot${sequenceLength > 1 ? 's' : ''}`}
            </button>
          </div>
        )}

        {/*
          Which engine renders this frame.

          It reads its numbers off measurements of the live API rather than the
          datasheet: Omni has no duration parameter of any kind, and its
          resolution parameter is validated and then ignored — 360p and 1080p
          both come back 720x1280. The picker used to sell it as a peer of Veo
          with "native synchronized 48kHz speech & audio", which is the internal
          transport described to somebody who wants to know what they will get.

          The same control also stood on the new-run form, where it asked for a
          decision about rendering before the user had seen a single frame, and
          could then disagree with this one. It lives only here now — next to
          the button it affects.
        */}
        {node.kind === 'frame' && !rendering && (
          <div className="rounded-lg border border-line bg-subtle px-3 py-2.5">
            <p className="text-[10.5px] font-bold tracking-[0.12em] text-ink-3">ENGINE</p>
            <div className="mt-1.5 flex items-center gap-1.5">
              {(['veo', 'omni'] as const).map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => setEngineChoice(e)}
                  aria-pressed={engineChoice === e}
                  className={`rounded px-2.5 py-1 text-[11.5px] font-semibold transition-colors ${
                    engineChoice === e ? 'bg-accent text-white shadow-xs' : 'text-ink-3 hover:text-ink-2'
                  }`}
                >
                  {e === 'veo' ? 'Veo 3.1' : 'Gemini Omni'}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[11.5px] leading-snug text-ink-3">
              {engineChoice === 'veo'
                ? 'Higher resolution, and it keeps the length you set — longer clips are chained shot by shot. About 40 seconds each.'
                : 'One take of about 10 seconds at 720p, whatever length you set, with speech and sound generated together. Renders in about 20.'}
            </p>
          </div>
        )}

        {node.kind === 'video' && node.status === 'achieved' ? (
          <button
            type="button"
            onClick={downloadClip}
            className="flex items-center justify-center gap-2 rounded-lg bg-primary py-3 text-[13.5px] font-semibold text-primary-ink"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 10l5 5 5-5" /><path d="M12 15V3" /></svg>
            Download clip
          </button>
        ) : (
          <button
            type="button"
            disabled={!canRender || busy || !user}
            onClick={() => renderVideo('frame')}
            title={!user ? 'Sign in first' : undefined}
            className="flex items-center justify-center gap-2 rounded-lg bg-primary py-3 text-[13.5px] font-semibold text-primary-ink disabled:opacity-40"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M8 5v14l11-7z" /></svg>
            {rendering
              ? 'Rendering…'
              : alreadyRendered
                ? 'Render this frame again'
                : busy
                  ? 'Starting…'
                  : failedRender
                    ? 'Render failed — try again'
                    : 'Render this frame to video'}
          </button>
        )}
      </div>
    </aside>
  );
}


function RegeneratePanel({ run, node, onClose }: { run: Run; node: TreeNode; onClose: () => void }) {
  const { user } = useUser();

  // The tree's own context menu closes on Escape one layer away; a panel that
  // does not is the kind of inconsistency people feel without naming.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    if (prompt.trim().length < 4 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (user) headers.authorization = `Bearer ${await user.getIdToken()}`;
      const res = await fetch(`/api/runs/${run.id}/regenerate`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ nodeId: node.id, instruction: prompt.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'regenerate failed');
      onClose(); // the new sibling arrives on the tree via the live subscription
    } catch (e) {
      setError(e instanceof Error ? e.message : 'regenerate failed');
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label={`Regenerate step ${node.stepNo}`}
      className="rs-enter absolute inset-x-3 top-4 z-40 rounded-card border border-line bg-panel p-4 shadow-[0_22px_50px_-16px_rgba(0,0,0,0.45)] sm:inset-x-auto sm:right-4 sm:w-[420px]"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10.5px] font-bold tracking-[0.12em] text-ink-3">
            REGENERATE · STEP {node.stepNo}
            {node.label ? ` — ${node.label.toUpperCase()}` : ''}
          </p>
          <p className="mt-1 text-[12.5px] leading-snug text-ink-2">
            A new attempt from the same base frame. The old one stays on the tree — nothing is overwritten.
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-ink-3 hover:bg-subtle hover:text-ink">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><path d="M18 6L6 18M6 6l12 12" /></svg>
        </button>
      </div>

      <div className="mt-3">
        <PromptComposer
          purpose="edit"
          keywords={EDIT_KEYWORDS}
          placeholder="Say or type what should change — one thing at a time."
          onPrompt={(finalPrompt) => setPrompt(finalPrompt)}
        />
      </div>

      {error && <p className="mt-2 text-[12.5px] text-crit-ink">{error}</p>}

      <button
        type="button"
        disabled={prompt.trim().length < 4 || busy}
        onClick={go}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-[13.5px] font-semibold text-primary-ink disabled:opacity-40"
      >
        {busy ? 'Starting…' : 'Generate new attempt'}
      </button>
    </div>
  );
}


/*
 * What the change costs, before it is spent.
 *
 * Swapping a frame invalidates everything built on top of it, and rebuilding
 * those steps is a paid generation each. Doing it automatically would be
 * smoother and would spend somebody's money without asking, so the count and
 * the time sit in front of the button.
 */
function RebuildBar({
  steps,
  label,
  busy,
  onRebuild,
  onDismiss,
}: {
  steps: number[];
  label: string;
  busy: boolean;
  onRebuild: () => void;
  onDismiss: () => void;
}) {
  const one = steps.length === 1;
  return (
    <div className="rs-enter rs-tint-warn absolute inset-x-3 bottom-4 z-40 flex flex-wrap items-center gap-3 rounded-card border border-warn/45 p-3.5 shadow-[0_18px_40px_-18px_rgba(0,0,0,0.4)] sm:inset-x-auto sm:left-1/2 sm:w-[560px] sm:-translate-x-1/2">
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold tracking-[0.1em] text-warn-ink">
          {steps.length} SHOT{one ? '' : 'S'} OUT OF DATE
        </p>
        {/* One cause is no longer the only cause. This said "built on the frame
            you changed", which was true when every step edited the one before —
            but a shot can now be out of date because the PRODUCT or the
            LOCATION changed under it, and it never descended from anything.
            The wording says what is true either way. Singular was broken too:
            "it no longer follow from it", and a "Rebuild them" for one shot. */}
        <p className="mt-1 text-[12.5px] leading-snug text-ink-2">
          {one ? 'Step' : 'Steps'} {steps.join(', ')} no longer {one ? 'matches' : 'match'} this shoot.
          Remaking {one ? 'it' : 'them'} takes {label}.
        </p>
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={onRebuild}
        className="rounded-lg bg-primary px-3.5 py-2 text-[12.5px] font-semibold text-primary-ink disabled:opacity-50"
      >
        {busy ? 'Starting…' : one ? 'Remake it' : 'Remake them'}
      </button>
      <button
        type="button"
        onClick={onDismiss}
        className="rounded-lg border border-line-strong px-3.5 py-2 text-[12.5px] font-semibold text-ink-2"
      >
        {one ? 'Leave it' : 'Leave them'}
      </button>
    </div>
  );
}
