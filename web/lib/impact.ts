/*
 * What breaks when the shoot changes.
 *
 * Swapping the product, the location or the face invalidates work — but not
 * "everything after it". That was the right answer only while every step was an
 * edit of the one before, where position in the chain WAS the dependency. Shots
 * are photographed independently now, each against the run's look, so the
 * question is no longer what comes after image 3. It is what actually depends on
 * the thing that changed.
 *
 * Getting this right is worth real money to the user. A blanket "regenerate
 * everything" on a six-shot ad is six paid generations and a couple of minutes,
 * and on a product swap, two of those shots never showed the product.
 *
 * CERTAIN vs POSSIBLE is the honest part. Whether a PERSON shot shows the
 * product is not knowable from its kind — "twisting the cap" does, "walking to
 * the window" does not — and guessing either way is wrong in a way the user
 * pays for. So the certain set is pre-selected and the possible set is listed,
 * unchecked, with the reason. The person decides; the interface does not
 * pretend to know.
 *
 * Pure, and free of server imports, so the workspace can show the consequences
 * of a change before anyone commits to it.
 */
import type { ShotKind } from './types';

export type LookField = 'location' | 'wardrobe' | 'light' | 'palette' | 'product' | 'avatar';

export const LOOK_FIELDS: LookField[] = ['location', 'wardrobe', 'light', 'palette', 'product', 'avatar'];

const ALL: ShotKind[] = ['person', 'product', 'detail', 'scene'];

interface Dependency {
  certain: ShotKind[];
  possible: ShotKind[];
  /** Said to the user, in the modal, as the reason their work is affected. */
  why: string;
  /** What the field is called on screen. */
  label: string;
}

const DEPENDS: Record<LookField, Dependency> = {
  location: {
    certain: ALL,
    possible: [],
    label: 'the location',
    why: 'Every shot in this ad is set in the same place, so every shot shows it.',
  },
  light: {
    certain: ALL,
    possible: [],
    label: 'the lighting',
    why: 'The light is what makes separate shots look like one afternoon. If it changes in one, it has to change in all of them.',
  },
  palette: {
    certain: ALL,
    possible: [],
    label: 'the palette',
    why: 'Colour is carried by every frame; a shot left on the old palette will not cut with the others.',
  },
  wardrobe: {
    certain: ['person'],
    possible: [],
    label: 'the wardrobe',
    why: 'Only shots with the person in them show what they are wearing.',
  },
  product: {
    certain: ['product', 'detail'],
    possible: ['person'],
    label: 'the product',
    why: 'Product and detail shots are ABOUT the item, so they all change.',
  },
  avatar: {
    certain: ['person'],
    possible: [],
    label: 'the person',
    why: 'Only shots with a face in them show who is in the ad.',
  },
};

export interface ImpactedShot {
  id: string;
  stepNo: number;
  label?: string;
  shot: ShotKind;
  /** True when the dependency is definite; false when it merely might apply. */
  certain: boolean;
  /** Why this particular shot is in the list. */
  because: string;
}

export interface Impact {
  changed: LookField[];
  shots: ImpactedShot[];
  certainCount: number;
  possibleCount: number;
  /** Shots that nothing touched. Shown as a count, because "4 of 6" is only
   *  reassuring if the other 2 are accounted for. */
  untouched: number;
  /** One sentence naming what changed and what it costs. */
  summary: string;
}

export interface ImpactNode {
  id: string;
  stepNo: number;
  kind: string;
  label?: string;
  shot?: ShotKind;
  frameUrl?: string;
  discarded?: boolean;
  removedFromSequence?: boolean;
}

/** Roughly what regenerating this many shots costs. Measured across real runs. */
export function regenerateEstimate(count: number): { seconds: number; label: string } {
  const seconds = count * 26;
  if (!count) return { seconds: 0, label: 'nothing to do' };
  const label =
    seconds < 60 ? 'under a minute' : `about ${Math.round(seconds / 60)} minute${seconds >= 90 ? 's' : ''}`;
  return { seconds, label };
}

/**
 * Which shots a set of changes invalidates.
 *
 * `changed` is the fields the user actually edited — not every field on the
 * form. Marking a shot stale because the user opened the panel and saved it
 * unchanged would charge them for nothing.
 */
export function impactOf(changed: LookField[], nodes: ImpactNode[]): Impact {
  const live = nodes.filter(
    (n) => n.kind === 'frame' && n.frameUrl && !n.discarded && !n.removedFromSequence,
  );

  const hit = new Map<string, ImpactedShot>();

  for (const field of changed) {
    const dep = DEPENDS[field];
    if (!dep) continue;

    for (const n of live) {
      const kind = (n.shot ?? 'person') as ShotKind;
      const isCertain = dep.certain.includes(kind);
      const isPossible = dep.possible.includes(kind);
      if (!isCertain && !isPossible) continue;

      const because = isCertain
        ? dep.why
        : field === 'product'
          ? 'This shot has the person in it, and may or may not show the product — only you can tell.'
          : dep.why;

      const existing = hit.get(n.id);
      // Certain wins over possible: if any change definitely affects a shot,
      // a second change that merely might is not a reason to downgrade it.
      if (existing && (existing.certain || !isCertain)) continue;
      hit.set(n.id, {
        id: n.id,
        stepNo: n.stepNo,
        label: n.label,
        shot: kind,
        certain: isCertain,
        because,
      });
    }
  }

  const shots = [...hit.values()].sort((a, b) => a.stepNo - b.stepNo);
  const certainCount = shots.filter((s) => s.certain).length;
  const possibleCount = shots.length - certainCount;

  const names = changed.map((f) => DEPENDS[f]?.label ?? f);
  const changedPhrase =
    names.length === 1
      ? names[0]
      : names.length === 2
        ? `${names[0]} and ${names[1]}`
        : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

  const summary = !shots.length
    ? `You changed ${changedPhrase}. Nothing already generated depends on it.`
    : `You changed ${changedPhrase}. ${certainCount} of ${live.length} shot${live.length === 1 ? '' : 's'} ` +
      `no longer match${certainCount === 1 ? 'es' : ''} it` +
      (possibleCount ? `, and ${possibleCount} more might.` : '.');

  return {
    changed,
    shots,
    certainCount,
    possibleCount,
    untouched: live.length - shots.length,
    summary,
  };
}

/** Which look fields actually differ between two versions. */
export function changedFields(
  before: Partial<Record<LookField, string>> | null | undefined,
  after: Partial<Record<LookField, string>>,
): LookField[] {
  const out: LookField[] = [];
  for (const f of LOOK_FIELDS) {
    const a = (before?.[f] ?? '').trim();
    const b = (after[f] ?? '').trim();
    // Absent in `after` means "not edited", which is different from "cleared".
    if (after[f] === undefined) continue;
    if (a !== b) out.push(f);
  }
  return out;
}
