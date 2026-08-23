/*
 * Generate the ad that plays on the landing page.
 *
 * The hero showed a still with a play badge drawn on top of it, which for a
 * product whose claim is "your ads do not look generated" is the weakest
 * possible evidence: a picture of a video.
 *
 * The face is the site's own persona — see the note on `views` below. It is the
 * same face as the three enrolment angles printed beside the video, so the one
 * thing the hero exists to demonstrate is checkable by looking at the page.
 *
 * This runs the REAL pipeline. Not a rehearsal of it: the same planRun that
 * writes the shot list, the same generateFrame that draws each shot from the
 * enrolment angles, the same submitRender and stitch the render route calls.
 * Whatever comes out is what a user gets.
 *
 * Rendered on Vertex deliberately. The models are identical either way, and
 * this way a marketing asset does not spend the shared Gemini key that real
 * users are on.
 *
 *   npx tsx scripts/make-hero-ad.mts
 */
import { readFileSync, writeFileSync } from 'node:fs';
for (const l of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && m[2].trim()) process.env[m[1]] ??= m[2].trim().replace(/^["']|["']$/g, '');
}

/*
 * The reference face comes from public/img, not from an enrolled account.
 *
 * It read the owner's own avatar out of Firestore, which put a real person's
 * face on the public marketing site. That account exists to exercise the
 * product as a client would, and client captures are not marketing assets — the
 * enrolment photographs are the most sensitive thing this product holds.
 *
 * public/img/av-{front,left,right}.jpg is the site's own persona, generated
 * rather than photographed, and already the face of every other image on the
 * page. Using her keeps the hero consistent with the rest of the site and keeps
 * a customer's likeness out of it.
 */
const UID = 'ypGBh9tgrxQixPdJWwI6k40lF812';
const SHOTS = 3;
const SECONDS = SHOTS * 8;
const GOAL =
  'A creator in her own sunlit kitchen shows how a few drops of a facial oil ' +
  'absorb in seconds, ending on her looking genuinely pleased with her skin.';

const { planRun, generateFrame, submitRender, pollRender, downloadRendered } = await import('../lib/gemini');
const { stitch } = await import('../lib/stitch');
const { personShotDirection, objectShotDirection } = await import('../lib/look');

const P = 'vertex' as const;

const views = (['front', 'left', 'right'] as const).map((a) => ({
  data: readFileSync(new URL(`../public/img/av-${a}.jpg`, import.meta.url)),
  mimeType: 'image/jpeg',
}));
console.log(`reference: ${views.length} angles from public/img (the site persona)`);

/* ── plan ──────────────────────────────────────────────────────────────────── */
console.log('\nplanning…');
let t = Date.now();
const { steps, look } = await planRun(GOAL, '9:16', SECONDS, undefined, undefined, P, UID);
console.log(`  ${steps.length} shots in ${Date.now() - t}ms · ${look?.location?.slice(0, 70)}`);

/* Keep the strongest three and make sure a person is among them — the hero has
   to show a face, that being the entire proposition. */
const person = steps.filter((s) => s.shot === 'person').slice(0, 1);
const rest = steps.filter((s) => s.shot !== 'person').slice(0, SHOTS - person.length);
const chosen = [...rest, ...person].sort((a, b) => a.stepNo - b.stepNo).slice(0, SHOTS);
for (const s of chosen) console.log(`  ${s.stepNo} [${s.shot}] ${s.label}`);

/* ── frames ────────────────────────────────────────────────────────────────── */
const frames: { bytes: Buffer; mimeType: string; shot: string; label: string }[] = [];
for (const s of chosen) {
  const isPerson = s.shot === 'person';
  const prompt = isPerson
    ? `${personShotDirection(look)}\n\nTHE SHOT: ${s.instruction}`
    : `${objectShotDirection(s.shot, look)}\n\nTHE SHOT: ${s.instruction}`;
  t = Date.now();
  const f = await generateFrame({
    prompt,
    aspect: '9:16',
    refs: isPerson ? views : [],
    provider: P,
    uid: UID,
  });
  console.log(`  frame ${s.stepNo} [${s.shot}] ${(f.bytes.length / 1024).toFixed(0)}KB in ${Date.now() - t}ms`);
  frames.push({ ...f, shot: s.shot, label: s.label });
}

/* ── render ────────────────────────────────────────────────────────────────── */
const { motionDirection, objectMotionDirection } = await import('../lib/look');
const clips: Buffer[] = [];
for (const [i, f] of frames.entries()) {
  const motion = f.shot === 'person' ? motionDirection() : objectMotionDirection(f.shot as never, look);
  t = Date.now();
  const { operation } = await submitRender({
    prompt: `Photorealistic UGC video clip, 24fps. ${GOAL} Scene focus: ${f.label}. ${motion}`,
    firstFrame: { data: f.bytes, mimeType: f.mimeType },
    aspect: '9:16',
    durationSeconds: 8,
    provider: P,
    uid: UID,
  });
  let uri: string | null = null;
  for (let k = 0; k < 90; k++) {
    await new Promise((r) => setTimeout(r, 5000));
    const st = await pollRender(operation, P, UID);
    if (st.done) {
      if ('error' in st) throw new Error(`shot ${i + 1}: ${st.error}`);
      uri = st.videoUri;
      break;
    }
  }
  if (!uri) throw new Error(`shot ${i + 1} did not finish`);
  const bytes = await downloadRendered(uri, P, UID);
  clips.push(bytes);
  console.log(`  clip ${i + 1}/${frames.length} ${(bytes.length / 1024 / 1024).toFixed(1)}MB in ${Math.round((Date.now() - t) / 1000)}s`);
}

/* ── one file ──────────────────────────────────────────────────────────────── */
const out = await stitch(clips, undefined);
const dest = new URL('../public/hero-ad.mp4', import.meta.url);
writeFileSync(dest, out);
console.log(`\n✅ public/hero-ad.mp4 — ${(out.length / 1024 / 1024).toFixed(1)}MB, ${frames.length} shots`);

/* A poster, so the card is never empty while the video loads. */
writeFileSync(new URL('../public/hero-poster.jpg', import.meta.url), frames[frames.length - 1].bytes);
console.log('✅ public/hero-poster.jpg');
