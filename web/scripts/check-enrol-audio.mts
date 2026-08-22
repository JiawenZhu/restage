/*
 * Enrolment must survive a user who has no voice to give.
 *
 * The voice sample is optional on screen, optional in the copy, and read by
 * nothing — and it has now failed a whole enrolment three separate times:
 *
 *   1. The data-URL regex could not cross a ';', so 'audio/webm;codecs=opus'
 *      (Chrome, Edge) and 'audio/ogg; codecs=opus' (Firefox) were refused —
 *      i.e. every real recording, in every browser.
 *   2. `.optional()` accepted undefined but not null, and the upload path sent
 *      an explicit null.
 *   3. A microphone that granted permission and produced no data left an empty
 *      chunk array; `new Blob([])` is a real, TRUTHY, 0-byte Blob, which encoded
 *      to "data:audio/webm;base64," with nothing after the comma and failed the
 *      trailing `.+`.
 *
 * Every time, the cost was three good photographs and four capture steps
 * discarded over a field nobody is required to fill. Variant 3 is the worst of
 * the three because it selects for precisely the people who cannot supply a
 * sample: those with no working microphone.
 *
 * So the rule under test is not "does the regex match" but the stronger one:
 * A BAD VOICE SAMPLE IS THE SAME AS NO VOICE SAMPLE, and the photographs — which
 * genuinely are required — are still strictly checked.
 *
 *   npx tsx scripts/check-enrol-audio.mts
 */
import { readFileSync } from 'node:fs';
import { z } from 'zod';

const ROUTE = readFileSync(new URL('../app/api/avatars/route.ts', import.meta.url), 'utf8');
const CAMERA = readFileSync(new URL('../components/enroll/EnrollmentCamera.tsx', import.meta.url), 'utf8');

let failed = 0;
const check = (ok: boolean, label: string, detail = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? `  ${detail}` : ''}`);
  if (!ok) failed++;
};

/*
 * The schema, modelled from the route.
 *
 * A copy that drifts is worse than no test, so the assertions in the last
 * section fail if the route stops doing what this models.
 */
const dataUrl = z
  .string()
  .regex(/^data:(image|audio)\/[a-zA-Z0-9.+-]+(\s*;[^;,]+)*;base64,.+$/, 'must be a data URL');

const Body = z.object({
  name: z.string().max(80).optional(),
  front: dataUrl,
  left: dataUrl,
  right: dataUrl,
  audio: z
    .string()
    .nullish()
    .transform((v) => (v && dataUrl.safeParse(v).success ? v : null)),
});

const PHOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
const photos = { front: PHOTO, left: PHOTO, right: PHOTO };

/* ── the voice sample, in every state a real browser produces ─────────────── */
console.log('════ 没有声音也必须能存下来 ════\n');

const audioCases: [string, unknown, boolean, string][] = [
  ['Chrome / Edge 的录音', 'data:audio/webm;codecs=opus;base64,GkXfo0A=', true, '带 ;codecs= 参数'],
  ['Firefox 的录音', 'data:audio/ogg; codecs=opus;base64,T2dnUwA=', true, '参数前还有个空格'],
  ['Safari 的录音', 'data:audio/mp4;base64,AAAAHGZ0eXA=', true, ''],
  ['完全没录（字段缺失）', undefined, false, '点了「跳过」'],
  ['显式的 null', null, false, '上传路径就是这么发的'],
  ['麦克风没出声音 → 0 字节', 'data:audio/webm;base64,', false, '← 第三次把整个注册搞挂的就是它'],
  ['乱七八糟的字符串', 'hello', false, '不该让它炸掉照片'],
  ['空字符串', '', false, ''],
];

for (const [label, audio, shouldKeep, why] of audioCases) {
  const body: Record<string, unknown> = { ...photos };
  if (audio !== undefined) body.audio = audio;
  const r = Body.safeParse(body);

  // The load-bearing assertion: it PARSES either way. The enrolment survives.
  check(r.success, `${label} —— 注册不会失败`, why);
  if (r.success) {
    const kept = r.data.audio !== null;
    check(
      kept === shouldKeep,
      `    ${shouldKeep ? '声音被保存' : '当作「没有声音」处理'}`,
      shouldKeep ? '' : '（不是报错，是当没有）',
    );
  }
}

/* ── the photographs are still required ───────────────────────────────────── */
console.log('\n════ 但是三张照片仍然是必须的 ════\n');

check(
  !Body.safeParse({ left: PHOTO, right: PHOTO }).success,
  '少一张照片就拒绝',
  '（宽松的是声音，不是照片）',
);
check(
  !Body.safeParse({ ...photos, front: 'not-a-data-url' }).success,
  '照片格式不对也拒绝',
);
check(
  Body.safeParse({ ...photos }).success,
  '三张照片齐了就能存，哪怕一句话都没录',
);

/* ── the source really does this ──────────────────────────────────────────── */
console.log('\n════ 代码里确实是这么写的 ════\n');

check(
  /audio:\s*z[\s\S]{0,200}\.nullish\(\)[\s\S]{0,200}\.transform\(/.test(ROUTE),
  '路由里 audio 用的是 transform 而不是校验',
  '（坏的就当没有，而不是 400）',
);
check(
  !/audio:\s*dataUrl\.nullish\(\),/.test(ROUTE),
  '不再直接拿 dataUrl 校验 audio',
  '（那正是会把整个注册顶掉的写法）',
);
check(
  /if \(blob\.size > 0\)/.test(CAMERA),
  '前端不会把 0 字节的录音当成样本',
);
check(
  /audioBlob && audioBlob\.size > 0/.test(CAMERA),
  '上传前也检查了 size，而不是只看真假值',
  '（空 Blob 是个对象，永远是 truthy）',
);
check(
  /Skip — no voice sample/.test(CAMERA),
  '录音这一步有「跳过」按钮',
);

console.log(`\n${failed === 0 ? '✅ 全部通过' : `❌ ${failed} 项失败`}`);
process.exit(failed === 0 ? 0 : 1);
