import { readFileSync } from 'node:fs';
for (const l of readFileSync('/Users/jiawenzhu/Developer/restage-design/web/.env.local','utf8').split('\n')) {
  const m=l.match(/^([A-Z0-9_]+)=(.*)$/); if(m&&m[2].trim()) process.env[m[1]] ??= m[2].trim().replace(/^["']|["']$/g,'');
}
const { adminDb } = await import('/Users/jiawenzhu/Developer/restage-design/web/lib/firebaseAdmin.ts');
const { FieldValue } = await import('firebase-admin/firestore' as string);
const db = adminDb();
const runs = await db.collection('runs').get();

let repaired = 0, summarised = 0;
for (const doc of runs.docs) {
  const d = doc.data();
  const patch: Record<string, unknown> = {};

  // Strip inline images that make the document unwritable.
  const hasInline = (v: unknown): boolean =>
    typeof v === 'string' ? v.startsWith('data:') && v.length > 4096
      : v && typeof v === 'object' ? Object.values(v).some(hasInline) : false;
  for (const [k, v] of Object.entries(d)) {
    if (hasInline(v)) { patch[k] = FieldValue.delete(); }
  }

  // Fill the summary the library reads.
  if (typeof d.frameCount !== 'number' || !d.thumbUrl) {
    const nodes = await doc.ref.collection('nodes').orderBy('createdAt', 'desc').get();
    const frames = nodes.docs.filter((n) => n.data().kind === 'frame' && n.data().frameUrl);
    if (frames.length) {
      const best = frames.find((n) => n.data().status === 'achieved') ?? frames[0];
      patch.frameCount = frames.length;
      patch.thumbUrl = best.data().frameUrl;
      summarised++;
    }
  }

  if (Object.keys(patch).length) {
    await doc.ref.update(patch);
    repaired++;
    const stripped = Object.entries(patch).filter(([, v]) => v && typeof v === 'object' && 'constructor' in (v as object)).length;
    console.log(`  ${doc.id}: ${Object.keys(patch).join(', ')}`);
  }
}
console.log(`repaired ${repaired} runs, ${summarised} given summaries`);
process.exit(0);
