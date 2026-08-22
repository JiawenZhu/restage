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
const { promoteFrame, removeFrame, restoreFrame, disconnectNode, deleteNode, lineageOf, shotPlan } = await import('../lib/lineage');

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

/*
 * 评审判定 failed 的帧，也不该进成片。
 *
 * 之前只挡了 discarded / removedFromSequence / rejected。discarded 说的是「失败
 * 了但还会重试一次」；重试次数用完之后那一帧仍然是 failed，而 discarded 是
 * false —— 于是它直接走进了要渲染的序列。
 *
 * 真实的 run 里就是这样：第 7 步的帧是 failed，它是链条的最后一环，成片就以它
 * 收尾。代理自己看过那张图、说它没达成要求，产品照样把它渲染成了结尾。
 */
await nodes.doc('s4').update({ status: 'failed' });
all = await read();
const afterFail = lineageOf(all).map((n) => n.id).join(',');
console.log(`\n  评审判 s4 failed 之后: ${afterFail === '' ? '(空)' : afterFail.split(',').join(' -> ')}`);
const okFail = !afterFail.split(',').includes('s4');
console.log(`  ${okFail ? '✅' : '❌'} 评审判 failed 的帧不会被渲染进成片（重试次数用完的那种）`);
await nodes.doc('s4').update({ status: 'achieved' });
all = await read();

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

/*
 * 断开与删除。
 *
 * 用户要的是两步：先 disconnect，然后才能删。这两件事风险完全不同 —— 断开是
 * 即时、可逆、不花钱的；删除是这个产品里唯一一个撤不回来的操作。把删除挡在
 * 断开后面，就没有人会因为在右键菜单里点错一下而永久丢掉东西。
 *
 * 而且图片和视频都要能断开。之前只有 frame 能被取出，clip 完全没有出路。
 */
await nodes.doc('vid2').set({
  parentId: 's4', stepNo: 99, kind: 'video', status: 'achieved', createdAt: Date.now() + 70,
});

let refused = '';
try { await deleteNode(runRef.id, uid, 'vid2'); } catch (e) { refused = (e as Error).message; }
console.log(`\n  没断开就直接删 clip → ${refused || '（居然没拦住）'}`);
const okGate = /disconnect it first/.test(refused);
console.log(`  ${okGate ? '✅' : '❌'} 删除被挡在断开后面`);

await disconnectNode(runRef.id, 'vid2');
all = await read();
const okVideoDisconnect = all.find((n) => n.id === 'vid2')?.removedFromSequence === true;
console.log(`  ${okVideoDisconnect ? '✅' : '❌'} clip 也能被断开（之前只有图片可以）`);

const goneClip = await deleteNode(runRef.id, uid, 'vid2');
all = await read();
const okDeleteClip = !all.some((n) => n.id === 'vid2') && goneClip.deleted.length === 1;
console.log(`  ${okDeleteClip ? '✅' : '❌'} 断开之后可以真正删掉`);

/*
 * 删一张图的时候，从它渲染出来的片子要跟着走。
 *
 * 那支片子是这一帧的产物，离开它就没有意义；留下来就成了画布上一支再也找不到
 * 来源的视频。而下面的步骤不会被连坐 —— disconnect 的时候就已经把它们接到上一
 * 层了，所以删的时候底下本来就是空的，没有东西会被牵连。
 */
await nodes.doc('vid3').set({
  parentId: 's4', stepNo: 99, kind: 'video', status: 'achieved', createdAt: Date.now() + 80,
});
const s4Parent = all.find((n) => n.id === 's4')?.parentId;
await disconnectNode(runRef.id, 's4');
all = await read();
const liftedTo = all.find((n) => n.id === 's5')?.parentId;
console.log(`\n  断开 s4：s5 被接到 ${liftedTo}（s4 原来的父节点是 ${s4Parent}）`);
const okLift = liftedTo === s4Parent;
console.log(`  ${okLift ? '✅' : '❌'} 断开时后续步骤先被接到上一层，所以删除不会牵连它们`);

const clipsOnS4 = all.filter((n) => n.parentId === 's4' && n.kind === 'video').length;
const gone = await deleteNode(runRef.id, uid, 's4');
all = await read();
const okCascade =
  gone.clips === clipsOnS4 &&
  !all.some((n) => n.id === 's4' || n.id === 'vid3') &&
  all.some((n) => n.id === 's5');
console.log(`  ${okCascade ? '✅' : '❌'} 删图片时带走挂在它下面的全部 ${gone.clips} 支片子（应为 ${clipsOnS4}），而 s5 完好无损`);

for (const d of (await nodes.get()).docs) await d.ref.delete();
await runRef.delete();
process.exit(
  okSwap && okRemove && okReject && okNoSentinel && okRestore &&
  okGate && okVideoDisconnect && okDeleteClip && okLift && okCascade
    ? 0 : 1,
);
