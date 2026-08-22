import { NextResponse } from 'next/server';
import { requireUid } from '@/lib/firebaseAdmin';
import { consume, tooMany } from '@/lib/rateLimit';
import { synthesizeSpeech } from '@/lib/tts';

export async function POST(req: Request) {
  // Synthesis is billed per character and this route had no auth and no length
  // bound — an open endpoint anyone could point a loop at.
  let uid: string;
  try {
    uid = await requireUid(req);
  } catch {
    return NextResponse.json({ error: 'sign in first' }, { status: 401 });
  }

  // Billed per character, and the last route without a ceiling.
  const rate = await consume(uid, 'text');
  if (!rate.ok) return tooMany(rate);

  try {
    const body = await req.json();
    const { text, voiceName, languageCode, speakingRate, pitch, audioEncoding } = body;

    if (!text || typeof text !== 'string') {
      return NextResponse.json({ error: 'Missing required field: text' }, { status: 400 });
    }
    if (text.length > 2000) {
      return NextResponse.json({ error: 'text is longer than 2000 characters' }, { status: 413 });
    }

    const audioBuffer = await synthesizeSpeech({
      text,
      voiceName,
      languageCode,
      speakingRate,
      pitch,
      audioEncoding: audioEncoding || 'MP3',
      sampleRateHertz: 24000,
    });

    return new Response(new Uint8Array(audioBuffer), {
      status: 200,
      headers: {
        'Content-Type': audioEncoding === 'LINEAR16' ? 'audio/wav' : 'audio/mpeg',
        'Content-Length': audioBuffer.length.toString(),
      },
    });
  } catch (err: any) {
    console.error('TTS API error:', err);
    return NextResponse.json({ error: err.message || 'TTS synthesis failed' }, { status: 500 });
  }
}
