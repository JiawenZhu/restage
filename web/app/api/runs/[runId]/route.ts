import { NextResponse } from 'next/server';
import { z } from 'zod';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb, requireUid } from '@/lib/firebaseAdmin';
import { deleteRunCompletely } from '@/lib/runDeletion';

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

/*
 * Rename a run.
 *
 * A separate `title` rather than editing `goal`, and the distinction is not
 * pedantic: the goal is what the planner was actually given, it is what every
 * shot in the run was generated from, and it is shown alongside the plan as the
 * record of what was asked for. Letting a rename overwrite it would make the
 * run claim it was built from a brief it never saw.
 *
 * So the title is a label on the card. The goal stays what it was.
 */
/* Nullable, because clearing the name has to be possible. A rename that can
   only ever be replaced by another rename is a one-way door of the same kind as
   the frame removal that could not be undone — and the obvious way to ask for
   "call it what it was again" is to empty the box. */
const Patch = z.object({ title: z.string().trim().max(120).nullable() });

export async function PATCH(req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const { runId } = await ctx.params;

  let uid: string;
  try {
    uid = await requireUid(req);
  } catch {
    return NextResponse.json({ error: 'sign in first' }, { status: 401 });
  }

  const parsed = Patch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'a name is required, up to 120 characters' }, { status: 400 });
  }

  const ref = adminDb().collection('runs').doc(runId);
  const snap = await ref.get();
  // Same answer for "absent" and "not yours": a 403 would confirm the id exists.
  if (!snap.exists || snap.data()!.uid !== uid) {
    return NextResponse.json({ error: 'no such run' }, { status: 404 });
  }

  const title = parsed.data.title?.trim() || null;
  await ref.update({
    // Removed rather than blanked, so `title || goal` in the library reads the
    // same as it did before the run was ever renamed.
    title: title ?? FieldValue.delete(),
    updatedAt: Date.now(),
  });
  return NextResponse.json({ title });
}

/*
 * Delete a run and everything it produced.
 *
 * Irreversible, and the only irreversible thing reachable from the library, so
 * the interface asks twice before it gets here. What goes: the generated frames
 * in Storage, the run's copies of the enrolment captures, every rendered clip in
 * R2, the node documents and the run itself.
 *
 * A render in flight is refused rather than raced. The background task holds no
 * reference to this request and would keep writing frames into a Storage folder
 * that had just been emptied, then attach them to a document that no longer
 * exists — leaving exactly the orphaned images this is meant to remove.
 */
export async function DELETE(req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const { runId } = await ctx.params;

  let uid: string;
  try {
    uid = await requireUid(req);
  } catch {
    return NextResponse.json({ error: 'sign in first' }, { status: 401 });
  }

  const snap = await adminDb().collection('runs').doc(runId).get();
  if (!snap.exists || snap.data()!.uid !== uid) {
    return NextResponse.json({ error: 'no such run' }, { status: 404 });
  }

  const status = snap.data()!.status as string;
  const updatedAt = (snap.data()!.updatedAt ?? snap.data()!.createdAt ?? 0) as number;
  const busy = status === 'planning' || status === 'running' || status === 'rendering';
  /* Unless it has clearly died. A run whose background task was torn down keeps
     its status forever, and refusing on that alone would make a dead run
     permanently undeletable — the same trap the render claim used to set. */
  if (busy && Date.now() - updatedAt < 10 * 60 * 1000) {
    return NextResponse.json(
      { error: 'This run is still working. Wait for it to finish or stop, then delete it.' },
      { status: 409 },
    );
  }

  try {
    const gone = await deleteRunCompletely(uid, runId);
    return NextResponse.json(gone);
  } catch (err) {
    console.error('[run:delete]', runId, err);
    return NextResponse.json({ error: 'could not delete that run' }, { status: 500 });
  }
}
