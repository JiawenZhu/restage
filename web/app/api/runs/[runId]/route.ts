import { NextResponse } from 'next/server';
import { adminDb, requireUid } from '@/lib/firebaseAdmin';

/*
 * Reading a run through the server rather than straight from Firestore.
 *
 * The client prefers onSnapshot — it is a real push channel and survives a
 * refresh. But security rules require request.auth, so before a sign-in
 * provider exists there is no authenticated client to read with. This route
 * covers that case, and doubles as the polling fallback the architecture
 * already wanted for when the live channel drops.
 *
 * Ownership is checked here explicitly: the admin SDK ignores security rules,
 * so nothing else is standing between one uid and another's run.
 */
export const runtime = 'nodejs';

export async function GET(req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const { runId } = await ctx.params;

  let uid: string;
  try {
    uid = await requireUid(req);
  } catch {
    return NextResponse.json({ error: 'sign in first' }, { status: 401 });
  }

  const db = adminDb();
  const runSnap = await db.collection('runs').doc(runId).get();
  if (!runSnap.exists) return NextResponse.json({ error: 'no such run' }, { status: 404 });

  const run = runSnap.data()!;
  if (run.uid !== uid) return NextResponse.json({ error: 'no such run' }, { status: 404 });

  const nodesSnap = await db.collection('runs').doc(runId).collection('nodes').orderBy('createdAt').get();

  return NextResponse.json(
    {
      run: { id: runSnap.id, ...run },
      nodes: nodesSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    },
    // A run in flight changes every few seconds; nothing here should be cached.
    { headers: { 'cache-control': 'no-store' } },
  );
}
