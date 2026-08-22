/* Poll the newest _looptest run and print what has landed. */
import { readFileSync } from 'node:fs';
for (const l of readFileSync(new URL('../.env.local', import.meta.url),'utf8').split('\n')) {
  const m=l.match(/^([A-Z0-9_]+)=(.*)$/); if(m&&m[2].trim()) process.env[m[1]] ??= m[2].trim().replace(/^["']|["']$/g,'');
}
const { adminDb } = await import('../lib/firebaseAdmin');
const db = adminDb();
const snap = await db.collection('runs').where('uid','==','_looptest').orderBy('createdAt','desc').limit(1).get();
if (snap.empty) { console.log('  还没有 run'); process.exit(0); }
const doc = snap.docs[0];
const d = doc.data();
console.log(`  run ${doc.id}`);
console.log(`  状态: ${d.status}   计划步骤: ${(d.plan||[]).length}   帧数: ${d.frameCount ?? 0}`);
if (d.audioScript) console.log(`  台词: "${d.audioScript}"`);
if (d.failureReason) console.log(`  失败原因: ${d.failureReason}`);
const nodes = await doc.ref.collection('nodes').orderBy('createdAt').get();
for (const n of nodes.docs) {
  const v = n.data();
  const badge = v.verdict ? `[${v.verdict}]` : '';
  const disc = v.discarded ? ' DISCARDED' : '';
  console.log(`    ${String(v.stepNo).padStart(2)} ${v.kind.padEnd(6)} ${v.status.padEnd(10)} ${badge}${disc} ${(v.label||v.instruction||'').slice(0,52)}`);
}
process.exit(0);
