/*
 * Proves the spend ceiling actually stops at its limit, and that parallel
 * requests cannot both slip through on the same count — the failure a
 * read-then-write counter has and a transaction does not.
 */
import { readFileSync } from 'node:fs';
for (const l of readFileSync(new URL('../.env.local', import.meta.url),'utf8').split('\n')) {
  const m=l.match(/^([A-Z0-9_]+)=(.*)$/); if(m&&m[2].trim()) process.env[m[1]] ??= m[2].trim().replace(/^["']|["']$/g,'');
}
const { consume, QUOTAS } = await import('../lib/rateLimit');
const { adminDb } = await import('../lib/firebaseAdmin');

const uid = `_ratetest_${Date.now()}`;
const limit = QUOTAS.render.limit;

let allowed = 0, denied = 0, retryAfter = 0;
for (let i = 0; i < limit + 5; i++) {
  const r = await consume(uid, 'render');
  if (r.ok) allowed++; else { denied++; retryAfter = r.retryAfterSeconds; }
}
console.log(`  串行 ${limit + 5} 次: 放行 ${allowed}, 拒绝 ${denied}  (上限 ${limit})`);

// parallel: a naive read-then-write counter lets these all through
const uid2 = `_ratetest_par_${Date.now()}`;
const results = await Promise.all(Array.from({ length: limit + 10 }, () => consume(uid2, 'render')));
const okCount = results.filter((r) => r.ok).length;
console.log(`  并行 ${limit + 10} 次: 放行 ${okCount}  (上限 ${limit})`);

console.log(`  重试提示: ${Math.round(retryAfter / 60)} 分钟后`);

for (const u of [uid, uid2]) await adminDb().collection('rateLimits').doc(`${u}_render`).delete().catch(() => {});
const pass = allowed === limit && denied === 5 && okCount <= limit;
console.log(pass ? '  ✅ 限额精确生效' : '  ❌ 限额不准');
process.exit(pass ? 0 : 1);
