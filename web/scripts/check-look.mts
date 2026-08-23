/*
 * The old photographic direction against the new one, on the same face and the
 * same instruction. Writes both to /tmp so they can be looked at side by side —
 * this is a judgement about a picture and no assertion can stand in for it.
 */
import { readFileSync, writeFileSync } from 'node:fs';
for (const l of readFileSync(new URL('../.env.local', import.meta.url),'utf8').split('\n')) {
  const m=l.match(/^([A-Z0-9_]+)=(.*)$/); if(m&&m[2].trim()) process.env[m[1]] ??= m[2].trim().replace(/^["']|["']$/g,'');
}
const { generateFrame } = await import('../lib/gemini');
const { stillDirection } = await import('../lib/look');

const avatar = readFileSync(new URL('../public/img/persona-front.jpg', import.meta.url));
const ref = { data: avatar, mimeType: 'image/jpeg' };
const instruction = 'Place them at a kitchen counter in the morning, holding a small serum bottle.';

const OLD =
  'IDENTITY ANCHOR: The person is 100% IDENTICAL to the reference photos — exact face geometry, ' +
  'jawline, eye shape, nose bridge, glasses, hairstyle, and skin tone. Do NOT alter, slim, or beautify the face.\n' +
  'Cinematic 4K photograph, natural 35mm shallow depth of field, authentic eye-level smartphone creator ' +
  'composition, realistic skin pores, subsurface scattering, ambient lighting interaction. No text, no logos.';

for (const [name, direction] of [['old', OLD], ['new', stillDirection()]] as const) {
  const t = Date.now();
  const frame = await generateFrame({
    prompt: `Build the opening frame of a UGC ad, 9:16.\n${instruction}\n\n${direction}`,
    aspect: '9:16',
    refs: [ref],
  });
  const out = `/tmp/look-${name}.jpg`;
  writeFileSync(out, frame.bytes);
  console.log(`  ${name}: ${out}  ${(frame.bytes.length/1024).toFixed(0)} KB  ${((Date.now()-t)/1000).toFixed(0)}s`);
}
process.exit(0);
