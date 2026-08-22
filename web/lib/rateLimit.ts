/*
 * A per-user ceiling on the routes that spend money.
 *
 * Every billable route was reachable an unlimited number of times by any
 * signed-in account: a loop against /api/runs or /api/runs/[id]/render bills the
 * project's Gemini and Veo quota with nothing in the way. This is not billing
 * (that is deliberately out of scope) — it is the difference between a bad
 * afternoon and an unbounded one.
 *
 * Firestore rather than memory, because serverless instances do not share
 * memory and a per-instance counter is not a limit. One document per user per
 * window, incremented in a transaction so parallel requests cannot both read
 * the same count.
 */
import { adminDb } from './firebaseAdmin';

export interface Quota {
  /** Requests allowed inside the window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export const QUOTAS = {
  // A run is 5-7 frames plus judges — the most expensive thing here.
  run: { limit: 20, windowMs: 60 * 60 * 1000 },
  // Counted in CLIPS, not requests — a seven-shot sequence render is seven Veo
  // jobs and is charged as seven. Sixty allows roughly eight full sequence
  // renders an hour while still being a real ceiling on a very expensive call.
  render: { limit: 60, windowMs: 60 * 60 * 1000 },
  // Cheap text calls, but still billed.
  text: { limit: 200, windowMs: 60 * 60 * 1000 },
} satisfies Record<string, Quota>;

export interface RateResult {
  ok: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * Take `amount` from the user's window. Refuses if the whole amount will not fit.
 *
 * The amount exists because one request is not one unit of spend. A sequence
 * render submits ONE Veo job per shot, so "render all 7 shots" costs seven
 * clips — and this counted it as one. With the render bucket at 30, a single
 * account could bill 30 x 7 = 210 Veo clips an hour and never be refused, which
 * is far above any project-level quota the API itself will allow. The ceiling
 * was set in the wrong unit, so it protected nothing: Google's quota was always
 * reached first, which is exactly what the user hit.
 *
 * All-or-nothing on purpose. Partially admitting a seven-shot render would
 * charge for seven and deliver four.
 */
export async function consume(
  uid: string,
  bucket: keyof typeof QUOTAS,
  amount = 1,
): Promise<RateResult> {
  const { limit, windowMs } = QUOTAS[bucket];
  const now = Date.now();
  const want = Math.max(1, Math.round(amount));
  const ref = adminDb().collection('rateLimits').doc(`${uid}_${bucket}`);

  try {
    return await adminDb().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.data();
      const windowStart: number = data?.windowStart ?? 0;
      const count: number = data?.count ?? 0;

      // A fresh window: the previous one has fully elapsed.
      if (now - windowStart >= windowMs) {
        // Still refusable: one request asking for more than the whole window
        // holds can never be satisfied, and saying so now beats spending most
        // of it and failing.
        if (want > limit) {
          return { ok: false, remaining: limit, retryAfterSeconds: 0 };
        }
        tx.set(ref, { windowStart: now, count: want, updatedAt: now });
        return { ok: true, remaining: limit - want, retryAfterSeconds: 0 };
      }

      if (count + want > limit) {
        return {
          ok: false,
          remaining: Math.max(0, limit - count),
          retryAfterSeconds: Math.ceil((windowStart + windowMs - now) / 1000),
        };
      }

      tx.set(ref, { windowStart, count: count + want, updatedAt: now }, { merge: true });
      return { ok: true, remaining: limit - count - want, retryAfterSeconds: 0 };
    });
  } catch {
    /*
     * Fail OPEN, and say why: this is a spend ceiling, not an access control.
     * A Firestore blip must not stop a paying user from working, and every one
     * of these routes already requires an authenticated owner.
     */
    console.error('[rateLimit] check failed; allowing the request');
    return { ok: true, remaining: -1, retryAfterSeconds: 0 };
  }
}

/** The 429 body, shaped the way the client already reads errors. */
export function tooMany(r: RateResult) {
  const mins = Math.max(1, Math.ceil(r.retryAfterSeconds / 60));
  return Response.json(
    { error: `That is a lot of generating. Try again in about ${mins} minute${mins === 1 ? '' : 's'}.` },
    { status: 429, headers: { 'retry-after': String(r.retryAfterSeconds) } },
  );
}
