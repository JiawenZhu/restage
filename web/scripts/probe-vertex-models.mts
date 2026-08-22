/*
 * Which models does Vertex ACTUALLY serve for this project?
 *
 * The paid path was built on gemini-2.5-flash across the board, on the advice
 * that it is the model without usage limits. That advice decided the planner,
 * the critic and the identity verifier — and the planner is what writes every
 * prompt the image and video models are given, so if it is the weaker model
 * then everything downstream inherits that, and no amount of Veo quality
 * rescues a badly-written shot.
 *
 * The question is therefore not "which model has quota" but "is the good model
 * even unavailable here". Nobody had checked. This checks.
 *
 * It asks for MODEL METADATA, not generations: a GET on the publisher model
 * resource says whether the model exists on this endpoint and costs nothing.
 * Only the text models are then given one real, tiny call to prove they answer
 * — Veo is never invoked, because submitting a video job to find out costs a
 * clip.
 *
 *   npx tsx scripts/probe-vertex-models.mts
 */
import { readFileSync } from 'node:fs';
for (const l of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && m[2].trim()) process.env[m[1]] ??= m[2].trim().replace(/^["']|["']$/g, '');
}

const { vertexToken, VERTEX_BASE, VERTEX_PROJECT, VERTEX_LOCATION, scrub } = await import('../lib/provider');

const TEXT = [
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3-pro',
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
];
const IMAGE = [
  'gemini-3-pro-image',
  'gemini-3-pro-image-preview',
  'gemini-2.5-flash-image',
  'imagen-4.0-generate-001',
];
const VIDEO = [
  'veo-3.1-generate-001',
  'veo-3.1-fast-generate-001',
  'veo-3.1-fast-generate-preview',
  'veo-3.0-generate-001',
  'veo-3.0-fast-generate-001',
];

const token = await vertexToken();
const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

console.log(`project ${VERTEX_PROJECT} · location ${VERTEX_LOCATION}\n`);

/*
 * Does this model exist here, WITHOUT generating anything?
 *
 * A GET on the publisher-model resource looked like the clean way to ask and is
 * not: Vertex 404s that path for every model, including ones that demonstrably
 * work, so it answers "no" universally and means nothing. (Caught because
 * gemini-2.5-flash — the model the paid path runs on right now — came back 404
 * from a probe run seconds after a real call to it had succeeded.)
 *
 * So ask the generation endpoint with a DELIBERATELY EMPTY body and read which
 * refusal comes back. A model that is not served answers 404 NOT_FOUND. A model
 * that is served gets far enough to validate the request and answers 400. Both
 * are free: nothing is generated either way.
 */
async function exists(model: string, method: string): Promise<{ ok: boolean; note: string }> {
  try {
    const res = await fetch(`${VERTEX_BASE}/models/${model}:${method}`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({}),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string; status?: string } };
    const msg = scrub(body.error?.message ?? '').slice(0, 68);
    if (res.status === 404) return { ok: false, note: `404 not served here` };
    if (res.status === 400) return { ok: true, note: `served (400 on empty body: ${msg.slice(0, 42)})` };
    return { ok: res.ok, note: `${res.status} ${msg}` };
  } catch (e) {
    return { ok: false, note: scrub(String(e)).slice(0, 68) };
  }
}

/** One real, minimal call. Only for text — a video probe costs a clip. */
async function answers(model: string): Promise<{ ok: boolean; ms: number; note: string }> {
  const t0 = Date.now();
  try {
    const res = await fetch(`${VERTEX_BASE}/models/${model}:generateContent`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Reply with exactly: OK' }] }] }),
    });
    const body = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) {
      return { ok: false, ms: Date.now() - t0, note: `${res.status} ${scrub(body?.error?.message ?? '').slice(0, 64)}` };
    }
    const text = (body.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim().slice(0, 20);
    return { ok: true, ms: Date.now() - t0, note: text };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, note: scrub(String(e)).slice(0, 64) };
  }
}

async function section(title: string, models: string[], call: boolean, method = 'generateContent') {
  console.log(`\n════ ${title} ════\n`);
  for (const m of models) {
    const e = await exists(m, method);
    if (!e.ok) {
      console.log(`  ✗  ${m.padEnd(32)} ${e.note}`);
      continue;
    }
    if (!call) {
      console.log(`  ✓  ${m.padEnd(32)} exists`);
      continue;
    }
    const a = await answers(m);
    console.log(`  ${a.ok ? '✓' : '✗'}  ${m.padEnd(32)} ${a.ok ? `${String(a.ms).padStart(5)}ms  ${a.note}` : a.note}`);
  }
}

await section('TEXT — planner, critic, identity verifier', TEXT, true);
await section('IMAGE — storyboard frames', IMAGE, false);
await section('VIDEO — Veo (empty-body probe; nothing is generated)', VIDEO, false, 'predictLongRunning');

console.log(
  '\nA ✓ on the metadata line means the model is served here. It does NOT prove the\n' +
    'quota is generous — that is a separate question, answered by the console — but\n' +
    'a ✗ settles it: that model is not an option on this endpoint at all.',
);
