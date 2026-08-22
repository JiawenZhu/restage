/*
 * Run the real loop once, end to end, and report what landed in Firestore.
 *
 * This makes real API calls and costs real money — a plan, roughly six frames
 * and six critiques. That is the point: the loop cannot be verified by reading
 * it, only by watching a tree appear.
 *
 *   node --experimental-strip-types scripts/check-loop.mts
 */
import { readFileSync } from 'node:fs';

for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && m[2].trim()) process.env[m[1]] ??= m[2].trim().replace(/^["']|["']$/g, '');
}

const { createRun, executeRun } = await import('../lib/orchestrator');
const { adminDb } = await import('../lib/firebaseAdmin');

const avatar = readFileSync(new URL('../public/img/av-front.jpg', import.meta.url));
const args = {
  uid: '_looptest',
  goal: 'A 15-second ad where I actually use the serum, in my kitchen. Should feel filmed, not shot.',
  aspect: '9:16' as const,
  seconds: 8 as const,
  avatarDataUrl: `data:image/jpeg;base64,${avatar.toString('base64')}`,
};

const started = Date.now();
const runId = await createRun(args);
console.log(`run ${runId} created\n`);

const db = adminDb();
const seen = new Set<string>();

// Poll the way the client watches it, so what prints is what a user would see
// arriving on the tree.
const watcher = setInterval(async () => {
  const [run, nodes] = await Promise.all([
    db.collection('runs').doc(runId).get(),
    db.collection('runs').doc(runId).collection('nodes').orderBy('createdAt').get(),
  ]);
  const status = run.data()?.status;

  for (const d of nodes.docs) {
    const n = d.data();
    const stamp = `${d.id}:${n.status}`;
    if (seen.has(stamp)) continue;
    seen.add(stamp);
    const t = ((Date.now() - started) / 1000).toFixed(0).padStart(3);
    if (n.kind === 'avatar') {
      console.log(`${t}s  root      avatar`);
    } else if (n.status === 'generating') {
      console.log(`${t}s  step ${n.stepNo}    generating — ${String(n.instruction).slice(0, 58)}`);
    } else {
      const mark = n.discarded ? 'DISCARDED, retrying' : n.verdict?.toUpperCase() ?? n.status;
      console.log(`${t}s  step ${n.stepNo}    ${mark}`);
    }
  }
  if (status === 'awaiting-approval' || status === 'failed') {
    clearInterval(watcher);
  }
}, 1500);

await executeRun(runId, args);
await new Promise((r) => setTimeout(r, 2500));
clearInterval(watcher);

const [run, nodes] = await Promise.all([
  db.collection('runs').doc(runId).get(),
  db.collection('runs').doc(runId).collection('nodes').orderBy('createdAt').get(),
]);
const data = run.data()!;
const kept = nodes.docs.filter((d) => !d.data().discarded).length;
const discarded = nodes.docs.length - kept;

console.log(`\n─────────────────────────────────────────────`);
console.log(`status     ${data.status}`);
console.log(`plan       ${data.plan?.length ?? 0} steps`);
console.log(`nodes      ${kept} kept, ${discarded} discarded`);
console.log(`elapsed    ${((Date.now() - started) / 1000).toFixed(0)}s`);
console.log(`frames     ${nodes.docs.filter((d) => d.data().frameUrl).length} carry an image`);
console.log(`critiques  ${nodes.docs.filter((d) => d.data().criticNotes).length} carry a verdict`);

// Clean up: this is a test run, not a user's.
for (const d of nodes.docs) await d.ref.delete();
await run.ref.delete();
console.log(`\ntest run deleted`);
process.exit(0);
