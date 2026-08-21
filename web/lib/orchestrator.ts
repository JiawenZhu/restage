/*
 * The loop. Plan, then for each step: generate a frame, have the critic judge
 * it, and when the verdict is `failed` keep the attempt on the tree and try
 * again from the same parent.
 *
 * Every node is written to Firestore the moment it exists rather than at the
 * end, because that write IS the live update — the client is watching the
 * collection. It also means a refresh mid-run loses nothing, and a run that
 * dies halfway leaves a readable record of how far it got instead of vanishing.
 *
 * SERVER ONLY: it holds the Gemini key and writes through the admin SDK.
 */

if (typeof window !== 'undefined') {
  throw new Error('lib/orchestrator is server-only.');
}

import { adminDb } from './firebaseAdmin';
import { critique, generateFrame, planRun } from './gemini';
import type { Aspect } from './types';

/** One retry. A second failure keeps both attempts visible and moves on, because
 *  a loop that retries forever is a bill, not a feature. */
const MAX_RETRIES_PER_STEP = 1;

export interface StartArgs {
  uid: string;
  goal: string;
  aspect: Aspect;
  seconds: 8 | 15 | 30;
  /** Enrolment capture as a data URL. Passed to every frame so the face holds. */
  avatarDataUrl: string;
}

function decodeDataUrl(u: string) {
  const m = u.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) throw new Error('avatar must be a data URL');
  return { mimeType: m[1], data: Buffer.from(m[2], 'base64') };
}

/** Frames are stored inline as data URLs for now. See note in executeRun. */
function toDataUrl(bytes: Buffer, mimeType: string) {
  return `data:${mimeType};base64,${bytes.toString('base64')}`;
}

export async function createRun(args: StartArgs): Promise<string> {
  const db = adminDb();
  const ref = db.collection('runs').doc();

  await ref.set({
    uid: args.uid,
    goal: args.goal,
    aspect: args.aspect,
    seconds: args.seconds,
    status: 'planning',
    plan: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  // The root of the tree is the avatar itself: the run starts from a face, not
  // from an empty frame.
  await ref.collection('nodes').doc('root').set({
    parentId: null,
    stepNo: 0,
    kind: 'avatar',
    status: 'achieved',
    frameUrl: args.avatarDataUrl,
    createdAt: Date.now(),
  });

  return ref.id;
}

/**
 * Runs the whole plan. Intended to be started and not awaited by the request
 * that triggers it — it takes 1-3 minutes and the client is watching Firestore,
 * not the response.
 */
export async function executeRun(runId: string, args: StartArgs): Promise<void> {
  const db = adminDb();
  const run = db.collection('runs').doc(runId);
  const nodes = run.collection('nodes');
  const avatar = decodeDataUrl(args.avatarDataUrl);

  const touch = (patch: Record<string, unknown>) => run.update({ ...patch, updatedAt: Date.now() });

  try {
    // ── plan ────────────────────────────────────────────────────────────────
    const steps = await planRun(args.goal, args.aspect, args.seconds);
    await touch({
      status: 'running',
      plan: steps.map((s) => ({ ...s, status: 'pending' })),
    });

    let parentId = 'root';
    // Typed loosely on purpose: Buffer's generic differs between what
    // Buffer.from produces here and what the image call returns, and the only
    // thing either end cares about is the bytes.
    let parentImage: { data: Uint8Array; mimeType: string } = avatar;

    for (const step of steps) {
      const markStep = async (status: string) => {
        const snap = await run.get();
        const plan = (snap.data()?.plan ?? []) as Record<string, unknown>[];
        plan[step.stepNo - 1] = { ...plan[step.stepNo - 1], status };
        await touch({ plan });
      };
      await markStep('running');

      let attempt = 0;
      let landed = false;
      // Fed back into the retry prompt, so the second attempt is informed by
      // what the critic actually objected to rather than guessing again.
      let lastCritique: { verdict: string; notes: string; retryHint: string } | null = null;

      while (attempt <= MAX_RETRIES_PER_STEP && !landed) {
        const nodeRef = nodes.doc();

        // Written before the image exists so the tree shows the agent arriving
        // at this node — the pulsing ring is real state, not an animation the
        // client invents.
        await nodeRef.set({
          parentId,
          stepNo: step.stepNo,
          kind: 'frame',
          status: 'generating',
          instruction: step.instruction,
          rationale: step.rationale,
          createdAt: Date.now(),
        });

        try {
          const retryNote =
            attempt > 0 && lastCritique
              ? `\n\nA previous attempt at this step was judged ${lastCritique.verdict}. Fix specifically this: ${lastCritique.retryHint || lastCritique.notes}\nChange nothing else.`
              : '';

          // The first step builds the opening frame from the avatar. Every step
          // after that EDITS the previous frame — passing it as the first
          // reference is what a real run proved necessary: with only the avatar
          // as input, each step repainted the whole scene, the critic objected
          // that nothing was refined in place, and the retry repeated the same
          // mistake because it had the same inputs.
          const isFirst = parentId === 'root';
          const refs = isFirst ? [avatar] : [parentImage, avatar];
          const prompt = isFirst
            ? `Build the opening frame of a UGC ad, ${args.aspect}. The person is the one in the reference photo — keep the face identical.\n` +
              `${step.instruction}\n\n` +
              `Realistic photograph, authentic phone-shot creator content. No text, no logos, no watermarks.${retryNote}`
            : `The FIRST image is the current frame. Apply exactly one change to it:\n` +
              `${step.instruction}\n\n` +
              `Keep everything else in the frame — the scene, clothing, camera position and props — unchanged. ` +
              `The SECOND image is the identity reference: the face must stay identical to it. ` +
              `Realistic photograph. No text, no logos, no watermarks.${retryNote}`;

          const frame = await generateFrame({ prompt, aspect: args.aspect, refs });
          const url = toDataUrl(frame.bytes, frame.mimeType);

          const verdict = await critique({
            instruction: step.instruction,
            rationale: step.rationale,
            before: parentImage,
            after: { data: frame.bytes, mimeType: frame.mimeType },
          });

          // Two real runs settled how this gate works. Keyed on `failed` alone,
          // no retry ever fired: the critic returned partial five times out of
          // six and failed zero, so the product's whole claim — that it corrects
          // itself — happened only in a demo. Keyed on `partial` as well, every
          // step ran twice and the run went from 171s to 384s.
          //
          // So the critic decides. It is the only party that has looked at both
          // frames, and it is told that a `true` costs the user twenty seconds,
          // so it should only say so when it can name what to do differently.
          const unsatisfactory = verdict.verdict === 'failed' || (verdict.verdict === 'partial' && verdict.worthRetry);
          const canRetry = unsatisfactory && verdict.worthRetry && attempt < MAX_RETRIES_PER_STEP;

          await nodeRef.update({
            frameUrl: url,
            verdict: verdict.verdict,
            criticNotes: verdict.notes,
            criticRubric: verdict.rubric,
            // A rejected attempt stays on the canvas. Hiding it would make the
            // tree tidier and delete the evidence that the agent self-corrected.
            status: verdict.verdict === 'failed' ? 'failed' : verdict.verdict === 'partial' ? 'partial' : 'achieved',
            discarded: canRetry,
          });

          lastCritique = { verdict: verdict.verdict, notes: verdict.notes, retryHint: verdict.retryHint };

          if (!unsatisfactory) {
            parentId = nodeRef.id;
            parentImage = { data: frame.bytes, mimeType: frame.mimeType };
            landed = true;
            await markStep(attempt > 0 ? 'retried' : 'done');
          } else if (!canRetry) {
            // Out of retries: keep the node as the line's end rather than
            // pretending the step succeeded.
            parentId = nodeRef.id;
            parentImage = { data: frame.bytes, mimeType: frame.mimeType };
            landed = true;
            await markStep('retried');
          }
        } catch (err) {
          await nodeRef.update({
            status: 'failed',
            criticNotes: `Generation failed: ${err instanceof Error ? err.message : 'unknown'}`,
            discarded: attempt < MAX_RETRIES_PER_STEP,
          });
          if (attempt >= MAX_RETRIES_PER_STEP) throw err;
        }

        attempt += 1;
      }
    }

    await touch({ status: 'awaiting-approval' });
  } catch (err) {
    console.error('[orchestrator]', runId, err);
    // The run is marked failed rather than left "running" forever, so the UI can
    // say what happened instead of spinning.
    await touch({ status: 'failed' }).catch(() => {});
  }
}
