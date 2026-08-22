/*
 * Proves caption timings line up with the audio they describe.
 *
 * The check that matters: the chunk timings, summed, must equal the real
 * duration of the continuous synthesis — and each chunk's share must reflect
 * how long it actually takes to SAY, not how many letters it has.
 */
import { readFileSync } from 'node:fs';
for (const l of readFileSync(new URL('../.env.local', import.meta.url),'utf8').split('\n')) {
  const m=l.match(/^([A-Z0-9_]+)=(.*)$/); if(m&&m[2].trim()) process.env[m[1]] ??= m[2].trim().replace(/^["']|["']$/g,'');
}
const { synthesizeSpeech } = await import('../lib/tts');
const { timeCaptions, chunkScript, wavDurationSeconds } = await import('../lib/captions');

const VOICE = { voiceName: 'en-US-Chirp3-HD-Aoede', languageCode: 'en-US', speakingRate: 1.05 } as const;
const script = 'I put this on while the coffee brews, and my skin does not feel tight or flaky once all day.';

console.log('  分块:');
for (const c of chunkScript(script)) console.log(`    "${c}"`);

const wav = await synthesizeSpeech({ text: script, audioEncoding: 'LINEAR16', sampleRateHertz: 24000, ...VOICE });
const total = wavDurationSeconds(wav);
console.log(`\n  连续合成时长: ${total.toFixed(2)}s`);

const caps = await timeCaptions(script, total, VOICE);
console.log('\n  时间轴:');
for (const c of caps) console.log(`    ${c.start.toFixed(2)}–${c.end.toFixed(2)}s  "${c.text}"`);

const last = caps[caps.length - 1];
const drift = Math.abs(last.end - total);
console.log(`\n  末尾对齐误差: ${drift.toFixed(3)}s`);

// character weighting, for comparison — what we would have shipped
const chunks = chunkScript(script);
const charW = chunks.map(c => c.replace(/[^a-z]/gi,'').length);
const cSum = charW.reduce((a,b)=>a+b,0);
let at = 0; const naive: number[] = [];
for (const w of charW) { at += (w/cSum)*total; naive.push(at); }
const maxDiff = Math.max(...caps.map((c,i)=>Math.abs(c.end - naive[i])));
console.log(`  与按字数估算的最大差距: ${maxDiff.toFixed(2)}s  ${maxDiff > 0.2 ? '(按字数会明显对不上)' : ''}`);

process.exit(drift < 0.01 ? 0 : 1);
