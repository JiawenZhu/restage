import { NextResponse } from 'next/server';
import { z } from 'zod';
import { adminDb, requireUid } from '@/lib/firebaseAdmin';
import { changedFields, impactOf, regenerateEstimate, type ImpactNode, type LookField } from '@/lib/impact';
import { deriveLook } from '@/lib/gemini';
import { providerOfRun } from '@/lib/provider';
import { rebuildStaleSteps } from '@/lib/orchestrator';
import { consume, tooMany } from '@/lib/rateLimit';
import { uploadToStorage } from '@/lib/orchestrator';

/*
 * Change the shoot: the product, the place, the light, the clothes, the person.
 *
 * Two calls, deliberately. Saving a change is instant and free and tells you
 * what it invalidated; regenerating is a paid, minutes-long job that only
 * happens when somebody asks for it by name. Folding them together would mean a
 * typo in the location field silently spends six generations.
 *
 * Marking stale is not the same as regenerating. A stale shot stays on the
 * canvas, still viewable, labelled as out of date — so a user who changes their
 * mind about the product and then changes it back has lost nothing.
 */
export const runtime = 'nodejs';
export const maxDuration = 300;

const LookPatch = z.object({
  location: z.string().trim().max(400).optional(),
  wardrobe: z.string().trim().max(400).optional(),
  light: z.string().trim().max(400).optional(),
  palette: z.string().trim().max(400).optional(),
  product: z.string().trim().max(400).optional(),
});

const Body = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('save'),
    look: LookPatch.optional(),
    /** A different enrolled face for this run. Its own kind of change. */
    avatarId: z.string().max(64).optional(),
  }),
  /* Read an existing run and work out what it was a shoot of. Every run made
     before shot lists existed has no look and no shot kinds, which would make
     the impact model answer "nothing breaks" to a product swap. */
  z.object({ action: z.literal('derive') }),
  z.object({
    action: z.literal('regenerate'),
    /** Exactly which shots to remake. The user chose these in the modal. */
    nodeIds: z.array(z.string().min(1)).min(1).max(24),
  }),
]);

export async function POST(req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const { runId } = await ctx.params;

  let uid: string;
  try {
    uid = await requireUid(req);
  } catch {
    return NextResponse.json({ error: 'sign in first' }, { status: 401 });
  }

  const db = adminDb();
  const runRef = db.collection('runs').doc(runId);
  const runSnap = await runRef.get();
  if (!runSnap.exists || runSnap.data()!.uid !== uid) {
    return NextResponse.json({ error: 'no such run' }, { status: 404 });
  }
  const run = runSnap.data()!;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'unknown request' }, { status: 400 });

  const nodes = (await runRef.collection('nodes').orderBy('createdAt').get()).docs.map((d) => ({
    id: d.id,
    ...(d.data() as Record<string, unknown>),
  })) as unknown as ImpactNode[];

  /* ── work out what an older run was a shoot of ──────────────────────────── */
  if (parsed.data.action === 'derive') {
    const frames = nodes.filter((n) => n.kind === 'frame' && n.frameUrl && !n.discarded);
    if (!frames.length) return NextResponse.json({ error: 'this run has no frames to read' }, { status: 400 });

    const { look, kinds } = await deriveLook(
      (run.goal as string) ?? '',
      frames.map((n) => ({ id: n.id, stepNo: n.stepNo, label: n.label, instruction: (n as { instruction?: string }).instruction })),
      providerOfRun(run as { provider?: string }),
      run.uid as string,
    );

    const known = new Set(frames.map((n) => n.id));
    const batch = db.batch();
    let tagged = 0;
    for (const k of kinds) {
      // Only ids that were actually in the listing. A model that invents one
      // would otherwise create an empty node document here.
      if (!known.has(k.id)) continue;
      batch.update(runRef.collection('nodes').doc(k.id), { shot: k.shot });
      tagged++;
    }
    batch.update(runRef, { look, updatedAt: Date.now() });
    await batch.commit();

    return NextResponse.json({ look, tagged, total: frames.length });
  }

  /* ── regenerate the shots the user picked ───────────────────────────────── */
  if (parsed.data.action === 'regenerate') {
    // The only branch that spends anything.
    const rate = await consume(uid, 'run');
    if (!rate.ok) return tooMany(rate);

    if (run.status === 'running' || run.status === 'planning' || run.status === 'rendering') {
      return NextResponse.json({ error: 'this run is already working — wait for it to finish' }, { status: 409 });
    }

    /* Mark the chosen ones stale before rebuilding. The certain shots were
       already marked when the change was saved, but a PERSON shot the user
       ticked in the modal was deliberately left alone until they decided — and
       a rebuild that does not mark it would leave the canvas claiming it is
       current while it is being replaced. */
    const batch = db.batch();
    for (const id of parsed.data.nodeIds) {
      batch.update(runRef.collection('nodes').doc(id), { stale: true });
    }
    await batch.commit();

    const count = await rebuildStaleSteps(runId, uid, parsed.data.nodeIds);
    return NextResponse.json({ rebuilding: count, ...regenerateEstimate(count) });
  }

  /* ── save a change and report what it broke ─────────────────────────────── */
  const before = (run.look ?? null) as Record<string, string> | null;
  const patch = parsed.data.look ?? {};

  const changed: LookField[] = changedFields(before, patch);

  /*
   * Swapping the face is a change to the shoot like any other, and it is
   * handled here rather than in its own route because its CONSEQUENCE is the
   * same shape: some shots no longer match, and the user has to decide whether
   * to pay to remake them.
   */
  let newRootUrl: string | null = null;
  if (parsed.data.avatarId && parsed.data.avatarId !== run.avatarId) {
    const av = await db.collection('users').doc(uid).collection('avatars').doc(parsed.data.avatarId).get();
    const paths = av.data()?.paths as { front?: string; left?: string; right?: string } | undefined;
    if (!av.exists || !paths?.front) {
      return NextResponse.json({ error: 'that face is not enrolled' }, { status: 400 });
    }

    /* Copied into the run's own folder, exactly as createRun does. A run has to
       own its inputs: pointing at the avatar's folder would mean deleting the
       avatar silently breaks every image in a run that still exists. */
    const bucket = (await import('@/lib/firebaseAdmin')).adminStorage().bucket(
      process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'restage-studio.firebasestorage.app',
    );
    const read = async (p?: string) => (p ? (await bucket.file(p).download())[0] : null);

    const front = await read(paths.front);
    newRootUrl = await uploadToStorage(front!, `users/${uid}/runs/${runId}/avatar.jpg`);
    const views: Record<string, string> = {};
    for (const [k, p] of Object.entries({ left: paths.left, right: paths.right })) {
      const buf = await read(p);
      if (buf) views[k] = await uploadToStorage(buf, `users/${uid}/runs/${runId}/views/${k}.jpg`);
    }

    await runRef.update({
      avatarId: parsed.data.avatarId,
      avatarMultiViews: { front: newRootUrl, ...views },
      updatedAt: Date.now(),
    });
    // The root node IS the source avatar on the canvas.
    await runRef.collection('nodes').doc('root').update({ frameUrl: newRootUrl }).catch(() => {});
    changed.push('avatar');
  }

  if (!changed.length) {
    return NextResponse.json({ changed: [], shots: [], summary: 'Nothing changed.', certainCount: 0, possibleCount: 0, untouched: 0, seconds: 0, label: 'nothing to do' });
  }

  if (Object.keys(patch).length) {
    await runRef.update({ look: { ...(before ?? {}), ...patch }, updatedAt: Date.now() });
  }

  const impact = impactOf(changed, nodes);

  /*
   * Only the CERTAIN ones are marked. A person shot that might have been
   * holding the old product is left alone until the user says so — marking it
   * would put "needs rebuilding" on a frame that may be perfectly fine, and the
   * only way back from that is to pay for a regeneration.
   */
  const certain = impact.shots.filter((s) => s.certain);
  if (certain.length) {
    const batch = db.batch();
    for (const s of certain) batch.update(runRef.collection('nodes').doc(s.id), { stale: true });
    await batch.commit();
  }

  return NextResponse.json({
    ...impact,
    ...regenerateEstimate(impact.certainCount),
    avatarUrl: newRootUrl,
  });
}
