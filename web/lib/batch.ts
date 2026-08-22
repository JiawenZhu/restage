/*
 * The Batch API, and an honest account of what it is for here.
 *
 * MEASURED AGAINST THE LIVE API, because the documentation's headline number is
 * misleading in both directions. It says "target turnaround 24 hours, but in
 * majority of cases much quicker", which reads as either unusable or magic.
 * Neither is true. Six real jobs, in the order they were run:
 *
 *     1 image  → 103s        2 text  → 109s
 *     6 images → 202s        2 text  → 200s      1 image → 250s
 *
 * Note the second and fourth: the SAME two-request text job took 109s once and
 * 200s another time. An early reading of this data had it as a tidy "85s of
 * overhead plus 20s an item", which the repeat measurement destroyed — the
 * spread within one job shape is as large as the spread between shapes. What is
 * actually being measured is queue time, and queue time is not ours to predict.
 *
 * So the honest model is a RANGE, roughly 100 to 260 seconds, only weakly
 * related to how many items are in the job. Batch is therefore SLOWER than the
 * interactive path — five to twelve times slower for one image — and anyone
 * reaching for it to make generation quicker has misread it.
 *
 * WHAT IT IS ACTUALLY FOR:
 *
 *   A SEPARATE QUOTA POOL. "Batch API requests are subject to their own rate
 *   limits, separate from the non-batch API calls" — 100 concurrent jobs. That
 *   is the scaling lever. Interactive RPM and TPM are shared across every user
 *   at once, so the second person to press Start is the one whose run degrades;
 *   work moved to batch stops competing for that.
 *
 *   HALF PRICE. 50% of interactive, for work nobody is watching.
 *
 * WHAT IT CANNOT DO, probed directly rather than assumed:
 *
 *     gemini-3-pro-image              ACCEPTED
 *     gemini-3.7-flash                ACCEPTED
 *     veo-3.1-fast-generate-preview   404 — not supported for batchGenerateContent
 *     gemini-omni-flash-preview       404 — not supported for batchGenerateContent
 *
 * Video, the slowest and most expensive thing this product does, cannot be
 * batched at all. So batch covers frames and text and nothing else.
 *
 * The result is that batch belongs on work the user is not sitting and watching
 * — rebuilding several shots, generating template previews, and absorbing
 * overflow when interactive is rate-limited — and does not belong on the live
 * canvas, where the whole promise is that you watch it happen.
 */

if (typeof window !== 'undefined') {
  throw new Error('lib/batch is server-only — it holds the API key.');
}

import { fetchJson, HttpError, withRetry } from './backoff';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

function key(): string {
  const k = process.env.GEMINI_API_KEY;
  if (!k) throw new Error('GEMINI_API_KEY is not set');
  return k;
}

function scrub(message: string): string {
  return message.replace(/key=[\w-]+/g, 'key=***');
}

/*
 * Observed range, not a formula.
 *
 * Item count barely moves this — a 6-image job landed at 202s and a 2-request
 * text job at 200s, while the same text job took 109s on another run. Quoting a
 * single number computed from item count would be inventing precision the
 * service does not offer, so the estimate leans to the slow end: a wait that
 * beats the estimate is a pleasant surprise, one that overruns it is a bug
 * report.
 */
export const BATCH_MIN_MS = 100_000;
export const BATCH_MAX_MS = 260_000;

export function batchEstimate(items: number): { ms: number; label: string } {
  // Only a gentle lean on size, because the data barely supports one at all.
  const ms = Math.min(BATCH_MAX_MS, BATCH_MIN_MS + Math.max(0, items - 1) * 15_000);
  return { ms, label: 'a few minutes' };
}

/** Only these are worth submitting; the rest 404 on batchGenerateContent. */
export const BATCHABLE = new Set(['gemini-3-pro-image', 'gemini-3.7-flash', 'gemini-3-pro-image-preview']);

export interface BatchItem {
  /** Yours, echoed back on the response so results can be matched to shots. */
  key: string;
  prompt: string;
  /** Reference images, same as an interactive frame request. */
  refs?: { data: Buffer | Uint8Array; mimeType: string }[];
  aspect?: '9:16' | '16:9';
  /** Set for image jobs; omit for text. */
  wantsImage?: boolean;
}

export interface BatchResult {
  key: string;
  bytes?: Buffer;
  mimeType?: string;
  text?: string;
  error?: string;
}

type BatchState =
  | 'BATCH_STATE_PENDING'
  | 'BATCH_STATE_RUNNING'
  | 'BATCH_STATE_SUCCEEDED'
  | 'BATCH_STATE_FAILED'
  | 'BATCH_STATE_CANCELLED'
  | 'BATCH_STATE_EXPIRED';

const TERMINAL: BatchState[] = [
  'BATCH_STATE_SUCCEEDED',
  'BATCH_STATE_FAILED',
  'BATCH_STATE_CANCELLED',
  'BATCH_STATE_EXPIRED',
];

/**
 * Submit a batch. Returns the job name to poll.
 *
 * Inline requests only. The alternative is uploading a JSONL file, which is for
 * batches beyond 20MB — a Restage batch is at most a handful of shots with a
 * few reference photos, comfortably inside that, and the file route would add
 * an upload, a handle to track and a second thing to clean up.
 */
export async function submitBatch(model: string, items: BatchItem[], displayName: string): Promise<string> {
  if (!BATCHABLE.has(model)) {
    throw new Error(`${model} does not support batchGenerateContent`);
  }
  if (!items.length) throw new Error('nothing to batch');

  const requests = items.map((it) => ({
    request: {
      contents: [
        {
          parts: [
            ...(it.refs ?? []).map((r) => ({
              inlineData: { mimeType: r.mimeType, data: Buffer.from(r.data).toString('base64') },
            })),
            { text: it.prompt },
          ],
        },
      ],
      ...(it.wantsImage
        ? {
            generationConfig: {
              responseModalities: ['IMAGE'],
              imageConfig: { aspectRatio: it.aspect ?? '9:16' },
            },
          }
        : {}),
    },
    metadata: { key: it.key },
  }));

  const json = await withRetry(
    () =>
      fetchJson(
        `${BASE}/models/${model}:batchGenerateContent?key=${key()}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            batch: { display_name: displayName, input_config: { requests: { requests } } },
          }),
        },
        scrub,
      ),
    { label: `batch:submit:${model}` },
  );

  const name = json.name as string | undefined;
  if (!name) throw new Error('batch submitted but no job name came back');
  return name;
}

export interface BatchStatus {
  state: BatchState;
  done: boolean;
  results?: BatchResult[];
  error?: string;
}

/** One poll. The caller decides the cadence, because a request handler and a
 *  background job want very different ones. */
export async function pollBatch(name: string): Promise<BatchStatus> {
  const json = await withRetry(
    () => fetchJson(`${BASE}/${name}?key=${key()}`, { method: 'GET' }, scrub),
    { label: 'batch:poll' },
  );

  const meta = (json.metadata ?? {}) as { state?: BatchState };
  const state = (meta.state ?? (json.state as BatchState) ?? 'BATCH_STATE_PENDING') as BatchState;
  if (!TERMINAL.includes(state)) return { state, done: false };

  if (state !== 'BATCH_STATE_SUCCEEDED') {
    return {
      state,
      done: true,
      error:
        state === 'BATCH_STATE_EXPIRED'
          ? 'the batch job expired before it ran'
          : state === 'BATCH_STATE_CANCELLED'
            ? 'the batch job was cancelled'
            : 'the batch job failed',
    };
  }

  /* The shape is nested twice: response.inlinedResponses.inlinedResponses. The
     outer is the union wrapper carrying @type, the inner is the actual list. */
  const response = (json.response ?? {}) as { inlinedResponses?: { inlinedResponses?: unknown[] } };
  const list = response.inlinedResponses?.inlinedResponses ?? [];

  const results: BatchResult[] = list.map((raw, i) => {
    const row = raw as {
      metadata?: { key?: string };
      response?: { candidates?: { content?: { parts?: Record<string, unknown>[] } }[] };
      error?: { message?: string };
    };
    // The key comes back on metadata; index is the fallback so a response that
    // loses it still lands somewhere rather than being silently dropped.
    const rk = row.metadata?.key ?? String(i);
    if (row.error) return { key: rk, error: scrub(row.error.message ?? 'failed') };

    const parts = row.response?.candidates?.[0]?.content?.parts ?? [];
    const img = parts.find((p) => p.inlineData) as
      | { inlineData: { data: string; mimeType?: string } }
      | undefined;
    if (img) {
      return {
        key: rk,
        bytes: Buffer.from(img.inlineData.data, 'base64'),
        mimeType: img.inlineData.mimeType ?? 'image/png',
      };
    }
    const text = parts.map((p) => p.text).filter(Boolean).join('');
    return text ? { key: rk, text: text as string } : { key: rk, error: 'no content returned' };
  });

  return { state, done: true, results };
}

/** Give up on a job. Batch jobs are billed on what they process, so cancelling
 *  a run the user abandoned is worth doing. */
export async function cancelBatch(name: string): Promise<void> {
  await fetchJson(`${BASE}/${name}:cancel?key=${key()}`, { method: 'POST' }, scrub).catch(() => {});
}

/**
 * Submit and wait. For a background job that owns its own lifetime.
 *
 * Never call this from a request handler: the measured floor is ~100 seconds
 * and the ceiling is the API's own 48-hour expiry.
 */
export async function runBatch(
  model: string,
  items: BatchItem[],
  displayName: string,
  opts: { pollMs?: number; timeoutMs?: number; onState?: (s: BatchState, elapsedMs: number) => void } = {},
): Promise<BatchResult[]> {
  const { pollMs = 15_000, timeoutMs = 20 * 60_000, onState } = opts;
  const name = await submitBatch(model, items, displayName);
  const started = Date.now();

  for (;;) {
    await new Promise((r) => setTimeout(r, pollMs));
    const status = await pollBatch(name);
    onState?.(status.state, Date.now() - started);

    if (status.done) {
      if (status.error) throw new Error(status.error);
      return status.results ?? [];
    }
    if (Date.now() - started > timeoutMs) {
      await cancelBatch(name);
      throw new Error(`batch did not finish within ${Math.round(timeoutMs / 60000)} minutes`);
    }
  }
}

export { HttpError };
