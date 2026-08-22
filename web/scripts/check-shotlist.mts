/*
 * Does the planner actually cut an ad, or does it still shoot six selfies?
 *
 * The whole change rests on one number: how many of the shots contain a face.
 * Every shot of a person is another generation of a face that has to survive,
 * and a cut made entirely of them is a photo set. So this asks a real planner
 * for real plans and counts.
 *
 * It also checks the thing a schema cannot express. "At most half may be
 * person" is a ratio, not an enum, so the model can honour the letter of the
 * schema and return six person shots anyway — which is why planRun re-types the
 * surplus. That backstop is what this proves.
 *
 *   npx tsx scripts/check-shotlist.mts
 */
import { readFileSync } from 'node:fs';
for (const l of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && m[2].trim()) process.env[m[1]] ??= m[2].trim().replace(/^["']|["']$/g, '');
}
const { planRun } = await import('../lib/gemini');
const { CREATIVE_TEMPLATES } = await import('../lib/templates');

const GOALS: { goal: string; templateId?: string }[] = [
  {
    goal: 'A creator shows off a ceramic pour-over coffee dripper, brewing a cup at home and talking about how it changed their morning.',
    templateId: 'unboxing',
  },
  {
    goal: 'A short ad for a stainless steel water bottle that keeps drinks cold for 24 hours.',
  },
];

let failures = 0;

for (const { goal, templateId } of GOALS) {
  const label = templateId ? `template "${templateId}"` : 'no template';
  console.log(`\n════ ${label} ════`);
  const { steps, look } = await planRun(goal, '9:16', 16, templateId);

  console.log('  THE SHOOT');
  for (const [k, v] of Object.entries(look)) console.log(`    ${k.padEnd(9)} ${String(v).slice(0, 78)}`);

  console.log('\n  THE CUT');
  for (const s of steps) {
    console.log(`    ${String(s.stepNo).padEnd(2)} [${s.shot.padEnd(7)}] ${s.label.padEnd(22)} ${s.instruction.slice(0, 60)}`);
  }

  const people = steps.filter((s) => s.shot === 'person').length;
  const cap = Math.max(1, Math.floor(steps.length / 2));
  const kinds = new Set(steps.map((s) => s.shot));

  const okRatio = people <= cap;
  const okVariety = kinds.size >= 2;
  const okLook = Object.values(look).every((v) => typeof v === 'string' && v.trim().length > 8);

  console.log(`\n  ${people} of ${steps.length} shots have a face in them (cap ${cap})`);
  console.log(`  ${okRatio ? '✅' : '❌'} 不再是清一色的人像：有脸的镜头没有超过一半`);
  console.log(`  ${okVariety ? '✅' : '❌'} 镜头类型有变化：${[...kinds].join(', ')}`);
  console.log(`  ${okLook ? '✅' : '❌'} 写出了统一的拍摄设定，独立生成的镜头才接得起来`);

  /* A shot that says "their hands" is a person shot wearing a disguise: it
     cannot be photographed without the person, so it drags the face back into a
     frame that was supposed to be free of one. */
  const leaks = steps
    .filter((s) => s.shot !== 'person')
    .filter((s) => /\b(their|her|his|the creator'?s?|face|head)\b/i.test(s.instruction));
  const okClean = leaks.length === 0;
  console.log(`  ${okClean ? '✅' : '❌'} 无人镜头里没有偷偷把人写回去${leaks.length ? `：${leaks.map((l) => l.label).join(', ')}` : ''}`);

  if (!okRatio || !okVariety || !okLook || !okClean) failures++;
}

/* The templates are the other half of this. A template whose authored
   choreography is still five person shots will push the planner straight back
   to where it started, however the planner is prompted. */
console.log('\n════ authored templates ════');
let badTemplates = 0;
for (const t of CREATIVE_TEMPLATES) {
  const people = t.presetSteps.filter((s) => s.shot === 'person').length;
  const cap = Math.max(1, Math.floor(t.presetSteps.length / 2));
  const bad = people > cap;
  if (bad) badTemplates++;
  console.log(`  ${bad ? '❌' : '✅'} ${t.id.padEnd(20)} ${people}/${t.presetSteps.length} person`);
}
console.log(`\n  ${badTemplates === 0 ? '✅' : '❌'} 所有模板的人像镜头都没有超过一半（${badTemplates} 个超标）`);

process.exit(failures === 0 && badTemplates === 0 ? 0 : 1);
