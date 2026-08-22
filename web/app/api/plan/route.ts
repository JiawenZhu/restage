import { NextResponse } from 'next/server';
import { requireUid } from '@/lib/firebaseAdmin';
import { z } from 'zod';
import { planRun } from '@/lib/gemini';

/*
 * Planning is a text call and takes ~7s measured. It runs here rather than in a
 * job because nothing renders until the user has read the plan — waiting for it
 * IS the planning state, not a stall to hide.
 */
export const runtime = 'nodejs';
export const maxDuration = 60;

const Body = z.object({
  goal: z.string().min(8).max(600),
  aspect: z.enum(['9:16', '16:9']),
  seconds: z.union([z.literal(8), z.literal(15), z.literal(30)]),
  templateId: z.string().optional(),
});

export async function POST(req: Request) {
  // These calls cost real money; they were anonymous before auth existed.
  try {
    await requireUid(req);
  } catch {
    return NextResponse.json({ error: 'sign in first' }, { status: 401 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'goal, aspect and seconds are required' }, { status: 400 });
  }

  try {
    const steps = await planRun(
      parsed.data.goal,
      parsed.data.aspect,
      parsed.data.seconds,
      parsed.data.templateId
    );
    return NextResponse.json({ steps });
  } catch (err) {
    // The adapter already scrubs `key=`; this keeps the response body from
    // carrying anything else the caller has no business seeing.
    console.error('[plan]', err);
    return NextResponse.json({ error: 'planning failed' }, { status: 502 });
  }
}
