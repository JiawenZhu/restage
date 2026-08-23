/*
 * Does the person actually stay the same age across an ad's shots?
 *
 * scripts/check-consistency.mts grades the PROMPT — that the age is pinned,
 * that the anchor is plumbed, that every template gets both. It runs free and
 * it proves the wiring. It cannot prove the pictures changed, and the complaint
 * this all comes from was about pictures: an ad that opened on a woman in her
 * twenties and closed on a visibly older one.
 *
 * So this generates them. Two sets of three person shots from the same face,
 * the same look and the same three instructions:
 *
 *   BEFORE  the direction as it shipped — each shot from the enrolment captures
 *           alone, nothing pinning age, "real texture and real pores"
 *   AFTER   the direction now — age locked in both directions, texture sourced
 *           from the reference, and a casting note read off the same captures
 *           and handed to every shot
 *
 * The casting note is read ONCE, before the first shot, exactly as executeRun
 * does it. Reading it per shot would be a different and much weaker system.
 *
 * An earlier version of AFTER passed shot 1 back as a reference image instead.
 * It held the age just as well — and shots 1 and 3 came back as the same seated
 * pose in the same crop, because a reference image cannot show a face without
 * showing a composition. That result is why the shipped fix is text. If this
 * script is ever changed back to an image anchor, look at whether the three
 * frames are still three different shots.
 *
 * Then a vision model reads an apparent age off each frame WITHOUT being told
 * which set it came from or what the experiment is about. It is asked for a
 * number, and the number that matters is the SPREAD within a set: an ad is
 * consistent when its shots agree, not when they hit some target age.
 *
 * Both sets run on Vertex. The models are identical either way and this keeps a
 * diagnostic off the shared Gemini key that real users are on.
 *
 * The face is the site persona from public/img, never an enrolled account. The
 * enrolment captures are the most sensitive thing this product holds, and a
 * diagnostic is not a reason to touch them.
 *
 * RUN IT MORE THAN ONCE. A single trial measured a spread of 3 years before and
 * 2 after, which is the right direction and is also well inside the noise of an
 * age estimate read off a photograph. Three shots is a small sample and the
 * grader is not a precision instrument; one trial can only reproduce the defect,
 * not size the fix. The trial label keeps the frames from overwriting.
 *
 *   npx tsx scripts/diag-age-drift.mts          one trial, /tmp/age-*.jpg
 *   npx tsx scripts/diag-age-drift.mts 2        the second, /tmp/age-t2-*.jpg
 */
const TRIAL = process.argv[2] ? `t${process.argv[2]}-` : '';
import { readFileSync, writeFileSync } from 'node:fs';
for (const l of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && m[2].trim()) process.env[m[1]] ??= m[2].trim().replace(/^["']|["']$/g, '');
}

const { castPerson, generateFrame } = await import('../lib/gemini');
const { generateContent, MODELS } = await import('../lib/provider');
const { personShotDirection, lookContract, OUTPUT_RULES } = await import('../lib/look');
import type { CastingNote, LookBible } from '../lib/types';

const P = 'vertex' as const;

const LOOK: LookBible = {
  location:
    'A sunlit kitchen counter of pale oak beside an open casement window, with a small basil plant and plain cabinetry behind',
  wardrobe: 'A cream ribbed cotton tank top, no jewellery',
  light: 'Late morning sun through the window from camera left, warm and directional, no overhead fill',
  palette: 'Warm oak, cream, soft green, amber glass',
  product: 'A small amber glass dropper bottle of facial oil with a white pipette top and a plain cream label',
};

/* Three beats from one ad, chosen because they are the shape a real template
   produces: an opening address, a middle demonstration, a closing reaction. The
   middle one turns toward the window on purpose — raking side light is where
   invented skin texture shows up first. */
const SHOTS = [
  'A medium shot of the creator at the counter, talking to camera, relaxed and unposed.',
  'A medium shot of the creator turned toward the window so the light rakes across one side of the face, pressing a drop of oil into the cheek.',
  'A medium shot of the creator looking genuinely pleased with her skin, a small easy smile, the bottle set down on the counter beside her.',
];

const views = (['front', 'left', 'right'] as const).map((a) => ({
  data: readFileSync(new URL(`../public/img/persona-${a}.jpg`, import.meta.url)),
  mimeType: 'image/jpeg',
}));

/*
 * The direction exactly as it shipped, so BEFORE is a real baseline and not a
 * strawman. Copied verbatim from lib/look.ts at b6eedf0 — the two clauses that
 * matter are the identity lock with no mention of age, and "real texture and
 * real pores", which is an instruction to invent detail.
 */
const OLD_LOCK =
  'IDENTITY: This is a specific real person. Their bone structure, face width, ' +
  'jawline, eye shape and spacing, nose shape, lip shape, hairline, hairstyle, ' +
  'skin tone and eyeglasses are FIXED and must match the reference exactly. ' +
  'Do not slim the face, enlarge the eyes, reshape the nose or jaw, or make them ' +
  'look like a different person. Someone who knows them must recognise them ' +
  'instantly.';
const OLD_CAMERA =
  'PHOTOGRAPHY: Shoot them the way a good portrait photographer would. ' +
  '85mm equivalent lens with natural compression — never a wide lens, which ' +
  'distorts a face at close range. Camera very slightly above eye level. ' +
  'Soft, large key light from about 45 degrees and a little above, with gentle ' +
  'fill so shadows under the eyes and chin stay open — no harsh overhead or ' +
  'under-lighting. A soft catchlight in the eyes. ' +
  'Skin looks healthy and well-rested: real texture and real pores, but even in ' +
  'tone and not accentuated — not airbrushed to plastic, and not sharpened into ' +
  'every flaw. Relaxed, engaged expression. Flattering, and unmistakably them.';
const oldDirection = () =>
  [
    'The images provided are reference photographs of a specific real person, ' +
      'taken from several angles. They are not the shot. Build a NEW photograph ' +
      'of that same person as described below.',
    OLD_LOCK,
    OLD_CAMERA,
    'FRAMING: A medium shot. Head and shoulders with clear headroom and air on ' +
      'both sides, at a comfortable conversational distance — the face occupies ' +
      'a modest part of the frame.',
    lookContract(LOOK),
    OUTPUT_RULES,
  ].join('\n');

type Frame = { bytes: Buffer; mimeType: string };

/*
 * Wait out a 429 rather than losing the trial to one.
 *
 * The image quota on this project is a short-window bucket, not a daily cap:
 * three trials run back to back exhausted it, and it was serving again about
 * fifteen minutes later. lib/backoff already retries, but its ceiling is a few
 * seconds — right for a user waiting on a click, far too short for a refill
 * window. Losing a trial two frames from the end also wastes every generation
 * already spent on it, which is the expensive kind of failure.
 *
 * Deliberately only here. The product should fail fast and say so; a diagnostic
 * nobody is watching should wait.
 */
async function patiently<T>(what: string, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const exhausted = /exhaust|quota|429/i.test(e instanceof Error ? e.message : String(e));
      if (!exhausted || attempt >= 5) throw e;
      const waitMs = 90_000;
      console.log(`  … ${what}: quota window is full, waiting ${waitMs / 1000}s (${attempt + 1}/5)`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
}

async function shoot(set: 'before' | 'after', casting: CastingNote | null): Promise<Frame[]> {
  const frames: Frame[] = [];

  for (const [i, instruction] of SHOTS.entries()) {
    const direction = set === 'after' ? personShotDirection(LOOK, casting) : oldDirection();

    const t = Date.now();
    const f = await patiently(`${set} ${i + 1}`, () =>
      generateFrame({
        prompt: `${direction}\n\nTHE SHOT: ${instruction}`,
        aspect: '9:16',
        // Identical for both sets: the enrolment captures, nothing else. The
        // only variable under test is the direction.
        refs: views,
        provider: P,
      }),
    );
    const path = `/tmp/age-${TRIAL}${set}-${i + 1}.jpg`;
    writeFileSync(path, f.bytes);
    console.log(
      `  ${set} ${i + 1}/3  ${(f.bytes.length / 1024).toFixed(0)}KB  ${Math.round((Date.now() - t) / 1000)}s  → ${path}`,
    );
    frames.push(f);
  }
  return frames;
}

/*
 * The grader is told nothing.
 *
 * Not which set this is, not that there are two sets, not that the experiment
 * is about age. It is asked to read three photographs and write down a number
 * for each, which is a question it can answer without knowing what answer would
 * be convenient. Asking "did these drift?" would get agreement either way.
 */
async function readAges(frames: Frame[]): Promise<{ ages: number[]; note: string }> {
  const json = await generateContent({
    provider: P,
    model: MODELS[P].judge,
    label: 'age-read',
    body: {
      contents: [
        {
          role: 'user',
          parts: [
            ...frames.map((f) => ({
              inlineData: { mimeType: f.mimeType, data: f.bytes.toString('base64') },
            })),
            {
              text:
                'For each photograph in order, estimate the apparent age of the person in years, ' +
                'judging only from the face — skin texture, fine lines around the eyes and mouth, ' +
                'and skin firmness. Then, in one short sentence, describe how the skin differs ' +
                'between the photographs, if it does.\n' +
                'Reply as JSON only: {"ages":[n,n,n],"note":"..."}',
            },
          ],
        },
      ],
      generationConfig: { responseMimeType: 'application/json', temperature: 0 },
    },
  });

  const text =
    (json as { candidates?: { content?: { parts?: { text?: string }[] } }[] }).candidates?.[0]?.content?.parts?.[0]
      ?.text ?? '{}';
  const parsed = JSON.parse(text) as { ages?: number[]; note?: string };
  return { ages: parsed.ages ?? [], note: parsed.note ?? '' };
}

/* ── run ──────────────────────────────────────────────────────────────────── */
console.log('reading the casting note off the enrolment captures\n');
const casting = await patiently('casting', () => castPerson(views, P));
console.log(`  age: ${casting.age}`);
console.log(`  skin: ${casting.skin}`);
console.log(`  hair: ${casting.hair}\n`);

console.log('shooting three person shots, twice\n');

const before = await shoot('before', null);
const after = await shoot('after', casting);

console.log('\nreading apparent age off each set (the grader is not told which is which)\n');

const results: Record<string, { ages: number[]; note: string }> = {
  before: await patiently('grade before', () => readAges(before)),
  after: await patiently('grade after', () => readAges(after)),
};

let worse = false;
for (const [set, { ages, note }] of Object.entries(results)) {
  const spread = ages.length ? Math.max(...ages) - Math.min(...ages) : NaN;
  console.log(`  ${set.toUpperCase().padEnd(6)} ages ${JSON.stringify(ages)}  spread ${spread} years`);
  console.log(`         ${note}`);
  results[set] = { ages, note };
}

const spreadOf = (s: string) => {
  const a = results[s].ages;
  return a.length ? Math.max(...a) - Math.min(...a) : NaN;
};
const b = spreadOf('before');
const a = spreadOf('after');

console.log(`\n  before spread ${b}y → after spread ${a}y`);
if (Number.isNaN(b) || Number.isNaN(a)) {
  console.log('  ⚠️  the grader did not return usable numbers — look at /tmp/age-*.jpg yourself');
} else if (a < b) {
  console.log(`  ✅ the ad holds one age ${b - a} years tighter than it did`);
} else if (a === b) {
  console.log('  ⚠️  no measured improvement. Look at /tmp/age-*.jpg before believing either way.');
} else {
  worse = true;
  console.log('  ❌ WORSE than before. Do not ship this.');
}

console.log(`\n  the six frames are in /tmp/age-${TRIAL}{before,after}-{1,2,3}.jpg — look at them.`);
process.exit(worse ? 1 : 0);
