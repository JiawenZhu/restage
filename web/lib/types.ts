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
  instruction: string;
  /** Never truncated to nothing in the UI: it is what proves the agent reasoned. */
  rationale: string;
  status: 'pending' | 'running' | 'done' | 'retried';
}

export interface TreeNode {
  id: string;
  /** Self-referencing: this is the whole tree. Null on the root (the avatar). */
  parentId: string | null;
  stepNo: number;
  kind: 'avatar' | 'frame' | 'video';
  status: NodeStatus;

  instruction?: string;
  rationale?: string;

  /** Firebase Storage path for a frame; R2 key for a rendered clip. */
  frameUrl?: string;
  videoKey?: string;

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
  avatarId: string;
  goal: string;
  aspect: Aspect;
  seconds: 8 | 15 | 30;
  status: 'planning' | 'running' | 'awaiting-approval' | 'rendering' | 'complete' | 'failed';
  plan: PlanStep[];
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
