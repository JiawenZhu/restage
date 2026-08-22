/*
 * Swapping and removing frames, against a real tree in Firestore.
 *
 * The thing worth testing is not the write — it is what the write INVALIDATES.
 * Each step edits the frame before it, so replacing frame 2 makes frames 3 and
 * 4 answers to a question that was withdrawn. Getting that set wrong means
 * either rebuilding steps that were fine, or leaving steps that silently no
 * longer follow from anything.
 */
import { readFileSync } from 'node:fs';
for (const l of readFileSync(new URL('../.env.local', import.meta.url),'utf8').split('\n')) {
  const m=l.match(/^([A-Z0-9_]+)=(.*)$/); if(m&&m[2].trim()) process.env[m[1]] ??= m[2].trim().replace(/^["']|["']$/g,'');
}
const { adminDb } = await import('../lib/firebaseAdmin');
const { promoteFrame, removeFrame, lineageOf, shotPlan } = await import('../lib/lineage');

const uid = `_seqtest_${Date.now()}`;
const db = adminDb();
const runRef = db.collection('runs').doc();
await runRef.set({ uid, goal: 'sequence probe', aspect: '9:16', seconds: 24, status: 'awaiting-approval', plan: [], createdAt: Date.now() });
const nodes = runRef.collection('nodes');

// root -> s1 -> s2 -> s3 -> s4, plus an alternate at step 2
const mk = (id: string, parentId: string | null, stepNo: number, extra: Record<string, unknown> = {}) =>
  nodes.doc(id).set({ parentId, stepNo, kind: 'frame', status: 'achieved', frameUrl: `https://x/${id}.jpg`, createdAt: Date.now() + stepNo, ...extra });

await nodes.doc('root').set({ parentId: null, stepNo: 0, kind: 'avatar', status: 'achieved', frameUrl: 'https://x/root.jpg', createdAt: 1 });
await mk('s1', 'root', 1);
await mk('s2', 's1', 2);
await mk('s2alt', 's1', 2);          // the alternate the user prefers
await mk('s3', 's2', 3);
await mk('s4', 's3', 4);

const read = async () => (await nodes.orderBy('createdAt').get()).docs.map(d => ({ id: d.id, ...(d.data() as any) }));

let all = await read();
console.log(`  换之前的序列: ${lineageOf(all).map(n=>n.id).join(' -> ')}`);

const swap = await promoteFrame(runRef.id, 's2', 's2alt');
all = await read();
console.log(`  换之后的序列: ${lineageOf(all).map(n=>n.id).join(' -> ')}`);
console.log(`  标记为过时: 步骤 ${swap.staleSteps.join(', ')} (${swap.staleIds.length} 个节点)`);

const okSwap =
  lineageOf(all).map(n=>n.id).join(',') === 's1,s2alt,s3,s4' &&
  swap.staleIds.sort().join(',') === 's3,s4';
console.log(`  ${okSwap ? '✅' : '❌'} 换帧：后续重新指向新帧，且只有后续被标记`);

// clear the stale flags so the removal test is not reading the swap's marks
for (const id of ['s3','s4']) await nodes.doc(id).update({ stale: false });

const rm = await removeFrame(runRef.id, 's3');
all = await read();
console.log(`\n  删掉 s3 之后: ${lineageOf(all).map(n=>n.id).join(' -> ')}`);
console.log(`  标记为过时: 步骤 ${rm.staleSteps.join(', ')}`);
const s3 = all.find(n => n.id === 's3');
const okRemove =
  lineageOf(all).map(n=>n.id).join(',') === 's1,s2alt,s4' &&
  rm.staleIds.join(',') === 's4' &&
  s3?.removedFromSequence === true;
console.log(`  ${okRemove ? '✅' : '❌'} 删帧：s4 接到 s2alt，s3 留在画布上标记为已取出`);

const p = shotPlan(24, lineageOf(all).length);
console.log(`\n  用户设的 24s / ${lineageOf(all).length} 个镜头 → 每段 ${p.perShot}s，总 ${p.total}s`);

for (const d of (await nodes.get()).docs) await d.ref.delete();
await runRef.delete();
process.exit(okSwap && okRemove ? 0 : 1);
