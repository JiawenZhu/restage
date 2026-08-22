/*
 * Does EVERY template still plan a real advertisement?
 *
 * The plan is the whole game. It decides what each shot is OF, and that decides
 * whether the run comes out as an ad or as six photographs of one face — which
 * is also the difference between a good finished video and a bad one, because
 * Veo animates the frames it is given and cannot rescue a badly-chosen shot.
 *
 * The template path had never been graded. Every planner measurement taken so
 * far used a BARE GOAL, and the template branch is materially harder: it injects
 * authored presetSteps with their shot kinds and asks the model to preserve the
 * authored person/product ratio while rewriting each beat to the user's goal.
 * That authored ratio is the point of a template, and re-inferring kinds is
 * exactly the instruction a model drops first — the failure mode being that
 * everything silently becomes a 'person' shot again, which is the shape this
 * product started with and spent a lot of work leaving behind.
 *
 * Graded mechanically, because the checks that matter are countable: the mix,
 * the cap, whether a face leaked into a shot that is supposed to have nobody in
 * it, and whether the look bible is concrete enough to shoot from.
 *
 *   npx tsx scripts/check-templates.mts            all templates
 *   npx tsx scripts/check-templates.mts unboxing   just one
 */
import { readFileSync } from 'node:fs';
for (const l of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && m[2].trim()) process.env[m[1]] ??= m[2].trim().replace(/^["']|["']$/g, '');
}

/* ALL_TEMPLATES, not CREATIVE_TEMPLATES. The templates live in two arrays —
   AD_FORMAT_TEMPLATES and CREATIVE_TEMPLATES — and grading only the second one
   silently skipped six, including problem-solution, which is the template the
   run that prompted this check was made from. */
const { ALL_TEMPLATES } = await import('../lib/templates');
const { planRun } = await import('../lib/gemini');
const { MODELS, VERTEX_LOCATION } = await import('../lib/provider');

/*
 * Repeat, because the planner is stochastic and one sample is not a pass rate.
 *
 * Graded once, four templates looked broken. Graded again, three of those four
 * passed and a different one failed. What that measures is variance, not
 * quality — so a template is judged on how OFTEN it plans a good ad, and a
 * single bad draw is not a defect to go fixing.
 */
const REPEAT = Math.max(1, Number(process.argv.find((a) => a.startsWith('--repeat='))?.split('=')[1] ?? 1));
const only = process.argv[2]?.startsWith('--') ? undefined : process.argv[2];
const templates = only ? ALL_TEMPLATES.filter((t) => t.id === only) : ALL_TEMPLATES;
if (!templates.length) throw new Error(`no template ${only}`);

/*
 * Words that mean a HUMAN is in frame.
 *
 * Bare body-part nouns are not those words, which this got wrong first time and
 * nearly cost a planner fix it did not need. "head" flagged two perfectly good
 * shots: "the honeycomb mesh head" is the lint shaver's, and "frame the room
 * head-on" is a camera direction. Both were rewritten as planner failures until
 * the offending text was actually printed.
 *
 * So body parts count only when something owns them. Everything else here names
 * a person outright or describes something only a person does.
 */
const PERSON_WORDS = new RegExp(
  [
    // NOT bare `face`. Objects have faces — "the face of the bronze signet
    // ring", "the bottle face" — and flagging those failed a good template 0/3.
    // A person's face is owned or introduced: her face, a face, the creator's.
    String.raw`\b(?:person|people|creator|woman|man|portrait)\b`,
    String.raw`\b(?:his|her|their|a|the (?:person|creator|model)'s)\s+faces?\b`,
    String.raw`\b(?:she|he|her|him|hers|his)\b`,
    String.raw`\b(?:smil\w+|expression|eye contact|looking (?:at|into) the (?:camera|lens))\b`,
    // A body part, but only when it belongs to somebody.
    String.raw`\b(?:his|her|their|the (?:person|creator|model)'s)\s+\w*\s*(?:head|shoulders?|hands?|arms?|eyes?|hair)\b`,
  ].join('|'),
  'i',
);

/*
 * A look bible that cannot be shot from.
 *
 * The test is not "does it contain a weak adjective" — that was the first
 * version, and it failed "A modern open-plan office desk made of light oak",
 * which names a material and a layout and is perfectly shootable. A word like
 * "modern" is only a problem when it is doing ALL the work.
 *
 * So: vague if it reaches for a weak adjective AND offers no concrete anchor —
 * no material, no colour, no light, nothing spatial. "A modern kitchen" fails
 * both ways and is exactly the example the planner prompt already warns about.
 */
const WEAK = /\b(modern|nice|beautiful|stylish|generic|various|some|appropriate|suitable|typical|cozy|clean)\b/i;
const ANCHOR = new RegExp(
  [
    // material
    String.raw`\b(oak|birch|ash|walnut|pine|marble|granite|terrazzo|concrete|brick|tile|plaster|linen|cotton|wool|steel|brass|glass|ceramic|leather|velvet|chrome)\b`,
    // colour
    String.raw`\b(pale|cream|off-white|amber|sage|beige|charcoal|slate|powder|blush|ochre|navy|ivory|walnut|honey|grey|gray|white|black)\b`,
    // light and where it comes from
    String.raw`\b(window|sunlit|overcast|morning|afternoon|dusk|lamp|north-facing|east-facing|south-facing|west-facing|backlit|daylight|neon)\b`,
    // spatial
    String.raw`\b(to the left|to the right|behind|above|beside|corner|against the wall|by the)\b`,
  ].join('|'),
  'i',
);
const isVague = (s: string) => WEAK.test(s) && !ANCHOR.test(s);

/*
 * "…with no people visible" is the planner getting it RIGHT.
 *
 * A scene shot that states nobody is in frame is doing the thing the shot kind
 * exists for, and a naive search for person-words reads it as the opposite.
 * That was this checker's third false positive of the same family — after "the
 * honeycomb mesh head" and "frame the room head-on" — and between them they
 * nearly bought three planner fixes that were not needed.
 *
 * So negated mentions are removed before the search. The lesson each time was
 * the same one: print the offending text before believing the check.
 */
function withoutNegations(text: string): string {
  return text
    .replace(/\b(?:no|without|zero|free of|empty of|devoid of|absent (?:of|any))\s+(?:visible\s+)?\w*\s*(?:people|person|persons|humans?|faces?|figures?|models?|creators?)\b/gi, ' ')
    .replace(/\b(?:nobody|no one|no-one|unoccupied|uninhabited|deserted)\b/gi, ' ');
}

interface Row {
  id: string;
  ok: boolean;
  steps: number;
  authored: string;
  planned: string;
  problems: string[];
  sample: string;
}

async function grade(t: (typeof ALL_TEMPLATES)[number]): Promise<Row> {
  const problems: string[] = [];
  const authoredKinds = t.presetSteps.map((s) => s.shot);
  const authored = authoredKinds.join(',');

  try {
    const { steps, look } = await planRun(t.defaultPrompt, '9:16', 8, t.id, undefined, 'vertex');
    const planned = steps.map((s) => s.shot).join(',');

    if (steps.length < 5 || steps.length > 7) problems.push(`${steps.length} steps (want 5-7)`);

    // The cap the planner is told about, and the one the code enforces after.
    const persons = steps.filter((s) => s.shot === 'person').length;
    if (persons > Math.ceil(steps.length / 2)) problems.push(`${persons}/${steps.length} person shots — over the cap`);

    // The authored mix is the template's whole identity. Compare counts rather
    // than order: the planner may reorder beats, but turning three object shots
    // into three person shots is the regression worth catching.
    for (const kind of ['person', 'product', 'detail', 'scene'] as const) {
      const a = authoredKinds.filter((k) => k === kind).length;
      const p = steps.filter((s) => s.shot === kind).length;
      if (a > 0 && p === 0) problems.push(`lost every '${kind}' shot (authored ${a})`);
      if (kind === 'person' && p > a + 1) problems.push(`person shots ${a}→${p}`);
    }

    for (const s of steps) {
      if (s.shot !== 'person' && PERSON_WORDS.test(withoutNegations(s.instruction))) {
        const hit = s.instruction.match(PERSON_WORDS)?.[0] ?? '?';
        problems.push(`step ${s.stepNo} '${s.shot}' names a person ("${hit}"):\n      ${s.instruction}`);
      }
      if (s.instruction.length < 40) problems.push(`step ${s.stepNo} instruction too thin`);
    }

    if (!look?.location || look.location.length < 25) problems.push('look.location is thin');
    else if (isVague(look.location)) problems.push(`look.location has nothing to shoot: "${look.location.slice(0, 60)}"`);
    if (!look?.product || look.product.length < 15) problems.push('look.product is thin');

    return {
      id: t.id,
      ok: problems.length === 0,
      steps: steps.length,
      authored,
      planned,
      problems,
      sample: steps[0] ? `${steps[0].label} — ${steps[0].instruction.slice(0, 62)}` : '',
    };
  } catch (e) {
    return {
      id: t.id,
      ok: false,
      steps: 0,
      authored,
      planned: '—',
      problems: [(e instanceof Error ? e.message : String(e)).slice(0, 96)],
      sample: '',
    };
  }
}

console.log(`planner: ${MODELS.vertex.text} · location: ${VERTEX_LOCATION} · ${templates.length} templates\n`);

/* Four at a time: the planner takes ~10s, and sixteen in series is nearly three
   minutes of waiting for a check somebody is watching. */
const jobs = templates.flatMap((t) => Array.from({ length: REPEAT }, () => t));
const rows: Row[] = [];
for (let i = 0; i < jobs.length; i += 4) {
  const batch = await Promise.all(jobs.slice(i, i + 4).map(grade));
  for (const r of batch) {
    if (REPEAT === 1 || !r.ok) {
      console.log(`${r.ok ? '✅' : '❌'} ${r.id.padEnd(20)} ${String(r.steps).padStart(2)} shots  ${r.planned}`);
      if (!r.ok && r.authored !== r.planned) console.log(`   authored: ${r.authored}`);
      for (const p of r.problems) console.log(`   ↳ ${p}`);
      if (r.ok && r.sample) console.log(`   ${r.sample}`);
    }
  }
  rows.push(...batch);
}

console.log('');
let anyBad = false;
for (const t of templates) {
  const mine = rows.filter((r) => r.id === t.id);
  const passed = mine.filter((r) => r.ok).length;
  const bar = passed === mine.length ? '✅' : passed === 0 ? '❌' : '⚠️ ';
  if (passed !== mine.length) anyBad = true;
  console.log(`${bar} ${t.id.padEnd(20)} ${passed}/${mine.length}`);
}
const total = rows.filter((r) => r.ok).length;
console.log(`\n${total}/${rows.length} 次排程通过（${templates.length} 个模板 × ${REPEAT} 次）`);
process.exit(anyBad ? 1 : 0);
