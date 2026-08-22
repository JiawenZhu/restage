/*
 * Does detail actually decay along the edit chain?
 *
 * Every step edits the frame before it, so step 6 is six generations of
 * re-encoding away from the enrolment photo. The claim worth testing is that
 * this is lossy in the ordinary photocopy sense — that each pass throws away
 * high-frequency detail, and the face gets softer and less specific the further
 * down the chain it sits.
 *
 * Measured as variance of the Laplacian over the upper-middle of the frame,
 * which is where a vertical UGC shot puts a head. High variance means crisp
 * edges — pores, lashes, hair strands, the rim of a glasses frame. Low variance
 * means those edges have been averaged away. Computed at native resolution,
 * because downscaling first would destroy the exact thing being measured.
 *
 *   npx tsx scripts/diag-chain.mts <runId>
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
for (const l of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && m[2].trim()) process.env[m[1]] ??= m[2].trim().replace(/^["']|["']$/g, '');
}
const { adminDb, adminStorage } = await import('../lib/firebaseAdmin');
const { execFile } = await import('node:child_process');
const { promisify } = await import('node:util');
const exec = promisify(execFile);

const runId = process.argv[2];
if (!runId) throw new Error('usage: diag-chain.mts <runId>');

mkdirSync('/tmp/rschain', { recursive: true });

const snap = await adminDb().collection('runs').doc(runId).collection('nodes').orderBy('createdAt').get();
const nodes = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) })) as any[];

/** Walk parent links to get true generation depth from the avatar. */
function depthOf(id: string): number {
  let d = 0;
  let cur = nodes.find((n) => n.id === id);
  while (cur && cur.parentId) {
    cur = nodes.find((n) => n.id === cur.parentId);
    d++;
  }
  return d;
}

/** Variance of the Laplacian over the head region, at native resolution. */
async function detail(file: string): Promise<{ w: number; h: number; lap: number }> {
  const { stdout: dim } = await exec('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file,
  ]);
  const [w, h] = dim.trim().split(',').map(Number);

  /* Crop the middle 60% across and the top 55% down — the head.
     Even dimensions, because ffmpeg quietly adjusts odd ones and the rawvideo
     buffer then no longer matches the width this loop indexes by: every read
     lands one pixel further out of alignment per row, and the variance comes
     back NaN off the end of the buffer. */
  const cw = Math.round((w * 0.6) / 2) * 2;
  const ch = Math.round((h * 0.55) / 2) * 2;
  const raw = `/tmp/rschain/${Math.random().toString(36).slice(2)}.gray`;
  await exec('ffmpeg', [
    '-v', 'error', '-y', '-i', file,
    '-vf', `crop=${cw}:${ch}:${Math.round((w * 0.2) / 2) * 2}:0,format=gray`,
    '-f', 'rawvideo', raw,
  ]);
  const buf = readFileSync(raw);
  if (buf.length !== cw * ch) {
    throw new Error(`gray buffer is ${buf.length}, expected ${cw}x${ch}=${cw * ch}`);
  }

  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < ch - 1; y++) {
    for (let x = 1; x < cw - 1; x++) {
      const i = y * cw + x;
      const v = 4 * buf[i] - buf[i - 1] - buf[i + 1] - buf[i - cw] - buf[i + cw];
      sum += v;
      sumSq += v * v;
      n++;
    }
  }
  const mean = sum / n;
  return { w, h, lap: sumSq / n - mean * mean };
}

const frames = nodes.filter((n) => (n.kind === 'avatar' || n.kind === 'frame') && n.frameUrl && !n.discarded);

console.log('generation loss along the edit chain\n');
console.log('depth  step  node                  size        detail (var of Laplacian)');

const rows: { depth: number; lap: number }[] = [];
for (const n of frames.sort((a, b) => depthOf(a.id) - depthOf(b.id))) {
  const f = `/tmp/rschain/${String(n.id).slice(0, 8)}.jpg`;
  try {
    const res = await fetch(n.frameUrl as string);
    if (!res.ok) continue;
    writeFileSync(f, Buffer.from(await res.arrayBuffer()));
    const d = await detail(f);
    const dep = depthOf(n.id);
    rows.push({ depth: dep, lap: d.lap });
    const bar = '█'.repeat(Math.max(1, Math.round(d.lap / 12)));
    console.log(
      `  ${String(dep).padEnd(5)}${String(n.stepNo ?? '-').padEnd(6)}${String(n.id).slice(0, 20).padEnd(22)}` +
      `${d.w}x${String(d.h).padEnd(6)} ${d.lap.toFixed(1).padStart(7)}  ${bar}`,
    );
  } catch (e) {
    console.log(`  ${String(n.id).slice(0, 20)}  ERROR ${(e as Error).message.slice(0, 60)}`);
  }
}

if (rows.length > 1) {
  const first = rows[0].lap;
  const deepest = rows[rows.length - 1].lap;
  console.log(
    `\n  depth ${rows[0].depth} → ${rows[rows.length - 1].depth}: ` +
    `${first.toFixed(1)} → ${deepest.toFixed(1)}  (${(((deepest - first) / first) * 100).toFixed(0)}%)`,
  );
}
process.exit(0);
