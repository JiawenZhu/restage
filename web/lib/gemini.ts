/*
 * The direct path to Google. This file is what replaces lib/muapi.js in the
 * studio we borrowed from — one adapter instead of a paid aggregator, which
 * also removes the third-party hop that every user's face would otherwise take.
 *
 * SERVER ONLY. The key lives here and must never be bundled into a client
 * component. The guard below is deliberately loud: the failure it prevents is
 * silent otherwise, and shipping a key into page source is not recoverable by
 * rotating it later — it is already in someone's cache.
 */

if (typeof window !== 'undefined') {
  throw new Error(
    'lib/gemini is server-only. Importing it from a client component would ' +
      'bundle GEMINI_API_KEY into the page. Call it from app/api/* instead.',
  );
}

import { getTemplateById } from './templates';
import { VIDEO_NEGATIVE_PROMPT } from './look';
import type { LookBible, ShotKind } from './types';
import { fetchJson, HttpError, withRetry } from './backoff';

/* The shape generateContent answers with. fetchJson returns a plain record —
   deliberately, since it does not know what it fetched — so each reader says
   what it expects rather than every call site guessing with `any`. */
type GenJson = {
  candidates?: {
    content?: { parts?: { text?: string; inlineData?: { data: string; mimeType?: string } }[] };
    finishReason?: string;
  }[];
  name?: string;
};

/** The one JSON string a structured call is asked for. */
function firstText(json: Record<string, unknown>): string | undefined {
  return (json as GenJson).candidates?.[0]?.content?.parts?.[0]?.text;
}

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

// Frames run on the cheap fast model on purpose: the plan expects to throw some
// away, and a critic that cannot afford to reject anything is not a critic.
const IMAGE_MODEL = process.env.RESTAGE_IMAGE_MODEL ?? 'gemini-3-pro-image';
const VIDEO_MODEL = process.env.RESTAGE_VIDEO_MODEL ?? 'veo-3.1-fast-generate-preview';

export type Aspect = '9:16' | '16:9';

/*
 * The fast Veo model's own words when asked for more: "The number value for
 * `durationSeconds` is out of bound. Please provide a value between 4 and 8,
 * inclusive." The UI used to offer 8 / 15 / 30 and the value reached nothing —
 * every choice produced the same clip. Longer output needs several renders
 * stitched together, which is the editing worker's job, not this call's.
 */
export const MIN_CLIP_SECONDS = 4;
export const MAX_CLIP_SECONDS = 8;

function key(): string {
  const k = process.env.GEMINI_API_KEY;
  if (!k) throw new Error('GEMINI_API_KEY is not set');
  return k;
}

/**
 * Never let a thrown error carry the request URL: the key is a query parameter,
 * so a stack trace in a log aggregator would leak it.
 */
function scrub(message: string): string {
  return message.replace(/key=[\w-]+/g, 'key=***');
}

export interface FrameRequest {
  prompt: string;
  /** Enrolment captures. Passing them is what holds one face across every scene. */
  refs?: { data: Buffer | Uint8Array; mimeType: string }[];
  aspect: Aspect;
  /**
   * When the interactive quota is exhausted, fall through to the Batch API
   * rather than failing.
   *
   * THIS IS THE SCALING VALVE, and it is the only honest use of batch on a path
   * somebody is watching. Interactive RPM and TPM are shared across every user
   * at once; batch has its own pool of 100 concurrent jobs. So when the shared
   * pool is full, the choice is not "fast or slow" — it is a slower frame or no
   * frame at all.
   *
   * It costs about 103 seconds against roughly 20 interactive, measured, so it
   * is never the first choice and never silent: `onOverflow` fires so the run
   * can say on the canvas that it is queued and why.
   */
  overflowToBatch?: boolean;
  onOverflow?: (estimateMs: number) => void;
}

export async function generateFrame(req: FrameRequest): Promise<{ bytes: Buffer; mimeType: string }> {
  const parts: unknown[] = [
    ...(req.refs ?? []).map((r) => ({
      inlineData: { mimeType: r.mimeType, data: Buffer.from(r.data).toString('base64') },
    })),
    { text: req.prompt },
  ];

  /* Retried on a rate limit rather than thrown straight through. Interactive
     RPM and TPM are shared across every user at once, so under any concurrency
     at all the second person to press Start is the one who gets the 429 — and
     before this, that 429 abandoned their step. */
  let json: Record<string, unknown>;
  try {
    json = await withRetry(
      () =>
        fetchJson(
          `${BASE}/models/${IMAGE_MODEL}:generateContent?key=${key()}`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts }],
              generationConfig: {
                responseModalities: ['IMAGE'],
                imageConfig: { aspectRatio: req.aspect },
              },
            }),
          },
          scrub,
        ),
      { label: 'frame' },
    );
  } catch (err) {
    /*
     * Out of interactive quota, with a separate pool sitting unused.
     *
     * Retrying already waited as long as it was allowed to; a further wait is
     * just a longer version of the same failure. Batch is a different quota
     * entirely — 100 concurrent jobs, not shared with the interactive limit
     * that is currently full — so the frame can still be made. It takes about
     * five times as long, which is why this is a last resort and why the caller
     * is told rather than left wondering.
     */
    const http = err instanceof HttpError ? err : null;
    if (!req.overflowToBatch || !http || http.status !== 429) throw err;

    const { runBatch, BATCHABLE, batchEstimate } = await import('./batch');
    if (!BATCHABLE.has(IMAGE_MODEL)) throw err;

    req.onOverflow?.(batchEstimate(1).ms);
    console.warn(`[frame] interactive quota exhausted, overflowing one frame to batch`);

    const [result] = await runBatch(
      IMAGE_MODEL,
      [{ key: 'overflow', prompt: req.prompt, refs: req.refs, aspect: req.aspect, wantsImage: true }],
      'restage-overflow',
      { pollMs: 10_000, timeoutMs: 8 * 60_000 },
    );
    if (!result || result.error || !result.bytes) {
      throw new Error(result?.error ?? 'the queued frame came back empty');
    }
    return { bytes: result.bytes, mimeType: result.mimeType ?? 'image/png' };
  }

  const cand = (json as GenJson).candidates?.[0];
  const img = cand?.content?.parts?.find((p) => p.inlineData);
  if (!img?.inlineData) throw new Error(`no image returned: ${cand?.finishReason ?? 'empty response'}`);

  return {
    bytes: Buffer.from(img.inlineData.data, 'base64'),
    mimeType: img.inlineData.mimeType ?? 'image/png',
  };
}

export interface RenderRequest {
  prompt: string;
  /** The approved frame becomes frame one, which is why the tree runs on stills. */
  firstFrame?: { data: Buffer | Uint8Array; mimeType: string };
  aspect: Aspect;
  /** Clip length. The fast Veo model's ceiling is 8s; see MAX_CLIP_SECONDS. */
  durationSeconds?: number;
}

/**
 * Veo is a long-running operation: this only submits it. Measured at ~41s for a
 * fast-model clip, so nothing should await it inside a request handler — store
 * the operation name and poll from a job.
 */
function normalizeVeoDuration(sec?: number): number {
  if (!sec) return 8;
  const valid = [4, 6, 8];
  return valid.reduce((prev, curr) => (Math.abs(curr - sec) < Math.abs(prev - sec) ? curr : prev), 8);
}

/*
 * Ask for the higher resolution when the clip is long enough to be allowed it.
 *
 * `resolution` was never sent, so every clip this product has ever made came
 * back at the 720p default — while the prompt opened with the words "Cinematic
 * 4K UGC video clip". Prompt text does not change the output size; the
 * parameter does, and there wasn't one.
 *
 * The floor is real and worth respecting rather than discovering in production.
 * The API refuses 1080p at anything under the full eight seconds, and refuses
 * it during REQUEST VALIDATION, before quota is even consulted:
 *
 *   durationSeconds 4 → "1080p is not supported for a duration of 4 seconds."
 *   durationSeconds 6 → "1080p is not supported for a duration of 6 seconds."
 *   durationSeconds 8 → accepted
 *
 * Both of those were measured, and the second one matters: 6 looks like it
 * ought to work, and a threshold written from the 4-second error alone would
 * have turned every six-second shot into a hard 400. A sequence divides the
 * chosen length across its shots, so short shots are the normal case on a
 * multi-shot ad — this has to degrade, not fail.
 *
 * WHAT IS NOT VERIFIED: that 1080p is actually honoured. The account's video
 * quota ran out before a finished 1080p clip could be measured, so the evidence
 * stops at "the API accepts it". That distinction is worth keeping in view,
 * because the sibling engine in this file does exactly the dishonest version —
 * gemini-omni-flash-preview validates response_format.resolution against a list
 * and then returns 720x1280 whatever you ask for. If Veo turns out to behave the
 * same way, this costs nothing and changes nothing; it is still the correct
 * request to be making.
 */
function veoResolution(seconds: number): '720p' | '1080p' {
  return seconds >= MAX_CLIP_SECONDS ? '1080p' : '720p';
}

/*
 * Veo's requests-per-minute allowance, and a gate that respects it.
 *
 * MEASURED FROM THE CONSOLE, not guessed: on the tier this project is on, Veo 3
 * Fast is capped at 2 RPM and 10 RPD, and the usage graph showed a peak of 4
 * against that limit of 2. That is the whole "the video quota is used up" story
 * — not an exhausted key, and not something a new key would fix, because the
 * allowance belongs to the project and its billing tier rather than to the
 * credential.
 *
 * A sequence render submits one job per shot from a loop with nothing between
 * the submissions, and withRetry turns each refusal into up to four attempts.
 * Seven shots therefore arrive as a burst against a limit of two, every attempt
 * counts toward the peak, and the run dies part-way through having paid for the
 * shots that did land.
 *
 * So submissions are serialised behind a minimum interval. This is a per-process
 * gate, which is exactly the scope that matters: the burst comes from one loop
 * in one process. Across instances the server-side limit and withRetry's
 * jittered backoff remain the backstop.
 *
 * RESTAGE_VEO_RPM tracks the tier. Raise it after upgrading billing; the default
 * is the free-tier number so an unconfigured deployment is slow rather than
 * broken.
 */
const VEO_RPM = Math.max(1, Number(process.env.RESTAGE_VEO_RPM) || 2);
const VEO_MIN_GAP_MS = Math.ceil(60_000 / VEO_RPM);

let veoQueue: Promise<unknown> = Promise.resolve();
let lastVeoSubmitAt = 0;

/** Serialise `fn` behind the RPM gap. Rejections must not poison the chain. */
function paceVeoSubmit<T>(fn: () => Promise<T>): Promise<T> {
  const turn = veoQueue.then(async () => {
    const wait = lastVeoSubmitAt + VEO_MIN_GAP_MS - Date.now();
    if (wait > 0) {
      console.warn(`[veo] holding ${Math.round(wait / 1000)}s to stay under ${VEO_RPM} rpm`);
      await new Promise((r) => setTimeout(r, wait));
    }
    lastVeoSubmitAt = Date.now();
    return fn();
  });
  // The NEXT caller waits for this one to finish its gap, not for its render.
  veoQueue = turn.catch(() => {});
  return turn;
}

export async function submitRender(req: RenderRequest): Promise<{ operation: string }> {
  const instance: Record<string, unknown> = { prompt: req.prompt };
  if (req.firstFrame) {
    instance.image = {
      bytesBase64Encoded: Buffer.from(req.firstFrame.data).toString('base64'),
      mimeType: req.firstFrame.mimeType,
    };
  }

  const seconds = normalizeVeoDuration(req.durationSeconds);

  const json = await paceVeoSubmit(() =>
    withRetry(
    () => fetchJson(`${BASE}/models/${VIDEO_MODEL}:predictLongRunning?key=${key()}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      instances: [instance],
      parameters: {
        aspectRatio: req.aspect,
        durationSeconds: seconds,
        resolution: veoResolution(seconds),
        /* The artefact rules were being written as negations inside the positive
           prompt — "no warping", "NO facial shape deformation" — which is the
           one place a diffusion model reliably mishandles them. There is a
           dedicated channel for this and it was unused. */
        negativePrompt: VIDEO_NEGATIVE_PROMPT,
      },
    }),
  }, scrub),
      { label: 'veo:submit' },
    ),
  );
  const name = (json as GenJson).name;
  if (!name) throw new Error('render submitted but no operation name came back');

  return { operation: name };
}

export type RenderStatus =
  | { done: false }
  | { done: true; videoUri: string }
  | { done: true; error: string };

export async function pollRender(operation: string): Promise<RenderStatus> {
  /* Polling is cheap and frequent, so it retries briefly and gives up fast —
     the caller polls again in a few seconds regardless. */
  const op = (await withRetry(
    () => fetchJson(`${BASE}/${operation}?key=${key()}`, { method: 'GET' }, scrub),
    { label: 'veo:poll', attempts: 3, baseMs: 500, maxDelayMs: 4_000, budgetMs: 10_000 },
  )) as Record<string, any>;
  if (!op.done) return { done: false };
  if (op.error) return { done: true, error: scrub(op.error.message ?? 'render failed') };

  /*
   * Veo can finish successfully and return nothing.
   *
   * That is what a content filter looks like from here: `done: true`, no error
   * object, and an empty sample list — with the actual reason tucked into
   * raiMediaFilteredReasons. Reporting that as "render finished with no video
   * attached" told the user their render had failed for no stated reason, when
   * the truthful answer is that something in the frame or the prompt was
   * refused, which is a thing they can act on.
   */
  const videoResponse = op.response?.generateVideoResponse ?? op.response ?? {};
  const samples = videoResponse.generatedSamples ?? [];
  const uri = samples[0]?.video?.uri;

  if (!uri) {
    const filtered: string[] =
      videoResponse.raiMediaFilteredReasons ?? videoResponse.raiFilteredReasons ?? [];
    if (filtered.length) {
      return {
        done: true,
        error: `The video model declined this frame: ${scrub(filtered.join('; '))}`,
      };
    }
    if (videoResponse.raiMediaFilteredCount) {
      return {
        done: true,
        error:
          'The video model declined this frame without giving a reason. Rendering a different frame usually works.',
      };
    }
    return { done: true, error: 'The video model returned no clip and no reason.' };
  }

  return { done: true, videoUri: uri };
}

/**
 * Google's download URI needs the key appended. Fetch server-side and hand the
 * bytes onward to R2 — never give this URI to a browser, since doing so would
 * put the key in a URL the client can read.
 */
export async function downloadRendered(videoUri: string): Promise<Buffer> {
  const sep = videoUri.includes('?') ? '&' : '?';
  const res = await fetch(`${videoUri}${sep}key=${key()}`);
  if (!res.ok) throw new Error(`video download failed (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

/*
 * What this model will and will not do, measured against the live API rather
 * than read off a docs page. Both numbers are load-bearing: the UI quotes them,
 * and the render route has to tell the user when their choice is being ignored.
 *
 *   · Length is FIXED at ~10s. There is no duration control anywhere in the
 *     request — 'duration', 'duration_seconds', 'length_seconds', 'seconds' and
 *     'video_duration' were each rejected as unknown parameters, at the top
 *     level and inside response_format. So a run set to 8s or 24s gets 10s.
 *   · Size is FIXED at 720x1280. response_format.resolution IS validated —
 *     it names '360p','720p','1080p','4k' as legal — but the preview model
 *     ignores it: requesting 360p and requesting 1080p both returned 720x1280.
 *
 * That second one is the whole answer to "why does Omni look worse than Veo".
 * Veo runs to 1080p; this preview cannot, and no prompt wording changes it.
 */
export const OMNI_FIXED_SECONDS = 10;
export const OMNI_FIXED_SHORT_EDGE = 720;

export interface OmniVideoRequest {
  prompt: string;
  /** The storyboard frame this shot should start on. */
  firstFrame?: { data: Buffer | Uint8Array; mimeType: string };
  /**
   * Enrolment views — front, left, right.
   *
   * Identity holds markedly better with more than one angle, which is the whole
   * reason enrolment captures three. Verified side by side: one reference of a
   * face shot on a wide lens under a ceiling light reproduced those flaws;
   * front plus left, with the same photographic direction, produced a natural,
   * well-lit, clearly recognisable person.
   */
  references?: Array<{ data: Buffer | Uint8Array; mimeType: string }>;
  aspect: Aspect;
  /** Sent so the call is correct the day the preview starts honouring it. */
  resolution?: '360p' | '720p' | '1080p' | '4k';
}

export interface OmniVideoResult {
  bytes: Buffer;
  /** Whether the returned container actually carries an audio track. */
  hasAudio: boolean;
}

/**
 * Gemini Omni Flash via the Interactions API.
 *
 * This model is reachable ONLY through POST /interactions — `generateContent`
 * answers "This model only supports Interactions API." — so the unusual shape
 * of this request is required, not incidental.
 */
export async function generateOmniVideo(req: OmniVideoRequest): Promise<OmniVideoResult> {
  const inputs: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mime_type: string }> = [];

  const asImage = (i: { data: Buffer | Uint8Array; mimeType: string }) => ({
    type: 'image' as const,
    data: Buffer.from(i.data).toString('base64'),
    mime_type: i.mimeType,
  });

  // References first, then the frame to start on, then the direction. The
  // starting frame is last of the images so it reads as "begin here" rather
  // than as one more example of the face.
  for (const r of req.references ?? []) inputs.push(asImage(r));
  if (req.firstFrame) inputs.push(asImage(req.firstFrame));
  inputs.push({ type: 'text', text: req.prompt });

  /* A long call — measured at 20-40s — so a rate limit here costs the user the
     whole wait before it fails. Fewer attempts than a frame, and a longer
     budget, because each try is expensive. */
  const json = await withRetry(
    () =>
      fetchJson(
        `${BASE}/interactions?key=${key()}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model: 'gemini-omni-flash-preview',
            input: inputs.length === 1 && inputs[0].type === 'text' ? inputs[0].text : inputs,
            response_format: {
              type: 'video',
              aspect_ratio: req.aspect,
              resolution: req.resolution ?? '1080p',
            },
          }),
        },
        scrub,
      ),
    { label: 'omni', attempts: 3, budgetMs: 120_000 },
  );

  type OmniStep = { type: string; content?: { type: string; data?: string }[] };
  const modelOutput = (json as { steps?: OmniStep[] }).steps?.find((st) => st.type === 'model_output');
  const videoObj = modelOutput?.content?.find((c) => c.type === 'video');

  if (!videoObj?.data) {
    throw new Error('Omni finished but returned no video stream');
  }

  const bytes = Buffer.from(videoObj.data, 'base64');
  return { bytes, hasAudio: containsAudioTrack(bytes) };
}

/*
 * Does this MP4 carry sound?
 *
 * The render route used to assert `hasAudio = true` for every Omni clip on the
 * grounds that the model advertises native audio, and then the workspace told
 * the user their ad had a voiceover whether or not one existed. Reading the
 * container is cheap: an MP4 declares each track in an 'hdlr' box whose
 * handler_type is 'soun' for audio. No ffmpeg, no temp file.
 *
 * handler_type sits TWELVE bytes past the box name — four for version+flags,
 * four for the pre_defined field, then the four-character code. Written first
 * as +8, which lands on pre_defined: that reads as four zero bytes on every
 * file, so a clip with perfectly good AAC in it reported as silent. Checked
 * against real output both ways, +12 yields 'vide','soun','mdir'.
 */
function containsAudioTrack(mp4: Buffer): boolean {
  const hdlr = Buffer.from('hdlr');
  let at = mp4.indexOf(hdlr);
  while (at !== -1) {
    if (mp4.subarray(at + 12, at + 16).toString('latin1') === 'soun') return true;
    at = mp4.indexOf(hdlr, at + 1);
  }
  return false;
}

/* ── planning and criticism ───────────────────────────────────────────────── */

// Verified with a real call, not read off the models list: 2.5-flash is still
// listed and is closed to new projects, so the endpoint's inventory is not a
// statement about access.
const TEXT_MODEL = process.env.RESTAGE_TEXT_MODEL ?? 'gemini-3.7-flash';

/*
 * Three model roles, not one.
 *
 * This was a single constant serving every text job, which meant the one env
 * var that looked like a cheap tuning knob also moved the CRITIC and the
 * IDENTITY VERIFIER — the two calls that decide whether a frame showing
 * somebody's face is allowed to stand. Benchmarked head to head against
 * gemini-3.5-flash-lite on the real prompts and schemas:
 *
 *   JUDGING — flash-lite scored 6/10 on faceMatches, which is near chance, and
 *   wrong in BOTH directions: it rejected the user's own face 2/5 on an
 *   unambiguous same-person pair, and passed a genuinely different woman 2/5.
 *   3.7-flash was 10/10. Worse for this product specifically, flash-lite
 *   INVERTS the verdict distribution — 8/10 "failed" where 3.7 returns 9/10
 *   "partial" — and the retry gate in orchestrator.ts was calibrated on that
 *   distribution. A critic that fails everything makes the agent throw away and
 *   regenerate nearly every shot, which is more latency and more spend, not
 *   less.
 *
 *   SHORT TEXT — dead even on quality, and much faster: writeScript 637ms vs
 *   3476ms, refinePrompt 830ms vs 2120ms. writeScript blocks at the head of
 *   every run and refinePrompt is the one call a user actively waits on.
 *
 * COST IS NOT THE REASON, despite being the obvious one. Text is about 3% of a
 * run — roughly $0.06 against $1.90 of frames and video — so moving all of it
 * saves around four cents. The reason is the seconds of dead air before the
 * first frame appears.
 */
const JUDGE_MODEL = process.env.RESTAGE_JUDGE_MODEL ?? 'gemini-3.7-flash';
/*
 * Cheap, fast, and only ever on work a human immediately sees and can correct:
 * the spoken line, the rewrite shown beside the user's own words, and the
 * derived look bible that is explicitly "offered rather than applied".
 *
 * The PLANNER deliberately stays on TEXT_MODEL. Flash-lite matched it on bare
 * goals (6/6 valid plans, never over the person cap), but every one of those
 * tests used a bare goal — the TEMPLATE path injects authored shot kinds and
 * asks the model to preserve an authored person/product ratio, which is exactly
 * the instruction-following a lite model drops first, and flash-lite spends
 * zero thinking tokens by default. Grading the 16 templates is the gate on that
 * switch; until then the planner keeps the model it was tuned against.
 */
const FAST_TEXT_MODEL = process.env.RESTAGE_FAST_TEXT_MODEL ?? 'gemini-3.5-flash-lite';

/**
 * Both calls below use responseSchema rather than asking for JSON in the prompt.
 * A model told "reply with JSON" wraps it in prose often enough that the parse
 * becomes the flakiest part of the pipeline; a schema makes the shape the API's
 * problem instead of ours.
 */
async function structured<T>(
  prompt: string,
  schema: object,
  system?: string,
  model: string = TEXT_MODEL,
): Promise<T> {
    const json = await withRetry(
    () => fetchJson(`${BASE}/models/${model}:generateContent?key=${key()}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      generationConfig: { responseMimeType: 'application/json', responseSchema: schema },
    }),
  }, scrub),
    { label: 'text' },
  );

  const text = firstText(json);
  if (!text) throw new Error(`no content: ${(json as GenJson).candidates?.[0]?.finishReason ?? 'empty'}`);
  return JSON.parse(text) as T;
}

const PLANNER_SYSTEM = `You cut UGC video ads that feature one real person whose
face is already enrolled.

You are given an outcome, not a shot list, and you turn it into 5-7 ordered SHOTS.
These are separate photographs that will be cut together — not edits to one frame.

WHAT EACH SHOT IS OF. Every shot declares a kind, and this is the most important
decision you make:

  person  — the creator is in frame.
  product — the item is the subject. Hands may hold or steady it. No face, no head.
  detail  — macro. Texture, lettering, a mechanism, the thing turning. Nobody.
  scene   — the place. Establishing, atmosphere, b-roll. Nobody in frame.

AT MOST HALF THE SHOTS MAY BE 'person', and about a third is better. This is not a
stylistic preference. A real advertisement is mostly things that are not faces:
the product in a hand, the label, the steam, the room. A cut of six medium shots
of one person is a photo set, not an ad — and every extra shot of a face is
another chance for that face to stop being the user's.

A shot that is not 'person' must be writable WITHOUT the person. If the
instruction says "their hands" or "her face" or "the creator", it is a person shot
wearing a disguise. Plain "hands" or "a hand" on a product shot is good.

Order it like an edit, not a checklist: open on something that earns attention,
put a human beat where the ad needs warmth or credibility, put the detail where a
viewer would want a closer look, and land the payoff last.

For each shot write:
- shot: one of the four kinds above
- label: 2-4 words for a thumbnail caption ("Steam rising", "Label close", "First
  sip"). Somebody glancing at the canvas reads only this.
- instruction: what is IN the frame, imperative, one line. Describe the
  photograph, not an editing operation.
- rationale: why a viewer would care. Read by the user, and it is what shows you
  reasoned rather than pattern-matched. Never generic, never a restatement.

YOU ALSO WRITE THE LOOK, once, for the whole ad.

These shots are photographed independently, so nothing is inherited between them.
The look is the contract that makes them read as one afternoon in one place:
location, wardrobe, light, palette, and the product itself described concretely
enough that every shot of it agrees. Be specific — "a pale oak kitchen counter
with a window to the left" is usable; "a modern kitchen" is not.`;

export interface PlannedShot {
  stepNo: number;
  shot: ShotKind;
  label: string;
  instruction: string;
  rationale: string;
}

export interface PlannedRun {
  steps: PlannedShot[];
  look: LookBible;
}

export async function planRun(
  goal: string,
  aspect: Aspect,
  seconds: number,
  templateId?: string,
  /** What this user has rejected before. See the taste block below. */
  avoid?: string[],
): Promise<PlannedRun> {
  const tpl = templateId ? getTemplateById(templateId) : undefined;

  /*
   * A template's presetSteps are its actual choreography — hand-authored, in
   * order, each with a reason. They used to be passed to nobody: the planner got
   * three sentences of adjectives and re-invented a sequence every time, so two
   * templates with completely different step structures produced the same shape
   * of run with different lighting words. That made "template" mean "adjective
   * set", which is not what the gallery promises.
   *
   * They are given as the STARTING sequence, not a script: the user's goal still
   * governs, and the planner is told to adapt them to it. A template the model
   * may not deviate from would break every goal that does not happen to match
   * the template author's imagined product.
   */
  const templateContext = tpl
    ? `\nTEMPLATE: "${tpl.name}" (${tpl.category})\n` +
      `Look: ${tpl.lightingAndColor}\n` +
      `Camera: ${tpl.cameraMotion}\n` +
      `Detail to preserve: ${tpl.secondaryPhysics}\n\n` +
      `This template's authored choreography, in order. The tag in brackets is what each ` +
      `shot is OF, and that balance is deliberate — keep roughly the same mix:\n` +
      /* WITH THE SHOT KIND. Leaving it out made the whole shot-list rewrite
         decorative: the templates were re-cut so that only a third of their
         beats have a face in them, and then this handed the planner nothing but
         prose and let it re-infer the kinds — which, for a model that has spent
         its life writing person shots, means inferring 'person'. The authored
         ratio is the point, so the ratio has to be legible. */
      tpl.presetSteps
        .map((s, i) => `  ${i + 1}. [${s.shot}] ${s.label} — ${s.instruction} (why: ${s.rationale})`)
        .join('\n') +
      `\n\nStart from that sequence. Keep its order and its intent, and rewrite each ` +
      `step so it serves the user's stated goal and the specific product they are ` +
      `showing. Drop a step that cannot apply and add one the goal clearly needs, ` +
      `but do not replace the choreography with a generic plan — the user chose ` +
      `this template for its structure, not only its palette.`
    : '';

  /*
   * What the user turned down last time.
   *
   * Every rejection was recorded to users/{uid}/taste and read by nothing,
   * while the landing page promised "what you rejected changes how the next
   * session opens". Framed as things to avoid rather than rules, because a
   * rejection is evidence about taste, not a specification — and because a
   * hard constraint from an old run would quietly sabotage a new goal that
   * genuinely needs the same treatment.
   */
  const tasteContext =
    avoid && avoid.length
      ? `\n\nThis person has previously rejected frames produced by these instructions:\n` +
        avoid.slice(0, 8).map((a) => `  - ${a}`).join('\n') +
        `\nTreat that as evidence about their taste. Prefer different choices where the goal allows, ` +
        `and do not repeat an instruction from that list verbatim.`
      : '';

  const { steps, look } = await structured<PlannedRun>(
    `Goal: ${goal}\nOutput format: ${aspect}, ${seconds} seconds.${templateContext}${tasteContext}\n\nCut the ad.`,
    {
      type: 'object',
      properties: {
        look: {
          type: 'object',
          description: 'the one shoot every shot belongs to',
          properties: {
            location: { type: 'string', description: 'concrete and specific — a room, a surface, a window' },
            wardrobe: { type: 'string', description: 'what the person wears in every shot they appear in' },
            light: { type: 'string', description: 'source, direction and time of day' },
            palette: { type: 'string', description: 'the few colours this ad lives in' },
            product: { type: 'string', description: 'the item itself, described so every shot of it agrees' },
          },
          required: ['location', 'wardrobe', 'light', 'palette', 'product'],
        },
        steps: {
          type: 'array',
          minItems: 5,
          maxItems: 7,
          items: {
            type: 'object',
            properties: {
              stepNo: { type: 'integer' },
              shot: {
                type: 'string',
                enum: ['person', 'product', 'detail', 'scene'],
                description: 'at most half may be person; about a third is better',
              },
              label: { type: 'string', description: '2-4 words, thumbnail caption' },
              instruction: { type: 'string' },
              rationale: { type: 'string' },
            },
            required: ['stepNo', 'shot', 'label', 'instruction', 'rationale'],
          },
        },
      },
      required: ['look', 'steps'],
    },
    PLANNER_SYSTEM,
  );

  /*
   * Enforce the ratio here as well as asking for it.
   *
   * A schema can describe an enum but not "at most half of these". Asked without
   * a backstop, a planner that has spent its whole life writing person shots
   * will quietly return six of them, and the run is back to being a photo set.
   * Re-typing the surplus is crude but it is bounded and visible; the ones
   * converted are the LATER person shots, because the opening beat is the one
   * that most needs a face.
   */
  const ordered = steps.map((s, i) => ({ ...s, stepNo: i + 1 }));
  const cap = Math.max(1, Math.floor(ordered.length / 2));
  let seen = 0;
  for (const s of ordered) {
    if (s.shot !== 'person') continue;
    seen++;
    if (seen > cap) {
      s.shot = 'product';
      console.info(`[plan] step ${s.stepNo} retyped person → product (cap ${cap} of ${ordered.length})`);
    }
  }
  return { steps: ordered, look };
}

const CRITIC_SYSTEM = `You judge whether one edit to a frame achieved what it claimed.

You see the person's ENROLMENT PHOTO, the frame before, the frame after, and the
instruction.

FIRST, before anything else: is the person in AFTER the same person as the
enrolment photo? Compare face geometry, glasses, hairline, and clothing (unless
the instruction changed clothing). Faces drift step by step in generated images,
and a drifted face makes the whole product worthless — the user is buying THEIR
face in the ad. Set faceMatches accordingly, and be strict: "a similar-looking
person" is false.

THEN decide the verdict for the edit itself:
  met     — the change happened and the frame is better for it
  partial — the change happened but overshot or lost something
  failed  — the change did not happen, or made the frame worse

THEN, separately, judge CONTINUITY — but only when you are told this frame is a
continuation. Each step edits the frame before it, so the six frames of a run
are meant to read as one continuous take: the same person, in the same room, in
the same clothes, under the same light, from the same camera. The instruction
named ONE change. Anything else that moved is a defect, however good it looks.

List in continuityBreaks everything that differs between BEFORE and AFTER that
the instruction did not ask for — clothing, room, furniture, background, props,
time of day, key-light direction or colour, lens or framing or camera height.
Set continuityHeld false if that list has anything real in it.

This matters more than it looks. A drifted frame becomes the base that every
later step edits from, so a change nobody asked for stops being a defect and
becomes the ground truth the rest of the run is judged against.

Write notes in your own voice, first person, quoting what you actually see. Be
specific about the pixels: "the shadow under the jaw is gone" beats "lighting
improved". Say what is still wrong even when the verdict is met.

Default to a harsher verdict when uncertain. A critic that passes everything is
not a critic, and the retry it declines to ask for is the whole product.

Then decide worthRetry separately from the verdict. Ask yourself whether a
second attempt would plausibly do better, not whether the frame is perfect:

  true  — a specific, nameable thing went wrong that a smaller or more targeted
          change could fix
  false — the step did what it could, or the shortfall is inherent to the
          instruction and another attempt would land in the same place

Most "partial" results are good enough to build on. Say true only when you can
name what the retry should do differently, because every true costs the user
another twenty seconds of waiting.`;

export interface Critique {
  verdict: Verdict;
  notes: string;
  rubric: string;
  /** Is the person in AFTER still the enrolled person? Strict. */
  faceMatches: boolean;
  /** The critic's own call on whether another attempt would help. */
  worthRetry: boolean;
  /** What the retry should do differently. Empty when worthRetry is false. */
  retryHint: string;
  /** Did everything the instruction did NOT name stay put? */
  continuityHeld: boolean;
  /** What drifted that nobody asked to drift. Empty when continuity held. */
  continuityBreaks: string;
}

export type Verdict = 'met' | 'partial' | 'failed';

export async function critique(args: {
  instruction: string;
  rationale: string;
  /** The enrolment photo. Identity is judged against THIS, not against `before`
   *  — judging against the previous frame is how drift compounds unseen. */
  avatar: { data: Buffer | Uint8Array; mimeType: string };
  before: { data: Buffer | Uint8Array; mimeType: string };
  after: { data: Buffer | Uint8Array; mimeType: string };
  /** False for the opening frame, where BEFORE is the enrolment photo and there
   *  is no previous shot to be continuous with. */
  isContinuation?: boolean;
  /** What the shot is OF. A photograph of a coffee cup has no face to judge, and
   *  asking anyway returns faceMatches:false — which reads as a wrong face and
   *  triggers a retry that produces another coffee cup. */
  subject?: ShotKind;
}): Promise<Critique> {
    const json = await withRetry(
    () => fetchJson(`${BASE}/models/${JUDGE_MODEL}:generateContent?key=${key()}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: CRITIC_SYSTEM }] },
      contents: [
        {
          parts: [
            { text: 'ENROLMENT PHOTO (the identity that must hold):' },
            { inlineData: { mimeType: args.avatar.mimeType, data: Buffer.from(args.avatar.data).toString('base64') } },
            { text: 'BEFORE:' },
            { inlineData: { mimeType: args.before.mimeType, data: Buffer.from(args.before.data).toString('base64') } },
            { text: 'AFTER:' },
            { inlineData: { mimeType: args.after.mimeType, data: Buffer.from(args.after.data).toString('base64') } },
            {
              text:
                `The instruction was: ${args.instruction}\nThe reason given was: ${args.rationale}\n\n` +
                (args.subject && args.subject !== 'person'
                  ? `This shot is a ${args.subject} shot: there is deliberately NO PERSON in the frame. ` +
                    'Do not treat the absence of a face as a defect — it is the brief. Set faceMatches true ' +
                    'and continuityHeld true, and judge only whether the described photograph was made well.'
                  : args.isContinuation
                    ? 'AFTER is an edit of BEFORE and must be continuous with it. Judge the edit, the identity, and the continuity.'
                    : 'AFTER is its own photograph, not an edit of BEFORE. Set continuityHeld true and leave ' +
                      'continuityBreaks empty. Judge whether the described shot was made, and whether it is the enrolled person.'),
            },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'object',
          properties: {
            verdict: { type: 'string', enum: ['met', 'partial', 'failed'] },
            notes: { type: 'string' },
            rubric: { type: 'string', description: 'the question you judged against, one line' },
            faceMatches: { type: 'boolean', description: 'is the person in AFTER the same person as the enrolment photo — strict' },
            worthRetry: { type: 'boolean' },
            retryHint: { type: 'string', description: 'what a retry should do differently; empty if worthRetry is false' },
            continuityHeld: { type: 'boolean', description: 'did everything the instruction did not name stay put; true for an opening frame' },
            continuityBreaks: { type: 'string', description: 'everything that changed that the instruction did not ask for; empty if none' },
          },
          required: ['verdict', 'notes', 'rubric', 'faceMatches', 'worthRetry', 'retryHint', 'continuityHeld', 'continuityBreaks'],
        },
      },
    }),
  }, scrub),
    { label: 'text' },
  );
  const text = firstText(json);
  if (!text) throw new Error('critic returned nothing');
  return JSON.parse(text) as Critique;
}

/* ── identity verification ────────────────────────────────────────────────── */

const VERIFIER_SYSTEM = `You are a strict face-identity comparator, in the manner
of a border officer: your only question is whether two photographs show the SAME
individual person.

Work in this order, and do not skip ahead:
1. Describe person A's face, feature by feature: face width and shape, jawline,
   cheek fullness, eye shape and spacing, eyebrows, nose bridge and tip, lips,
   hairline and hair, glasses frame shape if any.
2. Describe person B's face the same way.
3. List every concrete difference you found.
4. Only then decide samePerson.

Rules:
- "A similar-looking person of the same demographic" is NOT the same person.
- Different lighting, expression, angle or camera do not count as differences;
  different face GEOMETRY does — jaw width, cheek fullness, eye spacing,
  nose shape are geometry.
- When you are uncertain, samePerson is false. A false negative costs one
  retry; a false positive puts a stranger's face in the user's ad.`;

export interface IdentityCheck {
  differences: string;
  samePerson: boolean;
}

/**
 * A dedicated call, separate from critique(). The combined check was measured
 * to fail: asked to judge an edit AND identity at once, the model approved a
 * visibly different person from the user's own run. One job per call, and the
 * schema puts the analysis before the verdict so the decision follows the
 * evidence rather than preceding it.
 */
export async function verifyIdentity(
  avatar: { data: Buffer | Uint8Array; mimeType: string },
  frame: { data: Buffer | Uint8Array; mimeType: string },
  multiViews?: { data: Buffer | Uint8Array; mimeType: string }[],
): Promise<IdentityCheck> {
  const multiAngleParts = (multiViews ?? []).flatMap((mv, idx) => [
    { text: `Enrolment profile angle #${idx + 1}:` },
    { inlineData: { mimeType: mv.mimeType, data: Buffer.from(mv.data).toString('base64') } },
  ]);

    const json = await withRetry(
    () => fetchJson(`${BASE}/models/${JUDGE_MODEL}:generateContent?key=${key()}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: VERIFIER_SYSTEM }] },
      contents: [
        {
          parts: [
            { text: 'Person A (Base Enrolment Photo):' },
            { inlineData: { mimeType: avatar.mimeType, data: Buffer.from(avatar.data).toString('base64') } },
            ...multiAngleParts,
            { text: 'Person B (Generated Scene Frame):' },
            { inlineData: { mimeType: frame.mimeType, data: Buffer.from(frame.data).toString('base64') } },
            { text: 'Compare them against all reference angles and decide.' },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'object',
          // Property order is deliberate: the model writes the feature analysis
          // and differences BEFORE the boolean, so the verdict is forced to
          // follow its own evidence.
          properties: {
            featuresA: { type: 'string' },
            featuresB: { type: 'string' },
            differences: { type: 'string' },
            samePerson: { type: 'boolean' },
          },
          required: ['featuresA', 'featuresB', 'differences', 'samePerson'],
          propertyOrdering: ['featuresA', 'featuresB', 'differences', 'samePerson'],
        },
      },
    }),
  }, scrub),
    { label: 'text' },
  );
  const text = firstText(json);
  if (!text) throw new Error('identity check returned nothing');
  const parsed = JSON.parse(text) as IdentityCheck & { featuresA: string; featuresB: string };
  return { differences: parsed.differences, samePerson: parsed.samePerson };
}

/* ── prompt refinement ────────────────────────────────────────────────────── */

const REFINER_SYSTEM = `You rewrite a user's casual words — often dictated by
voice, in any language — into the precise English prompt the generation model
will actually receive. Both versions are SHOWN side by side, so the rewrite must
be visibly worth having: concrete nouns, physical detail, nothing vague.

purpose "goal": one or two sentences stating the OUTCOME of a UGC ad — who is in
it, where, doing what, and what it must feel like. Not a shot list.

purpose "edit": ONE imperative instruction describing ONE visible change to a
single frame. Never bundle two changes.

Preserve every concrete detail the user gave (objects, places, moods). Add the
physical specifics a model needs (light, framing, what hands are doing). Invent
nothing the user would disown.`;

export async function refinePrompt(raw: string, purpose: 'goal' | 'edit'): Promise<string> {
  const { refined } = await structured<{ refined: string }>(
    `purpose: ${purpose}\nuser's words: ${raw}\n\nRewrite.`,
    { type: 'object', properties: { refined: { type: 'string' } }, required: ['refined'] },
    REFINER_SYSTEM,
    /* The one call a user actively waits on — they have just stopped dictating
       and are watching for the rewrite. 830ms against 2120ms, and the composer
       shows their own words beside it, so a weaker rewrite is visible and
       correctable rather than silent. */
    FAST_TEXT_MODEL,
  );
  return refined;
}

/* ── the spoken script ────────────────────────────────────────────────────── */

const SCRIPT_SYSTEM = `You write the line a creator actually says to camera in a
short UGC ad. One to three sentences, spoken aloud in the time given.

It has to sound like a person who owns the thing talking to a friend — specific,
a little uneven, never a slogan. Name what the product does for them, not what
it is. No "Hey guys", no "game changer", no "trust me", no exclamation stacking,
no calls to action unless the goal asks for one.

Write only the words spoken. No stage directions, no quotation marks.`;

/**
 * The voiceover used to be a fixed sentence with the user's goal dropped into
 * the middle — "Hey guys, look at how well this works! <goal>. The quality is
 * honestly unbelievable!" — identical in every ad this product has ever made,
 * and never shown to the person whose face says it.
 */
export async function writeScript(goal: string, seconds: number): Promise<string> {
  const { script } = await structured<{ script: string }>(
    `Goal: ${goal}\nThe clip is ${seconds} seconds, so the line must be sayable in about ${Math.max(
      4,
      seconds - 2,
    )} seconds at a natural pace.\n\nWrite the spoken line.`,
    { type: 'object', properties: { script: { type: 'string' } }, required: ['script'] },
    SCRIPT_SYSTEM,
    /* The biggest single latency win available: 637ms against 3476ms, and this
       runs strictly before the planner and before any frame, so all of it is
       dead air at the head of a run. Quality was indistinguishable, the line is
       shown to the user before anything renders, and the whole block is already
       wrapped in try/catch. */
    FAST_TEXT_MODEL,
  );
  return script.trim();
}

/*
 * Read an existing run and work out what it was actually a shoot OF.
 *
 * Runs made before shot lists existed have no look and no shot kinds, so every
 * frame reads as 'person' by default — and the impact model, asked what a
 * product swap breaks, would answer "nothing", because no shot claims to be
 * about the product. Every run in the library predates this. Leaving them out
 * would make the whole feature apply only to work that does not exist yet.
 *
 * This is inference, so it is offered rather than applied: the user presses a
 * button, sees what it decided, and edits it. Silently guessing the wardrobe of
 * somebody's finished ad and then marking their frames out of date on the
 * strength of that guess would be a much worse trade.
 */
export async function deriveLook(
  goal: string,
  steps: { id: string; stepNo: number; label?: string; instruction?: string }[],
): Promise<{ look: LookBible; kinds: { id: string; shot: ShotKind }[] }> {
  const listing = steps
    .map((s) => `  id=${s.id} step=${s.stepNo} ${s.label ?? ''} — ${s.instruction ?? ''}`)
    .join('\n');

  return structured<{ look: LookBible; kinds: { id: string; shot: ShotKind }[] }>(
    `This ad already exists. Its brief was:\n${goal}\n\nIts shots are:\n${listing}\n\n` +
      `Describe the shoot these were made in, and say what each shot is OF.`,
    {
      type: 'object',
      properties: {
        look: {
          type: 'object',
          properties: {
            location: { type: 'string' },
            wardrobe: { type: 'string' },
            light: { type: 'string' },
            palette: { type: 'string' },
            product: { type: 'string' },
          },
          required: ['location', 'wardrobe', 'light', 'palette', 'product'],
        },
        kinds: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'the id given in the listing, copied exactly' },
              shot: { type: 'string', enum: ['person', 'product', 'detail', 'scene'] },
            },
            required: ['id', 'shot'],
          },
        },
      },
      required: ['look', 'kinds'],
    },
    `You are reading an advertisement that has already been shot and working out
what it was made from — a look book written after the fact.

Describe the ONE shoot every shot belongs to: the location, the wardrobe, the
light, the palette, and the product itself. Be concrete and specific, in the
words a photographer would use. "A pale oak kitchen counter with a window to the
left" is usable; "a modern kitchen" is not. Infer from the instructions; where
they are silent, choose something consistent with the rest rather than vague.

Then say what each shot is OF:

  person   the creator is in frame — a face is visible
  product  the item is the subject; hands may hold it, no face
  detail   macro — texture, lettering, a mechanism
  scene    the place, nobody in it

Judge that from what the instruction actually describes, not from where the shot
falls in the order. An instruction that names a face, an expression, eye contact
or the creator is a person shot. One that describes only an object, a label or a
surface is not, even if a person is implied nearby. Copy each id exactly.`,
    /* Lowest-risk call in this file: text only, no face anywhere near it, and
       the result is offered rather than applied — the user presses a button,
       reads what it decided, and edits it. A weaker guess is visible, never
       silently authoritative. */
    FAST_TEXT_MODEL,
  );
}
