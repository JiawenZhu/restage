import { NextResponse } from 'next/server';
import { consume, tooMany } from '@/lib/rateLimit';
import { z } from 'zod';
import { adminDb, requireUid } from '@/lib/firebaseAdmin';
import { downloadRendered, MAX_CLIP_SECONDS, pollRender, submitRender } from '@/lib/gemini';
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

const Body = z.object({ nodeId: z.string().min(1) });

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

function buildCinematicUgcVideoPrompt(goal: string, label?: string, aspect?: string): string {
  const cameraMovement =
    aspect === '9:16'
      ? 'Handheld smartphone vlog tracking camera with subtle organic breathing motion, eye-level perspective, 35mm lens, f/1.8 shallow depth of field with gentle background bokeh'
      : 'Smooth cinematic forward push-in dolly tracking shot, eye-level angle, 35mm lens, deep 3D spatial parallax between subject and background environment';

  return [
    `Cinematic 4K UGC video clip, 24fps.`,
    `${goal}. ${label ? `Scene focus: ${label}.` : ''}`,
    `STRICT FACIAL IDENTITY ANCHOR: The subject's exact facial structure, bone geometry, eye shape and spacing, nose structure, jawline, lip contour, hairline, and eyeglasses MUST remain 100% stable and identical to the initial reference frame across every single millisecond. Do not alter, slim, or beautify the face.`,
    `Expression & Motion Dynamics: Controlled natural micro-expressions only. The creator speaks with authentic charisma, fluid subtle jaw articulation, organic soft blinks, and gentle expressive head tilts. Absolutely NO exaggerated facial grimacing, NO jaw stretching, and NO facial shape deformation.`,
    `Camera Dynamics: ${cameraMovement}.`,
    `Lighting & Physics: Direct authentic cinematic lighting with realistic specular reflections shifting naturally across glasses and eyes, dynamic ambient lighting interaction, realistic skin subsurface scattering, subtle environmental dust/particles and secondary motion in the background.`,
    `Fidelity & Constraints: Photorealistic natural skin pores and micro-texture, coherent anatomy, smooth 24fps motion blur, zero facial drift, zero morphing, zero rubbery skin, zero jitter, zero warped geometry, no text, no watermarks, no logos.`,
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

  const frameSnap = await runRef.collection('nodes').doc(parsed.data.nodeId).get();
  const frame = frameSnap.data();
  if (!frameSnap.exists || frame?.kind !== 'frame' || !frame.frameUrl) {
    return NextResponse.json({ error: 'that node is not a renderable frame' }, { status: 400 });
  }
  const firstFrame = await resolveImage(frame.frameUrl);
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
  await videoRef.set({
    parentId: frameSnap.id,
    stepNo: (frame.stepNo ?? 0) + 1,
    kind: 'video',
    status: 'generating',
    instruction: 'Render the approved frame to video with cinematic UGC camera motion',
    rationale: 'The approved frame becomes frame one; everything the run built survives into motion.',
    frameUrl: frame.frameUrl, // poster while the clip cooks
    createdAt: Date.now(),
  });

  void (async () => {
    try {
      const prompt = buildCinematicUgcVideoPrompt(run.goal, frame.label, run.aspect);
      const { operation } = await submitRender({
        // The 8/15/30s control was collected, stored, and never sent anywhere.
        durationSeconds: run.seconds,
        prompt,
        firstFrame,
        aspect: run.aspect,
      });

      /*
       * A transient poll failure is not a failed render.
       *
       * One network blip threw straight out of the loop and abandoned a Veo
       * job that had already been submitted and paid for — the clip finished on
       * Google's side and the user was told it failed. Only a real terminal
       * error, or several consecutive failures, ends it now.
       */
      let uri: string | null = null;
      let consecutiveErrors = 0;
      for (let i = 0; i < 60; i++) {
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
          // A terminal error from the operation itself must still end the loop.
          if (pollErr instanceof Error && /safety|invalid|quota|blocked/i.test(pollErr.message)) throw pollErr;
          if (++consecutiveErrors >= 4) throw pollErr;
          console.warn('[render] transient poll failure', consecutiveErrors, pollErr);
        }
      }
      if (!uri) throw new Error('render did not finish in five minutes');

      let finalVideoBytes = await downloadRendered(uri);

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
        audioNote,
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
      await videoRef.update({
        status: 'failed',
        criticNotes: `Render failed: ${err instanceof Error ? err.message : 'unknown'}`,
      });
      await runRef.update({ status: 'awaiting-approval', updatedAt: Date.now() }).catch(() => {});
    }
  })();

  return NextResponse.json({ videoNodeId: videoRef.id });
}
