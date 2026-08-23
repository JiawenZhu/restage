/*
 * How the person should be photographed.
 *
 * This lived as four slightly different paragraphs across the orchestrator and
 * the render route, which drifted apart and each got a little worse. It is one
 * definition now, because it is one decision.
 *
 * THE DECISION: flatter the PHOTOGRAPH, never the FACE.
 *
 * A good portrait photographer makes someone look their best without changing
 * who they are — light, angle, lens and expression do the work, and bone
 * structure is left alone. That is the only version of "make me look good" that
 * is compatible with a product whose entire promise is that the person in the
 * ad is you. Slimming a jaw or enlarging eyes produces someone the user does
 * not recognise, which fails twice: it is not them, and they can tell.
 *
 * The previous prompts got this backwards in a specific, technical way, and the
 * complaint that faces came out looking OLDER was the symptom:
 *
 *   "35mm" — a wide lens. At the distance a face fills the frame, 35mm enlarges
 *   the nose, narrows the cheeks and stretches the edges. It is the geometry of
 *   an unflattering phone selfie, and it was being asked for by name. Portrait
 *   work is 85mm and up, where the compression flatters.
 *
 *   "eye-level" — neutral at best. A camera a little ABOVE eye level lifts the
 *   jawline and opens the eyes; a little below does the opposite.
 *
 *   "realistic skin pores, subsurface scattering" next to "do not beautify" —
 *   texture with no compensating light reads as harsh, and harsh reads as
 *   older. Skin should look like skin in good condition, which is not the same
 *   as either plastic or forensic.
 *
 * So: the anatomy lock stays exactly as strict as it was, and everything
 * photographic becomes flattering.
 *
 * LATER, from a finished ad: the third point was half-fixed and it showed. The
 * wording became "real texture and real pores, but even in tone" — still an
 * instruction to RENDER texture, with a brake on it. An instruction to invent
 * detail is answered differently every time it is given, and these shots are
 * generated independently, so one ad got a smooth twenty-something in shot one
 * and a lined face in shot four. The fix is to name the SOURCE of the texture
 * instead of its amount: copy the reference, do not invent. Amount is a dial the
 * model sets; a source is not.
 */

/*
 * The anatomy that must not move. This is what protects identity.
 *
 * APPARENT AGE WAS MISSING FROM THIS LIST, and its absence is a whole class of
 * defect: an ad that opened on a woman in her twenties and closed on the same
 * woman with crow's feet and nasolabial folds. Every frame in it satisfied the
 * lock as it was written — bone structure held, eye spacing held, the nose and
 * jaw were untouched — because nothing here said how OLD she was.
 *
 * That is not a small omission. Age is not carried by the geometry this lock
 * protects; it is carried almost entirely by skin, and skin was the one facial
 * property the prompt left to the model's discretion. Shots are generated
 * independently, so each one re-rolled that discretion, and across five shots
 * the roll came up differently. The face never changed. The age did, and to a
 * viewer that reads as a different person just as loudly.
 *
 * The lock is deliberately SYMMETRIC — no ageing and no de-ageing. It is
 * tempting to write only the half that fixes the complaint, but "do not add
 * wrinkles" applied to someone who has them is the same product failure in the
 * other direction: a person who does not recognise themselves. The reference is
 * the authority in both directions, which is the rule the rest of this file
 * already follows.
 */
export const IDENTITY_LOCK =
  'IDENTITY: This is a specific real person. Their bone structure, face width, ' +
  'jawline, eye shape and spacing, nose shape, lip shape, hairline, hairstyle, ' +
  'skin tone and eyeglasses are FIXED and must match the reference exactly. ' +
  'Do not slim the face, enlarge the eyes, reshape the nose or jaw, or make them ' +
  'look like a different person. Someone who knows them must recognise them ' +
  'instantly.';

/*
 * The optics that protect the face. GLOBAL, and a template may not opt out.
 *
 * This used to be one constant called FLATTERING_CAMERA that also owned the
 * lighting, the framing and the mood — so Film Noir's chiaroscuro and Moon
 * Expedition's jet-black shadows were overruled by "soft key at 45 degrees,
 * gentle fill, shadows stay open" on every single shot. Sixteen templates, one
 * look. See lib/style.ts.
 *
 * What stays here is only what the file's own header argues for: focal length
 * and distance. A 35mm lens at portrait range enlarges the nose, narrows the
 * cheeks and reads as older — that is geometry, it is not a mood, and no
 * template's idea is worth handing a user a face that is not theirs. Light,
 * colour, contrast and framing all moved to the template.
 */
export const FACE_GEOMETRY =
  'OPTICS: 85mm equivalent lens with natural compression whenever the face is ' +
  'a significant part of the frame — never a wide lens at close range, which ' +
  'distorts a face. ' +
  'Skin looks healthy and well-rested: real texture and real pores, but even in ' +
  'tone and not accentuated — not airbrushed to plastic, and not sharpened into ' +
  'every flaw. Relaxed, engaged expression. Flattering, and unmistakably them.';

/**
 * @deprecated Split into FACE_GEOMETRY (global) and the template's own style —
 * see lib/style.ts. Kept so older callers still compile; it is the default
 * style's lighting bolted back on, which is what it always was.
 */
export const FLATTERING_CAMERA = FACE_GEOMETRY;

/*
 * The props, and how much of the product there is.
 *
 * FOUND IN THE HERO, and it is a defect class nothing in this file addressed.
 * Across one eight-second clip:
 *
 *   t=3.5s  the bottle is in her right hand, dropper over her left palm
 *   t=5.0s  the bottle is GONE from her hand, and her hands are coated in a
 *           thick glossy layer of oil
 *   t=7.8s  the bottle is standing upright on a dish on the counter
 *
 * The bottle teleported, and a few drops became a handful. Neither is a face
 * problem, so every constraint in this file missed it: IDENTITY_LOCK protects a
 * person, lookContract fixes the room and the wardrobe, and NOTHING said the
 * objects have to obey physics. Veo was given eight seconds of freedom over the
 * props and used it.
 *
 * It reads worse than a wrong face in one specific way. A viewer may not
 * consciously notice a jaw shifting, but a bottle that moves on its own is the
 * kind of wrongness people spot immediately and cannot un-see — and for a
 * product ad, greasy hands are simply bad advertising for the product.
 *
 * Written as AFFIRMATIONS, not prohibitions. "The bottle stays in the hand that
 * is holding it" rather than "the bottle does not teleport" — the artefact
 * words belong in VIDEO_NEGATIVE_PROMPT, which is where they now also are.
 */
export const PROP_CONTINUITY =
  'PROPS AND PHYSICS: Every object obeys ordinary physics and ordinary ' +
  'continuity. Whatever is in a hand at the start of the clip is still in that ' +
  'hand at the end, and whatever is resting on a surface stays exactly where it ' +
  'is resting. An object that moves is moved BY the person, visibly, in one ' +
  'continuous motion the camera can follow. There is exactly one of each object ' +
  'in this scene, and the same number at the end as at the start.\n' +
  /*
   * MATERIAL-AGNOSTIC, and the first version was not.
   *
   * It read "a few drops of the product means a few drops… the way a
   * well-formulated oil behaves on real skin", which is a rule about facial
   * oil. That is the product in the LANDING-PAGE DEMO and nothing else. The
   * gallery runs to lunar expeditions, comic-book panels, video-game reveals
   * and period pieces, and a real user brings their own product to any of
   * them — so a global constant that assumes a dropper bottle is wrong for
   * fifteen of the sixteen templates.
   *
   * What the props actually are comes from the template's own scene and from
   * the look bible the planner writes for that run. This file only says how
   * matter behaves, which is the same everywhere.
   */
  'QUANTITY AND MATERIAL: however much of anything appears, it is the amount a ' +
  'real person would use, and it behaves the way that material really behaves — ' +
  'a liquid pours and is absorbed, a powder settles, cloth drapes and creases, ' +
  'dust falls and rests. Nothing multiplies, pools or spreads beyond what was ' +
  'actually dispensed, and a surface that something is worked into looks like ' +
  'that material was worked into it, not coated in it.';

/*
 * Hands and packaging — the two things a viewer catches instantly.
 *
 * PACKAGING was already "handled" and demonstrably was not. OUTPUT_RULES has
 * said 'No text, no captions, no logos, no watermarks' from the beginning, and
 * every bottle this product has ever generated carries invented lettering
 * anyway: LUMEN, a paragraph of blurred pseudo-English, a fake ingredients
 * panel. That is the negation trap again — 'no text' names text — and it
 * matters more here than elsewhere because IMAGE generation has no negative
 * channel at all. generateFrame sends no negativePrompt, so for a still there
 * is nowhere else to put it: the positive prompt has to describe a blank label
 * as a POSITIVE FACT about the object rather than as an absence.
 *
 * Hands are the other one. Fingers already appear in VIDEO_NEGATIVE_PROMPT, but
 * only there — the stills that Veo animates were being generated with nothing
 * said about hands at all, and a still with six fingers animates into eight
 * seconds of six fingers.
 */
export const HANDS_AND_PACKAGING =
  'HANDS: five fingers on each hand, in natural proportion. Where a hand holds ' +
  'something the fingers wrap around it and press into it, with real contact ' +
  'and real weight.\n' +
  /*
   * Scoped to the PRODUCT, deliberately.
   *
   * This ended "every surface in the frame is likewise blank: plain walls,
   * plain packaging, plain fabric", which is broader than the problem and
   * would flatten templates that are stylistically about graphics — the
   * sci-fi template has 3D typography reading MASS resolving behind the
   * creator, and that is the template's whole identity, not an artefact. The
   * defect being fixed is invented lettering on the PRODUCT, so that is what
   * this constrains.
   */
  'PACKAGING: whatever the product is, it carries NO printing. Its surfaces are ' +
  'clean unmarked material and it is recognised by shape, colour, material and ' +
  'finish alone. Photograph it for its grain, its edges, its seams and the way ' +
  'light moves across it.';

/*
 * Where the camera stands, and where the room is.
 *
 * Shots are generated independently, so nothing has ever fixed the GEOMETRY of
 * the set the way lookContract fixes its contents. lookContract says the room
 * has an oak counter and a casement window; it does not say the window is on
 * the left, so one shot puts it left and the next puts it right, and the two
 * cut together as though the creator teleported across her own kitchen.
 *
 * This is the film-grammar rule usually called not crossing the line: keep the
 * camera on one side of the action and left stays left.
 */
export const SPATIAL_CONTINUITY =
  /* "The window" was in here, which is the demo's kitchen. A lunar surface has
     no window; a comic-book panel has no counter. The rule is about geometry,
     so it names light and layout rather than furniture. */
  'THE SPACE: this location has one fixed layout, shared by every shot in the ' +
  'ad. The key light comes from the same side of frame throughout, and the ' +
  'surroundings and props keep the positions they have in the other shots. The ' +
  'camera films from one side of the action for the whole ad, so what is on the ' +
  'left of frame stays on the left.';

/** Shared closing constraints. */
export const OUTPUT_RULES =
  'Photorealistic. Authentic creator content, not a stock photo or a studio ad. ' +
  'No text, no captions, no logos, no watermarks.';

/*
 * The same, for a world that is not a photograph.
 *
 * OUTPUT_RULES opens with the word "Photorealistic" and was appended to every
 * shot of every template — including Comic Book Hero, whose whole look is ink
 * line art and visible CMYK dots. The template asked for one thing and the
 * closing line of its own prompt asked for the opposite.
 *
 * The rest of the rule survives in both worlds: an ad still should not look
 * like a stock photo, and invented lettering is as wrong in a cel-shaded panel
 * as in a photograph.
 */
export function outputRulesFor(style: ShotStyle): string {
  return style.realism === 'stylised'
    ? 'Rendered fully in the style described above, committed to rather than ' +
        'blended with realism. Authentic creator content, not a stock image or a ' +
        'studio ad. No text, no captions, no logos, no watermarks.'
    : OUTPUT_RULES;
}

/**
 * The FIRST frame, where the look is being established.
 *
 * This is the only place FLATTERING_CAMERA belongs. It is a hard, absolute
 * recipe — 85mm, camera slightly above eye level, soft key at 45 degrees — and
 * a recipe is the right thing to give a shot that does not exist yet.
 */
export function establishingDirection(): string {
  return `${IDENTITY_LOCK}\n${FLATTERING_CAMERA}\n${OUTPUT_RULES}`;
}

/**
 * Every LATER frame, which is an edit of the frame before it.
 *
 * THE BUG THIS EXISTS TO FIX: continuation steps were also given
 * FLATTERING_CAMERA. So the same prompt said, in consecutive sentences, "keep
 * the camera position and lighting of the image you are editing unchanged" and
 * "use an 85mm lens, camera slightly above eye level, soft key light at 45
 * degrees with a catchlight in the eyes". Those are different instructions, and
 * the recipe was re-asserted on every single step — so the model re-framed and
 * re-lit each time, which is exactly the frame-to-frame pop that made a
 * six-frame storyboard look like six unrelated photographs.
 *
 * It also made whole categories of planned step impossible by construction: a
 * step that asks to pull wide, or to crop in, or to move to a window, cannot be
 * carried out by a prompt that simultaneously demands a fixed portrait setup.
 *
 * The look is not specified here because it is already IN the image being
 * edited. What replaces it is a lock: whatever that image does, keep doing.
 */
export function continuationDirection(): string {
  return (
    `${IDENTITY_LOCK}\n` +
    'CONTINUITY: The FIRST image is this shot as it already exists, and it is ' +
    'the reference for everything the instruction does not name. Its camera ' +
    'position, focal length, framing, key-light direction, colour temperature ' +
    'and exposure are FIXED — reproduce them exactly. The location, the ' +
    'furniture, the background, the clothing and the props are FIXED. This is ' +
    'the same continuous take a moment later, not a new photograph of the same ' +
    'person: change only what the instruction names, and change nothing else.\n' +
    `${OUTPUT_RULES}`
  );
}

/**
 * @deprecated Say which of the two cases you mean — establishingDirection() for
 * the opening frame, continuationDirection() for an edit of an existing one.
 * One shared "still" direction is what let the camera recipe leak into every
 * continuation step.
 */
export function stillDirection(): string {
  return establishingDirection();
}

/*
 * Everything, for a video segment.
 *
 * WHAT WENT WRONG HERE, seen in a real render: across six frames of one clip the
 * mouth and jaw did something different every frame — chin elongating, jaw
 * widening, teeth bared — until two of the six frames were a rounder-jawed
 * stranger. The upper face held. The lower face did not. Three causes, all of
 * them things the prompt was asking for:
 *
 *   1. IT ASKED THE JAW TO MOVE. "The creator speaks with authentic charisma,
 *      fluid subtle jaw articulation" — a talking mouth at close range is the
 *      single hardest thing a video model renders, and it was requested by name.
 *      Worse, it buys nothing: the voiceover is a separate TTS track muxed on
 *      afterwards, so the mouth is not synced to any words. A mouth moving to
 *      words it is not saying is worse than a mouth at rest, AND it deforms.
 *
 *   2. IT ASKED FOR A CLOSE-UP. Arm's length plus a face-filling frame means
 *      every pixel of jawline has to be generated, at 720p, at 24fps. Compare a
 *      medium shot of the same person from the same model family: the face sits
 *      at a fraction of the frame height and holds perfectly.
 *
 *   3. IT PUT THE ARTEFACTS IN THE POSITIVE PROMPT. "no drift, no morphing, no
 *      rubbery skin, no warping" conditions on drift, morphing, rubbery skin and
 *      warping. Those words belong in VIDEO_NEGATIVE_PROMPT, which is where they
 *      are now, and nowhere near here.
 */
export function motionDirection(style: ShotStyle = DEFAULT_STYLE): string {
  return (
    composeDirection({
      shot: 'person',
      stage: 'video',
      overrides: modulesFromStyle(style),
      realism: style.realism,
    }) +
    '\n' +
    /* Framing comes from the style now. What stays is the one rule that is
       about the FACE rather than the composition: all of it has to be in
       frame, or Veo has a partial head to reinterpret every frame. */
    'Keep the whole head inside the frame for the entire clip.\n' +
    'MOTION: Small and calm. A gentle breath, a slow blink, the faintest shift of ' +
    'weight, one small head movement at most. The mouth stays closed or holds a ' +
    'soft, easy smile; lips and jaw stay settled. Hold one steady expression for ' +
    'the whole clip rather than travelling through several. Natural 24fps motion ' +
    'blur.\n' +
    /* The person is usually the one HOLDING the product, so this shot is where
       a teleporting bottle is most likely and most visible. */
    `${PROP_CONTINUITY}\n` +
    `${OUTPUT_RULES}`
  );
}

/*
 * The dedicated negative channel.
 *
 * These rules were being carried as negations inside the POSITIVE prompt —
 * "no warping", "NO exaggerated facial grimacing", "NO facial shape
 * deformation" — which is the one construction a diffusion model is least
 * reliable at honouring, because the tokens it is being told to avoid are the
 * tokens it is being conditioned on. Veo takes a negativePrompt parameter and
 * it was simply never sent.
 *
 * Kept short and concrete. A long negative prompt starts removing things nobody
 * asked to remove.
 *
 * DELIBERATELY ABSENT: anything about age. When an ad came back with a face
 * that gained wrinkles part-way through, the obvious move was to add "wrinkles,
 * aged skin, ageing face" here — and it is the wrong move, because a negative
 * prompt is not symmetric. It only ever subtracts. On a user who HAS lines it
 * would smooth them out and hand back someone they do not recognise, which is
 * the same defect wearing the other mask, and on the product's own terms a worse
 * one: this is a tool for putting YOUR face in an ad. Age is held by the
 * two-directional lock in IDENTITY_LOCK, where "match the reference" can mean
 * both add and remove. That is the only channel that can express it.
 */
export const VIDEO_NEGATIVE_PROMPT =
  'blurry, out of focus, distorted face, warped features, morphing face, ' +
  'face drift between frames, rubbery skin, waxy plastic skin, extra fingers, ' +
  'deformed hands, exaggerated grimace, stretched jaw, wide-angle lens ' +
  'distortion, harsh overhead lighting, text, captions, subtitles, watermark, logo, ' +
  /* The prop artefacts, named here rather than negated inside PROP_CONTINUITY.
     Measured in the hero: a bottle that left a hand mid-clip and reappeared
     standing on a dish, and a few drops of oil that became coated, glossy
     hands. Both are things a viewer notices instantly. */
  'teleporting objects, objects appearing from nowhere, objects vanishing, ' +
  'duplicated objects, floating objects, greasy shiny hands, excessive liquid, ' +
  'dripping mess, spilled product, ' +
  /* Packaging text is the one the user has seen on every render. It is in
     OUTPUT_RULES as "no text" and has never once worked there, for the reason
     given on HANDS_AND_PACKAGING. */
  'lettering on packaging, printed label, product name, brand name, ' +
  'ingredient list, gibberish writing, six fingers, malformed hands';

/**
 * The negative prompt for one shot, which depends on what the shot is OF.
 *
 * FOUND IN THE SHIPPED LANDING-PAGE HERO. Its middle shot is a `product` step —
 * a dropper bottle, no person in it — and the finished clip is dominated by a
 * woman's face in profile. Not the persona's face either: light brown hair,
 * where the shot before and after it have near-black hair. A three-shot ad
 * whose entire job is to prove one face survives every shot contains, on the
 * live site, two different women and neither is the one in the enrolment
 * thumbnails printed beside the video.
 *
 * The direction was not silent about this. objectShotDirection says "no face
 * and no head appear in the frame", and objectMotionDirection says "Nobody's
 * face enters the frame at any point." Both are NEGATIONS INSIDE THE POSITIVE
 * PROMPT, which is the one construction this file already documents as the
 * least reliable available — the tokens being forbidden are the tokens being
 * conditioned on. The comment on VIDEO_NEGATIVE_PROMPT makes exactly this
 * argument about warping, and the fix never reached the face-exclusion rules
 * because the negative prompt was a single constant shared by every shot kind:
 * putting "face, person" in it would have stripped the face out of the person
 * shots too.
 *
 * Making it depend on the shot is what lets each kind say the true thing. A
 * person shot still wants a well-rendered face and only rejects a broken one. A
 * shot of a bottle wants no face at all, and can now say so in the channel that
 * actually suppresses.
 */
export function videoNegativeFor(kind: ShotKind): string {
  if (kind === 'person') return VIDEO_NEGATIVE_PROMPT;
  return (
    `${VIDEO_NEGATIVE_PROMPT}, ` +
    /* Ordered widest-first: the model is likelier to honour the leading terms,
       and "person" excludes the failure more completely than "face" does. */
    'person, human face, head, portrait, someone looking at camera, ' +
    'shoulders, hair'
  );
}

/**
 * For a video segment that begins on the tail of the segment before it.
 *
 * A shot longer than Veo's 8-second ceiling is rendered in pieces, and each
 * piece after the first is seeded with the LAST FRAME of the one before — which
 * has to be the true last frame or the join is a visible jump. So this one path
 * really does chain, and unlike the still pipeline it cannot be un-chained.
 *
 * What makes it worse than an ordinary chain is the quality of the link. The
 * seed is not a generated still; it is a frame pulled out of encoded 720p video,
 * so it is soft, often carries motion blur, and has lost most of its fine skin
 * detail. Asked for a photorealistic clip from that, a model reasonably fills
 * the missing detail back in — and invented facial detail is, specifically,
 * lines. Three segments of it is three rounds of invention, always in the same
 * direction, which is why a long shot ages as it runs.
 *
 * Naming the softness as an artefact of the codec is what stops it being read as
 * information about the person.
 */
export const SOFT_SEED_NOTE =
  'The frame you have been given is a still lifted from the end of the previous ' +
  'video segment, so it is softer and less detailed than a photograph. That ' +
  'softness is video compression, not the person: do not sharpen the face to ' +
  'compensate, and do not add skin texture, lines or shadow that the softness is ' +
  'merely hiding. The same person at the same apparent age continues.';

/* ── shot-list direction ──────────────────────────────────────────────────── */

import type { CastingNote, LookBible, ShotKind } from './types';
import { DEFAULT_STYLE, type ShotStyle } from './style';
import { composeDirection, type TemplateModules } from './modules';

/*
 * A ShotStyle, as module overrides.
 *
 * ShotStyle is the older three-slot shape (light / camera / realism) and every
 * caller still speaks it. The registry is the twelve-slot one. Rather than
 * change every signature at once, this maps the three onto their module ids and
 * lets the other nine fall back — so a caller that only knows about lighting
 * still gets the full module set, and a template that sets `physics` gets it
 * through modulesForTemplate without anything else changing.
 */
function modulesFromStyle(style: ShotStyle): TemplateModules {
  return {
    light: style.light,
    camera: style.camera,
    /* ShotStyle.camera has always carried framing as well — DEFAULT_STYLE's is
       literally "a medium shot, head and shoulders" — so a style that came from
       a template must not ALSO get the default blocking line underneath it,
       contradicting itself. */
    ...(style !== DEFAULT_STYLE ? { blocking: style.camera } : {}),
    realism: style.realism,
    ...style.modules,
  };
}

/*
 * The continuity contract, as text.
 *
 * Six frames used to look like one shoot because each was an EDIT of the last —
 * continuity inherited for free, and paid for in generation loss: by step six
 * the picture was six reinterpretations away from the enrolment photo and the
 * jaw belonged to somebody else.
 *
 * Shots generated independently do not inherit anything, so the contract has to
 * be written down and handed to every one of them. This is that contract. It is
 * how a real production works — a look book, not a photocopy of yesterday.
 */
export function lookContract(look: LookBible | null | undefined): string {
  if (!look) return '';
  return (
    'THE SHOOT (every shot in this ad is the same afternoon, same place):\n' +
    `  Location: ${look.location}\n` +
    `  Wardrobe: ${look.wardrobe}\n` +
    `  Light: ${look.light}\n` +
    `  Palette: ${look.palette}\n` +
    `  Product: ${look.product}\n` +
    'Match all of the above exactly. It is the same shoot, a few minutes later.'
  );
}

/*
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT WAS TRIED AGAINST APPARENT-AGE DRIFT, AND WHAT THE NUMBERS SAID
 *
 * The complaint: "the character at the beginning is very young, but later the
 * girl has wrinkles." Real, reproducible, and none of the text below fixed it.
 * Written down because the obvious idea is a trap and the next person will
 * have it too.
 *
 * Method: three person shots from one face against one look, generated twice —
 * once with the direction as it shipped, once with the candidate — then an
 * apparent age read blind off each frame. The number that matters is the SPREAD
 * within a set. Also a counterbalanced blind pairing, "which set holds one
 * person better", asked in both orders with only order-invariant answers
 * counted. scripts/diag-age-drift.mts and scripts/judge-consistency.mts.
 *
 *   REFERENCE FRAME as a fourth input      3y→2y, 3y→0y      BETTER, twice
 *   casting note, wrinkles enumerated      1→1, 2→3, 4→5     worse; judge 0–5
 *   casting note, no wrinkle vocabulary    1→3               worse
 *
 * The text approaches lost every time, and they got worse the more precisely
 * they described the skin. Enumerating the marks — "do not add wrinkles,
 * crow's feet, nasolabial folds" — is the failure this file already documents
 * on VIDEO_NEGATIVE_PROMPT: a positive prompt CONDITIONS ON WHAT IT NAMES, so
 * an inventory of someone's fine lines draws fine lines. Removing the
 * vocabulary and keeping only "apparent age … neither older nor younger" still
 * lost, which suggests the word AGE is itself enough to pull the render older.
 *
 * The one thing that worked is the one thing that never says any of it: hand
 * the model a picture of the face and let it match. It was dropped because it
 * dragged the STAGING along too — shots one and three came back as the same
 * seated pose in the same crop — and that is a fixable problem: crop the anchor
 * to the head, so there is no composition in the image to copy. That is the
 * next thing to try, and it starts from evidence rather than from an idea.
 *
 * castPerson() and CastingNote are kept. The age they read is accurate and
 * stable — four independent readings of the same face gave 28–33, 28–33, 27–32,
 * 26–30 — which makes them a good diagnostic for "did this run come out older
 * than the person actually is". They are simply not prompt material.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/*
 * The person half of the look contract.
 *
 * lookContract() pins down the room, the wardrobe, the light and the product,
 * and every shot is generated against it — which is why the SETTING holds
 * across an ad whose shots never see each other. There was no equivalent
 * sentence for the person, so everything about how they were photographed that
 * the enrolment captures do not fix — apparent age, skin, hair, make-up — was
 * re-decided from scratch on every shot.
 *
 * WHY THIS IS TEXT AND NOT A REFERENCE FRAME. The obvious fix is to hand later
 * shots a frame from earlier in the ad. It was built that way first and it did
 * hold the face — and it also dragged the staging along with it. Measured on a
 * three-shot run: shots one and three came back as the same seated pose in the
 * same crop from the same camera position, differing only in expression, where
 * the unanchored version had produced a seated shot, a standing shot at the
 * window, and a wide. An ad whose every person shot is the same shot is a worse
 * ad than one whose face wobbles.
 *
 * That was not a wording problem, and it is worth being clear about why, because
 * the wording had already been tried. The anchored prompt said, in as many
 * words, "framing, camera angle and what the person is doing come from the
 * instruction below, not from the anchor — copy the person, not the
 * composition." It collapsed anyway. A reference image cannot show a face
 * without also showing a composition, so asking for one and not the other is
 * asking the model to unsee half of what it was given.
 *
 * A sentence has no composition in it. This carries exactly the properties that
 * drift and none of the ones that must not be copied — which makes it
 * structural rather than a request, the same move as putting artefact rules in
 * VIDEO_NEGATIVE_PROMPT instead of negating them in the positive prompt.
 *
 * Read off the ENROLMENT CAPTURES rather than off the first accepted frame, so
 * the ad is consistent AND right. Anchoring to a frame makes a run agree with
 * whatever its first shot happened to do, including its mistakes.
 */
export function castingContract(casting: CastingNote | null | undefined): string {
  if (!casting) return '';
  /*
   * `skin` is DELIBERATELY NOT INTERPOLATED, and leaving it out is the whole
   * lesson of this function's first version.
   *
   * That version printed it, and castPerson writes it as free prose — so a
   * typical run put "faint fine lines at the outer corners of the eyes, shallow
   * nasolabial creases, subtle under-eye hollows" into the POSITIVE prompt of
   * every person shot. Measured against the direction it replaced, over three
   * A/B trials and a counterbalanced blind comparison, it lost 0–5. It made the
   * exact defect it was written to fix measurably worse.
   *
   * The reason is written three screens up, on VIDEO_NEGATIVE_PROMPT: naming a
   * feature in a positive prompt CONDITIONS ON IT. An image model handed a
   * careful inventory of someone's fine lines draws fine lines. It does not
   * matter that the sentence around them said "do not add" — that is the same
   * construction as "no warping", which this file already established does not
   * work and moved to the negative channel.
   *
   * The field is still read and still stored, because it is genuinely useful
   * for diagnosis when a run comes out wrong. It just must not reach the model.
   * Age survives because a range is a fact about a person, not a feature to
   * render — "mid-thirties" contains nothing for the model to draw.
   */
  return (
    'THE PERSON (read from their photographs; the same in every shot of this ad):\n' +
    `  Apparent age: ${casting.age}\n` +
    `  Hair: ${casting.hair}\n` +
    `  Make-up: ${casting.makeup}\n` +
    `  Distinctive: ${casting.distinctive}\n` +
    'Photograph them at that age in every shot, neither older nor younger. This ' +
    'describes the person, not the picture: the framing, the camera position ' +
    'and what they are doing come from the instruction below.'
  );
}

/**
 * A shot with the creator in it.
 *
 * Always built from the ENROLMENT CAPTURES, never from the previous frame —
 * that is the entire point of the change. A person shot at step five used to be
 * five generations of reinterpretation deep; now it is one, exactly like the
 * first shot, no matter where it falls in the story.
 *
 * @param casting the run's casting note, which is what holds apparent age
 *        steady from shot to shot. Absent on runs planned before it existed,
 *        and on those the shot is generated exactly as it used to be.
 */
export function personShotDirection(
  look: LookBible | null | undefined,
  /*
   * ACCEPTED AND DELIBERATELY NOT USED. See the measurements below before
   * wiring it back in — this parameter has been through three versions and all
   * three made the defect worse.
   */
  casting?: CastingNote | null,
  /* The template's world. Omitted means DEFAULT_STYLE, which is the recipe
     this file used to hard-code for everything. */
  style: ShotStyle = DEFAULT_STYLE,
): string {
  void casting;
  return [
    'The images provided are reference photographs of a specific real person, ' +
      'taken from several angles. They are not the shot. Build a NEW photograph ' +
      'of that same person as described below.',
    composeDirection({
      shot: 'person',
      stage: 'still',
      overrides: modulesFromStyle(style),
      realism: style.realism,
      trailing: [lookContract(look)],
    }),
  ].join('\n');
}

/**
 * A shot with no face in it: the product, a detail, the room.
 *
 * Deliberately carries no identity lock and no portrait recipe. There is no
 * face to hold, so every constraint that exists to protect one is dead weight
 * here — and the flattering-portrait direction would actively fight a macro
 * shot of a label or a wide of an empty kitchen.
 *
 * These are the shots that cost nothing in identity risk, which is why an ad
 * should be mostly made of them.
 */
export function objectShotDirection(
  kind: ShotKind,
  look: LookBible | null | undefined,
  style: ShotStyle = DEFAULT_STYLE,
): string {
  const craft =
    kind === 'detail'
      ? 'A close macro shot. Shallow depth of field, one clean plane of focus on the ' +
        'texture or lettering that matters, everything else falling off softly. No person in frame.'
      : kind === 'scene'
        ? 'An establishing shot of the place itself. Nobody in frame. Depth and ' +
          'atmosphere — the room doing the talking.'
        : 'A product shot. The item is the subject and reads clearly. Hands may hold or ' +
          'steady it, but no face and no head appear in the frame.';

  return [
    (style.realism === 'stylised' ? 'Still frame. ' : 'Photorealistic still. ') + craft,
    composeDirection({
      shot: kind,
      stage: 'still',
      overrides: modulesFromStyle(style),
      realism: style.realism,
      trailing: [
        lookContract(look),
        'Shot on the same camera and lens as the rest of this ad, so it cuts ' +
          'together with shots of the person without a jump in look.',
      ],
    }),
  ].join('\n');
}

/**
 * Motion for a shot with no person in it.
 *
 * A gap that opened the moment shots stopped all being of the person: the video
 * prompt applied motionDirection() to everything, so a macro of a label was
 * being told "IDENTITY: this is a specific real person… 85mm portrait lens,
 * soft key at 45 degrees, a catchlight in the eyes." Every one of those
 * constraints exists to protect a face, and there is no face here — they can
 * only fight the shot.
 *
 * What these shots actually need is the opposite of a portrait: motion small
 * enough to read as a real camera on a real table, and nothing invented.
 */
export function objectMotionDirection(
  kind: ShotKind,
  look: LookBible | null | undefined,
  style: ShotStyle = DEFAULT_STYLE,
): string {
  const move =
    kind === 'detail'
      ? 'A very slow drift or a gentle rack of focus across the surface. The subject barely moves; the camera barely moves.'
      : kind === 'scene'
        ? 'A slow, almost still push or drift through the space. Light shifts, dust hangs, nothing lurches.'
        : 'The item turns slowly, or a hand steadies and repositions it. Small, deliberate, unhurried.';

  return [
    `MOTION: ${move} Natural 24fps motion blur. Nobody's face enters the frame at any point.`,
    composeDirection({
      shot: kind,
      stage: 'video',
      overrides: modulesFromStyle(style),
      realism: style.realism,
      trailing: [
        lookContract(look),
        'Shot on the same camera and lens as the rest of this ad, so it cuts together without a jump.',
      ],
    }),
  ]
    .filter(Boolean)
    .join('\n');
}
