import { NextResponse } from 'next/server';
import { z } from 'zod';
import { adminDb, requireUid } from '@/lib/firebaseAdmin';
import { downloadRendered, pollRender, submitRender } from '@/lib/gemini';
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

function decodeDataUrl(u: string) {
  const m = u.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return null;
  return { mimeType: m[1], data: Buffer.from(m[2], 'base64') };
}

export async function POST(req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const { runId } = await ctx.params;

  let uid: string;
  try {
    uid = await requireUid(req);
  } catch {
    return NextResponse.json({ error: 'sign in first' }, { status: 401 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'nodeId is required' }, { status: 400 });

  const db = adminDb();
  const runRef = db.collection('runs').doc(runId);
  const runSnap = await runRef.get();
  if (!runSnap.exists || runSnap.data()!.uid !== uid) {
    // The same answer for "absent" and "not yours": a 403 would confirm the id.
    return NextResponse.json({ error: 'no such run' }, { status: 404 });
  }
  const run = runSnap.data()!;
  if (run.status === 'planning') {
    return NextResponse.json({ error: 'the plan is still being written' }, { status: 409 });
  }

  const frameSnap = await runRef.collection('nodes').doc(parsed.data.nodeId).get();
  const frame = frameSnap.data();
  if (!frameSnap.exists || frame?.kind !== 'frame' || !frame.frameUrl) {
    return NextResponse.json({ error: 'that node is not a renderable frame' }, { status: 400 });
  }
  const firstFrame = decodeDataUrl(frame.frameUrl);
  if (!firstFrame) return NextResponse.json({ error: 'frame is not readable' }, { status: 400 });

  // The video node appears on the tree immediately, in the generating state —
  // the pulsing ring during a render is real state, same as during a frame.
  const videoRef = runRef.collection('nodes').doc();
  await videoRef.set({
    parentId: frameSnap.id,
    stepNo: (frame.stepNo ?? 0) + 1,
    kind: 'video',
    status: 'generating',
    instruction: 'Render the approved frame to video',
    rationale: 'The approved frame becomes frame one; everything the run built survives into motion.',
    frameUrl: frame.frameUrl, // poster while the clip cooks
    createdAt: Date.now(),
  });
  await runRef.update({ status: 'rendering', updatedAt: Date.now() });

  void (async () => {
    try {
      const { operation } = await submitRender({
        prompt:
          `Animate this exact frame into a short authentic UGC clip. ${run.goal}. ` +
          `The person speaks naturally to the camera with subtle handheld phone movement. ` +
          `Keep the scene, clothing and face exactly as in the frame. No text, no logos.`,
        firstFrame,
        aspect: run.aspect,
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
      if (!uri) throw new Error('render did not finish in five minutes');

      const bytes = await downloadRendered(uri);
      const key = videoKey(uid, runId, videoRef.id);
      await putVideo(key, bytes);
      // 7 days is R2's presigning maximum. A refresh endpoint comes with the
      // library page; for now a week outlives any working session.
      const url = await signedVideoUrl(key, 604800);

      await videoRef.update({ status: 'achieved', videoKey: key, videoUrl: url });
      await runRef.update({ status: 'complete', updatedAt: Date.now() });
    } catch (err) {
      console.error('[render]', runId, err);
      await videoRef.update({
        status: 'failed',
        criticNotes: `Render failed: ${err instanceof Error ? err.message : 'unknown'}`,
      });
      // Back to approvable rather than stuck in "rendering" forever.
      await runRef.update({ status: 'awaiting-approval', updatedAt: Date.now() }).catch(() => {});
    }
  })();

  return NextResponse.json({ videoNodeId: videoRef.id });
}
