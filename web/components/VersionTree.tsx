'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Aspect, TreeNode } from '@/lib/types';
import { flatten, layoutTree } from '@/lib/types';
import { lineageOf, type LineageNode } from '@/lib/sequence';

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
  // For a frame, a failed verdict means the attempt was discarded. For a video
  // node it means the render itself failed — see VIDEO_STATUS_WORD.
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
  onRegenerate,
  onSwapIn,
  onDisconnect,
  onReconnect,
  onDelete,
  onReorder,
  storageKey,
}: {
  nodes: TreeNode[];
  aspect: Aspect;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  /** Opens the regenerate panel for a node. Wired by the workspace. */
  onRegenerate?: (id: string) => void;
  /** Put this frame into the sequence in place of the one it is an alternate of. */
  onSwapIn?: (id: string) => void;
  /** Detach this node — a frame or a clip — from the canvas. Reversible. */
  onDisconnect?: (id: string) => void;
  onReconnect?: (id: string) => void;
  /** Destroy it and its pixels. Only offered once it is disconnected. */
  onDelete?: (id: string) => void;
  /** Move a shot earlier or later in the cut. Costs nothing. */
  onReorder?: (id: string, direction: 'earlier' | 'later') => void;
  storageKey?: string;
}) {
  const w = NODE_W[aspect];
  const h = NODE_H[aspect];

  const [offsets, setOffsets] = useState<Offsets>({});
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const suppressClick = useRef(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  /*
   * There is no local "cut" state any more.
   *
   * Cutting an edge used to be a viewer-side arrangement kept in localStorage:
   * it hid the line and labelled the node "disconnected — right-click to
   * reconnect" while nothing whatsoever had been disconnected. The scissors was
   * the most physical control on the canvas and it was the one that did the
   * least. It performs the real detach now, and the disconnected state is read
   * from the node itself, which means it survives a reload and means something
   * to the renderer.
   */
  const [edgeHover, setEdgeHover] = useState<{ id: string; x: number; y: number } | null>(null);
  /*
   * The scissors sits ON the edge it belongs to, so moving the pointer from the
   * path to the button crosses a gap and fires pointerleave. The button
   * re-asserted the hover on enter, which fixed the gap and created a worse
   * bug: nothing ever cleared it again, so once shown the scissors followed the
   * canvas forever, over unrelated nodes. A short shared dismiss timer bridges
   * the gap without stranding anything.
   */
  const dismissEdge = useRef<number | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null);
  /* Delete asks twice, in place. A native confirm() dialog is heavier than this
     needs to be, and a second click on a button that has changed its own label
     is a clearer signal of intent than a browser modal nobody reads. */
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  /* Delete was pressed on something still connected. The button is always
     there — hiding it made "why can I not delete this" an unanswerable
     question — so this holds the explanation of why it did not fire. */
  const [blockedDelete, setBlockedDelete] = useState<string | null>(null);

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

  // The menu closes the way every menu should: Esc, or clicking anywhere else.
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menu]);

  const holdEdge = (v: { id: string; x: number; y: number } | null) => {
    if (dismissEdge.current) window.clearTimeout(dismissEdge.current);
    dismissEdge.current = null;
    setEdgeHover(v);
  };

  const releaseEdge = () => {
    if (dismissEdge.current) window.clearTimeout(dismissEdge.current);
    dismissEdge.current = window.setTimeout(() => setEdgeHover(null), 220);
  };

  useEffect(() => () => {
    if (dismissEdge.current) window.clearTimeout(dismissEdge.current);
  }, []);

  const persist = (next: Offsets) => {
    if (!storageKey) return;
    try {
      localStorage.setItem(`rs-tree-${storageKey}`, JSON.stringify(next));
    } catch {
      /* session-only is fine */
    }
  };

  const laid = useMemo(() => flatten(layoutTree(nodes)), [nodes]);

  /* Frames that something was built on top of are the sequence; the rest are
     alternates. Drawn differently, because "which of these is the actual ad"
     is the question the canvas most needs to answer. */
  /*
   * The frames actually in the cut — the same walk the renderer runs.
   *
   * This was "every id that is somebody's parent", which is a third definition
   * of the sequence living alongside the server's and the workspace's. It gets
   * the tip of the chain wrong by construction: the last frame has no children,
   * so it was never "in the sequence", and the menu therefore refused to offer
   * "Take out of the sequence" on it while offering "Use this one instead" —
   * a swap against a frame that is not an alternate of anything.
   */
  const cutOrder = useMemo(
    () => lineageOf(nodes as unknown as LineageNode[]).map((x) => x.id),
    [nodes],
  );
  const inSequence = useMemo(() => new Set(cutOrder), [cutOrder]);

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

  function openMenuFor(nodeId: string, clientX: number, clientY: number) {
    setConfirmDelete(null);
    setBlockedDelete(null);
    const r = wrapRef.current?.getBoundingClientRect();
    if (r) setMenu({ x: clientX - r.left, y: clientY - r.top, nodeId });
  }

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
    <div ref={wrapRef} className="relative h-full w-full" onClick={() => menu && setMenu(null)}>
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
            if (!n.parentId || n.removedFromSequence) return null;
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
              <g key={`e-${n.id}`}>
                <path
                  d={d}
                  fill="none"
                  strokeWidth={2}
                  stroke={edgeHover?.id === n.id ? 'var(--accent)' : n.discarded ? 'var(--crit)' : 'var(--border-strong)'}
                  strokeDasharray={n.discarded ? '5 4' : undefined}
                  opacity={n.discarded ? 0.55 : 1}
                />
                {/* invisible fat twin: the hover target an edge needs to be cuttable */}
                {!n.discarded && (
                  <path
                    d={d}
                    fill="none"
                    strokeWidth={16}
                    stroke="transparent"
                    className="pointer-events-auto"
                    onPointerEnter={() => holdEdge({ id: n.id, x: (x1 + x2) / 2, y: (y1 + y2) / 2 })}
                    onPointerLeave={releaseEdge}
                  />
                )}
              </g>
            );
          })}
        </svg>

        {/* scissors on the hovered edge */}
        {edgeHover && (
          <button
            type="button"
            aria-label="Disconnect this node"
            title="Disconnect — reversible, and the only route to deleting it"
            onPointerEnter={() => holdEdge(edgeHover)}
            onPointerLeave={releaseEdge}
            onClick={() => {
              const id = edgeHover.id;
              setEdgeHover(null);
              onDisconnect?.(id);
            }}
            className="absolute z-20 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-line-strong bg-panel text-ink-2 shadow-[0_6px_18px_-6px_rgba(0,0,0,0.35)] hover:border-crit hover:text-crit-ink"
            style={{ left: edgeHover.x, top: edgeHover.y }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" />
              <path d="M8.1 8.1 20 20M8.1 15.9 20 4" />
            </svg>
          </button>
        )}

        {/* verdict badges at edge midpoints. A discarded stub carries none — the
            word under it already says so, and the badge was the collision. */}
        {laid.map((n) => {
          if (!n.parentId || !n.verdict || n.discarded || n.removedFromSequence) return null;
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
              onContextMenu={(e) => {
                e.preventDefault();
                openMenuFor(n.id, e.clientX, e.clientY);
              }}
              /* Right-click was the ONLY way to reach Regenerate — no
                 affordance, no keyboard path, and nothing at all on touch,
                 where contextmenu does not fire. The menu key and a visible
                 button now open the same menu. */
              onKeyDown={(e) => {
                if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
                  e.preventDefault();
                  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  openMenuFor(n.id, r.right, r.top);
                }
              }}
              className={`rs-enter absolute touch-none ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
              style={{ left: p.x, top: p.y, width: p.w, height: p.h }}
            >
              {selected && <span className="pointer-events-none absolute -inset-[7px] rounded-[14px] border-2 border-ink" />}
              {n.status === 'generating' && (
                <span className="rs-cursor pointer-events-none absolute -inset-[9px] rounded-[14px] border-2 border-accent" />
              )}

              <span
                className={`relative block h-full w-full overflow-hidden rounded-node border-2 bg-elevated ${STATUS_RING[n.status] ?? 'border-line'} ${
                  n.status === 'rejected' || n.removedFromSequence ? 'opacity-35 saturate-[0.15]' : ''
                } ${n.discarded ? 'opacity-50 saturate-[0.3]' : ''} ${
                  n.stale && !n.discarded ? 'opacity-60 saturate-[0.4]' : ''
                } ${selected ? 'shadow-[0_10px_30px_-10px_rgba(0,0,0,0.45)]' : ''}`}
              >
                {n.frameUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={n.frameUrl} alt="" draggable={false} className="h-full w-full select-none object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-[10px] text-ink-4">no frame</span>
                )}

                {n.status === 'generating' && (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/45">
                    <span className="flex items-center gap-1.5 rounded-chip bg-black/70 px-2.5 py-1.5 text-[9px] font-bold tracking-[0.05em] text-accent-ink">
                      <span className="rs-cursor block h-[5px] w-[5px] rounded-full bg-accent" />
                      {n.kind === 'video' ? 'RENDERING' : 'GENERATING'}
                    </span>
                  </span>
                )}

                {n.kind === 'video' && n.status === 'achieved' && (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/25">
                    <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/60">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="#fff" className="ml-0.5" aria-hidden><path d="M8 5v14l11-7z" /></svg>
                    </span>
                  </span>
                )}

                {/* What the shot is OF.
                  The whole point of the change is that an ad should be mostly
                  things that are not faces, and "mostly" is only checkable if
                  you can see it. Quiet by design — it sits under the status
                  ring and must not compete with it. */}
              {n.kind === 'frame' && n.shot && n.shot !== 'person' && !n.discarded && (
                <span className="absolute right-1.5 top-1.5 rounded bg-black/65 px-1.5 py-0.5 text-[8.5px] font-bold uppercase tracking-[0.08em] text-white">
                  {n.shot}
                </span>
              )}

              {n.kind === 'avatar' && (
                  <span className="absolute left-1.5 top-1.5 rounded bg-black/65 px-1.5 py-0.5 text-[8.5px] font-bold tracking-[0.08em] text-white">
                    AVATAR
                  </span>
                )}
              </span>

              {/* Clips get the affordance too, now that there is something on
                  the menu for them. Right-click always reached it, but that is
                  no path at all on touch, where contextmenu never fires — so a
                  rendered clip was effectively unreachable for most people. */}
              {selected && n.kind !== 'avatar' && (
                <span
                  role="button"
                  tabIndex={0}
                  aria-label="Node actions"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    openMenuFor(n.id, e.clientX, e.clientY);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      e.stopPropagation();
                      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      openMenuFor(n.id, r.right, r.top);
                    }
                  }}
                  className="absolute -right-2.5 -top-2.5 z-10 flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border border-line-strong bg-panel text-ink-2 shadow-sm hover:text-ink"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                    <circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" />
                  </svg>
                </span>
              )}

              {/* A failed render carried a play badge and read as a finished
                  clip. It has its own mark now. */}
              {n.kind === 'video' && n.status === 'failed' && (
                <span className="absolute -top-4 left-0 whitespace-nowrap text-[10.5px] font-semibold text-crit-ink">render failed</span>
              )}

              {/* Its source changed underneath it: this step is an answer to a
                  question that was withdrawn. */}
              {n.stale && !n.discarded && (
                <span className="absolute -top-4 left-0 whitespace-nowrap text-[10.5px] font-semibold text-warn-ink">
                  needs rebuilding
                </span>
              )}

              {/* One state, one label. "taken out" and "disconnected — right-click
                  to reconnect" were two labels for two different mechanisms that
                  looked identical on screen, drawn at the same offset, on top of
                  each other. */}
              {n.removedFromSequence && (
                <span className="absolute -top-4 left-0 whitespace-nowrap text-[10.5px] font-semibold text-ink-3">
                  disconnected
                </span>
              )}

              {n.discarded && (
                <span className="absolute -top-4 left-0 whitespace-nowrap text-[10.5px] font-semibold text-crit-ink">discarded</span>
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

      {/* legend — fixed to the pane, not the scrolled canvas */}
      <div className="pointer-events-none absolute bottom-4 left-4 flex items-center gap-4 rounded-card border border-line bg-panel/90 px-3.5 py-2 backdrop-blur-sm">
        {(
          [
            ['border-good', 'achieved'],
            ['border-warn', 'partial'],
            ['border-accent', 'generating'],
            ['border-crit', 'discarded'],
          ] as const
        ).map(([cls, word]) => (
          <span key={word} className="flex items-center gap-1.5 text-[11px] text-ink-2">
            <span className={`block h-[9px] w-[9px] rounded-[2px] border-2 ${cls}`} />
            {word}
          </span>
        ))}
      </div>

      {/* right-click menu */}
      {menu && (() => {
        const target = laid.find((n) => n.id === menu.nodeId);
        if (!target) return null;
        const isDisconnected = target.removedFromSequence === true;
        const orderIndex = cutOrder.indexOf(target.id);
        const item =
          'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] hover:bg-subtle disabled:opacity-40';
        return (
          <div
            className="rs-enter absolute z-40 w-[230px] rounded-card border border-line bg-panel p-1.5 shadow-[0_18px_44px_-14px_rgba(0,0,0,0.45)]"
            style={{
              left: Math.min(menu.x, (wrapRef.current?.clientWidth ?? 9999) - 240),
              // Clamped in both axes: a right-click near the bottom put the menu
              // off-screen with no way to reach its items.
              top: Math.min(menu.y, Math.max(8, (wrapRef.current?.clientHeight ?? 9999) - 210)),
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-bold tracking-[0.1em] text-ink-4">
              {target.kind === 'avatar' ? 'AVATAR' : target.kind === 'video' ? 'CLIP' : `STEP ${target.stepNo}${target.label ? ` · ${target.label}` : ''}`}
            </p>
            {/* An alternate can take the place of whatever is currently in the
                sequence at its step — which is the whole point of generating
                one. Everything after it then descends from a different image,
                so the workspace asks before rebuilding. */}
            {/* Only when there IS something to swap it in for. The item was
                shown for every frame outside the cut, including ones with no
                sibling at their step, where the handler finds no target and
                silently does nothing. */}
            {target.kind === 'frame' && target.frameUrl && onSwapIn && !inSequence.has(target.id) &&
              !target.removedFromSequence &&
              nodes.some((o) => o.id !== target.id && o.kind === 'frame' && o.parentId === target.parentId && !o.discarded) && (
              <button type="button" className={item} onClick={() => { setMenu(null); onSwapIn(target.id); }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M17 2l4 4-4 4" /><path d="M3 6h18" /><path d="M7 22l-4-4 4-4" /><path d="M21 18H3" /></svg>
                Use this one instead
              </button>
            )}

            {/* Frames AND clips. "I do not want this any more" is the same
                sentence about either, and only frames could hear it. */}
            {target.kind !== 'avatar' && onDisconnect && !isDisconnected && target.id !== 'root' && (
              <button type="button" className={item} onClick={() => { setMenu(null); onDisconnect(target.id); }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M8.1 8.1 20 20M8.1 15.9 20 4" /></svg>
                Disconnect
              </button>
            )}

            {/* The way back. Disconnecting used to be permanent — the flag was
                written in one place and cleared in none — so a mis-click cost a
                paid regeneration of a frame sitting right there. */}
            {onReconnect && isDisconnected && (
              <button type="button" className={item} onClick={() => { setMenu(null); onReconnect(target.id); }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 12h12M15 6l6 6-6 6" /><path d="M3 5v14" /></svg>
                Reconnect
              </button>
            )}

            {/*
              ALWAYS SHOWN, even on something still connected.
              
              It used to appear only once a node was disconnected, which answers
              the question "can I delete this" by making the control vanish —
              and a missing button explains nothing. Somebody looking for delete
              concludes the product cannot do it, which is exactly the report
              that arrived.
              
              The two-step safety is unchanged: detaching is reversible and
              destroying is not, so delete still only fires on a disconnected
              node and still asks twice. Pressing it early now SAYS so, and
              offers the step that was missing rather than leaving a dead end.
            */}
            {onDelete && target.kind !== 'avatar' && target.id !== 'root' && (
              <button
                type="button"
                className={`${item} ${confirmDelete === target.id ? 'text-crit-ink' : ''}`}
                onClick={() => {
                  if (!isDisconnected) {
                    setBlockedDelete(target.id);
                    return;
                  }
                  if (confirmDelete !== target.id) { setConfirmDelete(target.id); return; }
                  setMenu(null);
                  setConfirmDelete(null);
                  onDelete(target.id);
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></svg>
                {confirmDelete === target.id
                  ? `Delete ${target.kind === 'video' ? 'this clip' : 'it'} for good — click again`
                  : 'Delete permanently'}
              </button>
            )}

            {/* Why it did not delete, and the way forward. Offering Disconnect
                here is not a bypass: it performs the reversible step and stops,
                leaving delete still two further clicks away. */}
            {blockedDelete === target.id && !isDisconnected && (
              <div className="mx-1 mb-1 mt-0.5 rounded-lg bg-warn-soft px-2.5 py-2">
                <p className="text-[11.5px] font-semibold leading-snug text-warn-ink">
                  Disconnect it first
                </p>
                <p className="mt-0.5 text-[11px] leading-snug text-ink-2">
                  {target.kind === 'video'
                    ? 'This clip is still attached to the shot it was made from.'
                    : 'This shot is still part of the ad.'}{' '}
                  Deleting cannot be undone, so it only works on something already taken out.
                </p>
                {onDisconnect && (
                  <button
                    type="button"
                    onClick={() => { setBlockedDelete(null); setMenu(null); onDisconnect(target.id); }}
                    className="mt-1.5 text-[11.5px] font-semibold text-warn-ink underline"
                  >
                    Disconnect it now
                  </button>
                )}
              </div>
            )}

            {/* Reordering is free: shots are photographed independently, so
                their order says nothing about how they were made. Worth saying
                on the item itself, because with the old edit-chain this would
                have meant regenerating half the ad. */}
            {onReorder && inSequence.has(target.id) && orderIndex > 0 && (
              <button type="button" className={item} onClick={() => { setMenu(null); onReorder(target.id, 'earlier'); }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M19 12H5M12 5l-7 7 7 7" /></svg>
                Move earlier
              </button>
            )}
            {onReorder && inSequence.has(target.id) && orderIndex > -1 && orderIndex < inSequence.size - 1 && (
              <button type="button" className={item} onClick={() => { setMenu(null); onReorder(target.id, 'later'); }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12h14M12 5l7 7-7 7" /></svg>
                Move later
              </button>
            )}

            {target.kind === 'frame' && onRegenerate && (
              <button type="button" className={item} onClick={() => { setMenu(null); onRegenerate(target.id); }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M1 4v6h6" /><path d="M3.5 15a9 9 0 1 0 2.1-9.4L1 10" /></svg>
                {/* The same handler and the same panel as the Inspector's
                    button, so it gets the same name. Two names for one action
                    is a defect; "from same base" is true but belongs in the
                    tooltip and the panel, which both already say it. */}
                Another take
              </button>
            )}
            <button type="button" className={item} onClick={() => { setMenu(null); onSelect?.(target.id); }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="12" cy="12" r="3" /><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /></svg>
              Inspect
            </button>
            {offsets[target.id] && (
              <button
                type="button"
                className={item}
                onClick={() => {
                  const next = { ...offsets };
                  delete next[target.id];
                  setOffsets(next);
                  persist(next);
                  setMenu(null);
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M3 12h18M12 3v18" /></svg>
                Reset position
              </button>
            )}
          </div>
        );
      })()}
    </div>
  );
}

function VerdictBadge({ verdict, x, y }: { verdict: 'met' | 'partial' | 'failed'; x: number; y: number }) {
  /* PARTIAL says what the critic said. It used to say RETRIED, which read as a
     failure on every edge of a real run — a partial that was never retried is
     not a retry, and the discarded stub already marks the ones that were. */
  const style = {
    met: { cls: 'bg-good-soft text-good-ink border-good/45', label: 'MET' },
    partial: { cls: 'bg-warn-soft text-warn-ink border-warn/45', label: 'PARTIAL' },
    failed: { cls: 'bg-crit-soft text-crit-ink border-crit/45', label: 'DISCARDED' },
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
