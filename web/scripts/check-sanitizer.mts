/*
 * Proves sanitizeFirestore passes FieldValue sentinels through intact.
 *
 * The regression this guards is invisible in code review and silent at runtime:
 * a JSON round-trip turns FieldValue.increment(1) into {operand: 1}, which
 * Firestore stores as a map. The counter never counts and nothing errors.
 */
import { readFileSync } from 'node:fs';
for (const l of readFileSync(new URL('../.env.local', import.meta.url),'utf8').split('\n')) {
  const m=l.match(/^([A-Z0-9_]+)=(.*)$/); if(m&&m[2].trim()) process.env[m[1]] ??= m[2].trim().replace(/^["']|["']$/g,'');
}
const { adminDb } = await import('../lib/firebaseAdmin');
const { FieldValue } = await import('firebase-admin/firestore');
const { sanitizeForFirestore } = await import('../lib/orchestrator');

const ref = adminDb().collection('_healthcheck').doc('sanitizer');
await ref.set({ n: 0, arr: [] });

for (let i = 0; i < 3; i++) {
  await ref.update(sanitizeForFirestore({ n: FieldValue.increment(1), arr: FieldValue.arrayUnion({ i }) }));
}

const d = (await ref.get()).data()!;
const ok = d.n === 3 && Array.isArray(d.arr) && d.arr.length === 3;
console.log(`  三次 increment 后 n = ${JSON.stringify(d.n)}  (期望 3)`);
console.log(`  三次 arrayUnion 后 arr = ${Array.isArray(d.arr) ? `数组(${d.arr.length})` : JSON.stringify(d.arr)}  (期望 数组(3))`);

// and the size guard still strips inline images
const stripped = sanitizeForFirestore({ keep: 'data:image/x,tiny', drop: 'data:image/jpeg;base64,' + 'A'.repeat(5000) });
console.log(`  小 data: 保留 = ${stripped.keep !== null}   大 data: 剥离 = ${stripped.drop === null}`);

await ref.delete();
console.log(ok ? '  ✅ 哨兵值完好' : '  ❌ 哨兵值仍被破坏');
process.exit(ok ? 0 : 1);
