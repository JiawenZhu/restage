import { NextResponse } from 'next/server';
import { consume, tooMany } from '@/lib/rateLimit';
import { z } from 'zod';
import { adminDb, requireUid } from '@/lib/firebaseAdmin';
import {
  downloadRendered,
  generateOmniVideo,
  MAX_CLIP_SECONDS,
  MIN_CLIP_SECONDS,
  OMNI_FIXED_SECONDS,
  OMNI_FIXED_SHORT_EDGE,
  pollRender,
  submitRender,
} from '@/lib/gemini';
import { lastFrameOf, segmentsFor, stitch } from '@/lib/stitch';
import { lineageOf, shotPlan, type LineageNode } from '@/lib/lineage';
import { motionDirection, objectMotionDirection } from '@/lib/look';
import type { LookBible, ShotKind } from '@/lib/types';
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

/* Matches STALL_AFTER_MS in RunWorkspace. The client and the server have to
   agree on when a render has died, or one of them offers a retry the other
   refuses. */
const STALL_AFTER_MS = 10 * 60 * 1000;

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
  engine: z.enum(['veo', 'omni']).default('veo').optional(),
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
  /* What the shot is OF, and the look it belongs to. Without these every shot
     got the portrait recipe — including the ones with no person in them. */
  kind: ShotKind = 'person',
  look?: LookBible | null,
): string {
  /*
   * DISTANCE, not just movement.
   *
   * This said "handheld at arm's length", which is a close-up — and a close-up
   * is where a generated face comes apart. In a real render the lower face
   * deformed frame by frame until two of six frames were a different, rounder
   * -jawed person. The same model family, given a medium shot of the same
   * person, holds the face perfectly: the jaw simply occupies fewer pixels and
   * there is less of it to get wrong.
   *
   * The handheld feel is what makes it read as UGC and it is kept. The lens is
   * still 85mm-equivalent, because that is what stops a face distorting. What
   * changes is that the camera stands back.
   */
  const cameraMovement =
    aspect === '9:16'
      ? 'Handheld from a comfortable conversational distance with subtle organic breathing motion, ' +
        'camera a touch above eye level, 85mm-equivalent compression, f/2.8 depth of field with a softly separated background'
      : 'Slow cinematic push-in from a medium distance, camera a touch above eye level, ' +
        '85mm-equivalent compression, natural spatial parallax between subject and background';

  return [
    /* Not "Cinematic 4K". The output is 720p, or 1080p on a full-length shot,
       and saying 4K neither raises it nor costs nothing — it spends the model's
       attention on a resolution it cannot produce. */
    'Photorealistic UGC video clip, 24fps.',
    `${goal}. ${label ? `Scene focus: ${label}.` : ''}`,
    kind === 'person' ? motionDirection() : objectMotionDirection(kind, look),
    ...(kind === 'person' ? [`Camera: ${cameraMovement}.`] : []),
    /* The artefact rules that used to live here — "Absolutely NO exaggerated
       facial grimacing, NO jaw stretching, NO facial shape deformation" — are
       in VIDEO_NEGATIVE_PROMPT now. Naming a defect in the positive prompt is
       how you condition on it, and the defect that showed up in real output was
       precisely jaw stretching and facial deformation. */
    'Lighting: soft, believable light with gentle specular reflections on glasses and a catchlight in the eyes; ' +
      'skin looks like skin in good condition. The background stays put and stays quiet.',

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

  let shots: { id: string; frameUrl: string; label?: string; instruction?: string; shot: ShotKind }[];

  if (parsed.data.mode === 'sequence') {
    const chain = lineageOf(allNodes).filter((n) => n.frameUrl);
    if (!chain.length) {
      return NextResponse.json({ error: 'this run has no finished sequence to render' }, { status: 400 });
    }
    /*
     * Asked BEFORE the out-of-date frames are removed, which is the only order
     * that can actually refuse.
     *
     * This filtered `!n.stale` first and then asked whether anything remaining
     * was stale — a test that cannot fire, because the filter had just removed
     * every case it was looking for. So a sequence with two out-of-date steps
     * did not get the 409 it was meant to get: it quietly rendered the
     * remaining shots and handed back a shorter ad than the storyboard, with
     * nothing said about the steps that were dropped.
     */
    const stale = chain.filter((n) => (n as { stale?: boolean }).stale);
    if (stale.length) {
      return NextResponse.json(
        {
          error: `Rebuild ${stale.length} out-of-date step${stale.length > 1 ? 's' : ''} before rendering the sequence — ` +
            `step ${stale.map((n) => n.stepNo).join(', ')} ${stale.length > 1 ? 'no longer follow' : 'no longer follows'} from the frame above ${stale.length > 1 ? 'them' : 'it'}.`,
        },
        { status: 409 },
      );
    }
    shots = chain.map((n) => ({
      id: n.id,
      frameUrl: n.frameUrl!,
      label: (n as { label?: string }).label,
      instruction: n.instruction,
      shot: ((n as { shot?: ShotKind }).shot ?? 'person') as ShotKind,
    }));
  } else {
    if (!parsed.data.nodeId) return NextResponse.json({ error: 'nodeId is required' }, { status: 400 });
    const frameSnap = await runRef.collection('nodes').doc(parsed.data.nodeId).get();
    const frame = frameSnap.data();
    if (!frameSnap.exists || frame?.kind !== 'frame' || !frame.frameUrl) {
      return NextResponse.json({ error: 'that node is not a renderable frame' }, { status: 400 });
    }
    shots = [{
      id: frameSnap.id,
      frameUrl: frame.frameUrl,
      label: frame.label,
      instruction: frame.instruction,
      shot: (frame.shot ?? 'person') as ShotKind,
    }];
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
    const d = snap.data();
    if (d?.status === 'rendering') {
      /*
       * Unless the render that claimed it is dead.
       *
       * This background task is detached: if the process restarts or the
       * request is torn down mid-render, nothing ever moves the run off
       * 'rendering'. The claim then refuses every future render with a 409 and
       * the run is bricked — permanently, with no control anywhere in the
       * product that can clear it. The workspace already treats ten minutes of
       * silence as a stall and re-arms its buttons; the server has to agree
       * with it, or those buttons lead somewhere that always says no.
       */
      const silentFor = Date.now() - (d.updatedAt ?? d.createdAt ?? 0);
      if (silentFor < STALL_AFTER_MS) return false;
      console.warn(`[render] ${runId} taking over a render stalled for ${Math.round(silentFor / 1000)}s`);
    }
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

      const selectedEngine = parsed.data.engine || (run.videoEngine as string) || 'veo';
      let finalVideoBytes: Buffer;
      let hasAudio = false;
      let audioNote: string | null = null;
      /* Something true about the ENGINE that the user should see — a length or a
         resolution their choice did not survive. Separate from audioNote so a
         caption problem and an engine limit do not overwrite one another. */
      let engineNote: string | null = null;

      if (selectedEngine === 'omni') {
        /*
         * One model call for the entire ad, so the storyboard has to travel in
         * the PROMPT — there is no queue here to carry it.
         *
         * This passed `shots[0].label` and nothing else. In sequence mode that
         * is the storyboard's FIRST BEAT standing in for all of it: the user
         * asks to render the whole sequence, waits, and gets a single scene of
         * step one, with every other shot the agent planned dropped silently.
         */
        const beats = shots
          .map((s, i) => `${i + 1}. ${(s.label ?? s.instruction ?? '').trim()}`)
          .filter((l) => l.length > 4);

        const prompt = buildCinematicUgcVideoPrompt(
          run.goal,
          isSequence ? undefined : shots[0].label,
          run.aspect,
          isSequence && beats.length > 1
            ? `Shot list — play these beats in order as one continuous ${OMNI_FIXED_SECONDS}-second take, ` +
              `giving each roughly equal screen time and moving between them on action rather than restarting the shot: ${beats.join(' ')}`
            : undefined,
          /* Omni renders the whole ad in one call, so it is a person shot
             whenever any beat has a person in it — that is the only case where
             the identity direction earns its place. */
          isSequence ? (shots.some((sh) => sh.shot === 'person') ? 'person' : shots[0].shot) : shots[0].shot,
          (run.look ?? null) as LookBible | null,
        );

        /*
         * The enrolment views go in as references.
         *
         * Only the single starting frame was sent before. Enrolment captures
         * three angles precisely because identity holds better from three than
         * from one, and none of that was reaching this engine. Verified against
         * a real avatar: front plus left, with the photographic direction from
         * look.ts, produced a natural and clearly recognisable person where one
         * reference reproduced the wide-lens, overhead-lit flaws of the capture.
         */
        const views = (run.avatarMultiViews ?? {}) as { front?: string; left?: string; right?: string };
        const references = (
          await Promise.all(
            [views.front, views.left, views.right].filter(Boolean).map((u) => resolveImage(u as string)),
          )
        ).filter(Boolean) as Array<{ data: Buffer; mimeType: string }>;

        await videoRef.update({
          engine: 'omni',
          rationale:
            `Gemini Omni Flash — one continuous ${OMNI_FIXED_SECONDS}s shot with native audio` +
            (isSequence && beats.length > 1 ? `, following all ${beats.length} shots` : '') +
            (references.length ? `, held to your face from ${references.length} enrolment view${references.length > 1 ? 's' : ''}` : '') +
            '.',
        });

        const omni = await generateOmniVideo({
          prompt,
          firstFrame: firstFrame ?? undefined,
          references,
          aspect: run.aspect,
        });
        finalVideoBytes = omni.bytes;
        // Measured from the container rather than assumed from the datasheet.
        hasAudio = omni.hasAudio;

        /*
         * Two things this engine cannot do, said rather than swallowed. The
         * length has no parameter at all, and the resolution parameter is
         * accepted and then ignored — both verified against the live API.
         */
        if (wanted !== OMNI_FIXED_SECONDS) {
          engineNote =
            `Gemini Omni always returns about ${OMNI_FIXED_SECONDS} seconds at ${OMNI_FIXED_SHORT_EDGE}p, so this is not the ` +
            `${wanted}s you asked for. Render with Veo 3.1 to get the length you set.`;
        } else {
          engineNote = `Gemini Omni renders at ${OMNI_FIXED_SHORT_EDGE}p. Veo 3.1 goes higher.`;
        }
      } else {
        type Segment = {
          seconds: number;
          seed: { data: Buffer; mimeType: string } | undefined;
          label?: string;
          continues: boolean;
          /* Carried per segment: a sequence can mix a person shot and a macro of
             a label, and they must not be given the same direction. */
          shot: ShotKind;
        };
        const queue: Segment[] = [];

        if (isSequence) {
          for (const shot of shots) {
            const seed = await resolveImage(shot.frameUrl);
            queue.push({ seconds: plan.perShot, seed: seed ?? undefined, label: shot.label, continues: false, shot: shot.shot });
          }
        } else {
          const count = segmentsFor(wanted, MAX_CLIP_SECONDS);
          for (let i = 0; i < count; i++) {
            const remaining = wanted - i * MAX_CLIP_SECONDS;
            queue.push({
              seconds: Math.min(MAX_CLIP_SECONDS, Math.max(MIN_CLIP_SECONDS, remaining)),
              seed: i === 0 ? firstFrame : undefined, // later ones are seeded by the previous tail
              continues: i > 0,
              shot: shots[0].shot,
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
          seg.shot,
          (run.look ?? null) as LookBible | null,
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

        finalVideoBytes = await stitch(segments, isSequence ? undefined : (queue.length > 1 ? wanted : undefined));

        // ── Audio Muxing Pipeline for Veo ──
        // If voiceover audio exists on the run, mux it into the video with ffmpeg
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

              await execFileAsync('ffmpeg', [
                '-y',
                '-i', videoPath,
                '-i', audioPath,
                '-map', '0:v:0',
                '-map', '1:a:0',
                '-c:v', 'copy',
                '-c:a', 'aac',
                '-b:a', '192k',
                /*
                 * apad + -shortest, and no -t.
                 *
                 * The clamp here was `-t min(MAX_CLIP_SECONDS, run.seconds)`,
                 * and MAX_CLIP_SECONDS is 8 — so the min() could never exceed
                 * 8 and every clip carrying a voiceover was cut to eight
                 * seconds no matter what was asked for. A 24-second ad was
                 * stitched correctly from three segments and then thrown away
                 * two thirds of the way through. Runs almost always have a
                 * voiceover, so this was the normal path, not an edge case. It
                 * also read run.seconds, the length chosen before the run,
                 * rather than the length actually being rendered.
                 *
                 * `apad` extends the audio indefinitely and `-shortest` then
                 * ends the file with the video — which is the stated intent,
                 * "the video governs the length; the audio is padded with
                 * silence to match". -shortest alone truncated the video back
                 * when there was no apad to outlast it; together they are the
                 * standard idiom and need no fixed bound at all.
                 */
                '-af', 'apad',
                '-shortest',
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
            audioNote =
              muxErr instanceof Error && /ENOENT/.test(muxErr.message)
                ? 'ffmpeg is not installed on the server, so the voiceover could not be added.'
                : 'The voiceover could not be added to this clip.';
            console.warn('[render] audio mux failed:', muxErr);
          }
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
        engineNote,
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
      /*
       * The same conditional shape as the success path, for the same reason.
       *
       * This wrote unconditionally, which is precisely the bug the success path
       * above documents and guards against — a second render failing stamped
       * its status over a run that was already 'complete' with a downloadable
       * clip, and the library then read "Ready to render" next to a finished
       * video. And it hardcoded 'awaiting-approval' while `priorStatus` sat
       * captured at the top of this function, unread, holding the answer.
       */
      await adminDb()
        .runTransaction(async (tx) => {
          const snap = await tx.get(runRef);
          if (snap.data()?.status !== 'rendering') return;
          tx.update(runRef, {
            status: priorStatus === 'rendering' ? 'awaiting-approval' : priorStatus,
            updatedAt: Date.now(),
          });
        })
        .catch(() => {});
    }
  })();

  return NextResponse.json({ videoNodeId: videoRef.id });
}
