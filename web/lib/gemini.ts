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

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

// Frames run on the cheap fast model on purpose: the plan expects to throw some
// away, and a critic that cannot afford to reject anything is not a critic.
const IMAGE_MODEL = process.env.RESTAGE_IMAGE_MODEL ?? 'gemini-3-pro-image';
const VIDEO_MODEL = process.env.RESTAGE_VIDEO_MODEL ?? 'veo-3.1-fast-generate-preview';

export type Aspect = '9:16' | '16:9';

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
}

export async function generateFrame(req: FrameRequest): Promise<{ bytes: Buffer; mimeType: string }> {
  const parts: unknown[] = [
    ...(req.refs ?? []).map((r) => ({
      inlineData: { mimeType: r.mimeType, data: Buffer.from(r.data).toString('base64') },
    })),
    { text: req.prompt },
  ];

  const res = await fetch(`${BASE}/models/${IMAGE_MODEL}:generateContent?key=${key()}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: {
        responseModalities: ['IMAGE'],
        imageConfig: { aspectRatio: req.aspect },
      },
    }),
  });

  const json = await res.json();
  if (!res.ok) throw new Error(scrub(json?.error?.message ?? `image generation failed (${res.status})`));

  const img = json?.candidates?.[0]?.content?.parts?.find((p: { inlineData?: unknown }) => p.inlineData);
  if (!img) throw new Error(`no image returned: ${json?.candidates?.[0]?.finishReason ?? 'empty response'}`);

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
}

/**
 * Veo is a long-running operation: this only submits it. Measured at ~41s for a
 * fast-model clip, so nothing should await it inside a request handler — store
 * the operation name and poll from a job.
 */
export async function submitRender(req: RenderRequest): Promise<{ operation: string }> {
  const instance: Record<string, unknown> = { prompt: req.prompt };
  if (req.firstFrame) {
    instance.image = {
      bytesBase64Encoded: Buffer.from(req.firstFrame.data).toString('base64'),
      mimeType: req.firstFrame.mimeType,
    };
  }

  const res = await fetch(`${BASE}/models/${VIDEO_MODEL}:predictLongRunning?key=${key()}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ instances: [instance], parameters: { aspectRatio: req.aspect } }),
  });

  const json = await res.json();
  if (!res.ok) throw new Error(scrub(json?.error?.message ?? `render submit failed (${res.status})`));
  if (!json.name) throw new Error('render submitted but no operation name came back');

  return { operation: json.name };
}

export type RenderStatus =
  | { done: false }
  | { done: true; videoUri: string }
  | { done: true; error: string };

export async function pollRender(operation: string): Promise<RenderStatus> {
  const res = await fetch(`${BASE}/${operation}?key=${key()}`);
  const op = await res.json();

  if (!res.ok) throw new Error(scrub(op?.error?.message ?? `poll failed (${res.status})`));
  if (!op.done) return { done: false };
  if (op.error) return { done: true, error: scrub(op.error.message ?? 'render failed') };

  const samples = op.response?.generateVideoResponse?.generatedSamples ?? op.response?.generatedSamples ?? [];
  const uri = samples[0]?.video?.uri;
  if (!uri) return { done: true, error: 'render finished with no video attached' };

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

/* ── planning and criticism ───────────────────────────────────────────────── */

// Verified with a real call, not read off the models list: 2.5-flash is still
// listed and is closed to new projects, so the endpoint's inventory is not a
// statement about access.
const TEXT_MODEL = process.env.RESTAGE_TEXT_MODEL ?? 'gemini-3.7-flash';

/**
 * Both calls below use responseSchema rather than asking for JSON in the prompt.
 * A model told "reply with JSON" wraps it in prose often enough that the parse
 * becomes the flakiest part of the pipeline; a schema makes the shape the API's
 * problem instead of ours.
 */
async function structured<T>(prompt: string, schema: object, system?: string): Promise<T> {
  const res = await fetch(`${BASE}/models/${TEXT_MODEL}:generateContent?key=${key()}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      generationConfig: { responseMimeType: 'application/json', responseSchema: schema },
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(scrub(json?.error?.message ?? `text call failed (${res.status})`));

  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error(`no content: ${json?.candidates?.[0]?.finishReason ?? 'empty'}`);
  return JSON.parse(text) as T;
}

const PLANNER_SYSTEM = `You plan UGC video ads that star one real person whose face is already enrolled.

You are given an outcome, not a shot list, and you decompose it into 5-7 ordered
edits to a single still frame. The frame is generated and re-generated; only the
last approved one is rendered to video. So every step must be a visible change to
one image, not an instruction about editing or pacing.

For each step write:
- instruction: what changes in the frame, imperative, one line
- rationale: WHY, in terms of what a viewer would notice. This is read by the
  user and is what shows you reasoned rather than pattern-matched. Never generic.

Order matters: composition and setting before light, light before expression,
crop last, because each later step depends on the earlier one surviving.`;

export interface PlannedStep {
  stepNo: number;
  instruction: string;
  rationale: string;
}

export async function planRun(goal: string, aspect: Aspect, seconds: number): Promise<PlannedStep[]> {
  const { steps } = await structured<{ steps: PlannedStep[] }>(
    `Goal: ${goal}\nOutput format: ${aspect}, ${seconds} seconds.\n\nPlan the edits.`,
    {
      type: 'object',
      properties: {
        steps: {
          type: 'array',
          minItems: 5,
          maxItems: 7,
          items: {
            type: 'object',
            properties: {
              stepNo: { type: 'integer' },
              instruction: { type: 'string' },
              rationale: { type: 'string' },
            },
            required: ['stepNo', 'instruction', 'rationale'],
          },
        },
      },
      required: ['steps'],
    },
    PLANNER_SYSTEM,
  );
  return steps.map((s, i) => ({ ...s, stepNo: i + 1 }));
}

const CRITIC_SYSTEM = `You judge whether one edit to a frame achieved what it claimed.

You see the frame before, the frame after, and the instruction. Decide:
  met     — the change happened and the frame is better for it
  partial — the change happened but overshot or lost something
  failed  — the change did not happen, or made the frame worse

Write notes in your own voice, first person, quoting what you actually see. Be
specific about the pixels: "the shadow under the jaw is gone" beats "lighting
improved". Say what is still wrong even when the verdict is met.

Default to a harsher verdict when uncertain. A critic that passes everything is
not a critic, and the retry it declines to ask for is the whole product.`;

export interface Critique {
  verdict: Verdict;
  notes: string;
  rubric: string;
}

export type Verdict = 'met' | 'partial' | 'failed';

export async function critique(args: {
  instruction: string;
  rationale: string;
  before: { data: Buffer | Uint8Array; mimeType: string };
  after: { data: Buffer | Uint8Array; mimeType: string };
}): Promise<Critique> {
  const res = await fetch(`${BASE}/models/${TEXT_MODEL}:generateContent?key=${key()}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: CRITIC_SYSTEM }] },
      contents: [
        {
          parts: [
            { text: 'BEFORE:' },
            { inlineData: { mimeType: args.before.mimeType, data: Buffer.from(args.before.data).toString('base64') } },
            { text: 'AFTER:' },
            { inlineData: { mimeType: args.after.mimeType, data: Buffer.from(args.after.data).toString('base64') } },
            { text: `The instruction was: ${args.instruction}\nThe reason given was: ${args.rationale}\n\nJudge it.` },
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
          },
          required: ['verdict', 'notes', 'rubric'],
        },
      },
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(scrub(json?.error?.message ?? `critique failed (${res.status})`));
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('critic returned nothing');
  return JSON.parse(text) as Critique;
}
