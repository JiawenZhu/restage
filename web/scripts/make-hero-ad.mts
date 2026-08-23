/*
 * Generate the ad that plays on the landing page.
 *
 * The hero showed a still with a play badge drawn on top of it, which for a
 * product whose claim is "your ads do not look generated" is the weakest
 * possible evidence: a picture of a video. Worse, the three enrolment angles
 * beside it were a different woman from the one in the still, so the one thing
 * the hero is meant to demonstrate — that these three photos produce that
 * person — was visibly untrue.
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

const AVATAR = process.argv[2] ?? 'av_1787409381263';
const UID = 'ypGBh9tgrxQixPdJWwI6k40lF812';
/* Three shots, eight seconds each. Eight is not a style choice — the model
   refuses 1080p below a full eight-second shot, so anything shorter is 720p
   however it is asked for. Three of them is a real cut (the place, the product,
   the person) without a twenty-minute render. */
const SHOTS = 3;
const SECONDS = SHOTS * 8;
const GOAL =
  'A creator in her own sunlit kitchen shows how a few drops of a facial oil ' +
  'absorb in seconds, ending on her looking genuinely pleased with her skin.';

const { adminDb, adminStorage } = await import('../lib/firebaseAdmin');
const { planRun, generateFrame, submitRender, pollRender, downloadRendered } = await import('../lib/gemini');
const { stitch } = await import('../lib/stitch');
const { personShotDirection, objectShotDirection } = await import('../lib/look');

const P = 'vertex' as const;

/* ── the enrolled face ─────────────────────────────────────────────────────── */
const snap = await adminDb().collection('users').doc(UID).collection('avatars').doc(AVATAR).get();
const paths = snap.data()?.paths as { front?: string; left?: string; right?: string } | undefined;
if (!paths?.front) throw new Error(`avatar ${AVATAR} has no captures`);

const bucket = adminStorage().bucket(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET!);
const read = async (p?: string) => (p ? { data: (await bucket.file(p).download())[0], mimeType: 'image/jpeg' } : null);
const front = (await read(paths.front))!;
const views = [front, await read(paths.left), await read(paths.right)].filter(Boolean) as typeof front[];
console.log(`avatar ${AVATAR}: ${views.length} enrolment angles`);

/* The same three angles go onto the landing page, so the hero's claim — these
   photos became this person — is one anyone can check by looking. */
for (const [name, p] of [['front', paths.front], ['left', paths.left], ['right', paths.right]] as const) {
  const img = await read(p);
  if (img) {
    writeFileSync(new URL(`../public/img/av-${name}.jpg`, import.meta.url), img.data);
    console.log(`  wrote public/img/av-${name}.jpg`);
  }
}

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
