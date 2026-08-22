/*
 * Pull the rendered clips for a run and look at the FACE, frame by frame.
 *
 * "The lower half of the face is badly deformed" is a claim about motion, and
 * motion is exactly what a still cannot show. This extracts frames across each
 * clip so the drift is visible as a sequence, and crops the upper-middle of the
 * frame where a vertical UGC shot puts the head.
 *
 *   npx tsx scripts/diag-video.mts <runId>
 */
import { readFileSync, mkdirSync } from 'node:fs';
for (const l of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && m[2].trim()) process.env[m[1]] ??= m[2].trim().replace(/^["']|["']$/g, '');
}
const { adminDb } = await import('../lib/firebaseAdmin');
const { signedVideoUrl } = await import('../lib/r2');
const { execFile } = await import('node:child_process');
const { promisify } = await import('node:util');
const exec = promisify(execFile);

const runId = process.argv[2];
if (!runId) throw new Error('usage: diag-video.mts <runId>');

const snap = await adminDb().collection('runs').doc(runId).collection('nodes').get();
const vids = snap.docs
  .map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }))
  .filter((n) => n.kind === 'video' && n.videoKey)
  .sort((a, b) => (a.createdAt as number) - (b.createdAt as number));

mkdirSync('/tmp/rsvid', { recursive: true });
console.log(`${vids.length} rendered clip(s)\n`);

for (const v of vids) {
  const short = String(v.id).slice(0, 8);
  const mp4 = `/tmp/rsvid/${short}.mp4`;
  try {
    const url = await signedVideoUrl(v.videoKey as string, 600);
    const res = await fetch(url);
    if (!res.ok) {
      console.log(`${short}  DOWNLOAD FAILED ${res.status}`);
      continue;
    }
    const { writeFileSync } = await import('node:fs');
    writeFileSync(mp4, Buffer.from(await res.arrayBuffer()));

    const { stdout } = await exec('ffprobe', [
      '-v', 'error',
      '-show_entries', 'stream=codec_type,width,height,r_frame_rate',
      '-show_entries', 'format=duration,size',
      '-of', 'default=noprint_wrappers=1',
      mp4,
    ]);
    const g = (k: string) => stdout.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1] ?? '?';

    console.log(
      `${short}  engine=${String(v.engine ?? 'veo').padEnd(5)} shots=${String(v.shotCount ?? '?').padEnd(2)} ` +
      `${g('width')}x${g('height')}  ${Number(g('duration')).toFixed(2)}s  ${(Number(g('size')) / 1e6).toFixed(1)}MB`,
    );
    console.log(`          ${String(v.instruction ?? '').slice(0, 70)}`);

    /*
     * A contact sheet of the head region across the whole clip.
     *
     * Cropped rather than whole-frame on purpose: at 720p a full frame in a
     * six-up tile is ~240px wide, which is too small to see a jaw distort. The
     * crop takes the middle 60% horizontally and the top 55% vertically, which
     * is where a vertical UGC framing puts a head.
     */
    const dur = Number(g('duration')) || 8;
    await exec('ffmpeg', [
      '-v', 'error', '-y', '-i', mp4,
      '-vf', `fps=${(6 / dur).toFixed(3)},crop=iw*0.6:ih*0.55:iw*0.2:0,scale=320:-1,tile=3x2`,
      '-frames:v', '1',
      `/tmp/rsvid/${short}_faces.jpg`,
    ]);
    console.log(`          contact sheet → /tmp/rsvid/${short}_faces.jpg\n`);
  } catch (e) {
    console.log(`${short}  ERROR ${(e as Error).message.slice(0, 120)}\n`);
  }
}
process.exit(0);
