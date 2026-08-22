/*
 * Dump one real run's node graph and show exactly what lineageOf() makes of it.
 *
 * The canvas says "Render all 1 shots into one ad" for a run whose plan has six
 * steps and whose canvas shows six frames. Either the graph is broken or the
 * walk is. This prints both so the answer is not a guess.
 *
 *   npx tsx scripts/diag-run.mts <runId>
 */
import { readFileSync } from 'node:fs';
for (const l of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && m[2].trim()) process.env[m[1]] ??= m[2].trim().replace(/^["']|["']$/g, '');
}
const { adminDb } = await import('../lib/firebaseAdmin');
const { lineageOf } = await import('../lib/lineage');

const runId = process.argv[2];
if (!runId) throw new Error('usage: diag-run.mts <runId>');

const db = adminDb();
const runSnap = await db.collection('runs').doc(runId).get();
if (!runSnap.exists) throw new Error(`no run ${runId}`);
const run = runSnap.data() as Record<string, unknown>;

console.log('════ RUN ════');
for (const k of ['uid', 'status', 'aspect', 'seconds', 'videoEngine', 'templateId', 'avatarId', 'goal']) {
  console.log(`  ${k.padEnd(12)} ${JSON.stringify(run[k])}`);
}
console.log(`  plan steps   ${(run.plan as unknown[])?.length ?? 0}`);
console.log(`  audioUrl     ${run.audioUrl ? 'present' : 'ABSENT'}`);
console.log(`  script       ${run.script ? JSON.stringify(String(run.script).slice(0, 90)) : 'ABSENT'}`);

const snap = await db.collection('runs').doc(runId).collection('nodes').orderBy('createdAt').get();
const nodes = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) })) as any[];

console.log(`\n════ NODES (${nodes.length}) ════`);
console.log(
  ['id', 'parentId', 'step', 'kind', 'status', 'flags', 'frame'].map((h, i) => h.padEnd([22, 22, 5, 7, 12, 26, 6][i])).join(''),
);
for (const n of nodes) {
  const flags = [
    n.stale && 'stale',
    n.discarded && 'discarded',
    n.removedFromSequence && 'removed',
    n.detached && 'detached',
  ]
    .filter(Boolean)
    .join(',');
  console.log(
    [
      String(n.id).slice(0, 21),
      String(n.parentId ?? '—').slice(0, 21),
      String(n.stepNo ?? '—'),
      String(n.kind ?? '—'),
      String(n.status ?? '—'),
      flags || '—',
      n.frameUrl ? 'yes' : n.videoUrl ? 'VIDEO' : 'no',
    ]
      .map((v, i) => v.padEnd([22, 22, 5, 7, 12, 26, 6][i]))
      .join(''),
  );
}

// What does the walk actually return?
const chain = lineageOf(nodes as never);
console.log(`\n════ lineageOf() → ${chain.length} shot(s) ════`);
for (const c of chain) console.log(`  step ${c.stepNo}  ${c.id}  ${(c as any).label ?? ''}`);

// Why did it stop? Replay the walk, narrating each hop.
console.log('\n════ WALK TRACE ════');
const byParent = new Map<string, any[]>();
for (const n of nodes) {
  const k = n.parentId ?? 'root';
  if (!byParent.has(k)) byParent.set(k, []);
  byParent.get(k)!.push(n);
}
const out = (c: any) => c.discarded === true || c.removedFromSequence === true || c.status === 'rejected';
const goes = (c: any) => (byParent.get(c.id) ?? []).some((g: any) => g.kind === 'frame');

let cur = 'root';
const seen = new Set<string>();
while (!seen.has(cur)) {
  seen.add(cur);
  const raw = byParent.get(cur) ?? [];
  const frames = raw.filter((c) => c.kind === 'frame');
  const live = frames.filter((c) => !out(c));
  console.log(
    `  at ${cur.slice(0, 20).padEnd(21)} children=${raw.length} (${raw
      .map((c) => `${String(c.id).slice(0, 8)}:${c.kind}/${c.status}${c.discarded ? '/disc' : ''}${c.removedFromSequence ? '/rm' : ''}`)
      .join(' ')}) → frames=${frames.length} live=${live.length}`,
  );
  if (!frames.length) {
    console.log('  · end of chain — no frame children');
    break;
  }
  const next = live.find(goes) ?? live[live.length - 1] ?? frames.filter(goes).pop();
  if (!next) {
    console.log('  · end of chain — nothing eligible and nothing to pass through');
    break;
  }
  console.log(
    out(next)
      ? `    ↷ PASSES THROUGH ${next.id} (excluded, but steps hang off it)`
      : `    → collects ${next.id} (step ${next.stepNo})`,
  );
  cur = next.id;
}

// Orphans: nodes whose parent does not exist. These vanish from the walk.
const ids = new Set(nodes.map((n) => n.id));
const orphans = nodes.filter((n) => n.parentId && n.parentId !== 'root' && !ids.has(n.parentId));
if (orphans.length) {
  console.log(`\n════ ORPHANS (${orphans.length}) — parent id not in collection ════`);
  for (const o of orphans) console.log(`  ${o.id} step ${o.stepNo} → missing parent ${o.parentId}`);
}

// Does anything at all point at 'root'?
console.log(`\n  nodes whose parentId is null/root: ${nodes.filter((n) => !n.parentId || n.parentId === 'root').map((n) => `${n.id}(${n.kind})`).join(', ') || 'NONE'}`);
process.exit(0);
