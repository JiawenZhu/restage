/*
 * How often does the pipeline pay for an image and then throw it away?
 *
 * The user saw "1 thrown away" on a 6-image run AND on an 8-image run and
 * concluded it was systematic. A discard is not free: `discarded: canRetry` in
 * lib/orchestrator.ts (~line 658) means a second generateFrame() call was spent
 * on that step. So every discard is a paid image the user never sees.
 *
 * This walks EVERY run for one uid and prints, per run and in aggregate:
 *   - frames produced, frames discarded
 *   - the verdict distribution (met / partial / failed), and how many of each
 *     were discarded — the ratio that says whether the critic is catching
 *     defects or just expressing taste
 *   - for each discarded frame: stepNo, shot kind, verdict, the FULL
 *     criticNotes, and whether the replacement sibling actually scored better
 *
 * The shot kind is the load-bearing column. A person shot can fail identity —
 * a real, checkable defect. A product/detail/scene shot has no face to get
 * wrong (orchestrator.ts:612 `isPerson && ...`), so a discard there is the
 * critic disliking the photograph, nothing more.
 *
 * READ-ONLY. Nothing here writes, updates, or deletes.
 *
 *   npx tsx scripts/diag-discards.mts [uid]
 */
import { readFileSync } from 'node:fs';
for (const l of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && m[2].trim()) process.env[m[1]] ??= m[2].trim().replace(/^["']|["']$/g, '');
}
const { adminDb } = await import('../lib/firebaseAdmin');

const UID = process.argv[2] ?? 'ypGBh9tgrxQixPdJWwI6k40lF812';
// Named in the task so the survey can be proved to have reached them.
const MUST_COVER = ['vPoX3tm6zGblXqWjRXg7', 'fZFpbFfqDqPGMRFknrZu', 'IbRTzSfr06wTGgdKpBNL'];

const db = adminDb();

type Node = {
  id: string;
  parentId?: string | null;
  stepNo?: number;
  kind?: string;
  status?: string;
  shot?: string;
  verdict?: string;
  criticNotes?: string;
  criticRubric?: string;
  continuityHeld?: boolean;
  continuityBreaks?: string | null;
  discarded?: boolean;
  frameUrl?: string;
  createdAt?: number;
  label?: string;
  instruction?: string;
};

const runSnap = await db.collection('runs').where('uid', '==', UID).get();
const runIds = runSnap.docs.map((d) => d.id);
for (const id of MUST_COVER) if (!runIds.includes(id)) runIds.push(id); // fetched individually below
const runMeta = new Map(runSnap.docs.map((d) => [d.id, d.data() as Record<string, unknown>]));

console.log(`uid ${UID} → ${runSnap.size} run(s) by query; ${runIds.length} to examine`);
for (const id of MUST_COVER) {
  console.log(`  known-id check ${id}: ${runMeta.has(id) ? 'in query result' : 'NOT in query — fetching directly'}`);
}

const RANK: Record<string, number> = { failed: 0, partial: 1, met: 2 };
const better = (a?: string, b?: string) => {
  if (a === undefined || b === undefined) return 'unknown';
  const ra = RANK[a], rb = RANK[b];
  if (ra === undefined || rb === undefined) return 'unknown';
  return rb > ra ? 'better' : rb < ra ? 'WORSE' : 'same';
};

// verdict → [total, discarded]
const agg = new Map<string, [number, number]>();
const shotAgg = new Map<string, [number, number]>(); // shot kind → [total, discarded]
const bump = (m: Map<string, [number, number]>, k: string, disc: boolean) => {
  const cur = m.get(k) ?? [0, 0];
  cur[0]++;
  if (disc) cur[1]++;
  m.set(k, cur);
};

let framesTotal = 0;
let discardedTotal = 0;
const perRun: { runId: string; frames: number; discarded: number; kinds: string[] }[] = [];
const discardRows: Record<string, unknown>[] = [];

for (const runId of runIds) {
  const meta = runMeta.get(runId) ?? (await db.collection('runs').doc(runId).get()).data();
  if (!meta) {
    console.log(`\n──── ${runId} — NO SUCH RUN ────`);
    continue;
  }
  if (meta.uid !== UID) console.log(`  note: ${runId} belongs to uid ${meta.uid}, not ${UID}`);

  const snap = await db.collection('runs').doc(runId).collection('nodes').orderBy('createdAt').get();
  const nodes = snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as Node[];
  const frames = nodes.filter((n) => n.kind === 'frame');
  const discarded = frames.filter((n) => n.discarded === true);

  framesTotal += frames.length;
  discardedTotal += discarded.length;

  const dist = new Map<string, number>();
  for (const f of frames) {
    const v = f.verdict ?? '(none)';
    dist.set(v, (dist.get(v) ?? 0) + 1);
    bump(agg, v, f.discarded === true);
    bump(shotAgg, f.shot ?? '(unset)', f.discarded === true);
  }

  console.log(`\n════════════════════════════════════════════════════════════════════`);
  console.log(`RUN ${runId}   status=${meta.status}  plan=${(meta.plan as unknown[])?.length ?? 0} steps`);
  console.log(`  goal: ${JSON.stringify(String(meta.goal ?? '').slice(0, 120))}`);
  console.log(`  frames=${frames.length}  discarded=${discarded.length}  ` +
    `verdicts: ${[...dist].map(([k, v]) => `${k}=${v}`).join(' ') || 'none'}`);

  perRun.push({
    runId,
    frames: frames.length,
    discarded: discarded.length,
    kinds: discarded.map((d) => d.shot ?? '(unset)'),
  });

  for (const d of discarded) {
    // The retry is the next frame written at the same step off the same parent.
    const sibs = frames
      .filter((f) => f.stepNo === d.stepNo && (f.parentId ?? null) === (d.parentId ?? null))
      .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
    const idx = sibs.findIndex((s) => s.id === d.id);
    const repl = idx >= 0 ? sibs[idx + 1] : undefined;

    // wrongFace is not persisted, but it is recoverable: status is forced to
    // 'failed' when wrongFace is true even if the critic's own verdict was
    // met/partial (orchestrator.ts:657). And wrongFace is impossible unless the
    // shot is a person shot (orchestrator.ts:612).
    const isPersonShot = d.shot === 'person';
    const faceForced = isPersonShot && d.status === 'failed' && d.verdict !== 'failed';
    const cause = faceForced
      ? 'IDENTITY (face mismatch forced the failure)'
      : !isPersonShot
        ? `CRITIC TASTE ONLY — ${d.shot ?? '(unset)'} shot has no identity to fail`
        : `critic verdict '${d.verdict}' (identity indeterminate: verdict was already failed)`;

    console.log(`\n  ── DISCARDED  step ${d.stepNo}  shot=${d.shot ?? '(unset)'}  verdict=${d.verdict}  status=${d.status}`);
    console.log(`     node        ${d.id}`);
    console.log(`     label       ${d.label ?? '—'}`);
    console.log(`     instruction ${JSON.stringify(String(d.instruction ?? '').slice(0, 200))}`);
    console.log(`     cause       ${cause}`);
    console.log(`     rubric      ${d.criticRubric ?? '—'}`);
    console.log(`     continuity  held=${d.continuityHeld} breaks=${JSON.stringify(d.continuityBreaks ?? '')}`);
    console.log(`     criticNotes (VERBATIM, FULL):`);
    console.log(`       ${String(d.criticNotes ?? '(none)').split('\n').join('\n       ')}`);
    if (repl) {
      console.log(`     REPLACEMENT ${repl.id}  verdict=${repl.verdict}  status=${repl.status}  ` +
        `discarded=${repl.discarded === true}  → ${better(d.verdict, repl.verdict)}`);
      console.log(`     replacement notes (VERBATIM, FULL):`);
      console.log(`       ${String(repl.criticNotes ?? '(none)').split('\n').join('\n       ')}`);
    } else {
      console.log(`     REPLACEMENT none found at step ${d.stepNo} off parent ${d.parentId ?? 'root'}`);
    }

    discardRows.push({
      runId,
      stepNo: d.stepNo,
      shotKind: d.shot ?? '(unset)',
      verdict: d.verdict,
      status: d.status,
      cause,
      criticNotes: d.criticNotes ?? '',
      wasFaceShot: isPersonShot,
      replacementVerdict: repl?.verdict ?? null,
      replacementNotes: repl?.criticNotes ?? null,
      retryImproved: repl ? better(d.verdict, repl.verdict) : 'no replacement',
    });
  }
}

console.log(`\n════════════════════════════════════════════════════════════════════`);
console.log(`AGGREGATE across ${perRun.length} run(s)`);
console.log(`  frames generated (paid): ${framesTotal}`);
console.log(`  frames discarded:        ${discardedTotal}  ` +
  `(${framesTotal ? ((discardedTotal / framesTotal) * 100).toFixed(1) : '0'}% of spend)`);
console.log(`\n  per run:`);
for (const r of perRun) {
  console.log(`    ${r.runId.padEnd(22)} frames=${String(r.frames).padStart(2)}  discarded=${r.discarded}` +
    (r.kinds.length ? `  [${r.kinds.join(', ')}]` : ''));
}
console.log(`\n  verdict distribution (total / discarded):`);
for (const [v, [t, d]] of [...agg].sort((a, b) => b[1][0] - a[1][0])) {
  console.log(`    ${v.padEnd(10)} ${String(t).padStart(3)} frames, ${String(d).padStart(3)} discarded  ` +
    `(${t ? ((d / t) * 100).toFixed(0) : '0'}% of this verdict was thrown away)`);
}
console.log(`\n  by shot kind (total / discarded):`);
for (const [k, [t, d]] of [...shotAgg].sort((a, b) => b[1][0] - a[1][0])) {
  console.log(`    ${k.padEnd(10)} ${String(t).padStart(3)} frames, ${String(d).padStart(3)} discarded  ` +
    `(${t ? ((d / t) * 100).toFixed(0) : '0'}%)`);
}
const nonPerson = discardRows.filter((r) => !r.wasFaceShot).length;
console.log(`\n  discards on shots with NO identity to get wrong: ${nonPerson}/${discardRows.length}`);
const improved = discardRows.filter((r) => r.retryImproved === 'better').length;
const same = discardRows.filter((r) => r.retryImproved === 'same').length;
const worse = discardRows.filter((r) => r.retryImproved === 'WORSE').length;
console.log(`  retry outcome: better=${improved}  same=${same}  worse=${worse}  ` +
  `other=${discardRows.length - improved - same - worse}`);

// Machine-readable tail, so the numbers above can be checked without re-reading prose.
console.log(`\n──── JSON ────`);
console.log(JSON.stringify({ framesTotal, discardedTotal, perRun, discardRows }, null, 2));
process.exit(0);
