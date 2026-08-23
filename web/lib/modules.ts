/*
 * THE SHOT MODULES.
 *
 * Every rule that reaches an image or video prompt is one entry in the registry
 * below. A template overrides the entries its idea needs and inherits the rest,
 * and changing how ALL templates treat one dimension is a one-line edit to that
 * dimension's default.
 *
 * WHY IT IS BUILT THIS WAY. The direction used to live as a handful of large
 * string constants — IDENTITY_LOCK, FLATTERING_CAMERA, PROP_CONTINUITY — each
 * bundling several unrelated decisions. FLATTERING_CAMERA alone owned the focal
 * length, the camera height, the key light, the fill, the catchlight, the skin
 * texture and the expression. That made two things impossible at once:
 *
 *   - A template could not change the LIGHTING without also changing the lens,
 *     because they were the same sentence. So Film Noir's chiaroscuro and Moon
 *     Expedition's jet-black shadows were both overruled by "soft key at 45
 *     degrees with gentle fill", and sixteen templates rendered as one look.
 *   - Fixing one dimension everywhere meant editing a paragraph that six other
 *     dimensions depended on, which is how the age lock ended up rewriting the
 *     skin-texture rule as a side effect and measurably made things worse.
 *
 * One decision per module, one owner per decision.
 *
 * LOCKED MODULES. Three of them cannot be overridden by a template, and the
 * reason is the product's promise rather than tidiness: identity, face optics
 * and anatomy are what keep the ad a picture of the USER. A 35mm lens at
 * portrait distance enlarges the nose and narrows the cheeks — that is geometry,
 * not mood, and no creative idea is worth handing somebody a face they do not
 * recognise. Everything that is genuinely a matter of taste is open.
 */
import type { ShotKind } from './types';

export type ModuleId =
  | 'identity'
  | 'optics'
  | 'anatomy'
  | 'light'
  | 'contrast'
  | 'camera'
  | 'blocking'
  | 'props'
  | 'propMotion'
  | 'physics'
  | 'packaging'
  | 'space';

/** Which shots a module applies to, and at which stage it is spoken. */
type Applies = 'person' | 'object' | 'both';
type Stage = 'still' | 'video' | 'both';

export interface ShotModule {
  id: ModuleId;
  /** The line the model reads. Kept short — it is scanned, not studied. */
  heading: string;
  /** Locked modules protect the user's face; a template may not replace them. */
  locked: boolean;
  appliesTo: Applies;
  stage: Stage;
  /** What a template gets when it says nothing. */
  fallback: string;
}

/*
 * Ordered deliberately: who they are, how they are photographed, what the world
 * looks like, then how matter behaves. A model reads a prompt in order and
 * weights the opening more heavily, so identity comes first and always has.
 */
export const MODULES: readonly ShotModule[] = [
  {
    id: 'identity',
    heading: 'IDENTITY',
    locked: true,
    appliesTo: 'person',
    stage: 'both',
    fallback:
      'This is a specific real person. Their bone structure, face width, jawline, ' +
      'eye shape and spacing, nose shape, lip shape, hairline, hairstyle, skin ' +
      'tone and eyeglasses are FIXED and must match the reference exactly. Do not ' +
      'slim the face, enlarge the eyes, reshape the nose or jaw, or make them look ' +
      'like a different person. Someone who knows them must recognise them instantly.',
  },
  {
    id: 'optics',
    heading: 'OPTICS',
    locked: true,
    appliesTo: 'person',
    stage: 'both',
    fallback:
      '85mm equivalent lens with natural compression whenever the face is a ' +
      'significant part of the frame — never a wide lens at close range, which ' +
      'distorts a face. Skin looks healthy and well-rested: real texture and real ' +
      'pores, but even in tone and not accentuated — not airbrushed to plastic, and ' +
      'not sharpened into every flaw.',
  },
  {
    id: 'anatomy',
    heading: 'HANDS',
    locked: true,
    appliesTo: 'both',
    stage: 'both',
    fallback:
      'Five fingers on each hand, in natural proportion. Where a hand holds ' +
      'something the fingers wrap around it and press into it, with real contact ' +
      'and real weight.',
  },
  {
    id: 'light',
    heading: 'LIGHT',
    locked: false,
    appliesTo: 'both',
    stage: 'both',
    fallback:
      'Soft, large key light from about 45 degrees and a little above, with gentle ' +
      'fill so shadows under the eyes and chin stay open. A soft catchlight in the eyes.',
  },
  {
    id: 'contrast',
    heading: 'CONTRAST AND COLOUR',
    locked: false,
    appliesTo: 'both',
    stage: 'both',
    fallback:
      'Natural contrast with detail held in both the highlights and the shadows. ' +
      'Colour as a real camera would record it.',
  },
  {
    id: 'camera',
    heading: 'CAMERA',
    locked: false,
    appliesTo: 'both',
    stage: 'both',
    fallback: 'A steady camera at roughly eye level, with the unforced feel of a real hand holding it.',
  },
  {
    id: 'blocking',
    heading: 'FRAMING',
    locked: false,
    appliesTo: 'person',
    stage: 'both',
    fallback:
      'A medium shot. Head and shoulders with clear headroom and air on both ' +
      'sides, at a comfortable conversational distance — the face occupies a ' +
      'modest part of the frame.',
  },
  {
    id: 'props',
    heading: 'PROPS',
    locked: false,
    appliesTo: 'both',
    stage: 'both',
    fallback:
      'Only what the scene needs, and everything in it belongs to this place. ' +
      'Nothing decorative that a real person would not have to hand.',
  },
  {
    id: 'propMotion',
    heading: 'HOW THINGS MOVE',
    locked: false,
    appliesTo: 'both',
    stage: 'video',
    fallback:
      'Whatever is in a hand at the start is still in that hand at the end, and ' +
      'whatever rests on a surface stays where it rests. An object that moves is ' +
      'moved BY the person, visibly, in one continuous motion the camera can ' +
      'follow. There is exactly one of each object, and the same number at the end ' +
      'as at the start.',
  },
  {
    id: 'physics',
    heading: 'PHYSICS',
    locked: false,
    appliesTo: 'both',
    stage: 'both',
    fallback:
      'However much of anything appears, it is the amount a real person would use, ' +
      'and it behaves the way that material really behaves — a liquid pours and is ' +
      'absorbed, a powder settles, cloth drapes and creases, dust falls and rests. ' +
      'Nothing multiplies, pools or spreads beyond what was actually dispensed.',
  },
  {
    id: 'packaging',
    heading: 'PACKAGING',
    locked: false,
    appliesTo: 'both',
    stage: 'both',
    fallback:
      'Whatever the product is, it carries NO printing. Its surfaces are clean ' +
      'unmarked material and it is recognised by shape, colour, material and finish ' +
      'alone. Photograph it for its grain, its edges, its seams and the way light ' +
      'moves across it.',
  },
  {
    id: 'space',
    heading: 'THE SPACE',
    locked: false,
    appliesTo: 'both',
    stage: 'both',
    fallback:
      'This location has one fixed layout, shared by every shot in the ad. The key ' +
      'light comes from the same side of frame throughout, and the surroundings and ' +
      'props keep the positions they have in the other shots. The camera films from ' +
      'one side of the action for the whole ad, so what is on the left of frame ' +
      'stays on the left.',
  },
] as const;

/** The modules a template is allowed to speak for. */
export type OpenModuleId = Exclude<ModuleId, 'identity' | 'optics' | 'anatomy'>;

/**
 * A template's overrides. Everything omitted falls back to the registry.
 *
 * Partial on purpose: a template that only wants different lighting writes one
 * line and inherits eleven, which is the whole point of the split.
 */
export type TemplateModules = Partial<Record<OpenModuleId, string>> & {
  realism?: 'photoreal' | 'stylised';
};

const LOCKED = new Set<ModuleId>(['identity', 'optics', 'anatomy']);

/** True when a template may set this module. Used by the checks and the docs. */
export function isOpen(id: ModuleId): boolean {
  return !LOCKED.has(id);
}

/**
 * Build the direction for one shot, from the registry plus this template's
 * overrides.
 *
 * @param realism decides only the closing rule — a stylised world must not be
 *        told to be photorealistic, which is what a comic-book template was
 *        being told on every shot.
 */
export function composeDirection(opts: {
  shot: ShotKind;
  stage: 'still' | 'video';
  overrides?: TemplateModules;
  realism?: 'photoreal' | 'stylised';
  /* Per-RUN contracts — the look bible, and anything the caller needs to say
     about this particular shot. Placed after the modules and before the closing
     OUTPUT line, so the run's specifics are the last thing read before the
     rendering instruction. */
  trailing?: (string | undefined | null)[];
}): string {
  const isPerson = opts.shot === 'person';
  const realism = opts.realism ?? opts.overrides?.realism ?? 'photoreal';

  const lines = MODULES.filter((m) => {
    if (m.appliesTo === 'person' && !isPerson) return false;
    if (m.appliesTo === 'object' && isPerson) return false;
    if (m.stage !== 'both' && m.stage !== opts.stage) return false;
    return true;
  }).map((m) => {
    const override = isOpen(m.id) ? opts.overrides?.[m.id as OpenModuleId] : undefined;
    return `${m.heading}: ${override ?? m.fallback}`;
  });

  for (const t of opts.trailing ?? []) if (t) lines.push(t);

  lines.push(
    realism === 'stylised'
      ? 'OUTPUT: Rendered fully in the style described above, committed to rather ' +
          'than blended with realism. Authentic creator content, not a stock image ' +
          'or a studio ad. No text, no captions, no logos, no watermarks.'
      : 'OUTPUT: Photorealistic. Authentic creator content, not a stock photo or a ' +
          'studio ad. No text, no captions, no logos, no watermarks.',
  );

  return lines.join('\n');
}

/**
 * Which modules this template actually speaks for.
 *
 * Exposed so the gallery, the docs and the checks can all answer "what does
 * this template change?" from the data rather than from a comment that drifts.
 */
export function overriddenModules(overrides?: TemplateModules): OpenModuleId[] {
  if (!overrides) return [];
  return MODULES.filter((m) => isOpen(m.id) && overrides[m.id as OpenModuleId] !== undefined).map(
    (m) => m.id as OpenModuleId,
  );
}
