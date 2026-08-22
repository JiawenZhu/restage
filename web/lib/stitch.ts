/*
 * Longer clips, from segments the model can actually make.
 *
 * Veo's ceiling is 8 seconds — its own words when asked for more: "Please
 * provide a value between 4 and 8, inclusive." So a 16 or 24 second ad is
 * several renders joined, and the join has to preserve continuity or it reads
 * as a cut rather than a shot.
 *
 * The chaining trick is the product's own: Veo takes a FIRST FRAME, and the
 * last frame of segment N is a perfectly good first frame for segment N+1. The
 * person, the room and the light carry across because the next segment is
 * literally starting from where the previous one stopped.
 *
 * The concat itself follows a lesson taken from MoneyPrinterTurbo (MIT), which
 * says it plainly in its own comment: join once with the ffmpeg concat demuxer
 * rather than merging segment-by-segment, because repeated re-encoding degrades
 * the picture and shifts colour. Their codec-fallback handling is the same
 * shape as well — an encoder appearing in `ffmpeg -encoders` proves it was
 * compiled in, not that this machine can run it, so a runtime failure has to
 * fall back and be remembered rather than retried for every segment.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

const DEFAULT_CODEC = 'libx264';
/** Encoders that failed at runtime in this process. See the note above. */
const disabledCodecs = new Set<string>();

async function encoderUsable(codec: string): Promise<boolean> {
  if (codec === DEFAULT_CODEC) return true;
  if (disabledCodecs.has(codec)) return false;
  try {
    const { stdout } = await run('ffmpeg', ['-hide_banner', '-encoders'], { timeout: 10_000 });
    return stdout.includes(codec);
  } catch {
    return false;
  }
}

/**
 * The final frame of a clip, as JPEG bytes — the seed for the next segment.
 *
 * `-sseof` seeks from the end, which is far cheaper than decoding the whole
 * file to reach the last frame.
 */
export async function lastFrameOf(video: Buffer): Promise<{ data: Buffer; mimeType: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'restage-tail-'));
  try {
    const src = join(dir, 'in.mp4');
    const out = join(dir, 'tail.jpg');
    await writeFile(src, video);
    await run('ffmpeg', ['-y', '-loglevel', 'error', '-sseof', '-0.2', '-i', src, '-frames:v', '1', '-q:v', '2', out]);
    return { data: await readFile(out), mimeType: 'image/jpeg' };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Join segments into one clip, encoding once.
 *
 * @param maxSeconds trims the result, so a request for 15s from two 8s segments
 *        returns 15 and not 16.
 */
export async function stitch(segments: Buffer[], maxSeconds?: number): Promise<Buffer> {
  if (!segments.length) throw new Error('nothing to stitch');
  if (segments.length === 1) return segments[0];

  const dir = await mkdtemp(join(tmpdir(), 'restage-stitch-'));
  try {
    const files: string[] = [];
    for (const [i, bytes] of segments.entries()) {
      const p = join(dir, `seg-${i}.mp4`);
      await writeFile(p, bytes);
      files.push(p);
    }

    // The concat demuxer reads paths from a file; single quotes in a path would
    // break the format, so they are escaped the way ffmpeg expects.
    const listPath = join(dir, 'list.txt');
    await writeFile(listPath, files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'));

    const out = join(dir, 'joined.mp4');
    const build = (codec: string) => [
      '-y', '-loglevel', 'error',
      '-f', 'concat', '-safe', '0', '-i', listPath,
      '-c:v', codec,
      '-pix_fmt', 'yuv420p',
      ...(maxSeconds ? ['-t', maxSeconds.toFixed(3)] : []),
      out,
    ];

    const preferred = process.env.RESTAGE_VIDEO_CODEC ?? DEFAULT_CODEC;
    const codec = (await encoderUsable(preferred)) ? preferred : DEFAULT_CODEC;

    try {
      await run('ffmpeg', build(codec));
    } catch (err) {
      if (codec === DEFAULT_CODEC) throw err;
      // Compiled in but not runnable here. Remember it, so the rest of this
      // process stops paying for the same discovery.
      disabledCodecs.add(codec);
      console.warn(`[stitch] ${codec} failed at runtime, falling back to ${DEFAULT_CODEC}`);
      await run('ffmpeg', build(DEFAULT_CODEC));
    }

    return await readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** How many 8s segments a requested length needs. */
export function segmentsFor(seconds: number, perSegment = 8): number {
  return Math.max(1, Math.ceil(seconds / perSegment));
}
