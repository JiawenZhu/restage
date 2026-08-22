import { NextResponse } from 'next/server';
import { z } from 'zod';
import { adminDb, requireUid } from '@/lib/firebaseAdmin';

/*
 * The human verdict.
 *
 * The critic catches gross identity swaps but not subtle drift — measured
 * against a real run where both verifiers passed a frame the user immediately
 * rejected. So the person is the last line, and until now they had no way to
 * say so: the landing page sold "what you rejected changes how the next session
 * opens", the tree already drew a `rejected` state, and nothing could produce
 * one.
 *
 * Rejecting also records WHAT was rejected on the user's taste model, which is
 * the only mechanism by which a later session could open differently.
 */
export const runtime = 'nodejs';

const Body = z.object({ status: z.enum(['rejected', 'achieved']) });

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ runId: string; nodeId: string }> },
) {
  const { runId, nodeId } = await ctx.params;

  let uid: string;
  try {
    uid = await requireUid(req);
  } catch {
    return NextResponse.json({ error: 'sign in first' }, { status: 401 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'status is required' }, { status: 400 });

  const db = adminDb();
  const runRef = db.collection('runs').doc(runId);
  const runSnap = await runRef.get();
  if (!runSnap.exists || runSnap.data()!.uid !== uid) {
    return NextResponse.json({ error: 'no such run' }, { status: 404 });
  }

  const nodeRef = runRef.collection('nodes').doc(nodeId);
  const nodeSnap = await nodeRef.get();
  if (!nodeSnap.exists) return NextResponse.json({ error: 'no such node' }, { status: 404 });

  const node = nodeSnap.data()!;
  if (node.kind !== 'frame') {
    return NextResponse.json({ error: 'only frames can be judged' }, { status: 400 });
  }

  await nodeRef.update({ status: parsed.data.status, judgedByUser: true });

  if (parsed.data.status === 'rejected' && node.instruction) {
    /*
     * What the user turned down, in their own run's words. Server-written and
     * client-readable, exactly as the rules already specify — a taste model the
     * user could edit would stop being a record of what they actually rejected.
     */
    await db
      .collection('users')
      .doc(uid)
      .collection('taste')
      .doc(`rejected_${runId}_${nodeId}`)
      .set({
        instruction: node.instruction,
        criticNotes: node.criticNotes ?? null,
        runId,
        nodeId,
        at: Date.now(),
      });
  }

  return NextResponse.json({ status: parsed.data.status });
}
