/*
 * Proves a run can start from an avatarId alone — no image in the request —
 * and that what executeRun reads is what createRun persisted. The bug this
 * guards: createRun reassigned only its local args, so executeRun received an
 * empty source for every enrolled-avatar run.
 */
import { readFileSync } from 'node:fs';
for (const l of readFileSync(new URL('../.env.local', import.meta.url),'utf8').split('\n')) {
  const m=l.match(/^([A-Z0-9_]+)=(.*)$/); if(m&&m[2].trim()) process.env[m[1]] ??= m[2].trim().replace(/^["']|["']$/g,'');
}
const { adminDb, adminStorage } = await import('../lib/firebaseAdmin');
const { createRun } = await import('../lib/orchestrator');

const uid = `_enrolltest_${Date.now()}`;
const avatarId = 'av_probe';
const bucket = adminStorage().bucket(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'restage-studio.firebasestorage.app');
const img = readFileSync(new URL('../public/img/persona-front.jpg', import.meta.url));

const paths = { front: `users/${uid}/avatars/${avatarId}/front.jpg`, left: `users/${uid}/avatars/${avatarId}/left.jpg`, right: `users/${uid}/avatars/${avatarId}/right.jpg` };
for (const p of Object.values(paths)) await bucket.file(p).save(img, { contentType: 'image/jpeg' });
await adminDb().collection('users').doc(uid).collection('avatars').doc(avatarId).set({ id: avatarId, uid, name: 'probe', paths, createdAt: Date.now() });

// the shape the client now sends: an id, and no pixels
const runId = await createRun({ uid, avatarId, goal: 'A probe run for the enrolled avatar path.', aspect: '9:16', seconds: 8, avatarDataUrl: '' });
const run = (await adminDb().collection('runs').doc(runId).get()).data()!;
const rootNode = (await adminDb().collection('runs').doc(runId).collection('nodes').doc('root').get()).data()!;

const checks = [
  ['run 记录了持久化的头像 URL', typeof run.avatarUrl === 'string' && run.avatarUrl.includes('token=')],
  ['根节点带同一张图', rootNode.frameUrl === run.avatarUrl],
  ['三视图都已持久化', !!run.avatarMultiViews?.left && !!run.avatarMultiViews?.right],
  ['URL 可读取（executeRun 会这样做）', (await fetch(run.avatarUrl)).ok],
];
for (const [name, ok] of checks) console.log(`  ${ok ? '✅' : '❌'} ${name}`);

// clean up
await adminDb().collection('runs').doc(runId).collection('nodes').doc('root').delete();
await adminDb().collection('runs').doc(runId).delete();
await adminDb().collection('users').doc(uid).collection('avatars').doc(avatarId).delete();
await bucket.deleteFiles({ prefix: `users/${uid}/` }).catch(() => {});
process.exit(checks.every(([, ok]) => ok) ? 0 : 1);
