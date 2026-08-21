import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUid } from '@/lib/firebaseAdmin';
import { regenerateNode } from '@/lib/orchestrator';

export const runtime = 'nodejs';
export const maxDuration = 120;

const Body = z.object({
  nodeId: z.string().min(1),
  instruction: z.string().min(4).max(1200),
});

export async function POST(req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const { runId } = await ctx.params;
  let uid: string;
  try {
    uid = await requireUid(req);
  } catch {
    return NextResponse.json({ error: 'sign in first' }, { status: 401 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'nodeId and instruction are required' }, { status: 400 });

  try {
    const nodeId = await regenerateNode({ runId, uid, sourceNodeId: parsed.data.nodeId, instruction: parsed.data.instruction });
    return NextResponse.json({ nodeId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'regenerate failed';
    return NextResponse.json({ error: msg }, { status: msg === 'no such run' ? 404 : 400 });
  }
}
