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
const { promoteFrame, removeFrame, restoreFrame, lineageOf, shotPlan } = await import('../lib/lineage');

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

/*
 * 用户否掉链条中间的一帧。
 *
 * 这是真实运行里最容易踩的一种情况，而之前完全没有测到。用户点「否掉」的那
 * 一帧，后面几步早就是在它上面改出来的 —— 它虽然不该出现在成片里，却仍然是
 * 链条上承重的一环。之前的走法碰到它就停，于是它下面的每一步都被悄悄丢掉：
 * 在真实的六步运行里，第 2 步被否掉之后整个序列从 6 个镜头塌成 1 个，而渲染
 * 按钮照样写着「把全部 1 个镜头渲染成一支广告」。
 *
 * 现在的走法是「跨过去」而不是「停下来」：被否掉的帧不计入成片，但链条继续
 * 往下走。
 */
await nodes.doc('s2alt').update({ status: 'rejected' });
all = await read();
const afterReject = lineageOf(all).map((n) => n.id).join(',');
console.log(`\n  否掉链条中间的 s2alt 之后: ${afterReject.split(',').join(' -> ')}`);
const okReject = afterReject === 's1,s4';
console.log(`  ${okReject ? '✅' : '❌'} 否掉中间帧：跨过它继续往下走，不会把后面的步骤一起丢掉`);

/* 过时的清单里不该混进已渲染的片子。video 节点用 99 当哨兵步号，之前直接把它
   报给用户，于是界面上出现「第 99 步已过时」，重建报价也把它算成一次生成。 */
await nodes.doc('vid').set({
  parentId: 's4', stepNo: 99, kind: 'video', status: 'achieved', createdAt: Date.now() + 50,
});
await nodes.doc('s5').set({
  parentId: 's4', stepNo: 5, kind: 'frame', status: 'achieved', frameUrl: 'https://x/s5.jpg', createdAt: Date.now() + 60,
});
const rm2 = await removeFrame(runRef.id, 's4');
all = await read();
console.log(`\n  取出 s4（下面挂着一个 video + 一个 frame）`);
console.log(`  报给用户的步骤: ${rm2.staleSteps.join(', ')}   计价节点数: ${rm2.rebuildableIds.length}`);
/* 渲染好的片子留在它自己那一帧下面。之前连 video 一起往上挂，结果祖父节点凭空
   多出一个「已渲染」的孩子，Render 按钮被永久禁用，而画布上那支片子拍的其实是
   另外一帧。 */
const vid = all.find((n) => n.id === 'vid');
const okNoSentinel =
  !rm2.staleSteps.includes(99) && rm2.rebuildableIds.length === 1 && vid?.parentId === 's4';
console.log(`  ${okNoSentinel ? '✅' : '❌'} 过时清单不含哨兵步号；渲染好的片子仍挂在它自己那一帧下`);

/*
 * 把取出去的帧再放回来。
 *
 * 之前 removedFromSequence 只有写、没有清，所以「取出」是一扇单向门：点错一次
 * 就只能花钱重新生成一张画布上明明还在的图。放回来要把当初被抬走的子节点还给
 * 它，所以取出的时候要记下抬走了谁。
 */
const back = await restoreFrame(runRef.id, 's4');
all = await read();
const s4 = all.find((n) => n.id === 's4');
const s5 = all.find((n) => n.id === 's5');
console.log(`\n  放回 s4 之后: ${lineageOf(all).map((n) => n.id).join(' -> ')}`);
const okRestore =
  s4?.removedFromSequence === undefined && s5?.parentId === 's4' && back.staleSteps.includes(5);
console.log(`  ${okRestore ? '✅' : '❌'} 放回：标记清除，子节点归位，并标记为需要重建`);

for (const d of (await nodes.get()).docs) await d.ref.delete();
await runRef.delete();
process.exit(okSwap && okRemove && okReject && okNoSentinel && okRestore ? 0 : 1);
