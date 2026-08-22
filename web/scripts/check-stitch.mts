/*
 * Proves segments join into one clip and that a tail frame can seed the next.
 *
 * Uses the template clips already on disk, so it costs nothing to run — the
 * expensive half (does Veo continue convincingly from a tail frame) is a
 * judgement about pictures, not something a test can assert.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const { stitch, lastFrameOf, segmentsFor } = await import('../lib/stitch');

const dur = (p: string) =>
  parseFloat(
    JSON.parse(
      execFileSync('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_format', p], { encoding: 'utf8' }),
    ).format.duration,
  );

const a = readFileSync(new URL('../public/templates/moon.mp4', import.meta.url));
const b = readFileSync(new URL('../public/templates/noir.mp4', import.meta.url));

const joined = await stitch([a, b]);
writeFileSync('/tmp/stitch-join.mp4', joined);
writeFileSync('/tmp/stitch-a.mp4', a);
writeFileSync('/tmp/stitch-b.mp4', b);
const [da, db, dj] = ['/tmp/stitch-a.mp4', '/tmp/stitch-b.mp4', '/tmp/stitch-join.mp4'].map(dur);
console.log(`  两段 ${da.toFixed(2)}s + ${db.toFixed(2)}s → ${dj.toFixed(2)}s`);

const trimmed = await stitch([a, b], 10);
writeFileSync('/tmp/stitch-trim.mp4', trimmed);
const dt = dur('/tmp/stitch-trim.mp4');
console.log(`  限制 10s → ${dt.toFixed(2)}s`);

const tail = await lastFrameOf(a);
console.log(`  末帧 ${(tail.data.length / 1024).toFixed(0)} KB ${tail.mimeType}`);

console.log(`  15 秒需要 ${segmentsFor(15)} 段；30 秒需要 ${segmentsFor(30)} 段`);

const ok = Math.abs(dj - (da + db)) < 0.5 && Math.abs(dt - 10) < 0.5 && tail.data.length > 1000;
console.log(ok ? '  ✅ 拼接与末帧抽取正常' : '  ❌ 有问题');
process.exit(ok ? 0 : 1);
