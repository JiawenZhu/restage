/*
 * The whole finishing path on a real clip: frames out, timeline in, rendered
 * back, voice under it. Uses a template clip already on disk plus a real
 * synthesis, so it exercises everything except the Veo render.
 */
import { readFileSync, writeFileSync } from 'node:fs';
for (const l of readFileSync(new URL('../.env.local', import.meta.url),'utf8').split('\n')) {
  const m=l.match(/^([A-Z0-9_]+)=(.*)$/); if(m&&m[2].trim()) process.env[m[1]] ??= m[2].trim().replace(/^["']|["']$/g,'');
}
const { synthesizeSpeech } = await import('../lib/tts');
const { timeCaptions, wavDurationSeconds } = await import('../lib/captions');
const { finishAd } = await import('../lib/finishAd');

const VOICE = { voiceName: 'en-US-Chirp3-HD-Aoede', languageCode: 'en-US', speakingRate: 1.05 } as const;
const script = 'I put this on while the coffee brews, and my skin stops feeling tight by about day three.';

const t0 = Date.now();
const wav = await synthesizeSpeech({ text: script, audioEncoding: 'LINEAR16', sampleRateHertz: 24000, ...VOICE });
const spoken = wavDurationSeconds(wav);
console.log(`  配音 ${spoken.toFixed(2)}s`);

const clip = readFileSync(new URL('../public/templates/moon.mp4', import.meta.url));
const captions = await timeCaptions(script, Math.min(spoken, 8), VOICE);
console.log(`  字幕 ${captions.length} 段，最后一段结束于 ${captions[captions.length-1].end.toFixed(2)}s`);

const res = await finishAd({
  clip,
  voice: wav,
  captions,
  kicker: 'THE ORDINARY',
  endCard: { headline: 'Niacinamide 10%', sub: 'Link in bio' },
});

const out = '/tmp/finished-ad.mp4';
writeFileSync(out, res.video);
console.log(`  产出 ${out}  ${(res.video.length/1024/1024).toFixed(1)} MB`);
console.log(`  唯一帧 ${(res.uniqueFrameRatio*100).toFixed(0)}% of ${res.frames}  ${res.uniqueFrameRatio >= 0.6 ? '✅ 健康' : '❌ 有重复帧'}`);
console.log(`  用时 ${((Date.now()-t0)/1000).toFixed(0)}s`);
process.exit(res.uniqueFrameRatio >= 0.6 ? 0 : 1);
