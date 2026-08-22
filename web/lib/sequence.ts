/*
 * The shape of the sequence, as pure functions over a list of nodes.
 *
 * Split out of lineage.ts because BOTH SIDES need it and only one side could
 * have it. lineage.ts imports the Firestore admin SDK, which throws on sight of
 * a browser, so the workspace could not call lineageOf() and grew its own
 * version instead:
 *
 *     const sequence = nodes.filter(n => !n.discarded && !n.removedFromSequence
 *                                        && n.status !== 'rejected');
 *     const sequenceLength = sequence.filter(n => parents.has(n.id) || isLast(n)).length;
 *
 * A flat filter and a "has children" test are not a walk, so the count on the
 * button and the shots the server actually rendered were two different answers
 * computed by two different algorithms — and they disagreed exactly when it
 * mattered, on a tree somebody had edited. There is one implementation now, and
 * it runs in both places.
 *
 * Nothing here touches the network or the database. That is the point.
 */

export interface LineageNode {
  id: string;
  parentId: string | null;
  stepNo: number;
  kind: string;
  status: string;
  stale?: boolean;
  discarded?: boolean;
  /** Taken out of the sequence by the user. Kept on the canvas. */
  removedFromSequence?: boolean;
  frameUrl?: string;
  instruction?: string;
}

/**
 * The frames actually in the sequence, in order.
 *
 * Walks from the root following the chain of frames that have children, which
 * is what "in the lineage" means — an alternate is a frame nothing was built
 * on top of.
 *
 * THE SUBTLE PART: an excluded frame is stepped OVER, not stopped at.
 *
 * This walk used to end the moment it met an excluded child, and that quietly
 * destroyed the feature. A frame the user rejects is excluded from the sequence
 * — but the run had already built the next four steps by editing it, so it is
 * still a load-bearing link in the chain. Stopping there orphaned every step
 * below it. Measured on a real six-step run: one rejected frame at step 2 took
 * the sequence from six shots to one, and the render button went on to offer
 * "render all 1 shots into one ad" as though that were the whole storyboard.
 *
 * So exclusion decides whether a frame is COLLECTED, and the presence of frame
 * children decides whether the walk CONTINUES. They are separate questions, and
 * conflating them was the bug.
 */
export function lineageOf(nodes: LineageNode[]): LineageNode[] {
  const byParent = new Map<string, LineageNode[]>();
  for (const n of nodes) {
    const key = n.parentId ?? 'root';
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(n);
  }
  const continues = (n: LineageNode) => (byParent.get(n.id) ?? []).some((g) => g.kind === 'frame');

  const chain: LineageNode[] = [];
  let currentId = 'root';
  const seen = new Set<string>();

  while (!seen.has(currentId)) {
    seen.add(currentId);
    const frames = (byParent.get(currentId) ?? []).filter((c) => c.kind === 'frame');
    if (!frames.length) break;

    const live = frames.filter((c) => !isOutOfSequence(c));
    /*
     * Continuation outranks liveness, and that order matters.
     *
     * Ranking the newest surviving attempt above an excluded frame looks safer
     * and is wrong: after a swap the replaced frame stays on the canvas as a
     * childless alternate, so it is "live" while being a dead end, and the walk
     * would take it and stop — losing the real chain hanging off the frame the
     * user rejected. Lineage means what was actually built on, so a frame with
     * steps below it wins even when it will not appear in the cut. Only when
     * nothing continues does the newest survivor win, which is the ordinary
     * case at the tip of the chain.
     */
    const next =
      live.find(continues) ?? frames.filter(continues).pop() ?? live[live.length - 1];
    if (!next) break;

    if (!isOutOfSequence(next)) chain.push(next);
    currentId = next.id;
  }
  return chain;
}

/*
 * Not part of the sequence: an attempt the orchestrator abandoned, one the user
 * took out, or one the user turned down.
 *
 * This was briefly written as a method installed on Object.prototype so that
 * the filter above would read as prose. That is a global mutation affecting
 * every object in the process, including ones from libraries, for a cosmetic
 * gain. A plain function reads nearly as well and breaks nothing.
 */
export function isOutOfSequence(n: LineageNode): boolean {
  return n.discarded === true || n.removedFromSequence === true || n.status === 'rejected';
}

/** Every descendant of a node, in step order. */
export function descendantsOf(nodes: LineageNode[], nodeId: string): LineageNode[] {
  const byParent = new Map<string, LineageNode[]>();
  for (const n of nodes) {
    const key = n.parentId ?? 'root';
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(n);
  }
  const out: LineageNode[] = [];
  const walk = (id: string) => {
    for (const c of byParent.get(id) ?? []) {
      out.push(c);
      walk(c.id);
    }
  };
  walk(nodeId);
  return out.sort((a, b) => a.stepNo - b.stepNo);
}

export interface RewireResult {
  /** Everything the rewire invalidated, frames and rendered clips alike. */
  staleIds: string[];
  /** Just the frames — the only things a rebuild can actually regenerate. */
  rebuildableIds: string[];
  staleSteps: number[];
}

/**
 * What a rewire invalidated, split by what the user can act on.
 *
 * A rendered clip downstream of the change is genuinely stale — it no longer
 * shows the sequence it claims to. But it is not a STEP. Video nodes carry the
 * sentinel stepNo 99, and reporting the set verbatim told people "steps 4, 6
 * and 99 are now out of date" and then priced the rebuild as if 99 were three
 * more generations to pay for. Only frames are rebuildable, so only frames are
 * counted and named.
 */
export function summarise(stale: LineageNode[]): RewireResult {
  const seen = new Set<string>();
  const unique: LineageNode[] = [];
  for (const n of stale) {
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    unique.push(n);
  }
  const frames = unique.filter((n) => n.kind === 'frame');
  return {
    staleIds: unique.map((n) => n.id),
    rebuildableIds: frames.map((n) => n.id),
    staleSteps: [...new Set(frames.map((n) => n.stepNo))].sort((a, b) => a - b),
  };
}

/**
 * How long each shot runs, given the length the user already chose.
 *
 * They set a length on /studio before the run started, and that choice should
 * survive into the render rather than being replaced by a constant. Six frames
 * of a 24-second ad are four seconds each; three frames of the same ad are
 * eight. The model's floor is 4s and its ceiling is 8s, so a sequence long
 * enough to push below the floor gets shots of 4s and a longer total than
 * asked — which is stated rather than silently applied.
 */
export function shotPlan(totalSeconds: number, shots: number, min = 4, max = 8) {
  if (shots <= 0) return { perShot: min, total: 0, honoursRequest: true };
  const ideal = totalSeconds / shots;
  const perShot = Math.max(min, Math.min(max, Math.round(ideal)));
  return {
    perShot,
    total: perShot * shots,
    honoursRequest: Math.abs(perShot * shots - totalSeconds) <= shots,
  };
}

/** Roughly what a rebuild will cost, so the number shown is not invented. */
export function rebuildEstimate(steps: number): { seconds: number; label: string } {
  // Measured across real runs: a frame plus its two judges lands around 26s.
  const seconds = steps * 26;
  const label =
    seconds < 60 ? 'under a minute' : `about ${Math.round(seconds / 60)} minute${seconds >= 90 ? 's' : ''}`;
  return { seconds, label };
}
