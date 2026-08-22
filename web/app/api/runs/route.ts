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
  // 4-8s is the model's actual range. 15 and 30 were accepted here, stored, and
  // shown on library cards, while the renderer produced 8s regardless.
  seconds: z.union([z.literal(4), z.literal(6), z.literal(8)]),
  templateId: z.string().optional(),
  /** Which enrolled avatar this run used, when it came from one. The Run type
   *  declared this as required and nothing ever sent it. */
  avatarId: z.string().max(64).nullable().optional(),
  // ~8MB of base64. Unbounded, this was a memory and cost amplifier: the string
  // is decoded, sent to the model, and echoed into Firestore.
  avatarDataUrl: z.string().min(1).max(11_000_000),
  // The same bound as avatarDataUrl: three unbounded images was three times the
  // amplifier one was.
  avatarMultiViews: z
    .object({
      front: z.string().max(11_000_000).optional(),
      left: z.string().max(11_000_000).optional(),
      right: z.string().max(11_000_000).optional(),
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

    const runs = snapshot.docs.map((doc: QueryDocumentSnapshot<DocumentData>) => {
        const data = doc.data();

        /*
         * No subcollection reads. This block used to open every node document
         * of every run just to count frames and pick a thumbnail — and a node
         * holds a base64 frame, so listing a few runs moved megabytes and
         * measured 4.7 to 13 seconds against real data. The orchestrator now
         * maintains `frameCount` and `thumbUrl` on the run as it works.
         *
         * Runs created before that fall back to previewFrames, which was always
         * on the document: entry 0 is the enrolment photo, so the LAST entry is
         * the one that shows what the run produced.
         */
        const previews: { frameUrl?: string }[] = Array.isArray(data.previewFrames) ? data.previewFrames : [];
        const generated = previews.slice(1);
        const thumbUrl: string | undefined =
          data.thumbUrl ?? generated[generated.length - 1]?.frameUrl ?? undefined;
        const frameCount: number = typeof data.frameCount === 'number' ? data.frameCount : generated.length;

        return {
          id: doc.id,
          goal: data.goal,
          // Recorded on every run since the beginning and read by nothing, so a
          // run made from a template was indistinguishable from one that was not.
          templateId: data.templateId ?? null,
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
    });

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
