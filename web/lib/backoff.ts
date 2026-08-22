/*
 * Surviving a rate limit.
 *
 * There was no handling for one. Every call in gemini.ts threw on any non-OK
 * status, so a 429 was indistinguishable from a malformed request: the step
 * failed, took its one retry immediately — into the same rate limit — and was
 * abandoned. With one user that is invisible, because one user rarely hits a
 * limit. With several it is the product: interactive RPM and TPM are shared
 * across everyone, so the second person to press Start is the one whose run
 * quietly degrades.
 *
 * Three things make retrying correct rather than merely hopeful:
 *
 *   HONOUR THE SERVER'S NUMBER. Google returns a RetryInfo detail carrying
 *   retryDelay ("37s"). Guessing when the server has already said is how a
 *   client turns a queue into a stampede.
 *
 *   FULL JITTER. Everything that fails at the same moment retries at the same
 *   moment, and a fleet of clients backing off in lockstep reproduces the spike
 *   it is backing off from. The delay is a random point in [0, cap], not the cap.
 *
 *   RETRY ONLY WHAT IS TRANSIENT. A 400 is a bug in the request and will fail
 *   identically forever; retrying it wastes the user's time to arrive at the
 *   same error. 429 and 5xx are the transient ones.
 */

/** Statuses worth trying again. A 400 will fail the same way every time. */
const TRANSIENT = new Set([408, 429, 500, 502, 503, 504]);

export interface RetryOptions {
  /** Attempts INCLUDING the first. */
  attempts?: number;
  /** First backoff step, doubled each time before jitter. */
  baseMs?: number;
  /** Longest any single wait may be. */
  maxDelayMs?: number;
  /** Longest the whole sequence may spend waiting. */
  budgetMs?: number;
  /** Named in logs so a slow path is identifiable. */
  label?: string;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Seconds the server asked us to wait, when it said. */
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/**
 * Pull the server's own retry advice out of a Gemini error body.
 *
 * Google's shape is `error.details[]` containing a
 * `type.googleapis.com/google.rpc.RetryInfo` with `retryDelay: "37s"`. The
 * `Retry-After` header is checked too, since not every path returns the detail.
 */
export function retryAfterFrom(body: unknown, headers?: Headers): number | undefined {
  const header = headers?.get('retry-after');
  if (header) {
    const secs = Number(header);
    if (Number.isFinite(secs)) return secs * 1000;
    const at = Date.parse(header);
    if (Number.isFinite(at)) return Math.max(0, at - Date.now());
  }

  const details = (body as { error?: { details?: unknown[] } })?.error?.details;
  if (!Array.isArray(details)) return undefined;
  for (const d of details) {
    const rec = d as { '@type'?: string; retryDelay?: string };
    if (!rec?.['@type']?.includes('RetryInfo')) continue;
    const m = /^([\d.]+)s$/.exec(rec.retryDelay ?? '');
    if (m) return Math.round(Number(m[1]) * 1000);
  }
  return undefined;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Run `fn`, retrying transient failures with jittered backoff.
 *
 * `fn` must throw an HttpError for the status to be understood; anything else
 * is treated as a real failure and rethrown immediately, because a bug in our
 * own code is not something waiting will fix.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const { attempts = 4, baseMs = 1_000, maxDelayMs = 30_000, budgetMs = 90_000, label = 'call' } = opts;

  let spent = 0;
  let lastErr: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const http = err instanceof HttpError ? err : null;
      if (!http || !TRANSIENT.has(http.status) || attempt === attempts) throw err;

      /* The server's number wins when it gave one. Capped anyway: a service
         asking for ten minutes is telling us to give up, not to hold a request
         handler open for ten minutes. */
      const exponential = Math.min(maxDelayMs, baseMs * 2 ** (attempt - 1));
      const ceiling = Math.min(maxDelayMs, http.retryAfterMs ?? exponential);
      // Full jitter, so simultaneous failures do not retry simultaneously.
      const wait = http.retryAfterMs
        ? http.retryAfterMs + Math.random() * 1_000
        : Math.random() * ceiling;

      if (spent + wait > budgetMs) throw err;
      spent += wait;

      console.warn(
        `[retry] ${label} got ${http.status}, attempt ${attempt}/${attempts}, waiting ${Math.round(wait)}ms` +
          (http.retryAfterMs ? ' (server asked)' : ''),
      );
      await sleep(wait);
    }
  }
  throw lastErr;
}

/**
 * fetch + throw HttpError on a non-OK status, with the body already read.
 *
 * The pattern everywhere in gemini.ts is fetch, read json, throw a plain Error
 * on !ok — which loses the status, and the status is the only thing that says
 * whether waiting will help.
 */
export async function fetchJson(
  url: string,
  init: RequestInit,
  scrub: (s: string) => string = (s) => s,
): Promise<Record<string, unknown>> {
  const res = await fetch(url, init);
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const msg = (json as { error?: { message?: string } })?.error?.message ?? `request failed (${res.status})`;
    throw new HttpError(res.status, scrub(msg), retryAfterFrom(json, res.headers));
  }
  return json;
}
