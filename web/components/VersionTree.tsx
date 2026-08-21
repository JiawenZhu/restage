'use client';

import { useMemo } from 'react';
import type { Aspect, LaidOutNode, TreeNode } from '@/lib/types';
import { flatten, layoutTree } from '@/lib/types';

/*
 * The hero component. Nodes are the images themselves, not boxes with labels —
 * that is the entire reason the tree works as a device: the viewer watches the
 * frame change as their eye travels left to right.
 *
 * Three things carry the agent's autonomy and none of them may be subtle:
 *   1. an animated ring on the node being generated — "the machine is here now"
 *   2. verdict badges on the edges, where self-correction becomes visible
 *   3. discarded attempts left on the canvas beside the retry that replaced them
 *
 * Hiding a failure would make the tree tidier and would delete the proof.
 */

const NODE_W = { '9:16': 108, '16:9': 176 } as const;
const NODE_H = { '9:16': 192, '16:9': 99 } as const;
const GAP_X = 76;
const GAP_Y = 34;

const STATUS_RING: Record<string, string> = {
  generating: 'border-accent',
  achieved: 'border-good',
  partial: 'border-warn',
  failed: 'border-crit',
  rejected: 'border-line-strong',
  pending: 'border-line',
};

export function VersionTree({
  nodes,
  aspect,
  selectedId,
  onSelect,
}: {
  nodes: TreeNode[];
  aspect: Aspect;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
}) {
  const w = NODE_W[aspect];
  const h = NODE_H[aspect];

  const laid = useMemo(() => flatten(layoutTree(nodes)), [nodes]);

  const pos = useMemo(() => {
    const m = new Map<string, { x: number; y: number; w: number; h: number }>();
    for (const n of laid) {
      // A discarded attempt is drawn small and stubbed above its parent rather
      // than taking a lane, so the main line stays a straight read.
      const small = n.discarded;
      const nw = small ? Math.round(w * 0.66) : w;
      const nh = small ? Math.round(h * 0.66) : h;
      const x = 24 + n.depth * (w + GAP_X);
      const y = small ? 8 : 132 + n.lane * (h + GAP_Y);
      // Offset right of the sibling it was replaced by, so the two edges out of
      // the shared parent do not overlap and neither do their labels.
      m.set(n.id, { x: small ? x + Math.round(w * 0.55) : x, y, w: nw, h: nh });
    }
    return m;
  }, [laid, w, h]);

  const extent = useMemo(() => {
    let mx = 0;
    let my = 0;
    for (const p of pos.values()) {
      mx = Math.max(mx, p.x + p.w);
      my = Math.max(my, p.y + p.h);
    }
    return { w: mx + 140, h: my + 90 };
  }, [pos]);

  return (
    <div
      className="relative h-full w-full overflow-auto"
      style={{
        backgroundImage: 'radial-gradient(var(--border-subtle) 1px, transparent 1px)',
        backgroundSize: '26px 26px',
      }}
    >
      <div className="relative" style={{ width: extent.w, height: extent.h }}>
        {/* edges under the nodes */}
        <svg className="pointer-events-none absolute inset-0" width={extent.w} height={extent.h} aria-hidden>
          {laid.map((n) => {
            if (!n.parentId) return null;
            const a = pos.get(n.parentId);
            const b = pos.get(n.id);
            if (!a || !b) return null;

            const x1 = a.x + a.w;
            const y1 = a.y + a.h / 2;
            const x2 = b.x;
            const y2 = b.y + b.h / 2;
            const mid = (x1 + x2) / 2;
            // Curves, not right angles — the tree should read as growth.
            const d = `M${x1} ${y1} C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`;

            return (
              <path
                key={`e-${n.id}`}
                d={d}
                fill="none"
                strokeWidth={2}
                stroke={n.discarded ? 'var(--crit)' : 'var(--border-strong)'}
                strokeDasharray={n.discarded ? '5 4' : undefined}
                opacity={n.discarded ? 0.55 : 1}
              />
            );
          })}
        </svg>

        {/* verdict badges at edge midpoints — where self-correction shows */}
        {laid.map((n) => {
          if (!n.parentId || !n.verdict || n.discarded) return null;
          const a = pos.get(n.parentId);
          const b = pos.get(n.id);
          if (!a || !b) return null;
          const x = (a.x + a.w + b.x) / 2;
          const y = (a.y + a.h / 2 + b.y + b.h / 2) / 2;
          return <VerdictBadge key={`v-${n.id}`} verdict={n.verdict} x={x} y={y} />;
        })}

        {/* nodes */}
        {laid.map((n) => {
          const p = pos.get(n.id)!;
          const selected = selectedId === n.id;
          return (
            <button
              key={n.id}
              type="button"
              onClick={() => onSelect?.(n.id)}
              aria-label={`${n.kind === 'avatar' ? 'Source avatar' : `Step ${n.stepNo}`}${n.instruction ? `: ${n.instruction}` : ''}`}
              aria-pressed={selected}
              className="absolute"
              style={{ left: p.x, top: p.y, width: p.w, height: p.h }}
            >
              {selected && <span className="pointer-events-none absolute -inset-[7px] rounded-[14px] border-2 border-ink" />}
              {n.status === 'generating' && (
                <span className="rs-cursor pointer-events-none absolute -inset-[9px] rounded-[14px] border-2 border-accent" />
              )}

              <span
                className={`relative block h-full w-full overflow-hidden rounded-node border-2 bg-elevated ${STATUS_RING[n.status] ?? 'border-line'} ${
                  n.status === 'rejected' ? 'opacity-35 saturate-[0.15]' : ''
                } ${n.discarded ? 'opacity-50 saturate-[0.3]' : ''} ${selected ? 'shadow-[0_10px_30px_-10px_rgba(0,0,0,0.45)]' : ''}`}
              >
                {n.frameUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={n.frameUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-[10px] text-ink-4">no frame</span>
                )}

                {n.status === 'generating' && (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/45">
                    <span className="flex items-center gap-1.5 rounded-chip bg-black/70 px-2.5 py-1.5 text-[9px] font-bold tracking-[0.05em] text-accent">
                      <span className="rs-cursor block h-[5px] w-[5px] rounded-full bg-accent" />
                      GENERATING
                    </span>
                  </span>
                )}

                {n.kind === 'avatar' && (
                  <span className="absolute left-1.5 top-1.5 rounded bg-black/65 px-1.5 py-0.5 text-[8.5px] font-bold tracking-[0.08em] text-white">
                    AVATAR
                  </span>
                )}
              </span>

              {/* Status is never colour alone — every node that carries one also
                  says it in words. */}
              {n.discarded && (
                <span className="absolute -top-4 left-0 whitespace-nowrap text-[10.5px] font-semibold text-crit">
                  discarded
                </span>
              )}
              {n.status === 'rejected' && (
                <span className="absolute -bottom-5 left-0 whitespace-nowrap text-[10.5px] font-semibold text-ink-3">
                  you rejected this
                </span>
              )}
              {!n.discarded && n.status !== 'rejected' && n.kind !== 'avatar' && (
                <span className="absolute bottom-1.5 left-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[9px] font-semibold text-white">
                  <span className="tnum">{n.stepNo}</span>
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function VerdictBadge({ verdict, x, y }: { verdict: 'met' | 'partial' | 'failed'; x: number; y: number }) {
  const style = {
    met: { cls: 'bg-good-soft text-good border-good/45', label: 'MET' },
    partial: { cls: 'bg-warn-soft text-warn border-warn/45', label: 'RETRIED' },
    failed: { cls: 'bg-crit-soft text-crit border-crit/45', label: 'DISCARDED' },
  }[verdict];

  return (
    <span
      className={`pointer-events-none absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-chip border px-2 py-[3px] text-[9px] font-bold tracking-[0.04em] ${style.cls}`}
      style={{ left: x, top: y }}
    >
      {style.label}
    </span>
  );
}
