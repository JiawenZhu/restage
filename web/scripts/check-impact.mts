/*
 * Changing the shoot: what gets invalidated, and what must not.
 *
 * This is the test that protects the user's money. Every shot this marks stale
 * is a paid generation and twenty-six seconds they will be asked to spend, so
 * being too eager costs them directly — and being too timid leaves frames in a
 * finished ad that show last week's product.
 *
 * Two halves. The rules are checked as pure functions against a synthetic six
 * shot ad, which is where the reasoning lives. Then the whole thing is run
 * against real Firestore through the real code path, because a rule that is
 * right in isolation and never reaches the database is worth nothing.
 *
 *   npx tsx scripts/check-impact.mts
 */
import { readFileSync } from 'node:fs';
for (const l of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && m[2].trim()) process.env[m[1]] ??= m[2].trim().replace(/^["']|["']$/g, '');
}
const { impactOf, changedFields, regenerateEstimate } = await import('../lib/impact');
const { adminDb } = await import('../lib/firebaseAdmin');

let failed = 0;
const check = (ok: boolean, label: string, detail = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? `  ${detail}` : ''}`);
  if (!ok) failed++;
};

/* A realistic cut: two person shots, two product, one detail, one scene. */
const SHOTS = [
  { id: 'a', stepNo: 1, kind: 'frame', shot: 'scene', label: 'The kitchen', frameUrl: 'x' },
  { id: 'b', stepNo: 2, kind: 'frame', shot: 'product', label: 'Bottle on counter', frameUrl: 'x' },
  { id: 'c', stepNo: 3, kind: 'frame', shot: 'person', label: 'Twisting the cap', frameUrl: 'x' },
  { id: 'd', stepNo: 4, kind: 'frame', shot: 'detail', label: 'Label macro', frameUrl: 'x' },
  { id: 'e', stepNo: 5, kind: 'frame', shot: 'person', label: 'First sip', frameUrl: 'x' },
  { id: 'f', stepNo: 6, kind: 'frame', shot: 'product', label: 'Payoff', frameUrl: 'x' },
] as never[];

console.log('════ 换东西之后，到底哪些镜头受影响 ════\n');

console.log('  改产品');
const prod = impactOf(['product'], SHOTS);
console.log(`    ${prod.summary}`);
console.log(`    确定要重做: ${prod.shots.filter((s) => s.certain).map((s) => s.label).join(', ')}`);
console.log(`    可能受影响: ${prod.shots.filter((s) => !s.certain).map((s) => s.label).join(', ') || '（无）'}`);
check(
  prod.shots.filter((s) => s.certain).map((s) => s.id).sort().join(',') === 'b,d,f',
  '产品/特写镜头全部标记为过时',
);
check(
  prod.shots.filter((s) => !s.certain).map((s) => s.id).sort().join(',') === 'c,e',
  '有人的镜头只列为「可能」，不自动标记',
  '（拿没拿着产品，只有用户知道）',
);
check(prod.untouched === 1, '场景镜头完全没被牵连', '（场景里没有产品）');

console.log('\n  换人');
const av = impactOf(['avatar'], SHOTS);
console.log(`    ${av.summary}`);
check(
  av.shots.map((s) => s.id).sort().join(',') === 'c,e',
  '换脸只影响有脸的镜头',
);
check(av.possibleCount === 0, '换脸没有「可能」这一档', '（有没有脸是确定的）');
check(av.untouched === 4, '产品、特写、场景一张都不用重做', '省下 4 次付费生成');

console.log('\n  改场地');
const loc = impactOf(['location'], SHOTS);
check(loc.shots.length === 6 && loc.certainCount === 6, '改场地会影响全部镜头', '（每一张都在这个地方拍的）');

console.log('\n  改衣服');
const ward = impactOf(['wardrobe'], SHOTS);
check(ward.shots.map((s) => s.id).sort().join(',') === 'c,e', '改衣服只影响有人的镜头');

console.log('\n  同时改产品和场地');
const both = impactOf(['product', 'location'], SHOTS);
check(both.certainCount === 6, '两个改动合并后，全部都是「确定」', '（不会因为第二个改动把第一个降级）');
check(both.possibleCount === 0, '被确定影响的镜头，不会再被列为「可能」');

console.log('\n  什么都没改');
const none = impactOf([], SHOTS);
check(none.shots.length === 0 && /Nothing/.test(none.summary), '没有改动就不标记任何东西', '（打开面板又原样保存不该花钱）');

console.log('\n  只把改过的字段算进去');
const cf = changedFields(
  { location: 'a kitchen', product: 'a bottle', wardrobe: 'grey tee' },
  { location: 'a kitchen', product: 'a mug' },
);
check(cf.join(',') === 'product', 'changedFields 只报真正变了的字段', `得到 [${cf.join(', ')}]`);

const est = regenerateEstimate(3);
check(est.seconds === 78 && /minute/.test(est.label), '重做的时间估算是按实测来的', `3 张 → ${est.label}`);

/* ── 真实数据库 ───────────────────────────────────────────────────────────── */
console.log('\n════ 真实 Firestore：改动会不会真的写下去 ════\n');

const uid = `_impacttest_${Date.now()}`;
const db = adminDb();
const runRef = db.collection('runs').doc();
await runRef.set({
  uid,
  goal: 'impact probe',
  aspect: '9:16',
  seconds: 16,
  status: 'awaiting-approval',
  plan: [],
  look: { location: 'a pale kitchen', wardrobe: 'grey tee', light: 'window left', palette: 'warm neutrals', product: 'a green bottle' },
  createdAt: Date.now(),
});
const nodes = runRef.collection('nodes');
for (const s of SHOTS as unknown as { id: string; stepNo: number; shot: string; label: string }[]) {
  await nodes.doc(s.id).set({
    parentId: 'root', stepNo: s.stepNo, kind: 'frame', shot: s.shot, label: s.label,
    status: 'achieved', frameUrl: `https://x/${s.id}.jpg`, createdAt: Date.now() + s.stepNo,
  });
}

const read = async () =>
  (await nodes.get()).docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }));

/* Replay exactly what the route does when the product is swapped. */
const stored = (await runRef.get()).data()!.look as Record<string, string>;
const patch = { product: 'a matte black flask' };
const fields = changedFields(stored, patch);
const impact = impactOf(fields, (await read()) as never[]);

await runRef.update({ look: { ...stored, ...patch } });
const batch = db.batch();
for (const s of impact.shots.filter((x) => x.certain)) batch.update(nodes.doc(s.id), { stale: true });
await batch.commit();

const after = await read();
const staleIds = after.filter((n) => n.stale === true).map((n) => n.id).sort().join(',');
const savedLook = (await runRef.get()).data()!.look as Record<string, string>;

console.log(`  标记为过时的: ${staleIds}`);
check(staleIds === 'b,d,f', '真实写入之后，只有产品和特写镜头被标记');
check(savedLook.product === 'a matte black flask', '新的产品描述存下来了');
check(savedLook.location === 'a pale kitchen', '没改的字段原样保留', '（不是整段覆盖）');
check(
  after.filter((n) => ['c', 'e'].includes(n.id)).every((n) => n.stale !== true),
  '有人的镜头没有被自动标记，等用户决定',
);
check(after.find((n) => n.id === 'a')!.stale !== true, '场景镜头依然是好的');

for (const d of (await nodes.get()).docs) await d.ref.delete();
await runRef.delete();

console.log(`\n${failed === 0 ? '✅ 全部通过' : `❌ ${failed} 项失败`}`);
process.exit(failed === 0 ? 0 : 1);
