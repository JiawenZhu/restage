/*
 * Shared shapes. These mirror the Firestore layout in ARCHITECTURE.md §4, and
 * the security rules in firestore.rules are written against the same field
 * names — if one moves, the other has to move with it.
 */

export type Aspect = '9:16' | '16:9';

export type NodeStatus =
  | 'generating'
  | 'achieved'
  | 'partial' // the critic rejected once and the retry landed
  | 'failed' // discarded — kept on the canvas on purpose
  | 'rejected' // the user turned it down
  | 'pending';

export type Verdict = 'met' | 'partial' | 'failed';

export interface PlanStep {
  stepNo: number;
  /** 2-4 words naming the change — the canvas caption. */
  label?: string;
  instruction: string;
  /** Never truncated to nothing in the UI: it is what proves the agent reasoned. */
  rationale: string;
  /** 'abandoned' means the step produced nothing usable and the run continued
   *  from the previous frame — distinct from 'retried', which succeeded on a
   *  second attempt. Reporting one as the other described a run that did not
   *  happen. */
  status: 'pending' | 'running' | 'done' | 'retried' | 'abandoned';
}

export interface TreeNode {
  id: string;
  /** Self-referencing: this is the whole tree. Null on the root (the avatar). */
  parentId: string | null;
  stepNo: number;
  kind: 'avatar' | 'frame' | 'video';
  status: NodeStatus;

  label?: string;
  instruction?: string;
  rationale?: string;

  /** Firebase Storage path for a frame; R2 key for a rendered clip. */
  frameUrl?: string;
  videoKey?: string;
  /** Signed playback URL for a finished clip (7-day expiry). */
  videoUrl?: string;

  verdict?: Verdict;
  /** The critic in its own voice — the most persuasive element in the interface. */
  criticNotes?: string;
  /** What the critic was asked to judge against. */
  criticRubric?: string;

  /** Set on a discarded attempt so it can be drawn stubbed off its parent's edge. */
  discarded?: boolean;

  createdAt: number;
}

export interface Run {
  id: string;
  uid: string;
  /** Optional because a run can still be started from a one-off upload; only a
   *  run made from an enrolled avatar carries one. It was declared required and
   *  never written, so every Run object in the app was lying about its shape. */
  avatarId?: string;
  /** Which creative template shaped the plan, if any. */
  templateId?: string | null;
  goal: string;
  aspect: Aspect;
  seconds: 4 | 8 | 16 | 24;
  status: 'planning' | 'running' | 'awaiting-approval' | 'rendering' | 'complete' | 'failed';
  plan: PlanStep[];
  /** Why a failed run stopped, so the workspace can say it rather than spin. */
  failureReason?: string;
  /** The line the creator says. Written by the model, editable by the user. */
  audioScript?: string;
  audioUrl?: string;
  /** R2 object key for the rendered clip. The key is the durable record; the
   *  playable URL is re-signed on demand by /api/runs/[runId]/video. */
  videoKey?: string;
  videoUrl?: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * Assemble the tree in memory. A run holds six to ten nodes, always scoped to
 * one run, so one collection read plus this is cheaper than any recursive query
 * — which is why this product does not need a relational database for its tree.
 */
export interface LaidOutNode extends TreeNode {
  depth: number;
  /** Row within its depth, so branches fan vertically. */
  lane: number;
  children: LaidOutNode[];
}

export function layoutTree(nodes: TreeNode[]): LaidOutNode[] {
  const byId = new Map<string, LaidOutNode>();
  for (const n of nodes) byId.set(n.id, { ...n, depth: 0, lane: 0, children: [] });

  const roots: LaidOutNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  // Left-to-right by depth, branches fanning vertically. Discarded attempts do
  // not take a lane of their own — they are stubbed off their parent's edge, so
  // the main line stays a straight read.
  const laneAtDepth = new Map<number, number>();
  const walk = (node: LaidOutNode, depth: number) => {
    node.depth = depth;
    if (node.discarded) {
      node.lane = -1;
    } else {
      const lane = laneAtDepth.get(depth) ?? 0;
      node.lane = lane;
      laneAtDepth.set(depth, lane + 1);
    }
    node.children.sort((a, b) => a.createdAt - b.createdAt);
    for (const child of node.children) walk(child, depth + 1);
  };
  roots.sort((a, b) => a.createdAt - b.createdAt);
  for (const r of roots) walk(r, 0);

  return roots;
}

/** Flatten for rendering — the tree shape is carried by depth/lane and parentId. */
export function flatten(roots: LaidOutNode[]): LaidOutNode[] {
  const out: LaidOutNode[] = [];
  const push = (n: LaidOutNode) => {
    out.push(n);
    n.children.forEach(push);
  };
  roots.forEach(push);
  return out;
}
