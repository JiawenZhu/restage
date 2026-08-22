/*
 * Caption timing for a line we already wrote.
 *
 * Every other tool in this space transcribes its own audio with Whisper to find
 * out when words are spoken. We do not need to: the script is ours, written by
 * writeScript() and shown to the user before anything renders. The text is
 * known exactly. Only the TIMING is unknown.
 *
 * Chirp3-HD — the voice this product uses — will not tell us. Measured against
 * the live API: it accepts SSML `<mark>` and returns ZERO timepoints, while
 * Neural2 returns exact ones. Better voice or free timing, not both.
 *
 * So the timing is measured rather than guessed. Each caption chunk is
 * synthesised on its own purely to learn how long it takes to say, and those
 * durations are normalised against the real, continuously-synthesised audio.
 * Character counts would be the cheap alternative and they are wrong in the way
 * that shows: "through" and "though" differ by one letter and a syllable, and a
 * caption 200ms out of step reads as broken.
 *
 * The audio the viewer hears is still ONE continuous synthesis. Concatenating
 * separately-synthesised chunks would give perfect timing and audibly choppy
 * prosody, because each chunk lands on a sentence-final intonation.
 */
import { synthesizeSpeech, type TTSOptions } from './tts';

export interface Caption {
  text: string;
  /** Seconds from the start of the clip. */
  start: number;
  end: number;
}

/** Duration of a LINEAR16 WAV, from its header. */
export function wavDurationSeconds(wav: Buffer): number {
  // Canonical PCM WAV: byte rate at offset 28, data size after the 'data' tag.
  const byteRate = wav.readUInt32LE(28);
  const dataIdx = wav.indexOf('data', 12, 'ascii');
  if (byteRate <= 0 || dataIdx < 0) return 0;
  const dataSize = wav.readUInt32LE(dataIdx + 4);
  return dataSize / byteRate;
}

/**
 * Break a line into caption-sized pieces.
 *
 * Two to five words is the shape social captions take, and the break should
 * land where a person pauses — after a comma or a conjunction — rather than
 * every N words, which cuts phrases in half.
 */
export function chunkScript(script: string, maxWords = 5): string[] {
  const words = script.replace(/\s+/g, ' ').trim().split(' ');
  const chunks: string[] = [];
  let current: string[] = [];

  const breaksAfter = (w: string) => /[,;:—–]$/.test(w) || /^(and|but|so|then|because|while)$/i.test(w);

  for (const w of words) {
    current.push(w);
    const long = current.length >= maxWords;
    const natural = current.length >= 2 && breaksAfter(w);
    if (long || natural) {
      chunks.push(current.join(' '));
      current = [];
    }
  }
  if (current.length) {
    // A one-word orphan reads worse than a slightly long final chunk.
    if (current.length === 1 && chunks.length) chunks[chunks.length - 1] += ` ${current[0]}`;
    else chunks.push(current.join(' '));
  }
  return chunks;
}

/**
 * Caption timings for a script, measured against its own voice.
 *
 * @param totalSeconds the real duration of the continuous synthesis, which the
 *        per-chunk measurements are normalised to.
 */
export async function timeCaptions(
  script: string,
  totalSeconds: number,
  voice: Pick<TTSOptions, 'voiceName' | 'languageCode' | 'speakingRate'>,
): Promise<Caption[]> {
  const chunks = chunkScript(script);
  if (!chunks.length || totalSeconds <= 0) return [];

  let weights: number[];
  try {
    // Measured, not estimated. Each chunk spoken by the same voice at the same
    // rate, timed.
    weights = await Promise.all(
      chunks.map(async (c) => {
        const wav = await synthesizeSpeech({ text: c, audioEncoding: 'LINEAR16', sampleRateHertz: 24000, ...voice });
        return Math.max(0.2, wavDurationSeconds(wav));
      }),
    );
  } catch (err) {
    // Falling back to syllable-ish weighting is worse, and saying so beats
    // silently shipping captions that drift.
    console.warn('[captions] could not measure chunk durations, falling back to length weighting', err);
    weights = chunks.map((c) => Math.max(1, c.replace(/[^a-z]/gi, '').length));
  }

  const sum = weights.reduce((a, b) => a + b, 0);
  const out: Caption[] = [];
  let at = 0;
  for (let i = 0; i < chunks.length; i++) {
    const dur = (weights[i] / sum) * totalSeconds;
    out.push({ text: chunks[i], start: +at.toFixed(3), end: +(at + dur).toFixed(3) });
    at += dur;
  }
  return out;
}
