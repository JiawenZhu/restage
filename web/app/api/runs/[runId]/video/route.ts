import { NextResponse } from 'next/server';
import { adminDb, requireUid } from '@/lib/firebaseAdmin';
import { signedVideoUrl } from '@/lib/r2';

/*
 * A stable address for a clip whose real URL keeps expiring.
 *
 * R2 signatures last at most seven days, and the finished URL used to be
 * written into Firestore as if it were durable state — so every clip in every
 * library would have quietly become a broken video a week after it was made,
 * with nothing in the app to notice or repair it.
 *
 * The key is the state. This route re-signs on each request and redirects, so
 * the URL a user bookmarks or shares with themselves keeps working for as long
 * as they own the run. Ownership is re-checked every time, which a long-lived
 * signed URL could never do.
 */
export const runtime = 'nodejs';

export async function GET(req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const { runId } = await ctx.params;

  let uid: string;
  try {
    uid = await requireUid(req);
  } catch {
    return NextResponse.json({ error: 'sign in to watch this' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const nodeId = searchParams.get('nodeId');

  const db = adminDb();
  const runRef = db.collection('runs').doc(runId);
  const runSnap = await runRef.get();
  if (!runSnap.exists || runSnap.data()!.uid !== uid) {
    return NextResponse.json({ error: 'no such clip' }, { status: 404 });
  }

  let key: string | undefined = runSnap.data()!.videoKey;
  if (nodeId) {
    const nodeSnap = await runRef.collection('nodes').doc(nodeId).get();
    key = nodeSnap.data()?.videoKey ?? key;
  }
  if (!key) return NextResponse.json({ error: 'no such clip' }, { status: 404 });

  // Short-lived on purpose: the redirect target is handed to the browser, and a
  // link that leaks should stop working quickly. The stable URL above is what
  // survives.
  const url = await signedVideoUrl(key, 3600);
  return NextResponse.redirect(url, { status: 302, headers: { 'cache-control': 'no-store' } });
}
