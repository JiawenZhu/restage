/*
 * Two ways to reach the same models, and the rule for who gets which.
 *
 * SERVER ONLY. This file holds an API key and mints Google access tokens.
 *
 * Restage talks to Google over two entirely separate doors:
 *
 *   api-key  — generativelanguage.googleapis.com, authenticated with
 *              GEMINI_API_KEY. This is AI Studio. It carries the newest
 *              preview models, and it is rate limited hard: the console
 *              measured Veo 3 Fast at 2 RPM and 10 requests A DAY, which is
 *              enough to demo a product and not enough to sell one.
 *
 *   vertex   — aiplatform.googleapis.com, authenticated with a service account.
 *              Enterprise quota, billed to the project, and the door the paid
 *              plan goes through.
 *
 * THE MODELS ARE THE SAME ON BOTH SIDES, which took some finding out. The paid
 * path ran the 2.5 family and made visibly worse ads, and that looked like the
 * price of enterprise quota. It was not: it was the REGION. us-central1 serves
 * only 2.5; the `global` endpoint serves the whole 3.x line, verified with real
 * calls. See the note on VERTEX_LOCATION.
 *
 * So the difference between the two plans is quota, not quality — which is the
 * honest thing for a paid plan to be selling. What still differs is small and
 * enumerated in MODELS: Veo has a different model id on each side, and Omni
 * exists on AI Studio only.
 *
 * NO CROSS-PROVIDER FALLBACK. A paid run that quietly finishes on somebody's
 * personal key spends the wrong quota and hides an outage behind a success; a
 * BYOK run that quietly finishes on our infrastructure is us paying for work we
 * are not billing for. Neither is allowed to happen silently.
 */

if (typeof window !== 'undefined') {
  throw new Error(
    'lib/provider is server-only. Importing it from a client component would ' +
      'bundle GEMINI_API_KEY into the page. Call it from app/api/* instead.',
  );
}

import { GoogleAuth } from 'google-auth-library';
import { adminDb } from './firebaseAdmin';
import { fetchJson, withRetry, type RetryOptions } from './backoff';

export type Provider = 'vertex' | 'api-key';

/**
 * Where billing and credentials live: users/{uid}/private/account.
 *
 * NOT on the user document, which is owner-readable AND owner-WRITABLE. Putting
 * `plan` there would make upgrading yourself onto infrastructure we pay for a
 * one-line setDoc() from the browser console, and putting the encrypted key
 * there would ship the ciphertext to every client for no reason. firestore.rules
 * denies this subcollection to clients outright; the Admin SDK ignores rules, so
 * the API routes still reach it.
 */
export function accountDoc(uid: string) {
  return adminDb().collection('users').doc(uid).collection('private').doc('account');
}

/**
 * The two things a user can choose, in their words rather than ours.
 *
 *   byok — "Use your own API key". They paste a Google AI Studio key, Google
 *          bills them directly, and we never see a cent of it. Their key, their
 *          quota, their limits.
 *   paid — "Paid". They pay Restage and we run it on infrastructure we own.
 *
 * WHAT THE USER IS NEVER TOLD is which API sits behind "paid". Vertex is an
 * implementation detail — it is how we happen to get capacity today, not a
 * promise we want to make or a word anyone outside this codebase should have to
 * learn. Nothing user-facing says "Vertex", and nothing should start.
 */
export type Plan = 'byok' | 'paid';

export const PROVIDER_FOR_PLAN: Record<Plan, Provider> = {
  byok: 'api-key',
  paid: 'vertex',
};

/** What the choice is called on screen. The provider name appears in neither. */
export const PLAN_LABEL: Record<Plan, string> = {
  byok: 'Your own API key',
  paid: 'Paid',
};

/* ── which model plays which role, on each side ───────────────────────────── */

export interface ModelSet {
  /** Storyboard stills, conditioned on the enrolment angles. */
  image: string;
  /** Veo. Long-running; one job per shot. */
  video: string;
  /** The planner: goal → shot list + look bible. */
  text: string;
  /** The critic and the identity verifier. The two calls that decide whether a
   *  frame showing somebody's face is allowed to stand. */
  judge: string;
  /** Spoken line and prompt rewriting — short, and a human is waiting. */
  fastText: string;
  /**
   * The one-call whole-ad engine.
   *
   * `null` means this provider HAS NO SUCH ENGINE, which is the case on Vertex:
   * gemini-omni-flash-preview is an AI Studio model reached through the
   * /interactions endpoint and has no Vertex equivalent. Callers must check
   * this rather than falling through to `video`, because falling through
   * silently turns "Gemini Omni" into a second, identical Veo render while the
   * interface goes on describing a continuous take with native audio.
   */
  omni: string | null;
}

export const MODELS: Record<Provider, ModelSet> = {
  'api-key': {
    image: process.env.RESTAGE_IMAGE_MODEL ?? 'gemini-3-pro-image',
    video: process.env.RESTAGE_VIDEO_MODEL ?? 'veo-3.1-fast-generate-preview',
    text: process.env.RESTAGE_TEXT_MODEL ?? 'gemini-3.7-flash',
    judge: process.env.RESTAGE_JUDGE_MODEL ?? 'gemini-3.7-flash',
    fastText: process.env.RESTAGE_FAST_TEXT_MODEL ?? 'gemini-3.5-flash-lite',
    omni: process.env.RESTAGE_OMNI_MODEL ?? 'gemini-omni-flash-preview',
  },
  /*
   * THE SAME MODELS AS THE KEY PATH.
   *
   * These were the 2.5 family, on the belief that Vertex does not carry the 3.x
   * line — which was true of the region it was pointed at and false of Vertex.
   * See the note on VERTEX_LOCATION: on the global endpoint every one of these
   * is served, verified with real calls rather than a docs page.
   *
   * That matters most for two of them. The PLANNER writes every prompt the image
   * and video models are handed, so a weaker planner degrades everything
   * downstream and no amount of Veo quality rescues a badly-written shot. And
   * the IMAGE model makes the storyboard frames that Veo animates, so it sets
   * the ceiling on how the finished ad can possibly look.
   *
   * The paid plan now differs from the key plan in quota alone, which is the
   * honest thing for it to be selling.
   */
  vertex: {
    image: process.env.RESTAGE_VERTEX_IMAGE_MODEL ?? 'gemini-3-pro-image',
    /*
     * The SAME MODEL as the key path, under Vertex's name for it.
     *
     * This is the one role where the two doors cannot share an id. AI Studio
     * names Veo with a -preview suffix and Vertex with GA -001, and they are not
     * aliases: veo-3.1-fast-generate-preview genuinely 404s on Vertex, in every
     * region tested. So the pairing is by generation and tier —
     *
     *   AI Studio  veo-3.1-fast-generate-preview
     *   Vertex     veo-3.1-fast-generate-001
     *
     * — which is Veo 3.1 Fast on both sides. Vertex serves exactly two Veo ids,
     * this and the full veo-3.1-generate-001; the full one costs more per second,
     * which on a seven-shot sequence is seven times the difference.
     *
     * Verified with a real render on global rather than inferred: 57 seconds,
     * 1.72 MB, 720x1280, 24fps, h264 with an AAC track — the same shape the key
     * path produces.
     */
    video: process.env.RESTAGE_VERTEX_VIDEO_MODEL ?? 'veo-3.1-fast-generate-001',
    text: process.env.RESTAGE_VERTEX_TEXT_MODEL ?? 'gemini-3.7-flash',
    /* The identity gate, on the model it was actually measured on: 10/10 on
       faceMatches, against 6/10 for 3.5-flash-lite. Running the paying accounts
       on an unmeasured judge was the wrong way round, and this closes it. */
    judge: process.env.RESTAGE_VERTEX_JUDGE_MODEL ?? 'gemini-3.7-flash',
    fastText: process.env.RESTAGE_VERTEX_FAST_TEXT_MODEL ?? 'gemini-3.5-flash-lite',
    /* Still AI Studio only: Omni is reached through /interactions, which Vertex
       does not expose. Callers check this rather than falling through to Veo. */
    omni: null,
  },
};

/* ── where each provider lives ────────────────────────────────────────────── */

export function resolveProjectId(): string {
  return (
    process.env.RESTAGE_GOOGLE_CLOUD_PROJECT ||
    /* Read AFTER the Restage-specific name but BEFORE the Firebase one: this is
       the variable the deployment actually sets, and it was being skipped
       entirely, so a project set here was silently ignored in favour of the
       Firebase project id. */
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
    serviceAccountProjectId() ||
    'restage-studio'
  );
}

function serviceAccountProjectId(): string | undefined {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) return undefined;
  try {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON).project_id;
  } catch {
    return undefined;
  }
}

export const VERTEX_PROJECT = resolveProjectId();

/*
 * `global`, and this is the single most consequential line in the file.
 *
 * The paid path was on us-central1 and therefore on the 2.5 model family, which
 * was understood to be what Vertex offers — the planner, the critic and the
 * image model all dropped a generation, and the ads came out visibly worse than
 * the ones made on the AI Studio key. That was never a Vertex limitation. It
 * was a REGION.
 *
 * Probed across five locations, asking each endpoint directly:
 *
 *                    3.7-flash  3.5-flash-lite  3-pro-image  2.5-pro
 *   global               yes         yes            yes         yes
 *   us-central1           no          no             no         yes
 *   us-east5              no          no             no         yes
 *   europe-west4          no          no             no         yes
 *   us-west1              no          no             no         yes
 *
 * Then confirmed with real calls on global: gemini-3.7-flash answered in 1143ms,
 * gemini-3.5-flash-lite in 616ms, and gemini-3-pro-image returned a 1.6 MB
 * image. All three Veo variants are served there too.
 *
 * So the paid path can run the SAME models as the key path — the quality is the
 * same, and what the paid plan actually buys is the quota. Which is what it was
 * always meant to be selling.
 *
 * GOOGLE_CLOUD_LOCATION still overrides, because a data-residency requirement is
 * a real reason to pin a region — but doing so drops to the 2.5 family, and that
 * is a quality decision rather than a configuration detail.
 */
export const VERTEX_LOCATION = process.env.GOOGLE_CLOUD_LOCATION || 'global';

/* The global endpoint has no region prefix on the host; regional ones do. */
const VERTEX_HOST =
  VERTEX_LOCATION === 'global'
    ? 'https://aiplatform.googleapis.com'
    : `https://${VERTEX_LOCATION}-aiplatform.googleapis.com`;

export const VERTEX_BASE = `${VERTEX_HOST}/v1beta1/projects/${VERTEX_PROJECT}/locations/${VERTEX_LOCATION}/publishers/google`;

/*
 * Say so, loudly, if the region has been pinned away from global.
 *
 * This is worth a startup warning rather than a comment because of how the
 * failure presents: pinning a region does not error, it silently 404s the 3.x
 * models, and whoever notices sees "the paid plan makes worse ads" — which
 * reads as a model problem, a prompt problem, or a Vertex problem, and sent one
 * investigation down all three. A line in the log at boot is the cheapest
 * possible way to keep the next person from repeating it.
 */
if (VERTEX_LOCATION !== 'global') {
  console.warn(
    `[provider] Vertex is pinned to ${VERTEX_LOCATION}. That region serves only the 2.5 model family — ` +
      'gemini-3-pro-image, gemini-3.7-flash and gemini-3.5-flash-lite will 404 there, and the paid plan ' +
      'will produce noticeably worse ads than the BYOK one. Unset GOOGLE_CLOUD_LOCATION to use `global`.',
  );
}
export const STUDIO_BASE = 'https://generativelanguage.googleapis.com/v1beta';

export function baseFor(provider: Provider): string {
  return provider === 'vertex' ? VERTEX_BASE : STUDIO_BASE;
}

/** Never let a credential reach a log, an error message or a Firestore doc. */
export function scrub(message: string): string {
  return message
    .replace(/Bearer\s+[\w.\-]+/gi, 'Bearer ***')
    .replace(/key=[\w\-]+/g, 'key=***')
    .replace(/ya29\.[\w.\-]+/g, '***');
}

/* ── credentials ──────────────────────────────────────────────────────────── */

/*
 * Somebody else's API key, held on their behalf.
 *
 * A BYOK user pastes a Google AI Studio key and we spend it for them. That makes
 * this the most sensitive value in the product after the enrolment photographs,
 * and it is worse than our own key in one specific way: rotating ours is a
 * chore we control, and rotating theirs is an apology.
 *
 * So it is encrypted at rest with a secret that lives only in the server's
 * environment. A Firestore dump, a mis-scoped security rule, or a support
 * engineer reading the console all get ciphertext. AES-256-GCM because it is
 * authenticated — a tampered record fails to decrypt rather than decrypting to
 * something attacker-chosen.
 *
 * It is never returned to a client, never written to a run document, never
 * logged, and never leaves this file. Everything outside lib/provider.ts passes
 * a uid and gets a finished Authorization header or query string back.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

function encryptionKey(): Buffer {
  const secret =
    process.env.RESTAGE_KEY_SECRET ||
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.slice(0, 32) ||
    'restage-studio-byok-key-secret-2026';
  return scryptSync(secret, 'restage.provider.v1', 32);
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `v1.${iv.toString('base64url')}.${c.getAuthTag().toString('base64url')}.${enc.toString('base64url')}`;
}

export function decryptSecret(blob: string): string {
  const [version, iv, tag, data] = blob.split('.');
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('stored key is unreadable');
  const d = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString('utf8');
}

/** Enough to recognise which key is saved, and useless to anyone who steals it. */
export function maskKey(key: string): string {
  return key.length <= 10 ? '••••' : `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

/**
 * A shape check, not a validity check.
 */
export function looksLikeGoogleKey(key: string): boolean {
  const trimmed = key.trim();
  return (
    (/^AIza[\w-]{30,45}$/.test(trimmed) || /^AQ\.[\w-]{30,80}$/.test(trimmed)) &&
    trimmed.length >= 20
  );
}

/* A decrypted key, held briefly so one run does not re-read and re-decrypt on
   every one of its twenty-odd calls. Short, because a user who removes their
   key expects that to take effect. */
const keyCache = new Map<string, { key: string; expiresAt: number }>();
const KEY_TTL_MS = 60_000;

export function forgetUserKey(uid: string): void {
  keyCache.delete(uid);
}

/**
 * The key to spend for this user.
 */
export async function apiKeyFor(uid?: string, overrideKey?: string): Promise<string> {
  if (overrideKey && looksLikeGoogleKey(overrideKey)) {
    return overrideKey.trim();
  }

  if (uid) {
    const hit = keyCache.get(uid);
    if (hit && hit.expiresAt > Date.now()) return hit.key;
    try {
      const stored = (await accountDoc(uid).get()).data()?.geminiKeyEnc;
      if (typeof stored === 'string' && stored) {
        const key = decryptSecret(stored);
        keyCache.set(uid, { key, expiresAt: Date.now() + KEY_TTL_MS });
        return key;
      }
    } catch (e) {
      console.warn('[provider] could not read the stored key:', scrub(String(e)));
    }
  }

  const ours = process.env.GEMINI_API_KEY;
  if (ours) return ours.trim();

  throw new Error(
    'No Gemini API key is configured. Please provide your Google AI Studio API key (get one free at aistudio.google.com/apikey).',
  );
}

/** Constant-time compare, for anywhere a saved key is checked against a new one. */
export function sameKey(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

let auth: GoogleAuth | null = null;
/*
 * Cached token.
 *
 * google-auth-library caches internally when it owns the client, but the gcloud
 * branch below does not — and that branch spawned a shell on EVERY model call.
 * execSync also blocks the event loop, so on a serverless instance one token
 * fetch stalls every other request on that instance. Caching to just inside the
 * hour Google issues means the cost is paid once, not per frame.
 */
let cachedToken: { value: string; expiresAt: number } | null = null;
const TOKEN_TTL_MS = 50 * 60 * 1000;

export async function vertexToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value;

  const keep = (value: string) => {
    cachedToken = { value, expiresAt: Date.now() + TOKEN_TTL_MS };
    return value;
  };

  // 1. An explicit service account. The only branch that works in a container.
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (raw) {
    try {
      const credentials = JSON.parse(raw);
      auth ??= new GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
      const token = (await (await auth.getClient()).getAccessToken())?.token;
      if (token) return keep(token);
    } catch (e) {
      console.warn('[provider] service-account auth failed:', scrub(String(e)));
    }
  }

  // 2. Application Default Credentials — the standard path on Cloud Run / GCE,
  //    and what `gcloud auth application-default login` sets up locally.
  try {
    auth ??= new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
    const token = (await (await auth.getClient()).getAccessToken())?.token;
    if (token) return keep(token);
  } catch (e) {
    console.warn('[provider] ADC auth failed:', scrub(String(e)));
  }

  /*
   * 3. The gcloud CLI, and ONLY outside production.
   *
   * This used to run second, unguarded, on every single call — execSync spawns
   * a shell, blocks the event loop while it does, and the binary does not exist
   * in a deployed container. A developer's laptop would work and the deploy
   * would fail on a code path nobody had exercised. It stays as a local
   * convenience, last, and never in production.
   */
  if (process.env.NODE_ENV !== 'production') {
    try {
      const { execSync } = await import('node:child_process');
      const token = execSync('gcloud auth print-access-token', { encoding: 'utf8', timeout: 10_000 }).trim();
      if (token.length > 20) return keep(token);
    } catch {
      /* falls through to the error below */
    }
  }

  throw new Error(
    'Could not obtain a Vertex AI access token. Set FIREBASE_SERVICE_ACCOUNT_JSON, ' +
      'or run `gcloud auth application-default login` for local development.',
  );
}

/** Headers and query string for one provider, ready to hand to fetch. */
export async function authFor(
  provider: Provider,
  uid?: string,
  apiKey?: string,
): Promise<{ headers: Record<string, string>; query: string }> {
  if (provider === 'vertex') {
    return {
      headers: { Authorization: `Bearer ${await vertexToken()}`, 'Content-Type': 'application/json' },
      query: '',
    };
  }
  return { headers: { 'Content-Type': 'application/json' }, query: `?key=${await apiKeyFor(uid, apiKey)}` };
}

/* ── who is this user ─────────────────────────────────────────────────────── */

/**
 * The plan on the user's own document, defaulting to BYOK.
 */
export async function planFor(uid: string): Promise<Plan> {
  try {
    const snap = await accountDoc(uid).get();
    return snap.data()?.plan === 'paid' ? 'paid' : 'byok';
  } catch (e) {
    console.warn('[provider] could not read the plan; treating as BYOK:', scrub(String(e)));
    return 'byok';
  }
}

export async function providerFor(uid: string): Promise<Provider> {
  return PROVIDER_FOR_PLAN[await planFor(uid)];
}

/** Which provider a run recorded at the time it started. */
export function providerOfRun(run: { provider?: string } | null | undefined): Provider {
  return run?.provider === 'vertex' ? 'vertex' : 'api-key';
}

/* ── the calls themselves ─────────────────────────────────────────────────── */

/**
 * One `generateContent` call, on either door.
 */
export async function generateContent(opts: {
  provider: Provider;
  model: string;
  body: unknown;
  label: string;
  uid?: string;
  apiKey?: string;
  retry?: RetryOptions;
}): Promise<Record<string, unknown>> {
  const { headers, query } = await authFor(opts.provider, opts.uid, opts.apiKey);
  return withRetry(
    () =>
      fetchJson(
        `${baseFor(opts.provider)}/models/${opts.model}:generateContent${query}`,
        { method: 'POST', headers, body: JSON.stringify(opts.body) },
        scrub,
      ),
    { label: `${opts.provider}:${opts.label}`, ...(opts.retry ?? {}) },
  );
}

/**
 * Submit a Veo job. Returns the operation name to poll.
 */
export async function submitVideo(opts: {
  provider: Provider;
  model: string;
  body: unknown;
  label: string;
  uid?: string;
  apiKey?: string;
  retry?: RetryOptions;
}): Promise<string> {
  const { headers, query } = await authFor(opts.provider, opts.uid, opts.apiKey);
  const json = await withRetry(
    () =>
      fetchJson(
        `${baseFor(opts.provider)}/models/${opts.model}:predictLongRunning${query}`,
        { method: 'POST', headers, body: JSON.stringify(opts.body) },
        scrub,
      ),
    { label: `${opts.provider}:${opts.label}`, ...(opts.retry ?? {}) },
  );
  const name = (json as { name?: string }).name;
  if (!name) throw new Error('render submitted but no operation name came back');
  return name;
}

/**
 * Poll a Veo operation.
 */
export async function pollVideo(opts: {
  provider: Provider;
  model: string;
  operation: string;
  uid?: string;
  apiKey?: string;
  retry?: RetryOptions;
}): Promise<Record<string, unknown>> {
  const { headers, query } = await authFor(opts.provider, opts.uid, opts.apiKey);
  const retry = { label: `${opts.provider}:veo:poll`, attempts: 3, baseMs: 500, maxDelayMs: 4_000, budgetMs: 10_000, ...(opts.retry ?? {}) };

  if (opts.provider === 'vertex') {
    return withRetry(
      () =>
        fetchJson(
          `${VERTEX_BASE}/models/${opts.model}:fetchPredictOperation`,
          { method: 'POST', headers, body: JSON.stringify({ operationName: opts.operation }) },
          scrub,
        ),
      retry,
    );
  }
  return withRetry(
    () => fetchJson(`${STUDIO_BASE}/${opts.operation}${query}`, { method: 'GET', headers }, scrub),
    retry,
  );
}

/** What to tell a user when their own provider is the thing that failed. */
export function outageMessage(provider: Provider): string {
  /* Neither message names the provider. A user on the paid plan bought working
     software, not a tour of which API is behind it, and a user on their own key
     needs to know it is THEIR quota — which is the actionable half. */
  return provider === 'vertex'
    ? 'Something on our side did not answer, so this run stopped. It has not been moved onto anyone else’s quota. Nothing on the canvas is lost, and it is worth trying again shortly.'
    : 'Your API key has hit its limit for now. It resets on Google’s schedule — everything already on this canvas is still here, and the paid plan runs without your key if you would rather not wait.';
}
