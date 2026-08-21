import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUid } from '@/lib/firebaseAdmin';
import { createRun, executeRun } from '@/lib/orchestrator';

export const runtime = 'nodejs';
export const maxDuration = 300;

const Body = z.object({
  goal: z.string().min(8).max(600),
  aspect: z.enum(['9:16', '16:9']),
  seconds: z.union([z.literal(8), z.literal(15), z.literal(30)]),
  avatarDataUrl: z.string().startsWith('data:image/'),
});

export async function POST(req: Request) {
  let uid: string;
  try {
    uid = await requireUid(req);
  } catch {
    return NextResponse.json({ error: 'sign in first' }, { status: 401 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid run request' }, { status: 400 });

  const args = { uid, ...parsed.data };
  const runId = await createRun(args);

  // Deliberately not awaited. The run takes 1-3 minutes and the client watches
  // Firestore rather than this response — holding the connection open would add
  // a timeout to fail at without making anything land sooner.
  void executeRun(runId, args);

  return NextResponse.json({ runId });
}
