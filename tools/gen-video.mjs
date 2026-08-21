#!/usr/bin/env node
/*
 * Render a video with Veo, straight against Google — no aggregator in between.
 *
 * This exists because the open-source UGC studios on GitHub (Open-AI-UGC,
 * open-generative-ai) are wrappers around Muapi, a paid third-party aggregator.
 * Adopting one would put a middleman between us and a model we already reach
 * directly, add a subscription, and route every user's face through somebody
 * else's servers. The whole direct path is the ~90 lines below.
 *
 * Keys are read from an env var or a .env the caller points at. They are never
 * written into this repo, never sent anywhere but Google, and never printed —
 * the request URL carries the key, so nothing here logs a URL.
 *
 *   node tools/gen-video.mjs --out ad.mp4 --prompt "..." \
 *     --image frame.jpg --aspect 9:16 --key-from ~/path/.env
 */
import { writeFileSync, readFileSync, mkdirSync } from 'fs';
import { dirname, extname } from 'path';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : argv[i + 1]; };

const out = arg('out');
const prompt = arg('prompt');
const image = arg('image');          // the approved frame becomes frame one
const aspect = arg('aspect', '9:16');
const model = arg('model', 'veo-3.1-fast-generate-preview');
if (!out || !prompt) {
  console.error('usage: --out <file.mp4> --prompt <text> [--image frame.jpg] [--aspect 9:16]');
  process.exit(1);
}

let key = process.env.GEMINI_API_KEY;
const keyFrom = arg('key-from');
if (!key && keyFrom) {
  const line = readFileSync(keyFrom.replace(/^~/, process.env.HOME), 'utf8')
    .split('\n').find((l) => /^GEMINI_API_KEY=/.test(l));
  if (line) key = line.slice(line.indexOf('=') + 1).replace(/^["']|["']$/g, '').trim();
}
if (!key) { console.error('no GEMINI_API_KEY (set the env var or pass --key-from)'); process.exit(1); }

const base = 'https://generativelanguage.googleapis.com/v1beta';
const mimeOf = (f) => ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' }[extname(f).toLowerCase()] ?? 'image/jpeg');

const instance = { prompt };
if (image) {
  instance.image = { bytesBase64Encoded: readFileSync(image).toString('base64'), mimeType: mimeOf(image) };
}

const submit = await fetch(`${base}/models/${model}:predictLongRunning?key=${key}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ instances: [instance], parameters: { aspectRatio: aspect } }),
});
const job = await submit.json();
if (!submit.ok) { console.error('submit failed:', job?.error?.message ?? submit.status); process.exit(1); }

const opName = job.name;
console.log(`submitted (${aspect}) — polling`);

// Veo is a long-running operation: submit, then poll. Measured at ~41s for a
// fast-model clip, which is why the plan runs on still frames and only the
// approved one is ever rendered.
const startedAt = Date.now();
let done = null;
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 5000));
  const res = await fetch(`${base}/${opName}?key=${key}`);
  const op = await res.json();
  if (op.error) { console.error('render failed:', op.error.message); process.exit(1); }
  if (op.done) { done = op; break; }
}
if (!done) { console.error('still not finished after 5 minutes'); process.exit(1); }

const samples = done.response?.generateVideoResponse?.generatedSamples
  ?? done.response?.generatedSamples ?? [];
const uri = samples[0]?.video?.uri;
if (!uri) { console.error('no video in the finished job'); process.exit(1); }

// The download URI needs the key too; append rather than log.
const file = await fetch(`${uri}${uri.includes('?') ? '&' : '?'}key=${key}`);
if (!file.ok) { console.error('download failed:', file.status); process.exit(1); }
const buf = Buffer.from(await file.arrayBuffer());

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, buf);
console.log(`${out} — ${(buf.length / 1024 / 1024).toFixed(1)} MB in ${((Date.now() - startedAt) / 1000).toFixed(0)}s`);
