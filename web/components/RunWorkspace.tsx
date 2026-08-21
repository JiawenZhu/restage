'use client';

import { useState } from 'react';
import { VersionTree } from './VersionTree';
import { useUser } from './AuthGate';
import { PromptComposer } from './PromptComposer';
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

  // Until the user pins one, follow the agent: the newest node is where the work
  // is, so the inspector reads as narration rather than something to operate.
  const newest = nodes.length ? nodes[nodes.length - 1].id : null;
  const selectedId = pinned ?? newest;
  const selected = nodes.find((n) => n.id === selectedId) ?? null;

  return (
    <div className="flex min-h-0 flex-1">
      <PlanPanel run={run} />

      <section className="relative min-w-0 flex-1">
        <VersionTree
          nodes={nodes}
          aspect={run.aspect}
          selectedId={selectedId}
          onSelect={setPinned}
          onRegenerate={(id) => setRegenTarget(nodes.find((n) => n.id === id) ?? null)}
          storageKey={run.id}
        />
        {regenTarget && (
          <RegeneratePanel run={run} node={regenTarget} onClose={() => setRegenTarget(null)} />
        )}
      </section>

      <Inspector node={selected} run={run} />
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
};

function PlanPanel({ run }: { run: Run }) {
  return (
    <aside className="flex w-[300px] shrink-0 flex-col border-r border-line bg-panel">
      <p className="px-[18px] pb-3 pt-[18px] text-[11px] font-bold tracking-[0.12em] text-ink-3">PLAN</p>

      {run.status === 'planning' && (
        <div className="flex items-center gap-2.5 px-[18px] pb-3">
          <span className="rs-cursor block h-[7px] w-[7px] rounded-full bg-accent" />
          <span className="text-[13px] text-ink-2">Decomposing the goal…</span>
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

const VERDICT_STYLE = {
  met: { border: 'border-good/35', text: 'text-good', label: 'CRITIC · ACHIEVED' },
  partial: { border: 'border-warn/35', text: 'text-warn', label: 'CRITIC · PARTIAL' },
  failed: { border: 'border-crit/35', text: 'text-crit', label: 'CRITIC · REJECTED' },
} as const;

function Inspector({ node, run }: { node: TreeNode | null; run: Run }) {
  const { user } = useUser();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!node) {
    return (
      <aside className="w-[400px] shrink-0 border-l border-line bg-panel p-[18px]">
        <p className="text-[13px] leading-relaxed text-ink-4">Select a node to see what produced it.</p>
      </aside>
    );
  }

  const v = node.verdict ? VERDICT_STYLE[node.verdict] : null;
  const rendering = run.status === 'rendering';
  const canRender = node.kind === 'frame' && !!node.frameUrl && !rendering && run.status !== 'planning';

  async function renderVideo() {
    if (!user || !node) return;
    setBusy(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/runs/${run.id}/render`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ nodeId: node.id }),
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
    <aside className="flex w-[400px] shrink-0 flex-col border-l border-line bg-panel">
      <p className="px-[18px] pb-3 pt-[18px] text-[11px] font-bold tracking-[0.12em] text-ink-3">
        {node.kind === 'avatar' ? 'SOURCE AVATAR' : node.kind === 'video' ? 'RENDERED CLIP' : `STEP ${node.stepNo}`}
      </p>

      <div className="min-h-0 flex-1 overflow-y-auto px-[18px] pb-4">
        {node.kind === 'video' && node.videoUrl ? (
          <video
            src={node.videoUrl}
            poster={node.frameUrl}
            controls
            autoPlay
            loop
            muted
            playsInline
            className="w-full rounded-card border border-line bg-black"
          />
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

        {node.kind === 'video' && node.status === 'generating' && (
          <p className="mt-3 flex items-center gap-2 text-[13px] text-ink-2">
            <span className="rs-cursor block h-[6px] w-[6px] rounded-full bg-accent" />
            Rendering — about 40 seconds.
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
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2 border-t border-line px-[18px] py-3.5">
        {error && <p className="text-[12.5px] text-crit">{error}</p>}

        {node.kind === 'video' && node.videoUrl ? (
          <a
            href={node.videoUrl}
            download
            className="flex items-center justify-center gap-2 rounded-lg bg-accent py-3 text-[13.5px] font-semibold text-white"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 10l5 5 5-5" /><path d="M12 15V3" /></svg>
            Download clip
          </a>
        ) : (
          <button
            type="button"
            disabled={!canRender || busy || !user}
            onClick={renderVideo}
            title={!user ? 'Sign in first' : undefined}
            className="flex items-center justify-center gap-2 rounded-lg bg-accent py-3 text-[13.5px] font-semibold text-white disabled:opacity-40"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M8 5v14l11-7z" /></svg>
            {rendering ? 'Rendering…' : busy ? 'Starting…' : 'Render this frame to video'}
          </button>
        )}
      </div>
    </aside>
  );
}


function RegeneratePanel({ run, node, onClose }: { run: Run; node: TreeNode; onClose: () => void }) {
  const { user } = useUser();
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
    <div className="rs-enter absolute right-4 top-4 z-40 w-[420px] rounded-card border border-line bg-panel p-4 shadow-[0_22px_50px_-16px_rgba(0,0,0,0.45)]">
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

      {error && <p className="mt-2 text-[12.5px] text-crit">{error}</p>}

      <button
        type="button"
        disabled={prompt.trim().length < 4 || busy}
        onClick={go}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-accent py-2.5 text-[13.5px] font-semibold text-white disabled:opacity-40"
      >
        {busy ? 'Starting…' : 'Generate new attempt'}
      </button>
    </div>
  );
}
