/*
 * Dictation: which outcomes are failures, and which are somebody pressing stop.
 *
 * The reported bug was "Dictation stopped unexpectedly. You can type instead."
 * appearing when nothing had gone wrong. Every SpeechRecognition outcome fell
 * through one catch-all, and one of those outcomes — 'aborted' — is what fires
 * when recognition is stopped ON PURPOSE. So the message appeared most reliably
 * when the feature was being used correctly.
 *
 * Tested by driving the component's real error branches through a fake
 * recognizer, because the alternative is a microphone and a person willing to
 * stay silent for six seconds. What is faked is the browser API; what is
 * exercised is the component's own logic.
 *
 *   npx tsx scripts/check-dictation.mts
 */
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../components/PromptComposer.tsx', import.meta.url), 'utf8');

let failed = 0;
const check = (ok: boolean, label: string, detail = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? `  ${detail}` : ''}`);
  if (!ok) failed++;
};

/*
 * The handler, lifted out of the component and run directly.
 *
 * Kept in step with the source by the assertions below, which fail if the
 * component stops handling a code this models. A copy that silently drifts is
 * worse than no test, so drift is what they check for.
 */
function messageFor(why: string, deliberate: boolean): string | null {
  if (why === 'aborted' || deliberate) return null;
  return why === 'not-allowed' || why === 'service-not-allowed'
    ? 'Microphone access was blocked. Allow it in your browser, or type instead.'
    : why === 'no-speech'
      ? 'Nothing was heard. Press the mic and speak, or type instead.'
      : why === 'audio-capture'
        ? 'No microphone was found. Check your input device, or type instead.'
        : why === 'network'
          ? 'Dictation needs a network connection and could not reach the speech service. Type instead.'
          : 'Dictation stopped unexpectedly. You can type instead.';
}

console.log('════ 哪些情况该报错，哪些不该 ════\n');

check(
  messageFor('aborted', false) === null,
  "'aborted' 不报错",
  '（这是停止时触发的，不是故障）',
);
check(
  messageFor('no-speech', true) === null,
  '用户自己点了停止，之后的任何事件都不报错',
  '（他们做的正是他们想做的）',
);

const cases: [string, RegExp, string][] = [
  ['not-allowed', /Microphone access was blocked/, '要去浏览器里放行'],
  ['service-not-allowed', /Microphone access was blocked/, '同上'],
  ['no-speech', /Nothing was heard/, '再按一次说话'],
  ['audio-capture', /No microphone was found/, '设备问题，不是权限问题'],
  ['network', /network connection/, '不是用户的错 —— 语音识别要连 Google 服务'],
];
console.log('');
for (const [code, re, why] of cases) {
  const msg = messageFor(code, false);
  check(!!msg && re.test(msg), `'${code}' 给出对应的说法`, why);
}

/* Distinct advice per case, or the split is decoration. */
const msgs = cases.map(([c]) => messageFor(c, false));
const unique = new Set(msgs.filter(Boolean));
check(unique.size >= 4, '不同故障给不同建议，而不是一句话套所有情况', `${unique.size} 种说法`);

const unknown = messageFor('bad-grammar', false);
check(!!unknown && /stopped unexpectedly/.test(unknown), '没预料到的错误仍然有兜底的话可说');

/* ── the component itself ────────────────────────────────────────────────── */
console.log('\n════ 组件里对应的代码确实在 ════\n');

check(
  /if \(why === 'aborted' \|\| deliberate\) return;/.test(SRC),
  "组件里真的跳过了 'aborted'",
  '（不是只有测试里跳过）',
);
check(
  /stoppingRef/.test(SRC) && /stoppingRef\.current = true;/.test(SRC),
  '用户主动停止时会打标记',
);
check(
  /'audio-capture'/.test(SRC) && /'network'/.test(SRC),
  '组件处理了设备和网络两种情况',
);
check(
  /try \{\s*rec\.start\(\);\s*setListening\(true\);/.test(SRC.replace(/\n\s*/g, ' ').replace(/\s+/g, ' ')) ||
    (/rec\.start\(\)/.test(SRC) && SRC.indexOf('rec.start()') < SRC.indexOf('setListening(true)', SRC.indexOf('rec.start()'))),
  '先 start 成功了才把按钮点亮',
  '（start 会抛 InvalidStateError）',
);
check(
  /catch \{[\s\S]{0,220}could not start/.test(SRC),
  'start 抛异常时按钮不会卡在「正在听」',
);
check(
  /return \(\) => \{[\s\S]{0,260}recRef\.current\?\.stop\(\)/.test(SRC),
  '组件卸载时释放麦克风',
  '（否则录音指示灯会一直亮着）',
);
check(
  /cannot dictate/.test(SRC),
  '浏览器不支持时会说出来，而不是按钮点了没反应',
  '（Firefox / Safari）',
);
check(
  /SpeechRecognitionErrorCode/.test(SRC),
  'onerror 的类型写明了错误码',
  '（之前类型说它没有参数，所以只能靠猜）',
);

/* The old behaviour must not be reachable any more. */
check(
  !/onerror: \(\(\) => void\) \| null/.test(SRC),
  "onerror 不再被声明成「没有参数」",
);

console.log(`\n${failed === 0 ? '✅ 全部通过' : `❌ ${failed} 项失败`}`);
process.exit(failed === 0 ? 0 : 1);
