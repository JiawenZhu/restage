/*
 * Runs scripts/contrast-scan.js against every page, in both themes.
 *
 * Needs the dev server on :3100 and ego-browser. The scan itself lives in a
 * separate file so it can also be pasted into a devtools console.
 *
 *   npx tsx scripts/check-contrast.mjs
 *
 * It reports two numbers, and BOTH matter. A run that "passes" by skipping
 * everything is not a pass: an earlier version of the scan skipped 500
 * elements to reach zero failures, which is a worse answer than a wrong one.
 * Skips should be text over images — the gallery and the hero — and nowhere
 * else.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const PAGES = ['/', '/studio', '/studio/demo', '/library', '/avatars', '/enroll', '/likeness'];
const scan = readFileSync(new URL('./contrast-scan.js', import.meta.url), 'utf8').replace(/^\/\*[\s\S]*?\*\/\s*/, '');

const script = `
import fs from 'fs'
await useOrCreateTaskSpace('contrast check')
const scan = ${JSON.stringify(scan)}
let total = 0, skipped = 0
for (const p of ${JSON.stringify(PAGES)}) {
  await gotoAndWait('http://localhost:3100' + p, { timeout: 45, settle: 3 })
  await wait(2)
  const r = await js(scan)
  if (!r) { cliLog('  ' + p.padEnd(15) + ' (no result)'); continue }
  const items = [...(r.light?.fails||[]).map(x=>({...x,th:'light'})), ...(r.dark?.fails||[]).map(x=>({...x,th:'dark'}))]
  const sk = (r.light?.skippedOverMedia||0) + (r.dark?.skippedOverMedia||0)
  total += items.length; skipped += sk
  cliLog('  ' + p.padEnd(15) + (items.length === 0 ? 'ok' : 'FAIL ' + items.length) + '  (skipped ' + sk + ')' +
    (items.length ? '  ' + items.slice(0,5).map(x=>x.th+':"'+x.t+'" '+x.r+'/'+x.need).join('; ') : ''))
}
cliLog('')
cliLog('  ' + total + ' failures, ' + skipped + ' skipped (text over images)')
process.exitCode = total === 0 ? 0 : 1
`;

execFileSync('ego-browser', ['nodejs'], { input: script, stdio: ['pipe', 'inherit', 'inherit'] });
