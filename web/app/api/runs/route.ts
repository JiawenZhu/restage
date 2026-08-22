import { NextResponse } from 'next/server';
import { consume, tooMany } from '@/lib/rateLimit';
import { providerFor } from '@/lib/provider';
import { z } from 'zod';
import { requireUid, adminDb } from '@/lib/firebaseAdmin';
import { createRun, executeRun } from '@/lib/orchestrator';
import type { QueryDocumentSnapshot, DocumentData } from 'firebase-admin/firestore';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * An inline image, or a file in OUR bucket specifically.
 *
 * Allowing the storage HOSTS was too broad: every public Google Cloud Storage
 * bucket on the internet lives on those two hostnames, so the server could
 * still be pointed at an arbitrary object and made to buffer it. The bucket
 * name has to be in the path.
 */
function isOwnImageSource(v: string): boolean {
  if (v.startsWith('data:image/')) return true;
  const bucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'restage-studio.firebasestorage.app';
  try {
    const u = new URL(v);
    if (u.protocol !== 'https:') return false;
    if (u.hostname === 'firebasestorage.googleapis.com') return u.pathname.startsWith(`/v0/b/${bucket}/`);
    if (u.hostname === 'storage.googleapis.com') return u.pathname.startsWith(`/${bucket}/`);
    return false;
  } catch {
    return false;
  }
}

const Body = z.object({
  goal: z.string().min(8).max(600),
  aspect: z.enum(['9:16', '16:9']),
  /*
   * The model makes 4-8s. Longer clips are whole segments joined, each starting
   * on the last frame of the one before it — so the offered lengths are exact
   * multiples rather than numbers that need trimming mid-shot.
   *
   * 15 and 30 used to be accepted here, stored, and shown on library cards
   * while the renderer produced 8s regardless.
   */
  seconds: z.union([z.literal(4), z.literal(8), z.literal(16), z.literal(24)]),
  templateId: z.string().optional(),
  videoEngine: z.enum(['veo', 'omni']).default('veo').optional(),
  /** Which enrolled avatar this run used, when it came from one. The Run type
   *  declared this as required and nothing ever sent it. */
  avatarId: z.string().max(64).nullable().optional(),
  /*
   * A data: URL, or a URL inside our own storage — never an arbitrary one.
   *
   * The server fetches this value (orchestrator resolveImageInput /
   * uploadToStorage), so accepting any http(s) string is the same request
   * forgery primitive that was removed from /api/frame: a caller could point it
   * at cloud metadata or anything else reachable from inside the deployment.
   * The enrolled-avatar flow only ever sends our own signed Storage URLs, so
   * nothing legitimate needs more than this.
   *
   * ~8MB of base64. Unbounded, this was also a memory and cost amplifier: the
   * string is decoded, sent to the model, and echoed into Firestore.
   */
  avatarDataUrl: z
    .string()
    .min(1)
    .max(11_000_000)
    .refine(isOwnImageSource, { message: 'must be an image data URL or a Restage storage URL' })
    // Optional when avatarId is given: the server reads the enrolled captures
    // from Storage itself rather than trusting an expiring URL from the client.
    .optional(),
  // The same bound as avatarDataUrl: three unbounded images was three times the
  // amplifier one was.
  avatarMultiViews: z
    .object({
      front: z.string().max(11_000_000).refine(isOwnImageSource).optional(),
      left: z.string().max(11_000_000).refine(isOwnImageSource).optional(),
      right: z.string().max(11_000_000).refine(isOwnImageSource).optional(),
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
          title: data.title ?? null,
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

  /*
   * The ceiling belongs to POST, which is the expensive verb.
   *
   * A mechanical edit put it on GET instead, and the consequences were exactly
   * inverted: the Library polls every 8 seconds while a run is in flight, so
   * watching one 3-minute run spent 20+ of a 20/hour budget and then locked the
   * user out of their own library for an hour — while the most expensive route
   * in the product, 5-7 image generations plus judges plus a Veo render, had no
   * ceiling at all.
   */
  const rate = await consume(uid, 'run');
  if (!rate.ok) return tooMany(rate);

  try {
    const rawJson = await req.json().catch(() => null);
    const parsed = Body.safeParse(rawJson);
    if (!parsed.success) {
      return NextResponse.json({ error: 'invalid run request' }, { status: 400 });
    }

    if (!parsed.data.avatarId && !parsed.data.avatarDataUrl) {
      return NextResponse.json({ error: 'choose an enrolled face or upload a photo' }, { status: 400 });
    }
    /*
     * Which door this account goes through, decided here and pinned to the run.
     *
     * Resolved once, at the top, rather than inside each model call: a run that
     * looked this up per step would change models underneath itself if the plan
     * changed mid-run, and half an ad on each provider is exactly the kind of
     * visible seam this product exists to avoid.
     */
    const provider = await providerFor(uid);
    const args = { uid, provider, ...parsed.data, avatarDataUrl: parsed.data.avatarDataUrl ?? '' };
    const runId = await createRun(args);

    // Deliberately not awaited. The run takes 1-3 minutes and the client watches
    // Firestore rather than this response.
    void executeRun(runId, args);

    return NextResponse.json({ runId });
  } catch (err) {
    console.error('POST /api/runs error:', err);
    // A stale avatar id is the user's problem to fix, not a server fault, and
    // "could not start the run" gives them nothing to act on.
    const msg = err instanceof Error ? err.message : '';
    if (msg.includes('no longer available')) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    return NextResponse.json({ error: 'could not start the run' }, { status: 500 });
  }
}
