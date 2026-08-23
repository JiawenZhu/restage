/*
 * Regenerate the frames the demo run is built from.
 *
 * /studio/demo is what the landing page links to as "Watch it work", and its
 * fixture showed an enrolled avatar of one person producing frames of another.
 * On the page whose entire argument is that the face survives every shot, the
 * demo disproved it — and it is the first thing anyone clicks.
 *
 * Five frames from ONE avatar against ONE look, matching the five nodes in
 * lib/demoRun: three that land, one the critic rejects, one still generating.
 *
 * The rejected frame is generated deliberately badly rather than faked. The
 * demo's whole point is that the agent catches its own mistakes, and a rejected
 * frame that was never actually rejected is a worse lie than the mismatch this
 * replaces.
 *
 *   npx tsx scripts/make-demo-frames.mts
 */
import { readFileSync, writeFileSync } from 'node:fs';
for (const l of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && m[2].trim()) process.env[m[1]] ??= m[2].trim().replace(/^["']|["']$/g, '');
}

const AVATAR = 'av_1787409381263';
const UID = 'ypGBh9tgrxQixPdJWwI6k40lF812';
const P = 'vertex' as const;

const { adminDb, adminStorage } = await import('../lib/firebaseAdmin');
const { generateFrame } = await import('../lib/gemini');
const { personShotDirection, objectShotDirection } = await import('../lib/look');
import type { LookBible } from '../lib/types';

/* The same shoot the hero ad was made in, so the demo and the hero read as one
   product rather than two unrelated photo sets. */
const look: LookBible = {
  location:
    'A sunlit kitchen counter of pale oak beside an open casement window, with a small basil plant and plain cabinetry behind',
  wardrobe: 'A cream ribbed cotton tank top, no jewellery',
  light: 'Late morning sun through the window from camera left, warm and directional, no overhead fill',
  palette: 'Warm oak, cream, soft green, amber glass',
  product: 'A small amber glass dropper bottle of facial oil with a white pipette top and a plain cream label',
};

const snap = await adminDb().collection('users').doc(UID).collection('avatars').doc(AVATAR).get();
const paths = snap.data()?.paths as { front?: string; left?: string; right?: string };
const bucket = adminStorage().bucket(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET!);
const read = async (p?: string) => (p ? { data: (await bucket.file(p).download())[0], mimeType: 'image/jpeg' } : null);
const views = [await read(paths.front), await read(paths.left), await read(paths.right)].filter(Boolean) as {
  data: Buffer; mimeType: string;
}[];
console.log(`avatar ${AVATAR}: ${views.length} angles`);

type Job = { file: string; kind: 'person' | 'product' | 'detail' | 'scene'; instruction: string; note: string };

const JOBS: Job[] = [
  {
    file: 'f1', kind: 'scene', note: 'Kitchen scene — establishing, nobody in it',
    instruction:
      'A wide view of the empty kitchen counter in late morning light, the amber dropper bottle standing alone near the window, basil leaves catching the sun. No people in frame.',
  },
  {
    file: 'f2', kind: 'person', note: "Arm's-length framing — the person, handheld",
    instruction:
      'A medium handheld shot of the creator at the counter, holding the amber dropper bottle up toward the camera at arm\'s length, mid-sentence, relaxed and unposed.',
  },
  {
    file: 'f3', kind: 'person', note: 'Window light — partial, the one the critic marks down',
    instruction:
      'A medium shot of the creator turned toward the window so the light rakes across one side of the face, applying a drop of oil to the cheek, calm expression.',
  },
  {
    file: 'f4', kind: 'product', note: 'Product to lens — the bottle, legible',
    instruction:
      'A close shot of a hand holding the amber dropper bottle toward the lens so the cream label is sharp and readable, kitchen counter soft behind it. No face in frame.',
  },
  {
    /* Deliberately wrong, so the discarded node on the canvas is a real
       rejection rather than a decorative one: a flat overhead studio look that
       loses the room the look bible specifies. */
    file: 'fx', kind: 'person', note: 'The rejected attempt — flat studio light, room lost',
    instruction:
      'A tight close-up of the creator against a plain seamless grey studio backdrop under flat overhead lighting, no window, no kitchen, no natural light.',
  },
];

for (const j of JOBS) {
  const dir = j.kind === 'person' ? personShotDirection(look) : objectShotDirection(j.kind, look);
  const t = Date.now();
  const f = await generateFrame({
    prompt: `${dir}\n\nTHE SHOT: ${j.instruction}`,
    aspect: '9:16',
    refs: j.kind === 'person' ? views : [],
    provider: P,
    uid: UID,
  });
  writeFileSync(new URL(`../public/img/${j.file}.jpg`, import.meta.url), f.bytes);
  console.log(`  ${j.file}.jpg  ${(f.bytes.length / 1024).toFixed(0)}KB  ${Math.round((Date.now() - t) / 1000)}s  — ${j.note}`);
}

console.log('\n✅ five demo frames, one avatar, one look');
