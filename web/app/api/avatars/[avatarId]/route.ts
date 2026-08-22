import { NextResponse } from 'next/server';
import { adminDb, adminStorage, requireUid } from '@/lib/firebaseAdmin';

/*
 * Deleting an enrolled face, for real.
 *
 * /enroll tells the user that "deleting an avatar permanently purges all raw
 * data" — and no delete path existed anywhere in the app. That is the one
 * promise about a person's likeness that must not be decorative, so this
 * removes the Storage objects as well as the Firestore record, and clears the
 * pointer on the user document if it referenced this avatar.
 */
export const runtime = 'nodejs';

export async function DELETE(req: Request, ctx: { params: Promise<{ avatarId: string }> }) {
  const { avatarId } = await ctx.params;

  let uid: string;
  try {
    uid = await requireUid(req);
  } catch {
    return NextResponse.json({ error: 'sign in first' }, { status: 401 });
  }

  const db = adminDb();
  const ref = db.collection('users').doc(uid).collection('avatars').doc(avatarId);
  const snap = await ref.get();
  if (!snap.exists) return NextResponse.json({ error: 'no such avatar' }, { status: 404 });

  try {
    // The pixels first: a Firestore record with no images is recoverable
    // confusion, while images with no record are unreachable and permanent.
    const bucket = adminStorage().bucket(
      process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'restage-studio.firebasestorage.app',
    );
    await bucket.deleteFiles({ prefix: `users/${uid}/avatars/${avatarId}/` });

    await ref.delete();

    const userRef = db.collection('users').doc(uid);
    const user = await userRef.get();
    if (user.data()?.latestAvatarId === avatarId) {
      await userRef.set({ latestAvatarId: null, updatedAt: Date.now() }, { merge: true });
    }

    return NextResponse.json({ deleted: avatarId });
  } catch (err) {
    console.error('[avatars] delete failed', err);
    return NextResponse.json({ error: 'could not delete that avatar' }, { status: 500 });
  }
}
