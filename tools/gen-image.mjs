#!/usr/bin/env node
/*
 * Generate an image with Gemini and write it to disk.
 *
 * The key is read from an env var or from a .env the caller points at — it is
 * never written into this repo and never printed. Pass --key-from to borrow one
 * that already exists elsewhere on the machine.
 *
 * --ref carries reference images into the request (repeatable). That is how the
 * same face survives across every frame of a scene: generate the avatar once,
 * then pass it as a ref to everything downstream. Without it each generation
 * invents a new person and the whole premise falls apart.
 *
 *   node tools/gen-image.mjs --out frame.jpg --prompt "..." \
 *     --ref avatar-front.jpg --key-from ~/Developer/careervivid/.env
 */
import { writeFileSync, readFileSync, mkdirSync } from 'fs';
import { dirname, extname } from 'path';

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const argAll = (name) =>
  argv.reduce((acc, v, i) => (v === `--${name}` && argv[i + 1] ? [...acc, argv[i + 1]] : acc), []);

const out = arg('out');
const prompt = arg('prompt');
const model = arg('model', 'gemini-3-pro-image');
const aspect = arg('aspect', '4:3');
const refs = argAll('ref');
if (!out || !prompt) {
  console.error('usage: --out <file> --prompt <text> [--ref img]... [--model m] [--aspect 4:3]');
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

const mimeOf = (f) => ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }[extname(f).toLowerCase()] ?? 'image/jpeg');

const parts = [
  ...refs.map((f) => ({ inlineData: { mimeType: mimeOf(f), data: readFileSync(f).toString('base64') } })),
  { text: prompt },
];

const res = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
  {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: aspect } },
    }),
  },
);

const json = await res.json();
if (!res.ok) {
  console.error('gemini error:', json?.error?.message ?? res.status);
  process.exit(1);
}

const img = json?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
if (!img) {
  console.error('no image returned:', json?.candidates?.[0]?.finishReason ?? 'empty response');
  process.exit(1);
}

const buf = Buffer.from(img.inlineData.data, 'base64');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, buf);
console.log(`${out} — ${(buf.length / 1024).toFixed(0)} KB${refs.length ? ` (${refs.length} ref)` : ''}`);
