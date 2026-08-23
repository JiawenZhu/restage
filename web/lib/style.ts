/*
 * What a TEMPLATE gets to decide about how its shots look.
 *
 * THE PROBLEM THIS FIXES. Every template already declares its own world —
 * lightingAndColor, cameraMotion, secondaryPhysics — and every one of those
 * reached the PLANNER and stopped there. The planner turned them into words in
 * a shot list; the actual image and video prompts then applied one global
 * photographic recipe to all sixteen. So the gallery said:
 *
 *   Moon Expedition   "jet-black cast shadows, crisp high-contrast"
 *   Film Noir         "high-contrast chiaroscuro, Dutch tilt"
 *   Comic Book Hero   "bold black ink line art, cel-shaded"
 *
 * and every one of them was then told, in the same breath, "soft large key
 * light at 45 degrees with gentle fill so shadows stay open, no harsh
 * lighting… photorealistic". Sixteen templates flattened into one soft-lit
 * photoreal portrait. A gallery of moods that were only ever adjective sets.
 *
 * THE SPLIT. The global recipe was not arbitrary — it exists to protect the
 * face, and the file it came from records why: a 35mm lens at portrait distance
 * enlarges the nose and narrows the cheeks, and faces came back looking older.
 * So it divides in two:
 *
 *   GEOMETRY — focal length, distance, no wide-angle distortion at close
 *              range. Global, non-negotiable, because it is what keeps the
 *              user's face theirs. A template may not opt out.
 *   MOOD     — light quality, colour, contrast, framing, rendering style.
 *              The template's, entirely. This is what the user chose it for.
 *
 * A template can therefore be as dark, as hard-lit, as stylised or as wide as
 * its idea demands, and the one thing it cannot do is photograph the face
 * through a lens that deforms it.
 */
import { getTemplateById, type CreativeTemplate } from './templates';
import type { TemplateModules } from './modules';

export interface ShotStyle {
  /** Light quality, colour and contrast. The template's, or a safe default. */
  light: string;
  /** Framing and camera movement. Also the template's. */
  camera: string;
  /**
   * Whether this world is a photograph.
   *
   * Decided by category rather than per template, so a new template inherits
   * the right answer from where it is filed. 'Photorealistic' is asserted in
   * OUTPUT_RULES for everything today, which is simply false for Comic Book
   * Hero — a template whose entire look is ink line art and CMYK dots.
   */
  realism: 'photoreal' | 'stylised';
  /*
   * Everything else the template overrides — physics, props, contrast, space.
   *
   * ShotStyle predates the module registry and had exactly three slots, which
   * is why only light, camera and realism were ever honoured. Carrying the rest
   * here means a template that sets `modules.physics` reaches the prompt
   * without another signature change anywhere.
   */
  modules?: TemplateModules;
}

/*
 * Categories that are photographs of the real world, and categories that are
 * not. Filed by category on purpose: a seventeenth template dropped into
 * 'Gaming' should not have to remember to declare itself stylised.
 */
const STYLISED_CATEGORIES: ReadonlySet<CreativeTemplate['category']> = new Set([
  'Sci-Fi',
  'Artistic',
  'Gaming',
]);

/*
 * The default, for a run with no template at all.
 *
 * This is the old global recipe, minus the geometry that moved to
 * FACE_GEOMETRY. A bare goal with no template still gets a good-looking,
 * well-lit portrait — that behaviour was correct and is unchanged.
 */
export const DEFAULT_STYLE: ShotStyle = {
  light:
    'Soft, large key light from about 45 degrees and a little above, with gentle ' +
    'fill so shadows under the eyes and chin stay open. A soft catchlight in the eyes.',
  camera:
    'A medium shot. Head and shoulders with clear headroom and air on both sides, ' +
    'at a comfortable conversational distance — the face occupies a modest part of the frame.',
  realism: 'photoreal',
};

/**
 * The style for a run, from whatever templateId it recorded.
 *
 * Takes the id rather than the template because a run with NO template is the
 * ordinary case — a user typing a bare goal — and every call site would
 * otherwise repeat the same undefined-guard around getTemplateById.
 */
export function styleForRun(templateId: string | null | undefined): ShotStyle {
  return styleForTemplate(templateId ? getTemplateById(templateId) : null);
}

export function styleForTemplate(tpl: CreativeTemplate | null | undefined): ShotStyle {
  if (!tpl) return DEFAULT_STYLE;
  return {
    light: tpl.modules?.light ?? tpl.lightingAndColor,
    camera: tpl.modules?.camera ?? tpl.cameraMotion,
    realism: tpl.modules?.realism ?? (STYLISED_CATEGORIES.has(tpl.category) ? 'stylised' : 'photoreal'),
    modules: tpl.modules,
  };
}

/**
 * The full module set for a run: the template's explicit overrides, plus the
 * two it declares in prose (lightingAndColor / cameraMotion) mapped onto their
 * module ids.
 *
 * The prose fields predate the registry and every one of the original sixteen
 * templates uses them, so they are treated as overrides of `light` and `camera`
 * rather than being migrated — a migration would rewrite sixteen authored
 * descriptions to say what they already say.
 */
export function modulesForTemplate(tpl: CreativeTemplate | null | undefined): TemplateModules {
  if (!tpl) return {};
  return {
    light: tpl.lightingAndColor,
    camera: tpl.cameraMotion,
    realism: STYLISED_CATEGORIES.has(tpl.category) ? 'stylised' : 'photoreal',
    /* Explicit overrides win over the prose fields. */
    ...tpl.modules,
  };
}

export function modulesForRun(templateId: string | null | undefined): TemplateModules {
  return modulesForTemplate(templateId ? getTemplateById(templateId) : null);
}

/**
 * The style block as it appears in a shot prompt.
 *
 * Named THE LOOK OF THIS AD rather than "style", because the model reads it
 * alongside lookContract's THE SHOOT and castingContract's THE PERSON, and
 * those three together are meant to read as one production's paperwork.
 */
export function styleContract(style: ShotStyle): string {
  return (
    'THE LOOK OF THIS AD:\n' +
    `  Light and colour: ${style.light}\n` +
    `  Camera and framing: ${style.camera}\n` +
    (style.realism === 'stylised'
      ? '  Rendering: this ad is NOT a photograph. Render it in the style named ' +
        'above, committing to it fully rather than splitting the difference with ' +
        'realism.\n'
      : '  Rendering: a real photograph, made with a real camera.\n')
  );
}
