'use client';

import { useState } from 'react';
import { VersionTree } from './VersionTree';
import type { Run, TreeNode } from '@/lib/types';

/*
 * Three panes, one page. Selection lives here because the tree and the inspector
 * are two views of the same thing — hoisting it any higher would make the whole
 * route a client component for no gain.
 */
export function RunWorkspace({ run, nodes }: { run: Run; nodes: TreeNode[] }) {
  const [selectedId, setSelectedId] = useState<string | null>('n3');
  const selected = nodes.find((n) => n.id === selectedId) ?? null;

  return (
    <div className="flex min-h-0 flex-1">
      <PlanPanel run={run} />

      <section className="min-w-0 flex-1">
        <VersionTree nodes={nodes} aspect={run.aspect} selectedId={selectedId} onSelect={setSelectedId} />
      </section>

      <Inspector node={selected} />
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

      <div className="relative flex flex-1 flex-col gap-0.5 px-3.5">
        {/* hairline connector, so the steps read as a sequence not a checklist */}
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
                {/* Two lines, never truncated to nothing: the rationale is what
                    proves the agent reasoned rather than pattern-matched. */}
                <p className={`mt-0.5 text-xs leading-snug ${running ? 'text-ink-2' : s.status === 'pending' ? 'text-ink-4' : 'text-ink-3'}`}>
                  {s.rationale}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="border-t border-line px-[18px] py-3.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold tracking-[0.12em] text-ink-3">TASTE MODEL</span>
          <span className="tnum text-[11px] text-ink-4">7 sessions</span>
        </div>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {['never studio lighting', 'no retouched skin'].map((c) => (
            <span key={c} className="rounded-chip border border-line bg-elevated px-2.5 py-1 text-[11.5px] text-ink-2">
              {c}
            </span>
          ))}
        </div>
      </div>
    </aside>
  );
}

const VERDICT_STYLE = {
  met: { border: 'border-good/35', text: 'text-good', label: 'CRITIC · ACHIEVED' },
  partial: { border: 'border-warn/35', text: 'text-warn', label: 'CRITIC · PARTIAL, RETRIED ONCE' },
  failed: { border: 'border-crit/35', text: 'text-crit', label: 'CRITIC · REJECTED, RETRIED' },
} as const;

function Inspector({ node }: { node: TreeNode | null }) {
  if (!node) {
    return (
      <aside className="w-[372px] shrink-0 border-l border-line bg-panel p-[18px]">
        <p className="text-[13px] leading-relaxed text-ink-4">Select a node to see what produced it.</p>
      </aside>
    );
  }

  const v = node.verdict ? VERDICT_STYLE[node.verdict] : null;

  return (
    <aside className="flex w-[372px] shrink-0 flex-col border-l border-line bg-panel">
      <p className="px-[18px] pb-3 pt-[18px] text-[11px] font-bold tracking-[0.12em] text-ink-3">
        {node.kind === 'avatar' ? 'SOURCE AVATAR' : `STEP ${node.stepNo}`}
      </p>

      <div className="min-h-0 flex-1 overflow-y-auto px-[18px]">
        {node.frameUrl && (
          <div className="overflow-hidden rounded-card border border-line">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={node.frameUrl} alt="" className="max-h-[260px] w-full object-cover" />
          </div>
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

        {/* The critic block is the single most persuasive element in the
            interface, so it gets real presence rather than a toast. */}
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
        <button type="button" className="flex items-center justify-center gap-2 rounded-lg bg-accent py-3 text-[13.5px] font-semibold text-white">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M8 5v14l11-7z" /></svg>
          Render this frame to video
        </button>
        <div className="grid grid-cols-3 gap-1.5">
          <button type="button" className="rounded-lg border border-line-strong py-2.5 text-[12.5px] font-semibold text-ink-2">Accept</button>
          <button type="button" className="rounded-lg border border-crit/40 py-2.5 text-[12.5px] font-semibold text-crit">Reject</button>
          <button type="button" className="rounded-lg border border-line-strong py-2.5 text-[12.5px] font-semibold text-ink-2">Branch</button>
        </div>
      </div>
    </aside>
  );
}
