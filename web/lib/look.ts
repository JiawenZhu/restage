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
 */

/** The anatomy that must not move. This is what protects identity. */
export const IDENTITY_LOCK =
  'IDENTITY: This is a specific real person. Their bone structure, face width, ' +
  'jawline, eye shape and spacing, nose shape, lip shape, hairline, hairstyle, ' +
  'skin tone and eyeglasses are FIXED and must match the reference exactly. ' +
  'Do not slim the face, enlarge the eyes, reshape the nose or jaw, or make them ' +
  'look like a different person. Someone who knows them must recognise them ' +
  'instantly.';

/** How to light, frame and shoot them. This is where flattery is allowed. */
export const FLATTERING_CAMERA =
  'PHOTOGRAPHY: Shoot them the way a good portrait photographer would. ' +
  '85mm equivalent lens with natural compression — never a wide lens, which ' +
  'distorts a face at close range. Camera very slightly above eye level. ' +
  'Soft, large key light from about 45 degrees and a little above, with gentle ' +
  'fill so shadows under the eyes and chin stay open — no harsh overhead or ' +
  'under-lighting. A soft catchlight in the eyes. ' +
  'Skin looks healthy and well-rested: real texture and real pores, but even in ' +
  'tone and not accentuated — not airbrushed to plastic, and not sharpened into ' +
  'every flaw. Relaxed, engaged expression. Flattering, and unmistakably them.';

/** Shared closing constraints. */
export const OUTPUT_RULES =
  'Photorealistic. Authentic creator content, not a stock photo or a studio ad. ' +
  'No text, no captions, no logos, no watermarks.';

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
export function motionDirection(): string {
  return (
    `${IDENTITY_LOCK}\n${FLATTERING_CAMERA}\n` +
    'FRAMING: A medium shot. Head and shoulders with clear headroom above and ' +
    'air on both sides, at a comfortable conversational distance — the face ' +
    'occupies a modest part of the frame, the way a person filmed across a table ' +
    'looks. Keep the whole head inside the frame for the entire clip.\n' +
    'MOTION: Small and calm. A gentle breath, a slow blink, the faintest shift of ' +
    'weight, one small head movement at most. The mouth stays closed or holds a ' +
    'soft, easy smile; lips and jaw stay settled. Hold one steady expression for ' +
    'the whole clip rather than travelling through several. Natural 24fps motion ' +
    'blur.\n' +
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
 */
export const VIDEO_NEGATIVE_PROMPT =
  'blurry, out of focus, distorted face, warped features, morphing face, ' +
  'face drift between frames, rubbery skin, waxy plastic skin, extra fingers, ' +
  'deformed hands, exaggerated grimace, stretched jaw, wide-angle lens ' +
  'distortion, harsh overhead lighting, text, captions, subtitles, watermark, logo';

/* ── shot-list direction ──────────────────────────────────────────────────── */

import type { LookBible, ShotKind } from './types';

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

/**
 * A shot with the creator in it.
 *
 * Always built from the ENROLMENT CAPTURES, never from the previous frame —
 * that is the entire point of the change. A person shot at step five used to be
 * five generations of reinterpretation deep; now it is one, exactly like the
 * first shot, no matter where it falls in the story.
 */
export function personShotDirection(look: LookBible | null | undefined): string {
  return [
    'The images provided are reference photographs of a specific real person, ' +
      'taken from several angles. They are not the shot. Build a NEW photograph ' +
      'of that same person as described below.',
    IDENTITY_LOCK,
    FLATTERING_CAMERA,
    'FRAMING: A medium shot. Head and shoulders with clear headroom and air on ' +
      'both sides, at a comfortable conversational distance — the face occupies ' +
      'a modest part of the frame.',
    lookContract(look),
    OUTPUT_RULES,
  ]
    .filter(Boolean)
    .join('\n');
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
export function objectShotDirection(kind: ShotKind, look: LookBible | null | undefined): string {
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
    'Photorealistic still. ' + craft,
    lookContract(look),
    'Shot on the same camera and lens as the rest of this ad, so it cuts together ' +
      'with shots of the person without a jump in look.',
    OUTPUT_RULES,
  ]
    .filter(Boolean)
    .join('\n');
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
export function objectMotionDirection(kind: ShotKind, look: LookBible | null | undefined): string {
  const move =
    kind === 'detail'
      ? 'A very slow drift or a gentle rack of focus across the surface. The subject barely moves; the camera barely moves.'
      : kind === 'scene'
        ? 'A slow, almost still push or drift through the space. Light shifts, dust hangs, nothing lurches.'
        : 'The item turns slowly, or a hand steadies and repositions it. Small, deliberate, unhurried.';

  return [
    `MOTION: ${move} Natural 24fps motion blur. Nobody's face enters the frame at any point.`,
    lookContract(look),
    'Shot on the same camera and lens as the rest of this ad, so it cuts together without a jump.',
    OUTPUT_RULES,
  ]
    .filter(Boolean)
    .join('\n');
}
