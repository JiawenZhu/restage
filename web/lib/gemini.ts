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
