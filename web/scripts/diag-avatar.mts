/*
 * What the model actually receives as "this person".
 *
 * The complaint is that /studio/demo produces good frames and a personal avatar
 * produces worse ones. The demo seeds from a curated stock portrait; a personal
 * avatar seeds from a webcam capture. If the capture is small, soft, or badly
 * lit, every frame in the run inherits that and no prompt can recover it.
 *
 *   npx tsx scripts/diag-avatar.mts <uid> [avatarId]
 */
import { readFileSync, writeFileSync } from 'node:fs';
for (const l of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && m[2].trim()) process.env[m[1]] ??= m[2].trim().replace(/^["']|["']$/g, '');
}
const { adminDb, adminStorage } = await import('../lib/firebaseAdmin');
const { execFile } = await import('node:child_process');
const { promisify } = await import('node:util');
const exec = promisify(execFile);

const uid = process.argv[2];
const only = process.argv[3];
if (!uid) throw new Error('usage: diag-avatar.mts <uid> [avatarId]');

const snap = await adminDb().collection('users').doc(uid).collection('avatars').get();
console.log(`${snap.size} avatar(s) for ${uid}\n`);

for (const doc of snap.docs) {
  if (only && doc.id !== only) continue;
  const d = doc.data();
  console.log(`════ ${doc.id} ════`);
  console.log(`  name       ${JSON.stringify(d.name)}`);
  console.log(`  createdAt  ${d.createdAt}`);
  console.log(`  audio      ${d.audioPath ? 'yes' : 'no'}`);
  const paths = (d.paths ?? {}) as Record<string, string>;
  console.log(`  paths      ${JSON.stringify(Object.keys(paths))}`);

  for (const [view, p] of Object.entries(paths)) {
    if (!p) continue;
    try {
      const [buf] = await adminStorage().bucket().file(p).download();
      const tmp = `/tmp/av_${doc.id}_${view}.jpg`;
      writeFileSync(tmp, buf);
      const { stdout } = await exec('ffprobe', [
        '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height',
        '-of', 'csv=p=0',
        tmp,
      ]);
      const [w, h] = stdout.trim().split(',').map(Number);

      // Sharpness, the same way the capture HUD picks its best frame:
      // variance of the Laplacian. Low variance means a soft or blurred image.
      let sharp = 'n/a';
      try {
        const { stdout: sig } = await exec('ffmpeg', [
          '-v', 'error', '-i', tmp,
          '-vf', 'format=gray,convolution=0 -1 0 -1 4 -1 0 -1 0:0 -1 0 -1 4 -1 0 -1 0:0 -1 0 -1 4 -1 0 -1 0:0 -1 0 -1 4 -1 0 -1 0,signalstats,metadata=print:key=lavfi.signalstats.YAVG',
          '-f', 'null', '-',
        ]);
        const m = sig.match(/YAVG=([\d.]+)/);
        if (m) sharp = `edge-energy ${Number(m[1]).toFixed(2)}`;
      } catch { /* optional */ }

      console.log(
        `   ${view.padEnd(6)} ${String(w).padStart(5)}x${String(h).padEnd(5)} ` +
        `${(buf.length / 1024).toFixed(0).padStart(5)} KB  ${sharp}  → ${tmp}`,
      );
    } catch (e) {
      console.log(`   ${view.padEnd(6)} FAILED: ${(e as Error).message.slice(0, 90)}`);
    }
  }
  console.log();
}
process.exit(0);
