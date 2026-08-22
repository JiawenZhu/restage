import { NextResponse } from 'next/server';
import { consume, tooMany } from '@/lib/rateLimit';
import { z } from 'zod';
import { adminDb, requireUid } from '@/lib/firebaseAdmin';
import { downloadRendered, MAX_CLIP_SECONDS, MIN_CLIP_SECONDS, pollRender, submitRender } from '@/lib/gemini';
import { lastFrameOf, segmentsFor, stitch } from '@/lib/stitch';
import { lineageOf, shotPlan, type LineageNode } from '@/lib/lineage';
import { motionDirection } from '@/lib/look';
import { canFinish, finishAd } from '@/lib/finishAd';
import { timeCaptions, wavDurationSeconds } from '@/lib/captions';
import { putVideo, signedVideoUrl, videoKey } from '@/lib/r2';

/*
 * The end of the loop: an approved frame becomes a clip.
 *
 * The response returns as soon as the job is created. Veo measured ~41s, and the
 * client is watching the node in Firestore — holding this connection open would
 * only add a place to time out. The finished file goes to R2 (private, signed
 * read); only the pointer and a signed URL land in Firestore.
 */
export const runtime = 'nodejs';
export const maxDuration = 300;

/*
 * Render one frame, or the whole sequence.
 *
 * A single frame animated for eight seconds is one shot. The SEQUENCE is the
 * storyboard the agent reasoned about — six frames that each edit the one
 * before, which is why they read as a continuous take — and animating each of
 * them in order produces a multi-shot ad rather than a single held moment.
 *
 * `seconds` overrides the length chosen on /studio. The choice made before the
 * run should carry through by default; being able to change it here matters
 * because the right length is only really knowable once the frames exist.
 */
const Body = z.object({
  nodeId: z.string().min(1).optional(),
  mode: z.enum(['frame', 'sequence']).default('frame'),
  seconds: z.union([z.literal(4), z.literal(8), z.literal(16), z.literal(24), z.literal(32)]).optional(),
});

async function resolveImage(u: string): Promise<{ mimeType: string; data: Buffer } | null> {
  if (u.startsWith('data:')) {
    const m = u.match(/^data:([^;]+);base64,(.+)$/);
    if (!m) return null;
    return { mimeType: m[1], data: Buffer.from(m[2], 'base64') };
  }
  if (u.startsWith('http://') || u.startsWith('https://')) {
    try {
      const res = await fetch(u);
      if (!res.ok) return null;
      const arrayBuf = await res.arrayBuffer();
      const contentType = res.headers.get('content-type') || 'image/jpeg';
      return { mimeType: contentType, data: Buffer.from(arrayBuf) };
    } catch {
      return null;
    }
  }
  return null;
}

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const execFileAsync = promisify(execFile);

function buildCinematicUgcVideoPrompt(
  goal: string,
  label?: string,
  aspect?: string,
  /** Appended for segments after the first, so the shot continues rather than
   *  restarting. */
  continuation?: string,
): string {
  const cameraMovement =
    aspect === '9:16'
      /* Vertical UGC is shot at arm's length, and the camera move should still
         read as handheld — but the LENS matters more than the movement. 35mm at
         face distance is what makes a phone selfie unflattering; the framing
         here keeps the handheld feel and loses the distortion. */
      ? 'Handheld at arm\'s length with subtle organic breathing motion, camera a touch above eye level, 85mm-equivalent compression, f/2 shallow depth of field with gentle background bokeh'
      : 'Smooth cinematic forward push-in, camera a touch above eye level, 85mm-equivalent compression, natural spatial parallax between subject and background';

  return [
    `Cinematic 4K UGC video clip, 24fps.`,
    `${goal}. ${label ? `Scene focus: ${label}.` : ''}`,
    motionDirection(),
    `Expression & Motion Dynamics: Controlled natural micro-expressions only. The creator speaks with authentic charisma, fluid subtle jaw articulation, organic soft blinks, and gentle expressive head tilts. Absolutely NO exaggerated facial grimacing, NO jaw stretching, and NO facial shape deformation.`,
    `Camera Dynamics: ${cameraMovement}.`,
    `Lighting & Physics: Direct authentic cinematic lighting with realistic specular reflections shifting naturally across glasses and eyes, dynamic ambient lighting interaction, realistic skin subsurface scattering, subtle environmental dust/particles and secondary motion in the background.`,

    // Only on segments after the first: the given frame is the previous
    // segment's last, so this has to read as the same take continuing.
    ...(continuation ? [continuation] : []),
  ].join(' ');
}

export async function POST(req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const { runId } = await ctx.params;

  let uid: string;
  try {
    uid = await requireUid(req);
  } catch {
    // Rendering costs a Veo call and writes to somebody's run. The shared
    // 'guest_creator' fallback meant an anonymous caller could spend on, and
    // write into, a run they had merely guessed the id of.
    return NextResponse.json({ error: 'sign in to render' }, { status: 401 });
  }

  // Every call below spends money; nothing capped how many a single account
  // could make.
  const rate = await consume(uid, 'render');
  if (!rate.ok) return tooMany(rate);


  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'nodeId is required' }, { status: 400 });

  const db = adminDb();
  const runRef = db.collection('runs').doc(runId);
  const runSnap = await runRef.get();
  if (!runSnap.exists) {
    return NextResponse.json({ error: 'no such run' }, { status: 404 });
  }
  const run = runSnap.data()!;
  // Same answer for "absent" and "not yours": a 403 would confirm the id exists.
  if (run.uid !== uid) return NextResponse.json({ error: 'no such run' }, { status: 404 });
  if (run.status === 'planning') {
    return NextResponse.json({ error: 'the plan is still being written' }, { status: 409 });
  }

  /*
   * The shots to animate.
   *
   * Sequence mode walks the lineage — the chain of frames each edited from the
   * last — so the shots arrive in the order the plan intended. Frame mode is
   * the single approved still, which is what this route did before.
   */
  const allNodes = (await runRef.collection('nodes').orderBy('createdAt').get()).docs.map((d) => ({
    id: d.id,
    ...(d.data() as Record<string, unknown>),
  })) as LineageNode[];

  let shots: { id: string; frameUrl: string; label?: string; instruction?: string }[];

  if (parsed.data.mode === 'sequence') {
    const chain = lineageOf(allNodes).filter((n) => n.frameUrl && !n.stale);
    if (!chain.length) {
      return NextResponse.json({ error: 'this run has no finished sequence to render' }, { status: 400 });
    }
    if (chain.some((n) => (n as { stale?: boolean }).stale)) {
      return NextResponse.json({ error: 'rebuild the stale steps before rendering the sequence' }, { status: 409 });
    }
    shots = chain.map((n) => ({
      id: n.id,
      frameUrl: n.frameUrl!,
      label: (n as { label?: string }).label,
      instruction: n.instruction,
    }));
  } else {
    if (!parsed.data.nodeId) return NextResponse.json({ error: 'nodeId is required' }, { status: 400 });
    const frameSnap = await runRef.collection('nodes').doc(parsed.data.nodeId).get();
    const frame = frameSnap.data();
    if (!frameSnap.exists || frame?.kind !== 'frame' || !frame.frameUrl) {
      return NextResponse.json({ error: 'that node is not a renderable frame' }, { status: 400 });
    }
    shots = [{ id: frameSnap.id, frameUrl: frame.frameUrl, label: frame.label, instruction: frame.instruction }];
  }

  const frame = { label: shots[0].label, stepNo: 0 };
  const frameSnap = { id: shots[shots.length - 1].id };
  const firstFrame = await resolveImage(shots[0].frameUrl);
  if (!firstFrame) return NextResponse.json({ error: 'frame is not readable' }, { status: 400 });

  /*
   * Claim the run before spending on it.
   *
   * The status check and the write were separate, so two tabs — or one
   * double-click — could both pass the check and both submit a Veo render, then
   * race to write videoUrl. Claiming in a transaction means the second request
   * is refused rather than billed.
   */
  const priorStatus: string = run.status ?? 'awaiting-approval';
  const claimed = await adminDb().runTransaction(async (tx) => {
    const snap = await tx.get(runRef);
    if (snap.data()?.status === 'rendering') return false;
    tx.update(runRef, { status: 'rendering', updatedAt: Date.now() });
    return true;
  });
  if (!claimed) {
    return NextResponse.json({ error: 'this run is already rendering' }, { status: 409 });
  }
  // Only now, with the run claimed: a node created before the claim would have
  // to be deleted again on a refusal, flickering onto the live tree first.
  const videoRef = runRef.collection('nodes').doc();
  const isSequence = parsed.data.mode === 'sequence';
  await videoRef.set({
    parentId: frameSnap.id,
    stepNo: 99,
    kind: 'video',
    status: 'generating',
    instruction: isSequence
      ? `Render all ${shots.length} shots into one ad`
      : 'Render this frame to video',
    rationale: isSequence
      ? 'Each frame in the sequence becomes a shot, in the order the plan set.'
      : 'The approved frame becomes frame one; everything the run built survives into motion.',
    frameUrl: shots[0].frameUrl, // poster while the clip cooks
    shotCount: shots.length,
    createdAt: Date.now(),
  });

  void (async () => {
    try {
      /*
       * The shots to render, and how long each one runs.
       *
       * SEQUENCE: every frame in the storyboard becomes its own shot, seeded by
       * that frame. This is the multi-shot ad — the plan the agent reasoned
       * about, animated in order — rather than one held moment.
       *
       * FRAME: a single still, extended past the model's eight-second ceiling by
       * chaining, where each segment starts on the last frame of the one before
       * so the take stays continuous.
       *
       * Either way the LENGTH is the one chosen on /studio unless this request
       * overrode it. Six shots of a 24-second ad are four seconds each; three
       * shots of the same ad are eight. The model's floor is 4s, so a sequence
       * long enough to push below it gets 4s shots and a longer total than
       * asked — stated on the node rather than quietly applied.
       */
      const wanted = Math.max(MIN_CLIP_SECONDS, parsed.data.seconds ?? run.seconds ?? MAX_CLIP_SECONDS);
      const plan = shotPlan(wanted, shots.length, MIN_CLIP_SECONDS, MAX_CLIP_SECONDS);

      type Segment = { seconds: number; seed: { data: Buffer; mimeType: string } | undefined; label?: string; continues: boolean };
      const queue: Segment[] = [];

      if (isSequence) {
        for (const shot of shots) {
          const seed = await resolveImage(shot.frameUrl);
          queue.push({ seconds: plan.perShot, seed: seed ?? undefined, label: shot.label, continues: false });
        }
      } else {
        const count = segmentsFor(wanted, MAX_CLIP_SECONDS);
        for (let i = 0; i < count; i++) {
          const remaining = wanted - i * MAX_CLIP_SECONDS;
          queue.push({
            seconds: Math.min(MAX_CLIP_SECONDS, Math.max(MIN_CLIP_SECONDS, remaining)),
            seed: i === 0 ? firstFrame : undefined,   // later ones are seeded by the previous tail
            continues: i > 0,
          });
        }
      }

      const segments: Buffer[] = [];
      let carried = firstFrame;

      for (let i = 0; i < queue.length; i++) {
        const seg = queue[i];
        const seed = seg.seed ?? carried;

        await videoRef.update({
          segmentIndex: i + 1,
          segmentCount: queue.length,
          rationale: isSequence
            ? `Shot ${i + 1} of ${queue.length}${seg.label ? ` — ${seg.label}` : ''}.`
            : `Segment ${i + 1} of ${queue.length}. Each one begins on the last frame of the one before it.`,
        });

        const prompt = buildCinematicUgcVideoPrompt(
          run.goal,
          seg.label ?? frame.label,
          run.aspect,
          seg.continues
            ? 'This continues the same unbroken shot from the frame given. Do not cut, restart, or reframe.'
            : undefined,
        );

        const { operation } = await submitRender({
          durationSeconds: seg.seconds,
          prompt,
          firstFrame: seed,
          aspect: run.aspect,
        });

        /*
         * A transient poll failure is not a failed render.
         *
         * One network blip threw straight out of the loop and abandoned a Veo
         * job that had already been submitted and paid for. Only a real
         * terminal error, or several consecutive failures, ends it now.
         */
        let uri: string | null = null;
        let consecutiveErrors = 0;
        for (let k = 0; k < 60; k++) {
          await new Promise((r) => setTimeout(r, 5000));
          try {
            const st = await pollRender(operation);
            consecutiveErrors = 0;
            if (st.done) {
              if ('error' in st) throw new Error(st.error);
              uri = st.videoUri;
              break;
            }
          } catch (pollErr) {
            if (pollErr instanceof Error && /safety|invalid|quota|blocked/i.test(pollErr.message)) throw pollErr;
            if (++consecutiveErrors >= 4) throw pollErr;
            console.warn('[render] transient poll failure', consecutiveErrors, pollErr);
          }
        }
        if (!uri) throw new Error(`shot ${i + 1} did not finish in five minutes`);

        const bytes = await downloadRendered(uri);
        segments.push(bytes);

        // Only the chained case needs a tail; a sequence shot has its own seed.
        if (!isSequence && i + 1 < queue.length) carried = await lastFrameOf(bytes);
      }

      let finalVideoBytes = await stitch(segments, isSequence ? undefined : (queue.length > 1 ? wanted : undefined));

      // ── Audio Muxing Pipeline ──
      // If voiceover audio exists on the run, mux it into the video with ffmpeg
      let hasAudio = false;
      let audioNote: string | null = null;
      if (run.audioUrl) {
        try {
          const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'veo-mux-'));
          const videoPath = path.join(tempDir, 'raw_video.mp4');
          const audioPath = path.join(tempDir, 'voiceover.wav');
          const outputPath = path.join(tempDir, 'muxed_video.mp4');

          await fs.writeFile(videoPath, finalVideoBytes);

          // Download voice audio
          const audioRes = await fetch(run.audioUrl);
          if (audioRes.ok) {
            const audioBuffer = Buffer.from(await audioRes.arrayBuffer());
            await fs.writeFile(audioPath, audioBuffer);

            /*
             * Explicit stream mapping, and no -shortest.
             *
             * Veo clips can carry their own audio track. Without -map, ffmpeg
             * picks one audio stream by its own rules and the written voiceover
             * — the line the workspace shows the user before they render — was
             * the one that lost. And -shortest truncated the video whenever the
             * voiceover was shorter than the clip, so an 8-second ad became a
             * 5-second one. The video governs the length; the audio is padded
             * with silence to match.
             */
            await execFileAsync('ffmpeg', [
              '-y',
              '-i', videoPath,
              '-i', audioPath,
              '-map', '0:v:0',
              '-map', '1:a:0',
              '-c:v', 'copy',
              '-c:a', 'aac',
              '-b:a', '192k',
              '-af', 'apad',
              '-t', String(Math.min(MAX_CLIP_SECONDS, run.seconds || MAX_CLIP_SECONDS)),
              outputPath,
            ]);

            const muxedBytes = await fs.readFile(outputPath);
            if (muxedBytes && muxedBytes.length > 0) {
              finalVideoBytes = muxedBytes;
              hasAudio = true;
            }
          }

          // Clean up temp folder
          await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
        } catch (muxErr) {
          /* A silent clip is a usable clip, but shipping one while the
             workspace still displays the spoken line tells the user something
             untrue. The reason is recorded on the node and shown. */
          audioNote =
            muxErr instanceof Error && /ENOENT/.test(muxErr.message)
              ? 'ffmpeg is not installed on the server, so the voiceover could not be added.'
              : 'The voiceover could not be added to this clip.';
          console.warn('[render] audio mux failed:', muxErr);
        }
      }

      /*
       * Finish it into an ad.
       *
       * Up to this point the output is footage: a person in a scene. An ad has
       * burned-in captions, because social video is watched on mute, plus a
       * brand mark and something at the end. Those are typography and motion —
       * a timeline renders them over the frames.
       *
       * The captions need no transcription. The line was written by
       * writeScript() and shown to the user before they pressed render, so the
       * text is exact and only the timing has to be measured.
       *
       * Finishing is optional by design: it needs Playwright and a Chromium
       * download, which most serverless runtimes do not have. Without it the
       * clip still ships, just without captions — a worse ad, not a failure.
       */
      let captioned = false;
      let captionNote: string | null = null;
      if (run.audioScript && (await canFinish())) {
        try {
          const voiceWav = run.audioUrl ? Buffer.from(await (await fetch(run.audioUrl)).arrayBuffer()) : undefined;
          const spoken = voiceWav ? wavDurationSeconds(voiceWav) : wanted;
          const captions = await timeCaptions(run.audioScript, Math.min(spoken || wanted, wanted), {
            voiceName: 'en-US-Chirp3-HD-Aoede',
            languageCode: 'en-US',
            speakingRate: 1.05,
          });

          const finished = await finishAd({
            clip: finalVideoBytes,
            voice: voiceWav,
            captions,
            endCard: { headline: 'Made with Restage', sub: 'restage.studio' },
          });

          // The pipeline's own health check. A render(t) that ignored t would
          // produce a technically valid file of repeated frames.
          if (finished.uniqueFrameRatio >= 0.5) {
            finalVideoBytes = finished.video;
            captioned = true;
            hasAudio = hasAudio || !!voiceWav;
          } else {
            captionNote = 'Captions were skipped: the finishing render produced repeated frames.';
            console.warn('[render] finishing rejected, unique frames', finished.uniqueFrameRatio);
          }
        } catch (finishErr) {
          captionNote = 'The clip is finished, but captions could not be added.';
          console.warn('[render] finishing failed', finishErr);
        }
      }

      const key = videoKey(uid, runId, videoRef.id);
      await putVideo(key, finalVideoBytes);
      /*
       * The key is the durable record; the URL is not.
       *
       * A signed R2 URL expires — seven days is the maximum R2 allows — and
       * nothing re-signed it, so every clip in the library would have quietly
       * become a broken video after a week. Clients now link to
       * /api/runs/[runId]/video?nodeId=..., which re-signs on each request, so
       * the address a user bookmarks keeps working for as long as they own it.
       */
      await videoRef.update({
        status: 'achieved',
        hasAudio,
        captioned,
        audioNote: audioNote ?? captionNote,
        videoKey: key,
        videoUrl: `/api/runs/${runId}/video?nodeId=${videoRef.id}`,
      });
      /*
       * Only move off 'rendering', and only if this render still owns it.
       *
       * These writes were unconditional, so a second render failing would stamp
       * its status over a run that was already 'complete' with a downloadable
       * clip — the library then read "Ready to render" beside a finished video.
       * The same shape as claimTerminalStatus in the orchestrator.
       */
      await adminDb().runTransaction(async (tx) => {
        const snap = await tx.get(runRef);
        if (snap.data()?.status !== 'rendering') return;
        tx.update(runRef, {
          status: 'complete',
          videoKey: key,
          videoUrl: `/api/runs/${runId}/video?nodeId=${videoRef.id}`,
          updatedAt: Date.now(),
        });
      });
    } catch (err) {
      console.error('[render]', runId, err);
      /*
       * Say what a person can do about it.
       *
       * The raw message was passed through verbatim, so a quota limit read as a
       * wall of API prose with a documentation link, and a content refusal read
       * as "render finished with no video attached". Both are recoverable
       * situations and neither said so.
       */
      const raw = err instanceof Error ? err.message : 'unknown';
      const friendly = /quota|rate limit|exceeded/i.test(raw)
        ? 'The video quota for this project is used up. Renders work again once it resets, and the frames on this canvas are all still here.'
        : /declined|safety|blocked|filtered/i.test(raw)
          ? `${raw} Try rendering a different frame — the rest of the run is unaffected.`
          : `Render failed: ${raw}`;

      await videoRef.update({ status: 'failed', criticNotes: friendly });
      await runRef.update({ status: 'awaiting-approval', updatedAt: Date.now() }).catch(() => {});
    }
  })();

  return NextResponse.json({ videoNodeId: videoRef.id });
}
