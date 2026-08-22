/*
 * Two kinds of user, and the rules that keep them apart.
 *
 *   BYOK — the user pastes their own Google AI Studio key. Google bills them.
 *          We spend their key and nobody else's.
 *   PAID — the user pays Restage, and the work runs on infrastructure we own.
 *
 * The user is never told which API is behind "paid"; that is our business, not
 * a promise. What matters here is that the two never cross, in either
 * direction:
 *
 *   A paid run must not spend a user's key.
 *   A BYOK run must not reach the infrastructure we pay for.
 *   And nobody may put themselves on the paid plan by writing to Firestore.
 *
 * That last one is not hypothetical. `users/{uid}` is owner-writable, so a
 * `plan` field stored there would make upgrading yourself one setDoc() from the
 * browser console, with a bill as the only evidence.
 *
 * Runs offline by default and touches no API, so it is safe on a rate-limited
 * key and costs nothing.
 *
 *   npx tsx scripts/check-providers.mts          rules only, no network
 *   npx tsx scripts/check-providers.mts --live   also calls both doors once
 */
import { readFileSync } from 'node:fs';
for (const l of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && m[2].trim()) process.env[m[1]] ??= m[2].trim().replace(/^["']|["']$/g, '');
}
process.env.RESTAGE_KEY_SECRET ??= 'test-only-secret-for-check-providers';
const LIVE = process.argv.includes('--live');

const P = await import('../lib/provider');
const { batchAvailable } = await import('../lib/batch');
const { omniAvailable } = await import('../lib/gemini');

const SRC = readFileSync(new URL('../lib/provider.ts', import.meta.url), 'utf8');
const ORCH = readFileSync(new URL('../lib/orchestrator.ts', import.meta.url), 'utf8');
const KEYROUTE = readFileSync(new URL('../app/api/account/key/route.ts', import.meta.url), 'utf8');
const RULES = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');

let failed = 0;
const check = (ok: boolean, label: string, detail = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? `  ${detail}` : ''}`);
  if (!ok) failed++;
};

/* ── who goes where ───────────────────────────────────────────────────────── */
console.log('════ 两种用户，各走各的门 ════\n');

check(P.PROVIDER_FOR_PLAN.byok === 'api-key', '自带 key 的用户 → 用他自己的 key');
check(P.PROVIDER_FOR_PLAN.paid === 'vertex', '付费用户 → 走我们自己的基础设施');
check(
  /snap\.data\(\)\?\.plan === 'paid' \? 'paid' : 'byok'/.test(SRC),
  "只有明确写着 'paid' 才算付费",
  '（字段缺失 = 自带 key）',
);
check(/return 'byok';/.test(SRC), '读不到 plan 时降级成自带 key', '（不是升级成付费）');
check(P.providerOfRun({ provider: 'vertex' }) === 'vertex', 'run 记着哪扇门就走哪扇');
check(P.providerOfRun({}) === 'api-key', '老 run 没这字段时不会跑到付费那边');
check(P.providerOfRun(null) === 'api-key', 'run 读不到时也不会');

/* ── the money hole ───────────────────────────────────────────────────────── */
console.log('\n════ 不能自己把自己升级成付费 ════\n');

check(
  /match \/private\/\{document\} \{\s*allow read, write: if false;/.test(RULES),
  'plan 和 key 放在客户端读写不到的子集合里',
  '（users/{uid} 本身是 owner 可写的）',
);
check(
  /collection\('private'\)\.doc\('account'\)/.test(SRC),
  '服务端从 private/account 读，不是从用户文档读',
);
check(!/\bplan\b/.test(KEYROUTE.split('export async function POST')[1] ?? ''), 'key 路由不写 plan 字段');
check(/THE PLAN IS NOT SETTABLE HERE/.test(KEYROUTE), '这条规则写在代码里，不只在脑子里');

/* ── shipped but dormant ──────────────────────────────────────────────────── */
console.log('\n════ Vertex 随代码发布，但默认跑不起来 ════\n');

/*
 * The paid path ships in the repository and must not execute in a default
 * deployment. Three independent conditions have to hold, and all three are
 * asserted here rather than remembered: a route added later that writes `plan`
 * would open the door quietly, and this is what notices.
 */
const GEMINI_SRC = readFileSync(new URL('../lib/gemini.ts', import.meta.url), 'utf8');
check(
  /RESTAGE_DEFAULT_PROVIDER === 'vertex' \? 'vertex' : 'api-key'/.test(GEMINI_SRC),
  '没设环境变量时，默认走用户自己的 key',
  '（要走付费那边必须显式打开）',
);
check(/return 'byok';/.test(SRC) && /plan === 'paid' \? 'paid' : 'byok'/.test(SRC),
  '账号没有 plan 字段时算自带 key');
check(/provider: args\.provider \?\? 'api-key'/.test(ORCH), 'run 没记 provider 时也走自带 key');

/*
 * No route may write the plan. The only `plan:` assignments in the codebase are
 * the run's SHOT LIST — an unrelated field that happens to share the word — and
 * this check is written to tell them apart rather than to count occurrences.
 */
const ROUTE_FILES = [
  '../app/api/account/key/route.ts',
  '../app/api/runs/route.ts',
  '../app/api/runs/[runId]/render/route.ts',
  '../app/api/runs/[runId]/look/route.ts',
];
/* Comments stripped first. Without that, the key route's own comment — the one
   that says THE PLAN IS NOT SETTABLE HERE and quotes `plan: 'paid'` to explain
   why — matched, and the file documenting the rule was reported as breaking it.
   Fifth false positive of the day from matching text without reading context. */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

const writesPlan = ROUTE_FILES.filter((f) => {
  const src = stripComments(readFileSync(new URL(f, import.meta.url), 'utf8'));
  return /\bplan:\s*['"`](?:paid|byok)['"`]/.test(src);
});
check(writesPlan.length === 0, '没有任何路由能把账号改成付费', writesPlan.join(', ') || '（改 plan 只能靠服务端/Stripe）');

/* ── the user's key ───────────────────────────────────────────────────────── */
console.log('\n════ 用户的 key ════\n');

const FAKE = 'AIzaSyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r';
const blob = P.encryptSecret(FAKE);
check(P.decryptSecret(blob) === FAKE, '加密后能原样解回来');
check(!blob.includes(FAKE), '密文里看不到原始 key', blob.slice(0, 28) + '…');
check(P.encryptSecret(FAKE) !== P.encryptSecret(FAKE), '同样的 key 每次密文都不一样', '（每次新 IV）');

let tampered = false;
try {
  const parts = blob.split('.');
  parts[3] = Buffer.from('tampered-ciphertext').toString('base64url');
  P.decryptSecret(parts.join('.'));
} catch {
  tampered = true;
}
check(tampered, '密文被改过就解不开', '（GCM 带认证，不会解成攻击者想要的东西）');

const masked = P.maskKey(FAKE);
check(!masked.includes(FAKE.slice(4, -4)), '掩码不泄漏中间部分', masked);
check(masked.startsWith('AIza') && masked.endsWith(FAKE.slice(-4)), '掩码够认出是哪一把');
check(P.maskKey('short') === '••••', '短字符串整个盖掉，不会露出来');

check(P.looksLikeGoogleKey(FAKE), '正常的 key 收下');
for (const bad of ['sk-proj-abc123', 'https://aistudio.google.com/apikey', '{"type":"service_account"}', 'AIza', '']) {
  check(!P.looksLikeGoogleKey(bad), `明显不对的粘贴挡掉`, JSON.stringify(bad).slice(0, 34));
}

check(!/keyPreview: key|geminiKeyEnc:.*json|return.*\bkey\b\s*\}/.test(KEYROUTE.replace(/keyPreview: maskKey\(key\)/g, '')),
  'key 路由不会把明文 key 返回给前端');
check(/THE KEY IS NEVER RETURNED/.test(KEYROUTE), '这一点写在文件头上');
check(/scrub\(String\(e\)\)/.test(KEYROUTE), '异常信息也过一遍 scrub', '（异常里可能带着正在存的值）');

/*
 * OUR key is the default; a saved key overrides it.
 *
 * This was briefly gated to non-production, and the effect in a deployed build
 * was total: every account defaults to BYOK, none has a saved key (there is no
 * settings screen yet), the fallback was skipped because NODE_ENV was
 * production, and the first model call of every run threw. The whole product
 * failed closed on a guard meant to stop an accounting problem.
 */
/* Bounded to apiKeyFor's own body. Slicing to end-of-file also swept up
   vertexToken's gcloud branch, which is legitimately dev-only, and reported a
   correct guard as the broken one. */
const apiKeyForBody = (() => {
  const from = SRC.indexOf('export async function apiKeyFor');
  const next = SRC.indexOf('\nexport ', from + 1);
  return SRC.slice(from, next === -1 ? undefined : next);
})();
check(
  !/NODE_ENV !== 'production'/.test(apiKeyForBody),
  '生产环境下不会把我们自己的 key 关掉',
  '（否则没存过 key 的账号一跑就报错，而现在还没有存 key 的界面）',
);
check(
  /const ours = process\.env\.GEMINI_API_KEY;\s*if \(ours\) return ours;/.test(SRC),
  '没存自己 key 的用户用我们提供的那把',
);

/* ── the doors really are different ───────────────────────────────────────── */
console.log('\n════ 两扇门的地址、凭证、动词都不一样 ════\n');

const ROLES = ['image', 'video', 'text', 'judge', 'fastText'] as const;
for (const role of ROLES) {
  check(!!P.MODELS['api-key'][role] && !!P.MODELS.vertex[role], `${role} 两边都有模型`,
    `${P.MODELS['api-key'][role]}  |  ${P.MODELS.vertex[role]}`);
}
check(P.MODELS.vertex.omni === null, '付费那边没有 Omni', '（它是 AI Studio 的 /interactions 模型）');
check(omniAvailable('api-key') && !omniAvailable('vertex'), 'omniAvailable() 说得对');
check(P.MODELS.vertex.omni !== P.MODELS.vertex.video, 'Omni 不会偷偷变成第二个 Veo',
  '（迁移时正是这么坏的：两个引擎按钮，同一个调用）');

check(P.baseFor('vertex').includes('aiplatform.googleapis.com'), '付费走 aiplatform');
/* The region IS the quality setting. us-central1 and every other region tested
   serve only the 2.5 family; `global` serves the 3.x line the BYOK path uses.
   Pinning a region does not error — it 404s the good models and quietly makes
   worse ads. */
check(P.VERTEX_LOCATION === 'global', '付费走 global 端点', `现在是 ${P.VERTEX_LOCATION}`);
check(!P.baseFor('vertex').includes('us-central1'), 'URL 里没有被钉死的区域');
check(P.MODELS.vertex.image === P.MODELS['api-key'].image, '两条路用同一个图像模型',
  P.MODELS.vertex.image);
check(P.MODELS.vertex.text === P.MODELS['api-key'].text, '两条路用同一个 planner', P.MODELS.vertex.text);
check(P.MODELS.vertex.judge === P.MODELS['api-key'].judge, '两条路用同一个身份判定模型',
  '（付费用户不该拿到没测过的那个）');
check(P.baseFor('api-key').includes('generativelanguage.googleapis.com'), '自带 key 走 generativelanguage');
check(P.baseFor('vertex').includes(`/projects/${P.VERTEX_PROJECT}/`), 'URL 里带着 project', P.VERTEX_PROJECT);
check(
  /if \(opts\.provider === 'vertex'\)[\s\S]{0,400}fetchPredictOperation/.test(SRC),
  '付费那边轮询用 POST :fetchPredictOperation',
);
check(
  /STUDIO_BASE\}\/\$\{opts\.operation\}\$\{query\}`, \{ method: 'GET'/.test(SRC),
  '自带 key 那边轮询用 GET',
  '（两边不是同一个动词，搞反了会返回一个像是「模型不存在」的 404）',
);

/* ── no crossing over ─────────────────────────────────────────────────────── */
console.log('\n════ 不许串门 ════\n');

check(!batchAvailable('vertex'), '付费的 run 不会掉进 batch', '（batch 是 AI Studio 端点）');
check(/overflowToBatch: provider === 'api-key'/.test(ORCH), '只有自带 key 那条路开溢出阀');
check(/NO CROSS-PROVIDER FALLBACK/.test(SRC), '任何一边挂了都不会改走另一边');
check(/const provider: Provider = args\.provider \?\? 'api-key';/.test(ORCH), 'executeRun 只定一次门');
check(/const uid = args\.uid;/.test(ORCH), 'uid 跟着 provider 一起传', '（这样才知道花谁的 key）');
check(
  /uid\?: string;/.test(SRC) && /authFor\(\s*provider: Provider,[\s\S]{0,400}uid\?: string,/.test(SRC),
  '传的是 uid，不是 key 本身',
  '（密钥只在 provider.ts 里出现，不流经 orchestrator）',
);

/* ── we never say the quiet part ──────────────────────────────────────────── */
console.log('\n════ 对用户不提「Vertex」 ════\n');

check(P.PLAN_LABEL.byok === 'Your own API key' && P.PLAN_LABEL.paid === 'Paid',
  '两个选项的名字里没有厂商名', `${P.PLAN_LABEL.byok} / ${P.PLAN_LABEL.paid}`);
for (const provider of ['vertex', 'api-key'] as const) {
  const msg = P.outageMessage(provider);
  check(!/vertex|aiplatform|google cloud/i.test(msg), `${provider} 的报错文案里不出现基础设施名字`,
    msg.slice(0, 52) + '…');
}
check(P.outageMessage('api-key').includes('Your API key'), '自带 key 的人被告知是「你的」额度用完了',
  '（这才是他能采取行动的那一半）');

/* ── credentials never leak ───────────────────────────────────────────────── */
console.log('\n════ 凭证不会进日志 ════\n');

check(P.scrub('Bearer ya29.abcDEF-123_x') === 'Bearer ***', 'Bearer token 被抹掉');
check(P.scrub(`...?key=${FAKE}`).includes('key=***'), 'query 里的 key 被抹掉');
check(!P.scrub('ya29.rawTokenLeakedSomehow').includes('rawTokenLeaked'), '裸 token 也被抹掉');

/* ── live, only when asked ────────────────────────────────────────────────── */
if (!LIVE) {
  console.log('\n(没加 --live：不打真实接口。)');
} else {
  console.log('\n════ 真实各调用一次 ════\n');
  for (const provider of ['api-key', 'vertex'] as const) {
    const model = P.MODELS[provider].fastText;
    const t0 = Date.now();
    try {
      const json = await P.generateContent({
        provider,
        model,
        body: { contents: [{ role: 'user', parts: [{ text: 'Reply with exactly: OK' }] }] },
        label: 'selftest',
      });
      const text = (json as any).candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      check(text.length > 0, `${provider} 活着`, `${model} · ${Date.now() - t0}ms · ${text.trim().slice(0, 30)}`);
    } catch (e) {
      const msg = P.scrub(e instanceof Error ? e.message : String(e));
      /* A rate-limited key is expected right now and is NOT a code fault. Say
         which it is, rather than printing one red cross that means two things. */
      const limited = /quota|rate|429|exhaust|RESOURCE_EXHAUSTED/i.test(msg);
      check(limited, `${provider} ${limited ? '被限流（不是代码问题）' : '失败'}`, msg.slice(0, 110));
    }
  }
}

console.log(`\n${failed === 0 ? '✅ 全部通过' : `❌ ${failed} 项失败`}`);
process.exit(failed === 0 ? 0 : 1);
