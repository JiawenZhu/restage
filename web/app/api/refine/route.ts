import { NextResponse } from 'next/server';
import { consume, tooMany } from '@/lib/rateLimit';
import { z } from 'zod';
import { requireUid } from '@/lib/firebaseAdmin';
import { refinePrompt } from '@/lib/gemini';

export const runtime = 'nodejs';
export const maxDuration = 60;

const Body = z.object({
  raw: z.string().min(2).max(800),
  purpose: z.enum(['goal', 'edit']),
});

export async function POST(req: Request) {
  let uid: string;
  try {
    uid = await requireUid(req);
  } catch {
    return NextResponse.json({ error: 'sign in first' }, { status: 401 });
  }

  // Every call below spends money; nothing capped how many a single account
  // could make.
  const rate = await consume(uid, 'text');
  if (!rate.ok) return tooMany(rate);

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'raw and purpose are required' }, { status: 400 });

  try {
    const refined = await refinePrompt(parsed.data.raw, parsed.data.purpose);
    return NextResponse.json({ refined });
  } catch (err) {
    console.error('[refine]', err);
    return NextResponse.json({ error: 'refine failed' }, { status: 502 });
  }
}
