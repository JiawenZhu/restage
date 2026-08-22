/*
 * Footage in, finished ad out.
 *
 * Extract the clip to frames, build a timeline over them, render it back with
 * the saas-commercial-video pipeline, and put the voiceover underneath.
 *
 * Why frames and not an ffmpeg drawtext filter, which would be simpler: because
 * the timeline is CODE. Retiming a caption, restyling the plate, adding an end
 * card or a second brand mark is an edit and a re-render — not a new filter
 * graph guessed at from the outside. It also means captions get real easing and
 * real safe-area awareness rather than being burned in at a fixed position.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { buildAdTimeline, type AdCaption } from './adTimeline';

const run = promisify(execFile);

/** Where the skill's renderer lives. Overridable, because it is not in this repo. */
const RENDERER =
  process.env.RESTAGE_RENDERER ??
  join(process.env.HOME ?? '', '.claude/skills/saas-commercial-video/scripts/render.mjs');

export interface FinishOptions {
  clip: Buffer;
  /** LINEAR16 WAV. Optional — a silent ad is still a finished ad. */
  voice?: Buffer;
  captions: AdCaption[];
  kicker?: string;
  endCard?: { headline: string; sub?: string };
  /** 30 is plenty for social and halves the frame count against 60. */
  fps?: number;
}

export interface FinishResult {
  video: Buffer;
  /** Unique-frame ratio from mpdecimate. The pipeline's own health check: a
   *  small fraction means frames are being repeated rather than animated. */
  uniqueFrameRatio: number;
  frames: number;
}

/**
 * Whether finishing can run here at all.
 *
 * The renderer needs Playwright and a Chromium download — roughly 150MB, and it
 * does not run in most serverless environments. So this is a capability the
 * deployment either has or does not, and the honest thing is to check rather
 * than to fail halfway through a paid render. When it is absent the clip still
 * ships; it just ships without captions.
 */
export async function canFinish(): Promise<boolean> {
  try {
    await run('node', ['-e', "require.resolve('playwright')"], { cwd: process.cwd(), timeout: 10_000 });
    await run('test', ['-f', RENDERER]);
    return true;
  } catch {
    return false;
  }
}

export async function finishAd(opts: FinishOptions): Promise<FinishResult> {
  const fps = opts.fps ?? 30;
  const dir = await mkdtemp(join(tmpdir(), 'restage-ad-'));

  try {
    const src = join(dir, 'source.mp4');
    await writeFile(src, opts.clip);

    // What we are actually working with, rather than what we assume.
    const probe = await run('ffprobe', [
      '-v', 'quiet', '-print_format', 'json', '-show_streams', src,
    ]);
    const stream = JSON.parse(probe.stdout).streams.find((s: { codec_type: string }) => s.codec_type === 'video');
    const width = Number(stream?.width) || 1080;
    const height = Number(stream?.height) || 1920;

    const frameDir = join(dir, 'frames');
    await run('ffmpeg', [
      '-y', '-loglevel', 'error', '-i', src,
      '-vf', `fps=${fps}`,
      '-q:v', '3',
      join(frameDir, '%05d.jpg'),
    ], { maxBuffer: 1 << 26 }).catch(async (e) => {
      // mkdir via ffmpeg is not a thing; create and retry once.
      await run('mkdir', ['-p', frameDir]);
      return run('ffmpeg', [
        '-y', '-loglevel', 'error', '-i', src,
        '-vf', `fps=${fps}`, '-q:v', '3', join(frameDir, '%05d.jpg'),
      ], { maxBuffer: 1 << 26 });
    });

    const frameCount = (await readdir(frameDir)).filter((f) => f.endsWith('.jpg')).length;
    if (!frameCount) throw new Error('no frames could be extracted from the clip');

    const html = buildAdTimeline({
      frameCount,
      fps,
      frameDir: 'frames',
      width,
      height,
      captions: opts.captions,
      kicker: opts.kicker,
      endCard: opts.endCard,
    });
    const page = join(dir, 'timeline.html');
    await writeFile(page, html);

    const silent = join(dir, 'silent.mp4');
    const duration = frameCount / fps + (opts.endCard ? 1.6 : 0);
    await run('node', [
      RENDERER,
      '--page', page,
      '--width', String(width),
      '--height', String(height),
      '--fps', String(fps),
      '--to', duration.toFixed(3),
      '--out', silent,
    ], { maxBuffer: 1 << 26, timeout: 10 * 60_000 });

    /*
     * The pipeline's own measurement, run here rather than trusted.
     *
     * Its worst historical defect was a film rendered at 2fps with each frame
     * held fifteen times: every still looked perfect and only motion revealed
     * it. A render(t) that ignored t would fail exactly this way, silently.
     */
    const dec = await run('ffmpeg', ['-i', silent, '-vf', 'mpdecimate', '-loglevel', 'debug', '-f', 'null', '-'], {
      maxBuffer: 1 << 28,
    }).catch((e: { stderr?: string }) => ({ stdout: '', stderr: e.stderr ?? '' }));
    const kept = ((dec as { stderr: string }).stderr.match(/keep pts/g) ?? []).length;
    const totalFrames = Math.round(duration * fps);
    const uniqueFrameRatio = totalFrames ? kept / totalFrames : 0;

    let video = await readFile(silent);

    if (opts.voice) {
      const wav = join(dir, 'voice.wav');
      const withAudio = join(dir, 'final.mp4');
      await writeFile(wav, opts.voice);
      await run('ffmpeg', [
        '-y', '-loglevel', 'error',
        '-i', silent, '-i', wav,
        '-map', '0:v:0', '-map', '1:a:0',
        '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
        // The video governs the length; the voice is padded rather than the
        // picture cut, the same choice the render route makes.
        '-af', 'apad', '-t', duration.toFixed(3),
        '-movflags', '+faststart',
        withAudio,
      ]);
      video = await readFile(withAudio);
    }

    return { video, uniqueFrameRatio, frames: totalFrames };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
