import { NextResponse } from 'next/server';
import { consume, tooMany } from '@/lib/rateLimit';
import { requireUid } from '@/lib/firebaseAdmin';
import { z } from 'zod';
import { generateFrame } from '@/lib/gemini';
import { providerFor } from '@/lib/provider';

/*
 * One frame. ~14s measured, which is why the plan runs on frames and only the
 * approved one becomes video: the agent has to be able to afford being wrong.
 */
export const runtime = 'nodejs';
export const maxDuration = 120;

const Body = z.object({
  prompt: z.string().min(4).max(2000),
  aspect: z.enum(['9:16', '16:9']),
  /** Enrolment captures as data URLs — passing them holds one face across scenes. */
  refs: z.array(z.string()).max(3).optional(),
});

/*
 * Data URLs only.
 *
 * This used to fetch any http(s) URL the caller supplied, from the server, with
 * the server's network position — a request forgery primitive pointed at cloud
 * metadata endpoints and anything else reachable from inside the deployment.
 * No caller needs it: references are enrolment captures the client already
 * holds, and they arrive inline.
 */
function resolveImage(u: string): { mimeType: string; data: Buffer } | null {
  const m = u.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!m) return null;
  const data = Buffer.from(m[2], 'base64');
  if (!data.length || data.length > 8 * 1024 * 1024) return null;
  return { mimeType: m[1], data };
}

export async function POST(req: Request) {
  // This call costs money on every invocation. The catch here used to swallow
  // the failure with "allow dev / guest execution", which made the check
  // decorative — an unauthenticated caller could spend the project's quota.
  let uid: string;
  try {
    uid = await requireUid(req);
  } catch {
    return NextResponse.json({ error: 'sign in first' }, { status: 401 });
  }

  // Every call below spends money; nothing capped how many a single account
  // could make.
  const rate = await consume(uid, 'run');
  if (!rate.ok) return tooMany(rate);


  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'prompt and aspect are required' }, { status: 400 });

  const refs = (parsed.data.refs ?? [])
    .map(resolveImage)
    .filter((r): r is NonNullable<typeof r> => !!r);

  try {
    const provider = await providerFor(uid);
    const { bytes, mimeType } = await generateFrame({ prompt: parsed.data.prompt, aspect: parsed.data.aspect, refs, provider, uid });
    return NextResponse.json({ image: `data:${mimeType};base64,${bytes.toString('base64')}` });
  } catch (err) {
    console.error('[frame]', err);
    return NextResponse.json({ error: 'frame generation failed' }, { status: 502 });
  }
}
