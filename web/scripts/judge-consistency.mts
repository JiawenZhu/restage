/*
 * Which of two sets of shots holds ONE PERSON better?
 *
 * diag-age-drift.mts grades each frame with an absolute age estimate and
 * compares the spread. That metric turned out to be too blunt to answer the
 * question it was built for. Measured spreads came in at 1–3 years on both
 * sides, and a model reading an age off a photograph is not accurate to 1–3
 * years — so the numbers were mostly noise, and two of three trials landed on
 * "no change" and "worse" with no way to tell whether that meant anything.
 *
 * Worse, the spread metric can only detect an improvement on a run where the
 * defect actually showed up. Two trials had before-spreads of 1 and 2 years:
 * the person barely drifted, so there was nothing there to fix, and the trial
 * still counted as evidence.
 *
 * A PAIRED COMPARISON is the right instrument. Asking "which of these two sets
 * is more consistent" is a far easier question than "how old is this woman", it
 * uses both sets at once so per-session grader drift cancels, and it answers the
 * question actually being asked.
 *
 * Blinding matters and is easy to get wrong, so:
 *   - the sets are labelled A and B, never before/after
 *   - which one is A alternates by trial, so a model that favours the first set
 *     shown cannot produce a clean sweep
 *   - the judge is asked to commit to its reasoning BEFORE naming a winner
 *   - it is never told what changed between them, or that anything did
 *
 * Costs nothing to run: it re-reads frames already on disk.
 *
 *   npx tsx scripts/judge-consistency.mts
 */
import { readFileSync, existsSync } from 'node:fs';
for (const l of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && m[2].trim()) process.env[m[1]] ??= m[2].trim().replace(/^["']|["']$/g, '');
}

const { generateContent, MODELS } = await import('../lib/provider');
const P = 'vertex' as const;

const TRIALS = ['tf1-', 'tf2-', 'tf3-', 'tc1-', 't2-', 't3-'];
const REPEATS = 3; // the same pairing asked more than once, to expose a coin-flip

type Verdict = { reasoning: string; moreConsistent: 'A' | 'B' };

const load = (p: string) => ({
  inlineData: { mimeType: 'image/jpeg', data: readFileSync(p).toString('base64') },
});

async function judge(setA: string[], setB: string[]): Promise<Verdict> {
  const json = await generateContent({
    provider: P,
    model: MODELS[P].judge,
    label: 'consistency-judge',
    body: {
      contents: [
        {
          role: 'user',
          parts: [
            { text: 'SET A — three shots from one advertisement:' },
            ...setA.map(load),
            { text: 'SET B — three shots from a different advertisement:' },
            ...setB.map(load),
            {
              text:
                'Each set is meant to show the SAME woman photographed three times during one ' +
                'afternoon. Judge only the person, not the room, the framing or the product.\n\n' +
                'Look specifically at how much her APPARENT AGE and the CONDITION OF HER SKIN ' +
                'vary between the three shots within each set — fine lines around the eyes and ' +
                'mouth, nasolabial folds, forehead lines, skin firmness and evenness.\n\n' +
                'First write what you observe in each set. Then say which set holds one ' +
                'consistent person better across its three shots.\n' +
                'Reply as JSON only: {"reasoning":"...","moreConsistent":"A"|"B"}',
            },
          ],
        },
      ],
      generationConfig: { responseMimeType: 'application/json', temperature: 0 },
    },
  });
  const text =
    (json as { candidates?: { content?: { parts?: { text?: string }[] } }[] }).candidates?.[0]?.content?.parts?.[0]
      ?.text ?? '{}';
  return JSON.parse(text) as Verdict;
}

/*
 * COUNTERBALANCED WITHIN EACH PAIRING, because the first version was not and
 * the result was worthless.
 *
 * That version alternated which side the new direction sat on ACROSS trials,
 * and tallied. It came back 3–3, which reads like a coin flip and is not one:
 * in trial one the new set was A and the judge chose A three times; in trial
 * two the new set was B and the judge chose A three times. It picked the first
 * set shown, every single time, and all six explanations opened with the words
 * "In Set A". The alternation is what made that visible — without it, whichever
 * direction happened to be first would have won 6–0 and looked like proof.
 *
 * A judge with a position bias has not compared anything, so "3–3, no effect
 * demonstrated" was too generous. There was no signal at all.
 *
 * So each pairing is now asked in BOTH orders, and a verdict counts only when
 * it names the SAME underlying set both ways. A judge that always says A now
 * scores zero decisive verdicts instead of a tidy 50%, which is the honest
 * representation of what it knows.
 */
type Tally = { newWins: number; oldWins: number; positionBiased: number };
const tally: Tally = { newWins: 0, oldWins: 0, positionBiased: 0 };

for (const trial of TRIALS) {
  const before = [1, 2, 3].map((n) => `/tmp/age-${trial}before-${n}.jpg`);
  const after = [1, 2, 3].map((n) => `/tmp/age-${trial}after-${n}.jpg`);
  if (![...before, ...after].every(existsSync)) continue;

  console.log(`\n── trial ${trial.replace(/-$/, '')} ──`);

  for (let r = 0; r < REPEATS; r++) {
    // Same pairing, both ways round.
    const asked = await Promise.all([
      judge(after, before).then((v) => (v.moreConsistent === 'A' ? 'new' : 'old')),
      judge(before, after).then((v) => (v.moreConsistent === 'A' ? 'old' : 'new')),
    ]);

    if (asked[0] !== asked[1]) {
      tally.positionBiased++;
      console.log(`  ${r + 1}: no verdict — it chose the set shown first, both times`);
    } else if (asked[0] === 'new') {
      tally.newWins++;
      console.log(`  ${r + 1}: NEW — held under the swap`);
    } else {
      tally.oldWins++;
      console.log(`  ${r + 1}: OLD — held under the swap`);
    }
  }
}

const decisive = tally.newWins + tally.oldWins;
const total = decisive + tally.positionBiased;

console.log(`\n════ ${total} counterbalanced pairs ════`);
console.log(`  new direction more consistent: ${tally.newWins}`);
console.log(`  old direction more consistent: ${tally.oldWins}`);
console.log(`  no verdict (chose by position): ${tally.positionBiased}`);

if (!total) {
  console.log('\n  no complete trials on disk — run diag-age-drift.mts first');
  process.exit(0);
}

if (decisive < 4) {
  console.log(
    `\n  ⚠️  only ${decisive} of ${total} pairs produced a verdict that survived swapping.\n` +
      '  This judge cannot tell these sets apart. That is a fact about the judge,\n' +
      '  not evidence that the two directions are equivalent — look at the frames.',
  );
  process.exit(0);
}

const share = tally.newWins / decisive;
console.log(
  share >= 0.75
    ? `\n  ✅ the new direction wins ${tally.newWins}/${decisive} decisive pairs — a real effect`
    : share <= 0.25
      ? `\n  ❌ the OLD direction wins ${tally.oldWins}/${decisive} decisive pairs — this made it worse`
      : `\n  ⚠️  ${tally.newWins}/${decisive} decisive pairs. Not distinguishable from chance.`,
);
