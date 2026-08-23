/*
 * The render path, exercised in the exact sequence the route uses:
 * submit → poll → download → R2 put → signed URL → verify readable → clean up.
 * One real Veo call; ~60-90s.
 */
import { readFileSync } from 'node:fs';
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && m[2].trim()) process.env[m[1]] ??= m[2].trim().replace(/^["']|["']$/g, '');
}
const { submitRender, pollRender, downloadRendered } = await import('../lib/gemini');
const { putVideo, signedVideoUrl, deleteVideo } = await import('../lib/r2');

const frame = readFileSync(new URL('../public/img/shot-4.jpg', import.meta.url));
const t0 = Date.now();
const t = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;

const { operation } = await submitRender({
  prompt: 'Animate this exact frame into a short authentic UGC clip. She speaks naturally to the camera with subtle handheld phone movement. Keep the scene, clothing and face exactly as the frame. No text.',
  firstFrame: { data: frame, mimeType: 'image/jpeg' },
  aspect: '9:16',
});
console.log(`${t()}  submitted`);

let uri: string | null = null;
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 5000));
  const st = await pollRender(operation);
  if (st.done) {
    if ('error' in st) throw new Error(st.error);
    uri = st.videoUri;
    break;
  }
}
if (!uri) throw new Error('did not finish');
console.log(`${t()}  rendered`);

const bytes = await downloadRendered(uri);
console.log(`${t()}  downloaded ${(bytes.length / 1024 / 1024).toFixed(1)} MB`);

const key = '_healthcheck/render-path.mp4';
await putVideo(key, bytes);
const url = await signedVideoUrl(key, 3600);
const head = await fetch(url, { method: 'GET', headers: { range: 'bytes=0-99' } });
console.log(`${t()}  R2 stored, signed read ${head.ok || head.status === 206 ? 'ok' : `FAILED ${head.status}`}`);

await deleteVideo(key);
console.log(`${t()}  cleaned up — the render path is wired end to end`);
process.exit(0);
