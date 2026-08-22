/*
 * Generates one short preview clip per creative template.
 *
 * These are marketing assets, not user data: they show a stock person, never an
 * enrolled face, so they can live in public/ and be served without auth or a
 * signed URL. A template is understood in one second of motion; the alternative
 * is asking a user to read four paragraphs of prose to guess what they'd get.
 *
 * Run: npx tsx scripts/make-template-previews.mts [templateId ...]
 * Existing files are skipped, so an interrupted run resumes for free.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && m[2].trim()) process.env[m[1]] ??= m[2].trim().replace(/^["']|["']$/g, '');
}

const { generateFrame, submitRender, pollRender, downloadRendered } = await import('../lib/gemini');
const { CREATIVE_TEMPLATES } = await import('../lib/templates');

const OUT = new URL('../public/templates/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const LOCK = join(OUT, '.generating');
if (existsSync(LOCK)) {
  const age = (Date.now() - statSync(LOCK).mtimeMs) / 1000;
  if (age < 900) {
    console.error(`another generator has been running for ${age.toFixed(0)}s — refusing to double-spend`);
    process.exit(1);
  }
  console.log('stale lock, taking over');
}
writeFileSync(LOCK, String(process.pid));
const release = () => { try { unlinkSync(LOCK); } catch {} };
process.on('exit', release);
process.on('SIGINT', () => { release(); process.exit(130); });
process.on('SIGTERM', () => { release(); process.exit(143); });

const only = process.argv.slice(2);
const targets = only.length ? CREATIVE_TEMPLATES.filter((t) => only.includes(t.id)) : CREATIVE_TEMPLATES;

const t0 = Date.now();
const stamp = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;

// A described stock person rather than a real one: the preview must not imply a
// specific creator, and must not use anybody's enrolled likeness.
const STOCK =
  'A friendly person in their late twenties with shoulder-length dark hair, ' +
  'neutral casual clothing, natural unretouched skin';

for (const t of targets) {
  const mp4 = join(OUT, `${t.id}.mp4`);
  const jpg = join(OUT, `${t.id}.jpg`);
  if (existsSync(mp4) && existsSync(jpg)) {
    console.log(`${stamp()}  ${t.id}: already made, skipping`);
    continue;
  }

  try {
    console.log(`${stamp()}  ${t.id}: frame…`);
    const frame = await generateFrame({
      prompt:
        `${STOCK}. ${t.defaultPrompt}\n` +
        `Camera: ${t.cameraMotion}\n` +
        `Light and colour: ${t.lightingAndColor}\n` +
        `Detail: ${t.secondaryPhysics}\n` +
        `Vertical 9:16 phone-shot creator content. Realistic. No text, no logos, no watermarks.`,
      aspect: '9:16',
      refs: [],
    });
    writeFileSync(jpg, frame.bytes);

    console.log(`${stamp()}  ${t.id}: video…`);
    const { operation } = await submitRender({
      prompt:
        `Animate this frame into a short looping clip in the "${t.name}" style. ` +
        `${t.cameraMotion} The subject moves naturally. Keep the look and the face consistent. No text.`,
      firstFrame: { data: frame.bytes, mimeType: frame.mimeType },
      aspect: '9:16',
    });

    let uri: string | null = null;
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const st = await pollRender(operation);
      if (st.done) {
        if ('error' in st) throw new Error(st.error);
        uri = st.videoUri;
        break;
      }
    }
    if (!uri) throw new Error('render timed out');

    const bytes = await downloadRendered(uri);

    // Veo returns ~4MB per clip. Ten of those is 44MB of repo and a gallery that
    // stalls before it can show anything. These are muted, looping, thumbnail-
    // sized previews, so they get encoded for that job: 480px wide, no audio
    // track at all, and faststart so the first frame paints before the rest
    // arrives.
    const raw = join(OUT, `${t.id}.raw.mp4`);
    writeFileSync(raw, bytes);
    execFileSync('ffmpeg', [
      '-y', '-loglevel', 'error', '-i', raw,
      '-vf', 'scale=480:-2',
      '-c:v', 'libx264', '-crf', '30', '-preset', 'slow',
      '-movflags', '+faststart',
      '-an',
      mp4,
    ]);
    unlinkSync(raw);

    // The poster is what shows before the clip plays, so it must be small too.
    execFileSync('ffmpeg', [
      '-y', '-loglevel', 'error', '-i', mp4,
      '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '6',
      jpg,
    ]);

    const before = bytes.length / 1024 / 1024;
    const after = statSync(mp4).size / 1024 / 1024;
    console.log(`${stamp()}  ${t.id}: ✅ ${before.toFixed(1)} MB -> ${after.toFixed(2)} MB`);
  } catch (err) {
    // One template failing must not cost the other nine.
    console.error(`${stamp()}  ${t.id}: ❌ ${err instanceof Error ? err.message : err}`);
  }
}

console.log(`${stamp()}  done`);
process.exit(0);
