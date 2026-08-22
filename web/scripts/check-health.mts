/*
 * One command that answers "is this deployable right now".
 *
 * Every check here is one that has actually broken during development, which is
 * the only reason a check earns its place: silent Firestore sentinel
 * corruption, a locked bucket that broke every image, an expiring URL stored as
 * permanent state, a spend ceiling that did not hold under concurrency.
 *
 *   npx tsx scripts/check-health.mts
 */
import { readFileSync } from 'node:fs';
for (const l of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && m[2].trim()) process.env[m[1]] ??= m[2].trim().replace(/^["']|["']$/g, '');
}

const results: { name: string; ok: boolean; note: string }[] = [];
const check = async (name: string, fn: () => Promise<string>) => {
  try {
    results.push({ name, ok: true, note: await fn() });
  } catch (e) {
    results.push({ name, ok: false, note: e instanceof Error ? e.message : String(e) });
  }
};

const { adminDb } = await import('../lib/firebaseAdmin');
const { FieldValue } = await import('firebase-admin/firestore');
const { sanitizeForFirestore, uploadToStorage } = await import('../lib/orchestrator');
const { consume, QUOTAS } = await import('../lib/rateLimit');

await check('Firestore 可写', async () => {
  const ref = adminDb().collection('_healthcheck').doc('probe');
  await ref.set({ at: Date.now() });
  await ref.delete();
  return 'ok';
});

await check('FieldValue 哨兵未被破坏', async () => {
  const ref = adminDb().collection('_healthcheck').doc('sentinel');
  await ref.set({ n: 0, arr: [] });
  for (let i = 0; i < 3; i++) {
    await ref.update(sanitizeForFirestore({ n: FieldValue.increment(1), arr: FieldValue.arrayUnion({ i }) }));
  }
  const d = (await ref.get()).data()!;
  await ref.delete();
  if (d.n !== 3) throw new Error(`increment 得到 ${JSON.stringify(d.n)}，应为 3`);
  if (!Array.isArray(d.arr) || d.arr.length !== 3) throw new Error(`arrayUnion 得到 ${JSON.stringify(d.arr)}`);
  return 'increment 与 arrayUnion 均正常';
});

await check('存储私有但带令牌可读', async () => {
  const px = Buffer.from(
    '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
    'base64',
  );
  const path = `_healthcheck/probe-${Date.now()}.jpg`;
  const url = await uploadToStorage(px, path);
  if (!url.includes('token=')) throw new Error('上传未带下载令牌');
  const withToken = await fetch(url);
  const without = await fetch(url.split('&token=')[0]);
  const { adminStorage } = await import('../lib/firebaseAdmin');
  await adminStorage()
    .bucket(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'restage-studio.firebasestorage.app')
    .file(path)
    .delete()
    .catch(() => {});
  if (!withToken.ok) throw new Error(`带令牌读取失败 (${withToken.status})`);
  if (without.ok) throw new Error('去掉令牌仍可读 —— 存储桶未私有');
  return `带令牌 ${withToken.status} / 无令牌 ${without.status}`;
});

await check('限额在并发下精确', async () => {
  const uid = `_health_${Date.now()}`;
  const limit = QUOTAS.render.limit;
  const rs = await Promise.all(Array.from({ length: limit + 10 }, () => consume(uid, 'render')));
  await adminDb().collection('rateLimits').doc(`${uid}_render`).delete().catch(() => {});
  const ok = rs.filter((r) => r.ok).length;
  if (ok !== limit) throw new Error(`并发 ${limit + 10} 次放行 ${ok}，应为 ${limit}`);
  return `并发 ${limit + 10} 次放行 ${ok}`;
});

await check('复合索引已部署', async () => {
  // The query the library depends on. Without the index this throws, and the
  // old code silently answered with every user's runs instead.
  await adminDb().collection('runs').where('uid', '==', '_health').orderBy('createdAt', 'desc').limit(1).get();
  return 'uid + createdAt 可查询';
});

await check('运行文档无内联图片', async () => {
  const runs = await adminDb().collection('runs').limit(50).get();
  const heavy = runs.docs
    .map((d) => ({ id: d.id, size: JSON.stringify(d.data()).length }))
    .filter((r) => r.size > 900_000);
  if (heavy.length) throw new Error(`${heavy.length} 个文档接近 1MB 上限: ${heavy.map((h) => h.id).join(', ')}`);
  return `${runs.size} 个文档全部低于上限`;
});

console.log();
for (const r of results) console.log(`  ${r.ok ? '✅' : '❌'} ${r.name.padEnd(24)} ${r.note}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n  ${results.length - failed}/${results.length} 通过\n`);
process.exit(failed ? 1 : 0);
