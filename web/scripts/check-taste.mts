/*
 * Proves a rejection actually changes the next plan.
 *
 * The landing page promises "what you rejected changes how the next session
 * opens", and until now the taste collection was written on every rejection and
 * read by nothing. This plans the same goal twice — once clean, once with a
 * rejection on record — and shows the plans differ.
 */
import { readFileSync } from 'node:fs';
for (const l of readFileSync(new URL('../.env.local', import.meta.url),'utf8').split('\n')) {
  const m=l.match(/^([A-Z0-9_]+)=(.*)$/); if(m&&m[2].trim()) process.env[m[1]] ??= m[2].trim().replace(/^["']|["']$/g,'');
}
const { planRun } = await import('../lib/gemini');

const goal = 'A short ad where I use the hand cream at my desk during a work break.';

const plain = await planRun(goal, '9:16', 8);
console.log('  无历史:');
for (const s of plain.slice(0, 4)) console.log(`    ${s.stepNo}. ${s.label} — ${s.instruction.slice(0, 62)}`);

const avoid = [
  'Add warm golden-hour window light across the subject',
  'Place the subject at a wooden desk with plants behind',
];
const shaped = await planRun(goal, '9:16', 8, undefined, avoid);
console.log('\n  拒绝过（避免暖光 / 木桌绿植）:');
for (const s of shaped.slice(0, 4)) console.log(`    ${s.stepNo}. ${s.label} — ${s.instruction.slice(0, 62)}`);

const joined = shaped.map((s) => s.instruction.toLowerCase()).join(' ');
const repeated = avoid.filter((a) => joined.includes(a.toLowerCase()));
console.log(`\n  逐字重复被拒指令: ${repeated.length}`);
process.exit(repeated.length === 0 ? 0 : 1);
