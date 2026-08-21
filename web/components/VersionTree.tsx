'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Aspect, TreeNode } from '@/lib/types';
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
 * Nodes are draggable. The auto-layout is a starting arrangement, not an
 * artefact — this is a whiteboard, and rearranging it is how people think on
 * one. Dragged positions are the viewer's, so they live in localStorage rather
 * than Firestore: layout preference is not run data, and the nodes collection
 * is server-write-only on purpose.
 */

const NODE_W = { '9:16': 108, '16:9': 176 } as const;
const NODE_H = { '9:16': 192, '16:9': 99 } as const;
const GAP_X = 76;
const GAP_Y = 34;
const DRAG_THRESHOLD = 4;

const STATUS_RING: Record<string, string> = {
  generating: 'border-accent',
  achieved: 'border-good',
  partial: 'border-warn',
  failed: 'border-crit',
  rejected: 'border-line-strong',
  pending: 'border-line',
};

const STATUS_WORD: Record<string, string> = {
  generating: 'generating',
  achieved: 'achieved',
  partial: 'partial',
  failed: 'discarded',
  rejected: 'rejected by you',
  pending: 'pending',
};

type Offsets = Record<string, { x: number; y: number }>;

export function VersionTree({
  nodes,
  aspect,
  selectedId,
  onSelect,
  storageKey,
}: {
  nodes: TreeNode[];
  aspect: Aspect;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  storageKey?: string;
}) {
  const w = NODE_W[aspect];
  const h = NODE_H[aspect];

  const [offsets, setOffsets] = useState<Offsets>({});
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const suppressClick = useRef(false);

  // Load saved positions once per run. localStorage throws in some privacy
  // modes; losing a layout preference is not worth losing the page.
  useEffect(() => {
    if (!storageKey) return;
    try {
      const raw = localStorage.getItem(`rs-tree-${storageKey}`);
      if (raw) setOffsets(JSON.parse(raw));
    } catch {
      /* keep defaults */
    }
  }, [storageKey]);

  const persist = (next: Offsets) => {
    if (!storageKey) return;
    try {
      localStorage.setItem(`rs-tree-${storageKey}`, JSON.stringify(next));
    } catch {
      /* session-only is fine */
    }
  };

  const laid = useMemo(() => flatten(layoutTree(nodes)), [nodes]);

  const pos = useMemo(() => {
    const m = new Map<string, { x: number; y: number; w: number; h: number }>();
    for (const n of laid) {
      const small = n.discarded;
      const nw = small ? Math.round(w * 0.66) : w;
      const nh = small ? Math.round(h * 0.66) : h;
      const baseX = 24 + n.depth * (w + GAP_X);
      const baseY = small ? 8 : 132 + n.lane * (h + GAP_Y);
      const off = offsets[n.id] ?? { x: 0, y: 0 };
      m.set(n.id, {
        x: (small ? baseX + Math.round(w * 0.55) : baseX) + off.x,
        y: baseY + off.y,
        w: nw,
        h: nh,
      });
    }
    return m;
  }, [laid, w, h, offsets]);

  const extent = useMemo(() => {
    let mx = 0;
    let my = 0;
    for (const p of pos.values()) {
      mx = Math.max(mx, p.x + p.w);
      my = Math.max(my, p.y + p.h);
    }
    return { w: mx + 300, h: my + 120 };
  }, [pos]);

  function startDrag(e: React.PointerEvent, id: string) {
    // Primary button only; keyboard users still select through click.
    if (e.button !== 0) return;
    e.preventDefault();

    const startX = e.clientX;
    const startY = e.clientY;
    const base = offsets[id] ?? { x: 0, y: 0 };
    let moved = false;
    let latest = offsets;

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      if (!moved) {
        moved = true;
        setDragging(true);
        setHoveredId(null);
      }
      latest = { ...latest, [id]: { x: base.x + dx, y: base.y + dy } };
      setOffsets(latest);
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setDragging(false);
      if (moved) {
        suppressClick.current = true; // the click after a drag is not a select
        persist(latest);
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  const hovered = hoveredId ? laid.find((n) => n.id === hoveredId) : null;
  const hoveredPos = hovered ? pos.get(hovered.id) : null;
  // Flip the card left when it would run off the right edge.
  const cardLeft =
    hovered && hoveredPos
      ? hoveredPos.x + hoveredPos.w + 270 > extent.w
        ? hoveredPos.x - 260
        : hoveredPos.x + hoveredPos.w + 12
      : 0;

  return (
    <div
      className="relative h-full w-full overflow-auto"
      style={{
        backgroundImage: 'radial-gradient(var(--border-subtle) 1px, transparent 1px)',
        backgroundSize: '26px 26px',
      }}
    >
      <div className="relative" style={{ width: extent.w, height: extent.h }}>
        {/* edges under the nodes — they follow drags live, since they derive
            from the same position map */}
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

        {/* verdict badges at edge midpoints. A discarded stub carries none — the
            word under it already says so, and the badge was the collision. */}
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
              onPointerDown={(e) => startDrag(e, n.id)}
              onPointerEnter={() => !dragging && setHoveredId(n.id)}
              onPointerLeave={() => setHoveredId((cur) => (cur === n.id ? null : cur))}
              onClick={() => {
                if (suppressClick.current) {
                  suppressClick.current = false;
                  return;
                }
                onSelect?.(n.id);
              }}
              aria-label={`${n.kind === 'avatar' ? 'Source avatar' : n.kind === 'video' ? 'Rendered clip' : `Step ${n.stepNo}`}${n.instruction ? `: ${n.instruction}` : ''}`}
              aria-pressed={selected}
              className={`absolute touch-none ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
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
                  <img src={n.frameUrl} alt="" draggable={false} className="h-full w-full select-none object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-[10px] text-ink-4">no frame</span>
                )}

                {n.status === 'generating' && (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/45">
                    <span className="flex items-center gap-1.5 rounded-chip bg-black/70 px-2.5 py-1.5 text-[9px] font-bold tracking-[0.05em] text-accent">
                      <span className="rs-cursor block h-[5px] w-[5px] rounded-full bg-accent" />
                      {n.kind === 'video' ? 'RENDERING' : 'GENERATING'}
                    </span>
                  </span>
                )}

                {n.kind === 'video' && n.status !== 'generating' && (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/25">
                    <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/60">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="#fff" className="ml-0.5" aria-hidden><path d="M8 5v14l11-7z" /></svg>
                    </span>
                  </span>
                )}

                {n.kind === 'avatar' && (
                  <span className="absolute left-1.5 top-1.5 rounded bg-black/65 px-1.5 py-0.5 text-[8.5px] font-bold tracking-[0.08em] text-white">
                    AVATAR
                  </span>
                )}
              </span>

              {n.discarded && (
                <span className="absolute -top-4 left-0 whitespace-nowrap text-[10.5px] font-semibold text-crit">discarded</span>
              )}
              {n.status === 'rejected' && (
                <span className="absolute -top-4 left-0 whitespace-nowrap text-[10.5px] font-semibold text-ink-3">you rejected this</span>
              )}
              {!n.discarded && n.status !== 'rejected' && n.kind === 'frame' && (
                <span className="absolute bottom-1.5 left-1.5 flex max-w-[calc(100%-12px)] items-baseline gap-1 rounded bg-black/70 px-1.5 py-0.5 text-[9px] font-semibold text-white">
                  <span className="tnum shrink-0">{n.stepNo}</span>
                  {(n.label || n.instruction) && (
                    <span className="truncate font-medium">{n.label ?? n.instruction}</span>
                  )}
                </span>
              )}
              {n.kind === 'video' && n.status !== 'generating' && (
                <span className="absolute bottom-1.5 left-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[9px] font-semibold text-white">
                  final clip
                </span>
              )}
            </button>
          );
        })}

        {/* hover card — more than the node can carry, less than the inspector */}
        {hovered && hoveredPos && !dragging && (
          <div
            className="pointer-events-none absolute z-30 w-[248px] rounded-card border border-line bg-panel/95 p-3 shadow-[0_14px_34px_-14px_rgba(0,0,0,0.4)] backdrop-blur-sm"
            style={{ left: cardLeft, top: hoveredPos.y }}
          >
            <p className="text-[10px] font-bold tracking-[0.1em] text-ink-3">
              {hovered.kind === 'avatar' ? 'SOURCE AVATAR' : hovered.kind === 'video' ? 'RENDERED CLIP' : `STEP ${hovered.stepNo}${hovered.label ? ` — ${hovered.label}` : ''}`}
              <span className="ml-1.5 font-semibold normal-case tracking-normal text-ink-4">· {STATUS_WORD[hovered.status] ?? hovered.status}</span>
            </p>
            {hovered.instruction && (
              <p className="mt-1.5 line-clamp-2 text-[12.5px] font-medium leading-snug">{hovered.instruction}</p>
            )}
            {hovered.criticNotes && (
              <p className="mt-1.5 line-clamp-3 text-[11.5px] leading-snug text-ink-2">{hovered.criticNotes}</p>
            )}
            <p className="mt-2 border-t border-line pt-1.5 text-[10.5px] text-ink-4">Click to inspect · drag to move</p>
          </div>
        )}
      </div>
    </div>
  );
}

function VerdictBadge({ verdict, x, y }: { verdict: 'met' | 'partial' | 'failed'; x: number; y: number }) {
  /* PARTIAL says what the critic said. It used to say RETRIED, which read as a
     failure on every edge of a real run — a partial that was never retried is
     not a retry, and the discarded stub already marks the ones that were. */
  const style = {
    met: { cls: 'bg-good-soft text-good border-good/45', label: 'MET' },
    partial: { cls: 'bg-warn-soft text-warn border-warn/45', label: 'PARTIAL' },
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
