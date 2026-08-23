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

/*
 * What a shot is OF.
 *
 * The thing that makes an ad look like an ad rather than six selfies, and the
 * thing that decides how the frame gets generated. A shot with no face in it
 * needs no identity lock, carries no drift risk, and does not have to descend
 * from anything — so it can be made at full quality from a clean prompt.
 */
export type ShotKind =
  /** The creator is in frame. Generated from the enrolment captures. */
  | 'person'
  /** The product, in hands or on a surface. Hands are fine; a face is not. */
  | 'product'
  /** Macro: texture, a label, a mechanism, the thing turning. */
  | 'detail'
  /** The place. B-roll, establishing, atmosphere. Nobody in it. */
  | 'scene';

/*
 * The look every shot shares.
 *
 * When each step edited the frame before it, continuity was inherited for free
 * — and paid for in generation loss. Shots that are generated independently
 * need the contract written down instead: same room, same clothes, same light,
 * same palette. This is what makes six separately-made images read as one
 * afternoon's shoot.
 */
export interface LookBible {
  location: string;
  wardrobe: string;
  light: string;
  palette: string;
  /** The product itself, described once so every shot of it agrees. */
  product: string;
}

/**
 * The person, described once, so every shot of them agrees.
 *
 * LookBible does this for the room and it is why the SETTING holds across shots
 * that never see each other. There was no equivalent for the person, so
 * everything the enrolment captures under-determine — apparent age above all —
 * was re-decided from scratch on every shot. An ad came back opening on a woman
 * in her twenties and closing on a visibly older one, and every frame in it
 * passed the identity check, correctly: age is carried by skin, and skin was the
 * one facial property no constraint named.
 *
 * Read off the ENROLMENT CAPTURES, not off the first generated frame. Reading it
 * from a frame would make the ad self-consistent around whatever the first shot
 * happened to do; reading it from the photographs makes it consistent AND right.
 *
 * Deliberately TEXT and not a reference image. The obvious fix is to hand later
 * shots a frame from earlier in the ad, and it works — and it also carries the
 * staging with it. Measured: shots one and three came back as the same seated
 * pose in the same crop, differing only in expression, because a reference image
 * cannot show a face without also showing a composition. A sentence has no
 * composition to copy.
 */
export interface CastingNote {
  /** e.g. "mid-thirties". A range, because a number invites splitting hairs. */
  age: string;
  /** Lines, pores, evenness — the properties that actually encode age. */
  skin: string;
  /** Colour, length, how it is worn. */
  hair: string;
  /** Including "none", which is the common and easily-lost answer. */
  makeup: string;
  /** Glasses, freckles, a mole — whatever a stranger would describe first. */
  distinctive: string;
}

export interface PlanStep {
  stepNo: number;
  /** What this shot is of. Absent on runs planned before shot lists existed. */
  shot?: ShotKind;
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
  /** What this node's frame is of. Drives how it was generated. */
  shot?: ShotKind;

  /** Firebase Storage path for a frame; R2 key for a rendered clip. */
  frameUrl?: string;
  videoKey?: string;
  /** Signed playback URL for a finished clip (7-day expiry). */
  videoUrl?: string;
  /** Whether the clip was finished into an ad — captions, brand mark, end card. */
  captioned?: boolean;
  hasAudio?: boolean;
  audioNote?: string | null;
  /** Which video engine made this clip. */
  engine?: 'veo' | 'omni';
  /** A limit of that engine the user's choice did not survive — a length that
   *  could not be honoured, a resolution it will not reach. */
  engineNote?: string | null;

  verdict?: Verdict;
  /** The critic in its own voice — the most persuasive element in the interface. */
  criticNotes?: string;
  /** What the critic was asked to judge against. */
  criticRubric?: string;
  /** Did everything the instruction did not name stay put between frames? */
  continuityHeld?: boolean;
  /** What drifted that nobody asked to drift. */
  continuityBreaks?: string | null;

  /** Set on a discarded attempt so it can be drawn stubbed off its parent's edge. */
  discarded?: boolean;
  /** Its source frame changed under it — this step answers a question that was
   *  withdrawn, and needs rebuilding before it means anything. */
  stale?: boolean;
  /** Taken out of the sequence by the user, but kept on the canvas. */
  removedFromSequence?: boolean;

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
  /** The shared look every shot in this run is held to. */
  look?: LookBible | null;
  /** Video rendering engine used for the run. */
  videoEngine?: 'veo' | 'omni';
  /*
   * Which door this run goes through, decided once when it starts.
   *
   * PINNED, not looked up per call. A run that resolved the provider on every
   * step would change models underneath itself the moment an account was
   * upgraded or downgraded mid-run — the first three shots on one image model
   * and the last four on another, in an ad whose entire promise is that the
   * frames look like one shoot. Absent means 'api-key', which is what every run
   * made before this field existed was.
   */
  provider?: 'vertex' | 'api-key';
  /* A label the user can change, separate from `goal`.
     The goal is what the planner was actually given and what every shot was
     generated from; letting a rename overwrite it would make the run claim it
     was built from a brief it never saw. */
  title?: string;
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
