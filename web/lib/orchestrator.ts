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

import { randomUUID } from 'node:crypto';
import { adminDb, adminStorage } from './firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { critique, generateFrame, planRun, verifyIdentity, writeScript } from './gemini';
import type { Aspect, PlanStep } from './types';

/** One retry. A second failure keeps both attempts visible and moves on, because
 *  a loop that retries forever is a bill, not a feature. */
const MAX_RETRIES_PER_STEP = 1;

import { synthesizeSpeech } from './tts';

export interface StartArgs {
  uid: string;
  goal: string;
  aspect: Aspect;
  seconds: 4 | 6 | 8;
  templateId?: string;
  avatarId?: string | null;
  /** Enrolment capture as a data URL or HTTP URL. */
  avatarDataUrl: string;
  avatarMultiViews?: {
    front?: string;
    left?: string;
    right?: string;
  };
}

export async function uploadToStorage(
  input: string | Buffer | Uint8Array,
  path: string,
  contentType = 'image/jpeg'
): Promise<string> {
  const bucketName = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'restage-studio.firebasestorage.app';
  const bucket = adminStorage().bucket(bucketName);

  let dataBuffer: Buffer;
  if (typeof input === 'string') {
    /*
     * Pass through only URLs that already live in this bucket and carry a
     * download token — those are permanent.
     *
     * Any http(s) input used to be returned unchanged, and /studio now sends
     * the enrolled avatar as a ONE-HOUR signed URL. That URL was then stored as
     * the run's avatarUrl, its root node's frameUrl and previewFrames[0]: an
     * hour later the SOURCE AVATAR was a broken image and Regenerate — the
     * product's core revise action — failed permanently with "failed to fetch
     * image from url (403)".
     *
     * Anything else is fetched once and re-saved here, so what the run holds is
     * a copy it owns.
     */
    if (input.startsWith('http://') || input.startsWith('https://')) {
      if (input.includes('firebasestorage.googleapis.com') && input.includes('token=')) return input;
      const res = await fetch(input);
      if (!res.ok) throw new Error(`could not read the source image (${res.status})`);
      const buf = Buffer.from(await res.arrayBuffer());
      contentType = res.headers.get('content-type') ?? contentType;
      return uploadToStorage(buf, path, contentType);
    }
    const match = input.match(/^data:([^;]+);base64,(.+)$/);
    dataBuffer = match ? Buffer.from(match[2], 'base64') : Buffer.from(input, 'base64');
    if (match) contentType = match[1];
  } else {
    dataBuffer = Buffer.from(input);
  }

  /*
   * A download token, not a public bucket.
   *
   * This returned a bare `?alt=media` URL, which only resolved because the
   * storage rules allowed the world to read every object — the same rule that
   * exposed enrolled face photos. With the bucket locked down those URLs 403,
   * so the frames need their own credential.
   *
   * `firebaseStorageDownloadTokens` is the mechanism Firebase's own
   * getDownloadURL() uses: the object carries an unguessable token and the URL
   * that includes it reads regardless of rules. The capability lives in the
   * run's node document, which only its owner can read, so possession of the
   * URL is the permission — and no other user can obtain one.
   *
   * A token can be revoked later by clearing the metadata, which a public
   * bucket never offered.
   */
  const downloadToken = randomUUID();
  const file = bucket.file(path);
  await file.save(dataBuffer, {
    contentType,
    metadata: {
      cacheControl: 'private, max-age=31536000',
      metadata: { firebaseStorageDownloadTokens: downloadToken },
    },
  });
  return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(
    path,
  )}?alt=media&token=${downloadToken}`;
}

async function resolveImageInput(u: string): Promise<{ mimeType: string; data: Buffer }> {
  if (u.startsWith('data:')) {
    const m = u.match(/^data:([^;]+);base64,(.+)$/);
    if (!m) throw new Error('unreadable data url');
    return { mimeType: m[1], data: Buffer.from(m[2], 'base64') };
  }
  if (u.startsWith('http://') || u.startsWith('https://')) {
    const res = await fetch(u);
    if (!res.ok) throw new Error(`failed to fetch image from url (${res.status})`);
    const arrayBuf = await res.arrayBuffer();
    const contentType = res.headers.get('content-type') || 'image/jpeg';
    return { mimeType: contentType, data: Buffer.from(arrayBuf) };
  }
  throw new Error('image must be a valid data URL or HTTP URL');
}

/*
 * Prepare a value for Firestore.
 *
 * Two jobs, and the previous one-liner — JSON.parse(JSON.stringify(...)) — got
 * the second one catastrophically wrong.
 *
 *   1. undefined becomes null, because Firestore rejects undefined.
 *
 *   2. FieldValue sentinels must survive. A JSON round-trip turns
 *      FieldValue.increment(1) into the plain object {operand: 1} and
 *      FieldValue.arrayUnion(x) into {elements: [x]} — and Firestore stores
 *      those literally. Verified in the live database: a run's frameCount was
 *      the map {"operand":1} rather than a number, and previewFrames was
 *      {"elements":[…]} rather than an array, which is why it never
 *      accumulated across steps. Every step overwrote it with a one-element
 *      object.
 *
 * Sentinels are class instances, so the test is simply "not a plain object".
 *
 * The size guard stays: Firestore rejects any document over 1MB, and rejects it
 * on WRITE, so a document that grows too large cannot even be updated to mark
 * its run failed — it stops responding entirely. A real run in this database
 * reached 1,333,473 bytes because a base64 image was stored inline. Images
 * belong in Storage with a URL here.
 */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

export function sanitizeForFirestore<T>(value: T): T {
  const walk = (v: unknown): unknown => {
    if (v === undefined) return null;
    // Strings that are inline images: keep them out of the document entirely.
    if (typeof v === 'string') return v.startsWith('data:') && v.length > 4096 ? null : v;
    if (Array.isArray(v)) return v.map(walk);
    if (isPlainObject(v)) {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v)) out[k] = walk(val);
      return out;
    }
    // FieldValue sentinels, Timestamps, Buffers — pass through untouched.
    return v;
  };
  return walk(value) as T;
}

/**
 * Write a terminal status only if the run is still in a state the orchestrator
 * owns. A transaction, because the render route writes the same field from
 * another request at the same time.
 */
async function claimTerminalStatus(
  run: FirebaseFirestore.DocumentReference,
  status: 'awaiting-approval' | 'failed',
  failureReason?: string,
): Promise<void> {
  const db = adminDb();
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(run);
    const current = snap.data()?.status;
    if (current !== 'planning' && current !== 'running') return;
    tx.update(
      run,
      sanitizeForFirestore({ status, updatedAt: Date.now(), ...(failureReason ? { failureReason } : {}) }),
    );
  });
}

export async function createRun(args: StartArgs): Promise<string> {
  const db = adminDb();
  const ref = db.collection('runs').doc();

  // Upload avatar to Storage so the Firestore document is kept feather-light (< 1 KB)
  const avatarStorageUrl = await uploadToStorage(
    args.avatarDataUrl,
    `users/${args.uid}/runs/${ref.id}/avatar_root.jpg`
  );

  let multiViewsUrls: { front?: string; left?: string; right?: string } | null = null;
  if (args.avatarMultiViews) {
    const [f, l, r] = await Promise.all([
      args.avatarMultiViews.front
        ? uploadToStorage(args.avatarMultiViews.front, `users/${args.uid}/runs/${ref.id}/views/front.jpg`)
        : undefined,
      args.avatarMultiViews.left
        ? uploadToStorage(args.avatarMultiViews.left, `users/${args.uid}/runs/${ref.id}/views/left.jpg`)
        : undefined,
      args.avatarMultiViews.right
        ? uploadToStorage(args.avatarMultiViews.right, `users/${args.uid}/runs/${ref.id}/views/right.jpg`)
        : undefined,
    ]);
    multiViewsUrls = { front: f, left: l, right: r };
  }

  const runData = sanitizeForFirestore({
    uid: args.uid,
    goal: args.goal,
    aspect: args.aspect,
    seconds: args.seconds,
    templateId: args.templateId ?? null,
    avatarId: args.avatarId ?? null,
    status: 'planning',
    plan: [],
    avatarUrl: avatarStorageUrl,
    avatarMultiViews: multiViewsUrls,
    previewFrames: [
      {
        stepNo: 0,
        label: 'Avatar',
        frameUrl: avatarStorageUrl,
      },
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  await ref.set(runData);

  // The root of the tree is the avatar itself
  const rootNodeData = sanitizeForFirestore({
    parentId: null,
    stepNo: 0,
    kind: 'avatar',
    status: 'achieved',
    frameUrl: avatarStorageUrl,
    multiViews: multiViewsUrls,
    createdAt: Date.now(),
  });

  await ref.collection('nodes').doc('root').set(rootNodeData);

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

  const touch = (patch: Record<string, unknown>) =>
    run.update(sanitizeForFirestore({ ...patch, updatedAt: Date.now() }));

  try {
    const avatar = await resolveImageInput(args.avatarDataUrl);
    const extraViews = (
      await Promise.all([
        args.avatarMultiViews?.left ? resolveImageInput(args.avatarMultiViews.left) : null,
        args.avatarMultiViews?.right ? resolveImageInput(args.avatarMultiViews.right) : null,
      ])
    ).filter(Boolean) as { mimeType: string; data: Buffer }[];

    // ── 1. Synthesize Spoken Voiceover Audio (Google Cloud TTS Chirp 3-HD) ──
    try {
      // Was a fixed sentence with the goal dropped into the middle, identical
      // in every ad the product has ever produced. The model writes the line
      // now, and the workspace shows it before anything is rendered.
      const voiceoverText = await writeScript(args.goal, args.seconds);
      const audioBuffer = await synthesizeSpeech({
        text: voiceoverText,
        voiceName: 'en-US-Chirp3-HD-Aoede',
        languageCode: 'en-US',
        speakingRate: 1.05,
        audioEncoding: 'LINEAR16',
        sampleRateHertz: 24000,
      });
      const audioStorageUrl = await uploadToStorage(
        audioBuffer,
        `users/${args.uid}/runs/${runId}/voiceover.wav`,
        'audio/wav'
      );
      await touch({
        audioUrl: audioStorageUrl,
        audioScript: voiceoverText,
      });
    } catch (ttsErr) {
      console.warn('Background TTS synthesis notice:', ttsErr);
    }

    // ── 2. Plan Storyboard & Edits ──────────────────────────────────────────
    const steps = await planRun(args.goal, args.aspect, args.seconds, args.templateId);
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
      // Typed rather than `string`: an unhandled status would otherwise render
      // as a blank glyph with nothing to say it went wrong.
      const markStep = async (status: PlanStep['status']) => {
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
          label: step.label ?? null,
          instruction: step.instruction,
          rationale: step.rationale,
          createdAt: Date.now(),
        });

        let nodeSettled = false;
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
          const refs = isFirst
            ? [avatar, ...extraViews]
            : [parentImage, avatar, ...extraViews];
          const prompt = isFirst
            ? `Build the opening frame of a high-converting cinematic UGC ad, ${args.aspect}. ` +
              `IDENTITY ANCHOR: The person is 100% IDENTICAL to the reference photos (which include front and multi-angle profile captures) — exact face geometry, jawline, eye shape, nose bridge, glasses, hairstyle, and skin tone. Do NOT alter, slim, or beautify the face.\n` +
              `${step.instruction}\n\n` +
              `Cinematic 4K photograph, natural 35mm shallow depth of field, authentic eye-level smartphone creator composition, realistic skin pores, subsurface scattering, ambient lighting interaction. No text, no logos, no watermarks.${retryNote}`
            : `The FIRST image is the current frame. Apply exactly one change to it:\n` +
              `${step.instruction}\n\n` +
              `Keep everything else in the frame — the scene, clothing, camera position and props — unchanged. ` +
              `IDENTITY ANCHOR: The OTHER images are the identity references (including front and multi-angle profile captures). The person's facial structure, bone geometry, glasses, and authentic expression MUST remain 100% stable and identical to the identity reference. Do not idealize, slim, or beautify the face. ` +
              `Cinematic 4K photograph, natural 35mm shallow depth of field, authentic eye-level smartphone creator composition, realistic skin pores, specular lighting reflections. No text, no logos, no watermarks.${retryNote}`;

          const frame = await generateFrame({ prompt, aspect: args.aspect, refs });
          const url = await uploadToStorage(
            frame.bytes,
            `users/${args.uid}/runs/${runId}/nodes/${nodeRef.id}.jpg`,
            frame.mimeType
          );

          /*
             The run-level summary the library reads, updated for EVERY frame
             rather than only accepted ones. Keying it on acceptance was a bug
             found by checking the data after optimising: a run whose steps were
             all judged "partial" had produced three real images and the library
             reported it as having none. What the run made is what it made.
          */
          // Counting every frame produced is deliberate — an all-partial run
          // reporting zero frames was a real bug. The THUMBNAIL is different:
          // it represents the run, so a wrong-face or discarded attempt must
          // not become the library's picture of it. It is set where a frame is
          // adopted, below.
          await touch({ frameCount: FieldValue.increment(1) });

          /*
           * Attach the image to its node before the judges run.
           *
           * frameUrl was written only after critique and identity had both
           * returned, so a failure in either — a quota error, a timeout —
           * threw past it and the node kept no image at all. A generated frame
           * that already exists in Storage was thrown away because the opinion
           * about it could not be obtained. A judging failure should downgrade
           * a node's verdict, never erase its output.
           */
          await nodeRef.update({ frameUrl: url });

          // Critique and identity run in parallel — the identity check is a
          // separate call because the combined one was measured to wave through
          // a visibly different person from a real run.
          const [verdict, identity] = await Promise.all([
            critique({
              instruction: step.instruction,
              rationale: step.rationale,
              avatar,
              before: parentImage,
              after: { data: frame.bytes, mimeType: frame.mimeType },
            }),
            verifyIdentity(avatar, { data: frame.bytes, mimeType: frame.mimeType }, extraViews),
          ]);

          // Two real runs settled how this gate works. Keyed on `failed` alone,
          // no retry ever fired: the critic returned partial five times out of
          // six and failed zero, so the product's whole claim — that it corrects
          // itself — happened only in a demo. Keyed on `partial` as well, every
          // step ran twice and the run went from 171s to 384s.
          //
          // So the critic decides. It is the only party that has looked at both
          // frames, and it is told that a `true` costs the user twenty seconds,
          // so it should only say so when it can name what to do differently.
          // Identity overrides everything. The user's run proved why: the face
          // drifted person-by-person across six steps and the critic never
          // objected, because nothing asked it to. A frame with the wrong face
          // is failed regardless of how well the edit landed, always worth one
          // retry, and never allowed to become the base image for later steps —
          // advancing on a wrong face is exactly how drift compounds.
          // HONEST CEILING, measured against the user's own drifted run: both
          // the flash and pro verifiers passed a frame whose face the user
          // immediately rejected. This gate catches gross swaps (a different
          // person outright — verified), not subtle drift. Subtle drift needs
          // face-embedding comparison (ArcFace-class), which is the Python
          // worker's first job. Until then the human Reject is the last line.
          const wrongFace = !identity.samePerson || !verdict.faceMatches;
          const unsatisfactory =
            wrongFace || verdict.verdict === 'failed' || (verdict.verdict === 'partial' && verdict.worthRetry);
          /*
           * A `failed` verdict earns a retry on its own.
           *
           * Gating on worthRetry alone meant a critic saying "failed,
           * worthRetry: false" spent no attempt — and the give-up branch then
           * ADOPTED that frame as the base for every later step, while the plan
           * panel reported the step as "retried". The worst frame in the run
           * became its lineage, and the UI said the opposite. Still bounded at
           * one extra attempt, so the cost is capped.
           */
          const canRetry =
            unsatisfactory &&
            (wrongFace || verdict.worthRetry || verdict.verdict === 'failed') &&
            attempt < MAX_RETRIES_PER_STEP;

          await nodeRef.update({
            frameUrl: url,
            verdict: verdict.verdict,
            criticNotes: verdict.notes,
            criticRubric: verdict.rubric,
            // A rejected attempt stays on the canvas. Hiding it would make the
            // tree tidier and delete the evidence that the agent self-corrected.
            status: wrongFace || verdict.verdict === 'failed' ? 'failed' : verdict.verdict === 'partial' ? 'partial' : 'achieved',
            discarded: canRetry,
          });
          // From here the node has a verdict; a later throw must not rewrite it.
          nodeSettled = true;

          lastCritique = {
            verdict: wrongFace ? 'failed' : verdict.verdict,
            notes: verdict.notes,
            retryHint: wrongFace
              ? `The face no longer matches the enrolled person. Differences seen: ${identity.differences || 'face geometry changed'}. Restore the exact face from the identity reference. ${verdict.retryHint}`.trim()
              : verdict.retryHint,
          };

          if (!unsatisfactory) {
            parentId = nodeRef.id;
            parentImage = { data: frame.bytes, mimeType: frame.mimeType };
            landed = true;
            await markStep(attempt > 0 ? 'retried' : 'done');
            /*
             * Keep a summary on the run document itself.
             *
             * The library used to reconstruct this by reading every node of
             * every run — and a node holds a full frame — so listing a handful
             * of runs pulled megabytes and measured 4.7 to 13 SECONDS. The
             * numbers it wanted were already derivable at write time.
             *
             * thumbUrl is the newest accepted frame, which is also the one that
             * best represents where the run got to.
             */
            await touch({
              previewFrames: FieldValue.arrayUnion({
                stepNo: step.stepNo,
                label: step.label || `Step ${step.stepNo}`,
                frameUrl: url,
              }),
              thumbUrl: url,
            });
          } else if (!canRetry) {
            // Out of retries. An imperfect frame with the RIGHT face still
            // advances — it is a usable base. A frame with the WRONG face does
            // not: the node stays on the tree as a visible dead end, and the
            // next step continues from the last good parent.
            // An imperfect frame with the right face is a usable base. A frame
            // the critic called FAILED is not — advancing on it is how a run
            // degrades step by step.
            const usable = !wrongFace && verdict.verdict !== 'failed';
            if (usable) {
              parentId = nodeRef.id;
              parentImage = { data: frame.bytes, mimeType: frame.mimeType };
              await touch({ thumbUrl: url });
            }
            landed = true;
            // Say which happened. Reporting a step as "retried" when it was
            // abandoned is the plan panel describing a run that did not occur.
            await markStep(usable ? 'retried' : 'abandoned');
          }
        } catch (err) {
          /*
           * Only claim the node if it has not already settled. The accept path
           * writes a verdict and then does bookkeeping; a throw from that
           * bookkeeping used to land here and rewrite a node the critic had
           * just APPROVED into a failed, discarded one — and swallow the error
           * silently, so nothing said why.
           */
          console.error('[orchestrator]', runId, `step ${step.stepNo}`, err);
          if (!nodeSettled) {
            await nodeRef.update({
              status: 'failed',
              criticNotes: `Generation failed: ${err instanceof Error ? err.message : 'unknown'}`,
              discarded: attempt < MAX_RETRIES_PER_STEP,
            });
          }
          if (attempt >= MAX_RETRIES_PER_STEP) throw err;
        }

        attempt += 1;
      }
    }

    /*
     * Only claim the terminal status if the orchestrator still owns it.
     *
     * Rendering an early frame mid-run is supported, which sets the run to
     * 'rendering'. An unconditional write here stamped 'awaiting-approval' over
     * it: the Render button re-armed while Veo was still working, a second
     * click bought a second clip, and two video nodes raced to write videoUrl.
     * In the other order the clip finished first and this write flipped a
     * complete run back to un-approved.
     */
    await claimTerminalStatus(run, 'awaiting-approval');
  } catch (err) {
    console.error('[orchestrator]', runId, err);
    // The run is marked failed rather than left "running" forever, so the UI can
    // say what happened instead of spinning.
    // The comment above says the UI can say what happened — it could not,
    // because nothing recorded what happened. An empty plan panel that never
    // fills is indistinguishable from a slow one.
    // Same guard: a run whose clip already rendered must not be stamped failed
    // by a later orchestrator error — the library would show "Failed" beside a
    // finished, playable video.
    await claimTerminalStatus(run, 'failed', err instanceof Error ? err.message : 'the run stopped unexpectedly').catch(
      () => {},
    );
  }
}

/**
 * Regenerate one node as a NEW SIBLING — same parent, adjusted instruction.
 * Deliberately not an overwrite: the tree records what happened, and rewriting
 * a node would falsify that record. The old attempt stays visible; the new one
 * appears beside it and goes through the same critic and identity gate as any
 * other frame.
 */
export async function regenerateNode(args: {
  runId: string;
  uid: string;
  sourceNodeId: string;
  instruction: string;
}): Promise<string> {
  const db = adminDb();
  const runRef = db.collection('runs').doc(args.runId);
  const runSnap = await runRef.get();
  if (!runSnap.exists || runSnap.data()!.uid !== args.uid) throw new Error('no such run');
  const run = runSnap.data()!;

  const sourceSnap = await runRef.collection('nodes').doc(args.sourceNodeId).get();
  const source = sourceSnap.data();
  if (!sourceSnap.exists || source?.kind !== 'frame') throw new Error('that node cannot be regenerated');

  const parentId: string = source.parentId ?? 'root';
  const parentSnap = await runRef.collection('nodes').doc(parentId).get();
  const parentUrl: string | undefined = parentSnap.data()?.frameUrl;
  if (!parentUrl) throw new Error('the base frame is missing');

  const rootSnap = await runRef.collection('nodes').doc('root').get();
  const avatarUrl: string | undefined = rootSnap.data()?.frameUrl;
  if (!avatarUrl) throw new Error('the avatar is missing');

  const parentImage = await resolveImageInput(parentUrl);
  const avatarImage = await resolveImageInput(avatarUrl);

  const multiViews = rootSnap.data()?.multiViews || run.avatarMultiViews;
  const extraViews = (
    await Promise.all([
      multiViews?.left ? resolveImageInput(multiViews.left) : null,
      multiViews?.right ? resolveImageInput(multiViews.right) : null,
    ])
  ).filter(Boolean) as { mimeType: string; data: Buffer }[];

  const nodeRef = runRef.collection('nodes').doc();
  await nodeRef.set({
    parentId,
    stepNo: source.stepNo,
    kind: 'frame',
    status: 'generating',
    label: source.label ? `${source.label} · redo` : 'redo',
    instruction: args.instruction,
    rationale: 'Regenerated on request, from the same base frame.',
    createdAt: Date.now(),
  });

  void (async () => {
    try {
      const isFromAvatar = parentId === 'root';
      const prompt = isFromAvatar
        ? `Build the opening frame of a high-converting cinematic UGC ad, ${run.aspect}. The person is EXACTLY the one in the reference photos (including front and multi-angle captures) — identical face geometry, same glasses if worn, same hairstyle. Do not idealize or beautify.\n${args.instruction}\n\nCinematic 4K photograph, natural 35mm shallow depth of field, authentic eye-level smartphone creator composition, realistic skin pores, subsurface scattering. No text, no logos.`
        : `The FIRST image is the current frame. Apply exactly one change to it:\n${args.instruction}\n\nKeep everything else unchanged. The OTHER images are the identity references (including front and multi-angle profile captures): the person must remain EXACTLY that person. Do not idealize or beautify the face. Cinematic 4K photograph, natural 35mm shallow depth of field, authentic eye-level smartphone creator composition, realistic skin pores, specular lighting reflections. No text, no logos.`;

      const frame = await generateFrame({
        prompt,
        aspect: run.aspect,
        refs: isFromAvatar ? [avatarImage, ...extraViews] : [parentImage, avatarImage, ...extraViews],
      });

      const [verdict, identity] = await Promise.all([
        critique({
          instruction: args.instruction,
          rationale: 'User-directed regeneration.',
          avatar: avatarImage,
          before: parentImage,
          after: { data: frame.bytes, mimeType: frame.mimeType },
        }),
        verifyIdentity(avatarImage, { data: frame.bytes, mimeType: frame.mimeType }, extraViews),
      ]);

      const wrongFace = !identity.samePerson || !verdict.faceMatches;
      const url = await uploadToStorage(
        frame.bytes,
        `users/${args.uid}/runs/${args.runId}/nodes/${nodeRef.id}.jpg`,
        frame.mimeType
      );

      await nodeRef.update({
        frameUrl: url,
        verdict: wrongFace ? 'failed' : verdict.verdict,
        criticNotes: wrongFace ? `The face no longer matches the enrolled person. ${identity.differences}` : verdict.notes,
        criticRubric: verdict.rubric,
        status: wrongFace || verdict.verdict === 'failed' ? 'failed' : verdict.verdict === 'partial' ? 'partial' : 'achieved',
      });
    } catch (err) {
      await nodeRef.update({
        status: 'failed',
        criticNotes: `Regeneration failed: ${err instanceof Error ? err.message : 'unknown'}`,
      });
    }
  })();

  return nodeRef.id;
}
