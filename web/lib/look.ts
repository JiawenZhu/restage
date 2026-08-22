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

/** Everything, for a video segment, where drift across time is the added risk. */
export function motionDirection(): string {
  return (
    `${IDENTITY_LOCK}\n${FLATTERING_CAMERA}\n` +
    'MOTION: The face must stay identical in every frame — no drift, no morphing, ' +
    'no rubbery skin, no warping. Natural 24fps motion blur.\n' +
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
