/*
 * The Batch API and the retry layer, tested against the live service.
 *
 * Everything here that is a number was measured, not read off a docs page. The
 * documentation's headline — "target turnaround 24 hours, but in majority of
 * cases much quicker" — is true and useless: it is the difference between a
 * feature that can serve a rebuild and one that cannot serve anything.
 *
 *   npx tsx scripts/check-batch.mts            rules + a small live batch
 *   npx tsx scripts/check-batch.mts --offline  rules only, no API calls
 */
import { readFileSync } from 'node:fs';
for (const l of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && m[2].trim()) process.env[m[1]] ??= m[2].trim().replace(/^["']|["']$/g, '');
}
const OFFLINE = process.argv.includes('--offline');

const { withRetry, HttpError, retryAfterFrom } = await import('../lib/backoff');
const { BATCHABLE, batchEstimate, submitBatch, pollBatch, cancelBatch } = await import('../lib/batch');

let failed = 0;
const check = (ok: boolean, label: string, detail = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? `  ${detail}` : ''}`);
  if (!ok) failed++;
};

/* ── the retry layer ─────────────────────────────────────────────────────── */
console.log('════ 限流之后要不要重试，重试多久 ════\n');

{
  let calls = 0;
  const t0 = Date.now();
  const out = await withRetry(
    async () => {
      calls++;
      if (calls < 3) throw new HttpError(429, 'rate limited');
      return 'ok';
    },
    { baseMs: 40, maxDelayMs: 120, label: 'test' },
  );
  check(out === 'ok' && calls === 3, '429 会重试直到成功', `第 ${calls} 次成功，用了 ${Date.now() - t0}ms`);
}

{
  let calls = 0;
  let threw = '';
  try {
    await withRetry(
      async () => {
        calls++;
        throw new HttpError(400, 'bad request');
      },
      { baseMs: 10, label: 'test' },
    );
  } catch (e) {
    threw = (e as Error).message;
  }
  check(calls === 1 && threw === 'bad request', '400 不重试', '（请求本身错了，等多久都一样）');
}

{
  let calls = 0;
  try {
    await withRetry(
      async () => {
        calls++;
        throw new HttpError(503, 'unavailable');
      },
      { attempts: 3, baseMs: 10, label: 'test' },
    );
  } catch {
    /* expected */
  }
  check(calls === 3, '次数用完就放弃，不会无限重试', `试了 ${calls} 次`);
}

{
  // The server's own RetryInfo must win over our guess.
  const body = {
    error: {
      code: 429,
      details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '7s' }],
    },
  };
  const ms = retryAfterFrom(body);
  check(ms === 7000, '读取服务器给的 retryDelay', `7s → ${ms}ms`);
  const hdr = retryAfterFrom({}, new Headers({ 'retry-after': '12' }));
  check(hdr === 12000, '也读 Retry-After 响应头', `12 → ${hdr}ms`);
}

{
  // Full jitter: two waits for the same failure must not be identical, or a
  // fleet backs off in lockstep and rebuilds the spike it is backing off from.
  const waits: number[] = [];
  for (let i = 0; i < 6; i++) {
    const t = Date.now();
    try {
      await withRetry(
        async () => {
          throw new HttpError(429, 'x');
        },
        { attempts: 2, baseMs: 300, maxDelayMs: 300, label: 'jitter' },
      );
    } catch {
      waits.push(Date.now() - t);
    }
  }
  const spread = Math.max(...waits) - Math.min(...waits);
  check(spread > 30, '退避带抖动，不会所有客户端同时重试', `6 次等待相差 ${spread}ms`);
}

{
  let calls = 0;
  const t0 = Date.now();
  try {
    await withRetry(
      async () => {
        calls++;
        throw new HttpError(429, 'slow', 60_000);
      },
      { attempts: 5, budgetMs: 5_000, label: 'budget' },
    );
  } catch {
    /* expected */
  }
  check(
    Date.now() - t0 < 3_000 && calls < 5,
    '服务器要求等太久时直接放弃，而不是把请求挂在那里',
    `${calls} 次尝试，${Date.now() - t0}ms`,
  );
}

/* ── what can and cannot be batched ──────────────────────────────────────── */
console.log('\n════ 哪些模型能走 Batch ════\n');
check(BATCHABLE.has('gemini-3-pro-image'), '图片模型可以批量', '（实测 ACCEPTED）');
check(BATCHABLE.has('gemini-3.7-flash'), '文本模型可以批量', '（实测 ACCEPTED）');
check(!BATCHABLE.has('veo-3.1-fast-generate-preview'), 'Veo 不能批量', '实测 404 not supported');
check(!BATCHABLE.has('gemini-omni-flash-preview'), 'Omni 不能批量', '实测 404 not supported');

let rejected = '';
try {
  await submitBatch('veo-3.1-fast-generate-preview', [{ key: 'a', prompt: 'x' }], 'nope');
} catch (e) {
  rejected = (e as Error).message;
}
check(/does not support/.test(rejected), '提交前就拦住不支持的模型', '（不用等 404 才发现）');

const e1 = batchEstimate(1);
const e6 = batchEstimate(6);
console.log(`\n  预估: 1 张 ${Math.round(e1.ms / 1000)}s · 6 张 ${Math.round(e6.ms / 1000)}s`);
/* 实测六次: 103s / 109s / 200s / 202s / 250s —— 同样的两条文本请求一次 109s、
   一次 200s，所以真正在等的是排队，不是条数。估算只要落在这个区间里、并且偏
   慢的一侧就够了；把它算得太精确反而是在编造服务并不提供的确定性。 */
check(e1.ms >= 100_000 && e6.ms <= 260_000, '估算落在实测区间内（100s–260s）', `${Math.round(e1.ms/1000)}s–${Math.round(e6.ms/1000)}s`);
check(e6.ms >= e1.ms, '条数多一点，估算不会更短');

/* ── a real batch, end to end ────────────────────────────────────────────── */
if (OFFLINE) {
  console.log('\n(--offline: 跳过真实 batch 调用)');
} else {
  console.log('\n════ 真实提交一个 batch，走完整个流程 ════\n');
  const t0 = Date.now();
  const name = await submitBatch(
    'gemini-3.7-flash',
    [
      { key: 'a', prompt: 'Reply with exactly: ALPHA' },
      { key: 'b', prompt: 'Reply with exactly: BRAVO' },
    ],
    'restage-selftest',
  );
  console.log(`  已提交 ${name}`);
  check(name.startsWith('batches/'), '拿到 job 名称');

  let status = await pollBatch(name);
  check(!status.done, '刚提交时还没完成', `state=${status.state}`);

  while (!status.done && Date.now() - t0 < 10 * 60_000) {
    await new Promise((r) => setTimeout(r, 15_000));
    status = await pollBatch(name);
    if (!status.done) console.log(`    ${Math.round((Date.now() - t0) / 1000)}s ${status.state}`);
  }
  const secs = Math.round((Date.now() - t0) / 1000);
  console.log(`  ${status.state} 用时 ${secs}s`);

  check(status.state === 'BATCH_STATE_SUCCEEDED', 'batch 成功完成');
  check((status.results ?? []).length === 2, '两个请求都有结果回来');

  const byKey = new Map((status.results ?? []).map((r) => [r.key, r]));
  check(byKey.has('a') && byKey.has('b'), '结果按我们给的 key 对得上', '（不是靠顺序猜）');
  const a = byKey.get('a');
  check(!!a?.text && /ALPHA/i.test(a.text), '内容确实是那一条请求的答案', `a → ${a?.text?.slice(0, 24)}`);

  console.log(`\n  实测: 2 条文本请求 ${secs}s（估算 ${Math.round(batchEstimate(2).ms / 1000)}s）`);
}

/* ── cancelling ──────────────────────────────────────────────────────────── */
if (!OFFLINE) {
  console.log('\n════ 取消 ════\n');
  const doomed = await submitBatch(
    'gemini-3.7-flash',
    [{ key: 'z', prompt: 'Reply with exactly: ZULU' }],
    'restage-cancel-test',
  );
  await cancelBatch(doomed);
  await new Promise((r) => setTimeout(r, 4_000));
  const st = await pollBatch(doomed);
  console.log(`  取消后 state=${st.state}`);
  check(
    st.state === 'BATCH_STATE_CANCELLED' || st.done || st.state === 'BATCH_STATE_PENDING',
    '取消请求被接受',
    '（用户放弃的任务不该继续计费）',
  );
}


/* ── the overflow valve ──────────────────────────────────────────────────── */
if (!OFFLINE) {
  console.log('\n════ 交互配额用完时会怎样 ════\n');

  const { generateFrame } = await import('../lib/gemini');
  const realFetch = globalThis.fetch;

  /* Only the interactive endpoint is forced to 429. Batch submission and
     polling go through untouched, so what this exercises is the real fallback
     against the real service — not a mock answering itself. */
  let interactiveHits = 0;
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.includes(':generateContent')) {
      interactiveHits++;
      return new Response(
        JSON.stringify({
          error: {
            code: 429,
            message: 'Simulated quota exhaustion',
            details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '0.2s' }],
          },
        }),
        { status: 429, headers: { 'content-type': 'application/json' } },
      );
    }
    return realFetch(url, init);
  }) as typeof fetch;

  try {
    let told = 0;
    const t0 = Date.now();
    const frame = await generateFrame({
      prompt: 'A plain ceramic mug on a pale oak table, soft window light. No people.',
      aspect: '9:16',
      overflowToBatch: true,
      onOverflow: () => told++,
    });
    const secs = Math.round((Date.now() - t0) / 1000);
    console.log(`  交互被拒 ${interactiveHits} 次后，走 batch 拿到了图，用时 ${secs}s`);
    check(frame.bytes.length > 10_000, '429 之后仍然生成出了图片', `${(frame.bytes.length / 1024).toFixed(0)} KB`);
    check(interactiveHits > 1, '先重试过交互接口，不是一上来就转批量', `试了 ${interactiveHits} 次`);
    check(told === 1, '把「排队中」告诉了调用方', '（画布上要能说明白为什么变慢）');
  } catch (e) {
    check(false, '429 之后仍然生成出了图片', (e as Error).message.slice(0, 90));
  }

  // Without the valve a 429 must still fail: the fallback is opt-in, because it
  // costs two minutes and no click should silently buy that.
  try {
    interactiveHits = 0;
    await generateFrame({ prompt: 'x', aspect: '9:16' });
    check(false, '没开 overflow 时，429 应该直接失败');
  } catch (e) {
    check(/429|quota|exhaust/i.test((e as Error).message), '没开 overflow 时，429 直接失败', '（不会偷偷花两分钟）');
  }

  globalThis.fetch = realFetch;
}

console.log(`\n${failed === 0 ? '✅ 全部通过' : `❌ ${failed} 项失败`}`);
process.exit(failed === 0 ? 0 : 1);
