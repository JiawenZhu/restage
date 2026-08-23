/*
 * Proves that deleting an enrolled face deletes everything derived from it.
 *
 * This is the one promise on this product that cannot be decorative, and it was
 * decorative: the delete removed only the avatar folder, while createRun had
 * copied the same captures into every run's own folder and stamped them with
 * permanent download tokens. A user asked for their face to be erased and got a
 * Firestore row removed.
 */
import { readFileSync } from 'node:fs';
for (const l of readFileSync(new URL('../.env.local', import.meta.url),'utf8').split('\n')) {
  const m=l.match(/^([A-Z0-9_]+)=(.*)$/); if(m&&m[2].trim()) process.env[m[1]] ??= m[2].trim().replace(/^["']|["']$/g,'');
}
const { adminDb, adminStorage } = await import('../lib/firebaseAdmin');
const { createRun } = await import('../lib/orchestrator');

const uid = `_deltest_${Date.now()}`;
const avatarId = 'av_probe';
const bucketName = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'restage-studio.firebasestorage.app';
const bucket = adminStorage().bucket(bucketName);
const img = readFileSync(new URL('../public/img/persona-front.jpg', import.meta.url));

const paths = {
  front: `users/${uid}/avatars/${avatarId}/front.jpg`,
  left: `users/${uid}/avatars/${avatarId}/left.jpg`,
  right: `users/${uid}/avatars/${avatarId}/right.jpg`,
};
for (const p of Object.values(paths)) await bucket.file(p).save(img, { contentType: 'image/jpeg' });
await adminDb().collection('users').doc(uid).collection('avatars').doc(avatarId)
  .set({ id: avatarId, uid, name: 'probe', paths, createdAt: Date.now() });

const runId = await createRun({ uid, avatarId, goal: 'A probe run for the deletion path.', aspect: '9:16', seconds: 8, avatarDataUrl: '' });

const count = async (prefix: string) => (await bucket.getFiles({ prefix }))[0].length;
const before = { avatar: await count(`users/${uid}/avatars/`), run: await count(`users/${uid}/runs/`) };
console.log(`  删除前  头像文件 ${before.avatar}  运行副本 ${before.run}`);
if (before.run === 0) { console.log('  ⚠️ 运行目录没有副本，测试无意义'); process.exit(1); }

// exactly what the DELETE route does
const { DELETE } = await import('../app/api/avatars/[avatarId]/route');
process.env.RESTAGE_DEV_UID = uid;
process.env.NODE_ENV = 'development';
const res = await DELETE(new Request('http://x', { method: 'DELETE' }), { params: Promise.resolve({ avatarId }) });
const body = await res.json();
console.log(`  删除响应 ${res.status} ${JSON.stringify(body)}`);

const after = { avatar: await count(`users/${uid}/avatars/`), run: await count(`users/${uid}/runs/`) };
const runGone = !(await adminDb().collection('runs').doc(runId).get()).exists;
console.log(`  删除后  头像文件 ${after.avatar}  运行副本 ${after.run}  运行文档已删除=${runGone}`);

await bucket.deleteFiles({ prefix: `users/${uid}/` }).catch(() => {});
await adminDb().collection('users').doc(uid).delete().catch(() => {});

const ok = after.avatar === 0 && after.run === 0 && runGone;
console.log(ok ? '  ✅ 人脸的每一份副本都被删除' : '  ❌ 仍有副本残留');
process.exit(ok ? 0 : 1);
