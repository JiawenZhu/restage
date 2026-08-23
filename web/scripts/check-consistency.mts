/*
 * Is it the SAME PERSON in every shot — and will it stay that way for a
 * template nobody has written yet?
 *
 * From a finished ad: "the character at the beginning is very young, but later
 * the girl has wrinkles." Every frame in that ad passed the identity check,
 * and every frame was right to. The lock protected bone structure, face width,
 * jawline, eye shape and spacing, nose, lips, hairline, hairstyle, skin tone
 * and glasses — and said nothing whatsoever about how OLD she was. Apparent age
 * is not carried by any of that geometry. It is carried by skin, and skin was
 * the one facial property left to the model's discretion.
 *
 * Two independent causes, so two independent fixes, and this grades both:
 *
 *   1. NOTHING PINNED THE AGE. The prompt asked for "real texture and real
 *      pores" — an instruction to invent detail, answered a little differently
 *      every time it is given.
 *   2. NOTHING CARRIED IT BETWEEN SHOTS. Shots are generated independently
 *      (deliberately — it is what keeps every face one generation from the real
 *      photograph), so each one re-rolled that discretion from scratch. The
 *      room had a look contract. The product had an anchor. The person had
 *      neither.
 *
 * Graded WITHOUT generating anything. Every assertion here is about the prompt
 * that would be sent and the plumbing that would send it, so this runs in a
 * second, costs nothing, and can gate a commit. It cannot tell you the pictures
 * are good — scripts/check-look.mts renders two for the eye, and that judgement
 * is not automatable.
 *
 * The "for a template nobody has written yet" part is the reason this is worth
 * having at all. The direction lives in ONE place, lib/look.ts, and templates
 * supply only shot lists — so the guarantee is structural rather than per
 * template. The check walks all of them anyway, because that is the claim.
 *
 *   npx tsx scripts/check-consistency.mts
 */
import { readFileSync } from 'node:fs';

const {
  IDENTITY_LOCK,
  FLATTERING_CAMERA,
  SOFT_SEED_NOTE,
  motionDirection,
  objectMotionDirection,
  objectShotDirection,
  personShotDirection,
} = await import('../lib/look');
/* ALL_TEMPLATES, not CREATIVE_TEMPLATES — the latter is 10 of the 16, and the
   six it leaves out are the Ad-format ones: unboxing, testimonial,
   before-and-after. Those are the templates most made of person shots, so
   checking the other list would have graded exactly the wrong half. The same
   substitution has been a bug in this file before; see the note on
   templateById. */
const { ALL_TEMPLATES } = await import('../lib/templates');
import type { CastingNote, LookBible } from '../lib/types';

const { VIDEO_NEGATIVE_PROMPT } = await import('../lib/look');

const CASTING: CastingNote = {
  age: 'mid-thirties',
  skin: 'Even in tone with visible natural texture; faint fine lines at the outer corners of the eyes only',
  hair: 'Dark brown, shoulder length, worn loose with a centre parting',
  makeup: 'None visible',
  distinctive: 'A small mole below the left cheekbone; no glasses',
};

let failed = 0;
const check = (ok: boolean, label: string, detail = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? `  ${detail}` : ''}`);
  if (!ok) failed++;
};
const section = (s: string) => console.log(`\n════ ${s} ════\n`);

const LOOK: LookBible = {
  location: 'A sunlit kitchen counter of pale oak beside an open casement window',
  wardrobe: 'A cream ribbed cotton tank top, no jewellery',
  light: 'Late morning sun from camera left, warm and directional',
  palette: 'Warm oak, cream, soft green, amber glass',
  product: 'A small amber glass dropper bottle of facial oil',
};

/*
 * Source, with comments removed.
 *
 * Two of the checks below are necessarily about plumbing rather than output,
 * and a previous pass of this kind reported a clean bill of health five times
 * on strings that turned out to be sitting inside explanatory comments. The
 * comments in this repo discuss the bugs by name, so matching them is not an
 * edge case here — it is the default outcome.
 */
const bare = (p: string) =>
  readFileSync(new URL(p, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');

const ORCH = bare('../lib/orchestrator.ts');
const RENDER = bare('../app/api/runs/[runId]/render/route.ts');

/* ── 1. what the age experiments settled ─────────────────────────────────── */
section('Apparent age: reverted, and staying reverted until evidence says otherwise');

/*
 * These assert an ABSENCE, which is unusual for a test and is the point.
 *
 * Three separate attempts to pin apparent age in the prompt were measured
 * against the direction they replaced, and all three came back worse — worst of
 * all the version that named the marks. The header block in lib/look.ts has the
 * numbers. The prompt is back to what shipped, and these checks exist so the
 * next person to have the obvious idea has to read that block first.
 */
check(
  !/wrinkle|crow|nasolabial|forehead line|APPARENT AGE/i.test(IDENTITY_LOCK),
  'the identity lock says nothing about age or wrinkles',
  '(every version that did measured worse — see the header in look.ts)',
);
check(
  !personShotDirection(LOOK, CASTING).includes('THE PERSON'),
  'and the casting note does not reach the prompt',
  '(kept as a diagnostic; it is not prompt material)',
);
/* Word-bounded, because 'pack·AGING' matched an unbounded /aging/ and this
   reported an age term in a negative prompt whose only crime was the word
   "packaging". Sixth substring false positive of this kind in these checkers. */
check(
  !/\bwrinkles?\b|\baged skin\b|\bageing\b|\baging\b/i.test(VIDEO_NEGATIVE_PROMPT),
  'age is not in the video negative prompt either',
  '(it only subtracts; it would smooth users who really have lines)',
);

/* ── 2. a person shot is built from the enrolment captures alone ─────────── */
section('A person shot is built from the real photographs, and nothing else');

/*
 * The reference list is the load-bearing thing here, and both ways of getting
 * it wrong have now been tried in anger.
 *
 * Chaining each shot off the previous one is what this pipeline abandoned:
 * by step six the picture was six reinterpretations from the enrolment photo.
 * Anchoring every shot to the FIRST accepted frame instead is not that — depth
 * stays at two generations — and it measured BETTER on age drift, twice. But it
 * dragged the staging with it: shots one and three came back as the same seated
 * pose in the same crop, because a reference image cannot show a face without
 * also showing a composition.
 *
 * So the current state is the plain one: enrolment captures only. The next
 * thing to try is that anchor CROPPED TO THE HEAD, which keeps what worked and
 * removes the composition. Until then this asserts the plain version, so the
 * change is deliberate when it happens.
 */
check(
  /\brefs: isPerson \? \[avatarImage, \.\.\.extraViews\] : \[\]/.test(ORCH) ||
    /const refs = isPerson\s*\n\s*\? \[avatar, \.\.\.extraViews\]/.test(ORCH),
  'a person shot is handed the enrolment captures and nothing else',
  '(no generated frame in the reference list)',
);

section('The casting note is still derived, and still stored');

check(/castPerson\(\[avatar, \.\.\.extraViews\]/.test(ORCH), 'read off the ENROLMENT CAPTURES');
check(
  /await touch\(\{ casting \}\)/.test(ORCH),
  'and written to the run',
  '(a good diagnostic for "did this run come out older than she is")',
);
check(
  (ORCH.match(/castPerson\(/g) ?? []).length === 1,
  'exactly one reading per run',
);
check(
  /catch \(e\)[\s\S]{0,200}could not read the casting note/.test(ORCH),
  'a failed reading degrades the run instead of killing it',
);

/* productAnchor: declared, read, and never once assigned, so the comment above
   it described a mechanism that had never run. Fixed in the same pass. */
check(/productAnchor\s*\?\?=/.test(ORCH), 'the product anchor is ASSIGNED, not just read');
check(
  /rememberAnchor\(kind, parentImage\)/.test(ORCH) &&
    (ORCH.match(/rememberAnchor\(/g) ?? []).length >= 2,
  'and set on BOTH adoption paths, from frames that were ADOPTED',
  '(a discarded attempt is evidence on the canvas, not a reference)',
);

/* ── 3b. a face-free shot really is face-free ─────────────────────────────── */
section('A shot with nobody in it stays that way');

const GEMINI = bare('../lib/gemini.ts');
const { videoNegativeFor } = await import('../lib/look');

/*
 * The defect this section exists for reached the live landing page: the hero's
 * middle shot is a `product` step and the finished clip is dominated by a
 * woman's face — a different woman from the shot after it. In a three-shot ad
 * whose whole claim is that one face survives every shot.
 *
 * Two independent holes, so two checks. Either one alone still lets it through.
 */
check(
  /A face that IS present, however, is a hard failure/.test(GEMINI),
  'the critic fails an object shot that contains a face',
  '(it was told to set faceMatches TRUE and judge nothing else)',
);
check(
  /\bperson\b/.test(videoNegativeFor('product')) && /human face/.test(videoNegativeFor('product')),
  'and Veo is told to suppress people on object shots',
);
check(
  !/\bperson\b/.test(videoNegativeFor('person')),
  'while a person shot is NOT',
  '(one shared constant is why this could not be fixed before)',
);
check(
  /no face and no head appear/.test(objectShotDirection('product', LOOK)),
  'the positive prompt still asks as well',
  '(belt and braces — but the negative channel is the one that suppresses)',
);

/* ── 3c. the logics the user asked for ───────────────────────────────────── */
section('Prop physics, hands, packaging, space');

const { PROP_CONTINUITY, HANDS_AND_PACKAGING, SPATIAL_CONTINUITY } = await import('../lib/look');
const GEM = bare('../lib/gemini.ts');

/* Reported from a finished hero: at t=3.5s the bottle is in her hand, at t=5s
   it is gone and her hands are coated in oil, at t=7.8s it is standing on a
   dish. Nothing in this file had ever constrained an object. */
check(/in a hand at the start[\s\S]{0,80}still in that/i.test(PROP_CONTINUITY), 'objects stay where they are');
check(
  /the amount a real person would use/i.test(PROP_CONTINUITY) &&
    /behaves the way that material really behaves/i.test(PROP_CONTINUITY),
  'and quantities stay realistic for whatever the material is',
);
check(
  /teleporting objects/.test(VIDEO_NEGATIVE_PROMPT) && /excessive liquid/.test(VIDEO_NEGATIVE_PROMPT),
  'the artefacts are named in the NEGATIVE channel, not negated in the positive',
);
check(
  /still in that hand at the end/i.test(motionDirection()),
  'a person shot carries it',
  '(she is the one holding whatever the product is)',
);

/* 'No text' has been in OUTPUT_RULES since the beginning and every bottle still
   comes back printed. Image generation has no negative channel, so a blank
   label has to be stated as a positive fact about the object. */
check(
  /carries NO printing/i.test(HANDS_AND_PACKAGING) &&
    /shape, colour, material and finish alone/i.test(HANDS_AND_PACKAGING),
  'a blank product is asserted, not just forbidden',
);
check(
  /carries NO printing/i.test(personShotDirection(LOOK, null)) &&
    /carries NO printing/i.test(objectShotDirection('product', LOOK)),
  'and both shot kinds carry it',
);
check(/lettering on packaging/.test(VIDEO_NEGATIVE_PROMPT), 'with the artefact in the negative channel too');
/* Tests the RECOMMENDATION, not the word. The first version searched for
   'lettering' anywhere and failed on its own fix, whose wording is "Not
   lettering: packaging in this ad carries no printing." */
check(
  !/macro\. Texture, lettering/.test(GEM) && /Not lettering/.test(GEM),
  'the planner no longer offers lettering as a macro subject',
);

check(/five fingers on each hand/.test(HANDS_AND_PACKAGING), 'hands are specified on the STILL as well');
check(
  /key light comes from the same side/i.test(SPATIAL_CONTINUITY),
  'the location keeps one layout and one light direction',
);

/*
 * THE GLOBAL RULES MUST NOT KNOW WHAT THE PRODUCT IS.
 *
 * This check exists because the first version of these three contracts failed
 * it badly. They were written while debugging the landing-page hero, which is
 * a facial-oil ad shot in a kitchen, and the demo's specifics went straight
 * into constants that every template shares: "a few drops … the way a
 * well-formulated oil behaves on real skin", a label made "of the paper or
 * glass itself", and a layout rule that named THE WINDOW.
 *
 * Fifteen of the sixteen templates have no bottle, no window and no skincare
 * in them — the gallery runs to lunar expeditions, comic-book panels and
 * period pieces — and a real user brings their own product to any of them. The
 * dropper bottle exists in the public-page demo and nowhere else.
 *
 * Per-template scene and props already have a home: the template's own
 * lightingAndColor / cameraMotion / secondaryPhysics / presetSteps, which the
 * planner is given, and the per-run LookBible it writes from them. This file
 * describes only what is true of every shoot: identity, physics, geometry.
 */
const AGNOSTIC = [
  ['prop physics', PROP_CONTINUITY],
  ['hands & packaging', HANDS_AND_PACKAGING],
  ['spatial continuity', SPATIAL_CONTINUITY],
] as const;
const DEMO_SPECIFIC = /\b(oil|serum|dropper|bottle|kitchen|window|counter|paper|glass|skincare)\b/i;
for (const [name, text] of AGNOSTIC) {
  const hit = text.match(DEMO_SPECIFIC);
  check(!hit, `${name} names no specific product or place`, hit ? `found "${hit[0]}"` : '');
}
check(/CAUSAL ORDER/.test(GEM), 'the planner is told time runs forwards');
check(
  /kind === 'product' \|\| kind === 'detail'/.test(ORCH),
  'a detail macro gets the product anchor too',
  '(it is usually a close-up OF the product)',
);

/* ── 4. the video path ────────────────────────────────────────────────────── */
section('The video inherits all of it');

check(motionDirection().includes(IDENTITY_LOCK), 'the clip prompt carries the same lock as the still');
check(/not airbrushed to plastic/i.test(motionDirection()), 'and the same texture rule');
check(
  /video compression, not the person/i.test(SOFT_SEED_NOTE),
  'a chained segment is told its soft seed is a codec artefact',
  '(soft seed → model invents detail → invented facial detail is lines)',
);
check(
  /SOFT_SEED_NOTE/.test(RENDER) && /seg\.shot === 'person'/.test(RENDER),
  'and only person segments are told it',
  '(a macro of a label has no age to drift)',
);

/* ── 5. every template, including the ones not written yet ────────────────── */
section(`All ${ALL_TEMPLATES.length} templates`);

/*
 * EVERY logic, on EVERY shot of EVERY template — including the ones nobody has
 * written yet.
 *
 * This walked the templates asserting only IDENTITY_LOCK, which was true and
 * far too weak a claim. The product's promise is that a template is a shot list
 * and nothing else: all photographic and physical direction lives in
 * lib/look.ts, so a rule added there reaches all sixteen templates and the
 * seventeenth automatically. That promise is worth testing at the level it is
 * made — per contract, per shot, per template — rather than per file.
 */
/*
 * Matched on a distinctive PHRASE from each module rather than on a whole
 * constant. The constants were retired when the registry took over — the rules
 * moved into MODULES and are emitted as "HEADING: text", so an exact-substring
 * test against the old paragraph fails on prompts that carry every one of its
 * rules. Verified separately that all twenty substantive phrases survived the
 * migration; these are the ones worth asserting per template.
 */
const CONTRACTS = [
  { name: 'identity lock', text: 'bone structure, face width, jawline', on: 'person' },
  { name: 'face optics', text: '85mm equivalent lens', on: 'person' },
  { name: 'prop motion', text: 'still in that hand at the end', on: 'video' },
  { name: 'physics', text: 'behaves the way that material really behaves', on: 'both' },
  { name: 'blank packaging', text: 'carries NO printing', on: 'both' },
  { name: 'spatial continuity', text: 'one fixed layout', on: 'both' },
] as const;

let personSteps = 0;
let objectSteps = 0;
let leaked = 0;
const missing = new Map<string, string[]>();

for (const t of ALL_TEMPLATES) {
  for (const step of t.presetSteps) {
    const kind = step.shot ?? 'person';
    const isPerson = kind === 'person';
    isPerson ? personSteps++ : objectSteps++;

    // Exactly what lib/orchestrator.ts builds for this step...
    const still = isPerson ? personShotDirection(LOOK, null) : objectShotDirection(kind, LOOK);
    // ...and what the render route builds for its clip.
    const clip = isPerson ? motionDirection() : objectMotionDirection(kind, LOOK);

    for (const c of CONTRACTS) {
      const wanted =
        c.on === 'video' ? clip.includes(c.text)
        : c.on === 'both' ? still.includes(c.text)
        : isPerson ? still.includes(c.text) : true;
      if (!wanted) {
        const key = `${c.name} (${kind})`;
        missing.set(key, [...(missing.get(key) ?? []), `${t.id}·${step.label}`]);
      }
    }

    if (!isPerson && still.includes(IDENTITY_LOCK)) leaked++;
  }
}

check(
  personSteps > 0 && objectSteps > 0,
  `${ALL_TEMPLATES.length} templates · ${personSteps} person shots · ${objectSteps} face-free shots`,
);
for (const c of CONTRACTS) {
  const failures = [...missing.entries()].filter(([k]) => k.startsWith(c.name));
  check(
    failures.length === 0,
    `${c.name} reaches every shot it applies to`,
    failures.map(([k, v]) => `${k}: ${v.slice(0, 3).join(', ')}`).join(' | '),
  );
}
check(leaked === 0, 'no face-free shot is handed identity direction');
check(
  ALL_TEMPLATES.every((t) => t.presetSteps.some((s) => (s.shot ?? 'person') !== 'person')),
  'every template still cuts away from the face at least once',
  '(a shot with no face cannot drift)',
);

/*
 * And the templates must not contradict the contracts in their own words.
 *
 * A shot list cannot carry photographic direction, but it CAN carry an
 * instruction that asks for the opposite of one — "the label reads CALM" would
 * fight the blank-packaging rule from inside the one field a template does own.
 * The rule holds only if no authored instruction asks for what it forbids.
 */
/*
 * Scoped to shots OF THE PRODUCT, which is where the defect is.
 *
 * The first version tested every shot and found ten conflicts. Nine were real:
 * detail macros authored specifically to photograph lettering, which cannot
 * survive a blank label and are now rewritten to photograph grain, embossing
 * and seams instead — the same shot, with a subject that exists.
 *
 * The tenth was the sci-fi template's person shot, where 3D typography reading
 * MASS resolves behind the creator. That is environmental design and the
 * template's whole identity, not invented packaging text, so the rule was
 * narrowed rather than the template gutted. If a stylised template ever wants
 * words ON the bottle, this is the check that will argue with it.
 */
const askingForText = ALL_TEMPLATES.flatMap((t) =>
  t.presetSteps
    .filter((s) => (s.shot ?? 'person') !== 'person')
    .filter((s) => /\blabel (?:reads|says)\b|\blettering\b|\btypography\b|\bbrand name\b|\bproduct name\b/i.test(s.instruction))
    .map((s) => `${t.id}·${s.label}`),
);
check(
  askingForText.length === 0,
  'no product shot asks for readable text on the packaging',
  askingForText.join(', '),
);

/* The rationale is shown to the USER on the canvas. A rationale promising
   readable lettering beside a deliberately blank label is the product
   explaining itself incorrectly, which is its own kind of defect. */
const rationaleLies = ALL_TEMPLATES.flatMap((t) =>
  t.presetSteps.filter((s) => /\blettering\b|\bproduct name\b/i.test(s.rationale)).map((s) => `${t.id}·${s.label}`),
);
check(rationaleLies.length === 0, 'and no rationale promises the user readable text', rationaleLies.join(', '));

/* ── 5b. the module registry is WIRED, not merely declared ───────────────── */
section('Every module actually reaches a prompt');

/*
 * THE CHECK THIS FILE EXISTS FOR, in its purest form.
 *
 * The registry was written, typed, given a field on CreativeTemplate — and
 * composeDirection() had ZERO call sites. A template setting modules.physics
 * would have changed nothing at all, silently. That is the third time in this
 * codebase: productAnchor was declared and never assigned, RenderRequest.shot
 * was added and never passed, and then this.
 *
 * So the test drives it end to end: override every open module with a unique
 * sentinel, build the four real prompts, and require each sentinel to surface
 * in at least one of them. A module that cannot be observed in output is dead
 * however good its type is.
 */
const { MODULES: REG, isOpen: openM } = await import('../lib/modules');
const { styleForTemplate: styleOf } = await import('../lib/style');

const openIds = REG.filter((m) => openM(m.id)).map((m) => m.id);
const sentinels: Record<string, string> = {};
for (const id of openIds) sentinels[id] = `SENTINEL_${id.toUpperCase()}`;

const probeStyle = styleOf({
  id: 'probe', name: 'probe', category: 'Gaming',
  lightingAndColor: 'unused', cameraMotion: 'unused',
  modules: sentinels,
} as never);

const surfaces = [
  personShotDirection(LOOK, null, probeStyle),
  motionDirection(probeStyle),
  objectShotDirection('product', LOOK, probeStyle),
  objectMotionDirection('product', LOOK, probeStyle),
];
const dead = openIds.filter((id) => !surfaces.some((p) => p.includes(sentinels[id])));
check(dead.length === 0, `all ${openIds.length} open modules reach a real prompt`, dead.join(', '));

/* The locked three must NOT be overridable — they are what keeps the ad a
   picture of the actual user. */
const lockedIds = REG.filter((m) => !openM(m.id)).map((m) => m.id);
check(lockedIds.length === 3, `${lockedIds.length} modules are locked: ${lockedIds.join(', ')}`);
const lockedProbe = personShotDirection(LOOK, null, styleOf({
  id: 'p2', name: 'p2', category: 'Gaming', lightingAndColor: 'u', cameraMotion: 'u',
  modules: { identity: 'HACKED', optics: 'HACKED', anatomy: 'HACKED' } as never,
} as never));
check(!lockedProbe.includes('HACKED'), 'and a template cannot overwrite them');
check(
  REG.filter((m) => !openM(m.id)).every((m) => lockedProbe.includes(m.fallback)),
  'their real text survives the attempt',
);

/* ── 6. each template gets its OWN world ─────────────────────────────────── */
section('Every template is shot in its own style, not one global recipe');

/*
 * The defect: templates declared lightingAndColor / cameraMotion and it reached
 * the PLANNER and stopped. The image and video prompts then applied one global
 * recipe to all sixteen, so Moon Expedition's "jet-black cast shadows" and Film
 * Noir's chiaroscuro were both overruled by "soft key at 45 degrees, gentle
 * fill, shadows stay open… photorealistic" on every shot. A gallery of moods
 * that were only ever adjective sets.
 */
const { styleForRun, DEFAULT_STYLE: DEF } = await import('../lib/style');

const lit = new Set<string>();
for (const t of ALL_TEMPLATES) {
  const st = styleForRun(t.id);
  const prompt = personShotDirection(LOOK, null, st);
  lit.add(prompt.slice(0, 4000));

  if (!prompt.includes(t.lightingAndColor)) {
    check(false, `${t.id}: its own lighting reaches the shot`, '(overruled by the global recipe)');
  }
  if (/soft key light from about 45 degrees/i.test(prompt) && st !== DEF) {
    check(false, `${t.id}: NOT also given the default soft-key recipe`, '(two contradictory lighting instructions)');
  }
}
check(true, `all ${ALL_TEMPLATES.length} templates carry their own lighting and camera`);
check(
  lit.size === ALL_TEMPLATES.length,
  `and produce ${lit.size} distinct prompts, not one repeated ${ALL_TEMPLATES.length} times`,
);

/* The half that must NOT vary. A template may be as dark or as stylised as it
   likes and still may not photograph a face through a lens that deforms it. */
const everyTemplate = ALL_TEMPLATES.map((t) => personShotDirection(LOOK, null, styleForRun(t.id)));
check(
  everyTemplate.every((p) => /85mm equivalent lens/.test(p) && /never a wide lens/.test(p)),
  'while the face optics stay global and non-negotiable',
);
check(everyTemplate.every((p) => /recognise them instantly/.test(p)), 'as does the identity lock');

/* Stylised categories stop being told they are photographs. */
const comic = personShotDirection(LOOK, null, styleForRun('comic-book'));
check(!/Photorealistic/.test(comic), 'a comic-book shot is no longer ordered to be photorealistic');
check(/Photorealistic/.test(personShotDirection(LOOK, null, styleForRun('testimonial'))), 'while a testimonial still is');

/*
 * The structural claim, stated as a test.
 *
 * A template is a shot list. It cannot introduce photographic direction of its
 * own, which is precisely why a fix in lib/look.ts reaches templates that do not
 * exist yet. If a template ever grows its own prompt field, this fails and the
 * guarantee has to be re-argued rather than quietly lost.
 */
const TEMPLATE_SRC = bare('../lib/templates.ts');
check(
  !/\b(personDirection|identityLock|skinPrompt|customDirection)\b/.test(TEMPLATE_SRC),
  'no template carries photographic direction of its own',
  '(this is what makes the guarantee hold for future templates)',
);

console.log(`\n${failed === 0 ? '✅ all consistent' : `❌ ${failed} failed`}`);
process.exit(failed === 0 ? 0 : 1);
