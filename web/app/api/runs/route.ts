import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUid, adminDb } from '@/lib/firebaseAdmin';
import { createRun, executeRun } from '@/lib/orchestrator';
import type { QueryDocumentSnapshot, DocumentData } from 'firebase-admin/firestore';

export const runtime = 'nodejs';
export const maxDuration = 300;

const Body = z.object({
  goal: z.string().min(8).max(600),
  aspect: z.enum(['9:16', '16:9']),
  seconds: z.union([z.literal(8), z.literal(15), z.literal(30)]),
  templateId: z.string().optional(),
  // ~8MB of base64. Unbounded, this was a memory and cost amplifier: the string
  // is decoded, sent to the model, and echoed into Firestore.
  avatarDataUrl: z.string().min(1).max(11_000_000),
  avatarMultiViews: z
    .object({
      front: z.string().optional(),
      left: z.string().optional(),
      right: z.string().optional(),
    })
    .optional(),
});

/*
 * The signed-in user's own runs, newest first — this is what the Library reads.
 *
 * Three fail-open paths were removed from this handler, and the reasoning is
 * worth keeping because each one looked harmless in isolation:
 *
 *   1. `?uid=all` fell back to `uid = null`, and a null uid meant an UNFILTERED
 *      query — every user's runs, to anyone who asked. The parameter is gone;
 *      the identity of the caller is the only thing that selects rows now.
 *   2. A failed query was caught and retried WITHOUT the uid filter. The likely
 *      trigger is a missing composite index, so the first real deployment would
 *      have served strangers' runs to every signed-in user. A query that fails
 *      must fail.
 *   3. The limit capped at 10, which is not a library. It is now 100, still
 *      bounded because each run carries preview frames.
 *
 * Frames are base64 data URLs, so a page of runs with previews is heavy. Only
 * the first frame of each run is returned here; the rest arrive when the user
 * opens that run.
 */
export async function GET(req: Request) {
  let uid: string;
  try {
    uid = await requireUid(req);
  } catch {
    return NextResponse.json({ error: 'sign in to see your library' }, { status: 401 });
  }

  try {
    const db = adminDb();
    const { searchParams } = new URL(req.url);
    const limitParam = Number.parseInt(searchParams.get('limit') || '60', 10);
    const safeLimit = Math.min(Math.max(Number.isNaN(limitParam) ? 60 : limitParam, 1), 100);

    const snapshot = await db
      .collection('runs')
      .where('uid', '==', uid)
      .orderBy('createdAt', 'desc')
      .limit(safeLimit)
      .get();

    const runs = await Promise.all(
      snapshot.docs.map(async (doc: QueryDocumentSnapshot<DocumentData>) => {
        const data = doc.data();

        /*
         * One thumbnail per run — and it must be a frame the run PRODUCED.
         *
         * This preferred `previewFrames[0]`, which is the enrolment photo, so
         * every card in the library showed the same face on the same background
         * and none of them showed what the run made. It also meant the thumbnail
         * was a Storage URL, and Storage is private now, so those links 403.
         *
         * Generated frames are data URLs held in Firestore, so they need no
         * signing and cannot expire. Newest achieved first; a run that never got
         * a clean frame falls back to its last attempt, and only a run with no
         * frames at all shows nothing.
         */
        let thumbUrl: string | undefined;
        let frameCount = 0;
        try {
          const nodesSnap = await doc.ref.collection('nodes').orderBy('createdAt', 'desc').get();
          const frames = nodesSnap.docs.filter((n) => {
            const d = n.data();
            if (d.kind !== 'frame' || typeof d.frameUrl !== 'string') return false;
            // A Storage URL without a download token predates the bucket being
            // locked down and would render as a broken image. Better to show a
            // run with no thumbnail than one with a broken one.
            if (d.frameUrl.startsWith('data:')) return true;
            return d.frameUrl.includes('token=');
          });
          frameCount = frames.length;
          const best = frames.find((n) => n.data().status === 'achieved') ?? frames[0];
          thumbUrl = best?.data().frameUrl;
        } catch {
          // A run whose nodes cannot be read is still worth listing.
        }

        return {
          id: doc.id,
          goal: data.goal,
          aspect: data.aspect,
          seconds: data.seconds,
          status: data.status,
          stepCount: Array.isArray(data.plan) ? data.plan.length : 0,
          frameCount,
          videoUrl: data.videoUrl,
          createdAt: data.createdAt,
          updatedAt: data.updatedAt ?? data.createdAt,
          thumbUrl,
        };
      }),
    );

    return NextResponse.json({ runs }, { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    console.error('Failed to list runs:', err);
    return NextResponse.json({ error: 'could not load your library' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  // A run is the expensive thing this product does and it belongs to somebody.
  // The previous shared 'guest_creator' identity put every anonymous user's runs
  // in one pile, mutually visible and impossible to find again.
  let uid: string;
  try {
    uid = await requireUid(req);
  } catch {
    return NextResponse.json({ error: 'sign in to start a run' }, { status: 401 });
  }

  try {
    const rawJson = await req.json().catch(() => null);
    const parsed = Body.safeParse(rawJson);
    if (!parsed.success) {
      return NextResponse.json({ error: 'invalid run request' }, { status: 400 });
    }

    const args = { uid, ...parsed.data };
    const runId = await createRun(args);

    // Deliberately not awaited. The run takes 1-3 minutes and the client watches
    // Firestore rather than this response.
    void executeRun(runId, args);

    return NextResponse.json({ runId });
  } catch (err) {
    console.error('POST /api/runs error:', err);
    return NextResponse.json({ error: 'could not start the run' }, { status: 500 });
  }
}
