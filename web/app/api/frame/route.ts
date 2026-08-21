import { NextResponse } from 'next/server';
import { z } from 'zod';
import { generateFrame } from '@/lib/gemini';

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

function decodeDataUrl(u: string): { data: Buffer; mimeType: string } | null {
  const m = u.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return null;
  return { mimeType: m[1], data: Buffer.from(m[2], 'base64') };
}

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'prompt and aspect are required' }, { status: 400 });

  const refs = (parsed.data.refs ?? []).map(decodeDataUrl).filter((r): r is NonNullable<typeof r> => !!r);

  try {
    const { bytes, mimeType } = await generateFrame({ prompt: parsed.data.prompt, aspect: parsed.data.aspect, refs });
    return NextResponse.json({ image: `data:${mimeType};base64,${bytes.toString('base64')}` });
  } catch (err) {
    console.error('[frame]', err);
    return NextResponse.json({ error: 'frame generation failed' }, { status: 502 });
  }
}
