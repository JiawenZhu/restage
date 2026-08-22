import { NextResponse } from 'next/server';
import { z } from 'zod';
import { adminDb, adminStorage, requireUid } from '@/lib/firebaseAdmin';

/*
 * Enrolment: the one-time capture that every later run reuses.
 *
 * Four things were wrong here and each is worth naming, because they were all
 * invisible from the outside:
 *
 *   1. The uid came from the REQUEST BODY, defaulting to a shared
 *      'creator_guest'. A caller could write into any user's avatar collection
 *      by naming them. Identity now comes only from the verified token.
 *   2. A failed token verification was logged and ignored ("using fallback
 *      UID"), which made the verification decorative.
 *   3. `rawImages` stored three base64 720p JPEGs INSIDE the Firestore
 *      document. Firestore's hard limit is 1MB per document and three such
 *      images are several times that, so enrolment would have started failing
 *      the moment anyone used a decent camera. The bytes belong in Storage;
 *      Firestore holds paths.
 *   4. It returned `?alt=media` public URLs, which only worked because the
 *      bucket was world-readable. The bucket is private now, so reads are
 *      signed on demand — paths are stored, never URLs, so a link can never
 *      outlive its signature.
 */
export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const SIGNED_URL_TTL_MS = 60 * 60 * 1000; // an hour: long enough to work in, short enough to matter

/*
 * A data URL, including its media-type parameters.
 *
 * The previous pattern had no way to cross a ';', so every real recording was
 * rejected: Chrome and Edge produce 'audio/webm;codecs=opus' and Firefox
 * 'audio/ogg; codecs=opus'. A user completed all four capture steps, pressed
 * save, and was bounced back with "front, left and right captures are required"
 * printed above three photos that were plainly there. Reproduced against this
 * repo's own zod before fixing.
 */
const dataUrl = z
  .string()
  .regex(/^data:(image|audio)\/[a-zA-Z0-9.+-]+(\s*;[^;,]+)*;base64,.+$/, 'must be a data URL');

const Body = z.object({
  name: z.string().max(80).optional(),
  front: dataUrl,
  left: dataUrl,
  right: dataUrl,
  // nullish, not optional: the upload path sends `audio: null` explicitly, and
  // .optional() accepts only undefined — so an enrolment without a voice sample
  // failed in every browser.
  audio: dataUrl.nullish(),
});

function decode(b64: string): Buffer {
  // Non-greedy up to ';base64,' so parameters between the type and the encoding
  // do not defeat the match.
  const m = b64.match(/^data:(.+?);base64,(.+)$/);
  return Buffer.from(m ? m[2] : b64, 'base64');
}

function bucket() {
  return adminStorage().bucket(
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'restage-studio.firebasestorage.app',
  );
}

async function signPath(path: string, uid: string): Promise<string | null> {
  /*
   * Never sign a path outside the caller's own namespace.
   *
   * getSignedUrl runs with admin credentials and ignores storage rules, so this
   * function will sign ANY path it is handed. The paths come from a Firestore
   * document, and defence that relies on "the rules stop anyone writing a bad
   * one" is one rules edit away from being a cross-user file read. The check
   * belongs where the signing happens.
   */
  if (!path.startsWith(`users/${uid}/avatars/`) || path.includes('..')) {
    console.warn('[avatars] refused to sign an out-of-namespace path');
    return null;
  }
  try {
    const [url] = await bucket()
      .file(path)
      .getSignedUrl({ action: 'read', expires: Date.now() + SIGNED_URL_TTL_MS });
    return url;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  let uid: string;
  try {
    uid = await requireUid(req);
  } catch {
    return NextResponse.json({ error: 'sign in to enrol a face' }, { status: 401 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    // Naming the real field, because the generic message sent people back to
    // check three photos when the problem was the audio sample.
    const first = parsed.error.issues[0];
    const where = first?.path?.join('.') || 'request';
    return NextResponse.json({ error: `${where}: ${first?.message ?? 'invalid'}` }, { status: 400 });
  }

  const { name, front, left, right, audio } = parsed.data;

  const buffers = {
    front: decode(front),
    left: decode(left),
    right: decode(right),
    ...(audio ? { audio: decode(audio) } : {}),
  };
  for (const [which, buf] of Object.entries(buffers)) {
    if (!buf.length) return NextResponse.json({ error: `the ${which} capture is empty` }, { status: 400 });
    if (buf.length > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: `the ${which} capture is larger than 6MB` }, { status: 413 });
    }
  }

  try {
    const avatarId = `av_${Date.now()}`;
    const basePath = `users/${uid}/avatars/${avatarId}`;

    const put = async (buf: Buffer, filename: string, contentType: string) => {
      const path = `${basePath}/${filename}`;
      await bucket().file(path).save(buf, { contentType, metadata: { cacheControl: 'private, max-age=3600' } });
      return path;
    };

    const [frontPath, leftPath, rightPath] = await Promise.all([
      put(buffers.front, 'front.jpg', 'image/jpeg'),
      put(buffers.left, 'left.jpg', 'image/jpeg'),
      put(buffers.right, 'right.jpg', 'image/jpeg'),
    ]);
    /* Named and typed from what actually arrived. MediaRecorder gives WebM or
       MP4 depending on the browser; hardcoding .wav wrote a mislabelled file. */
    const audioMime = audio?.match(/^data:([^;]+);/)?.[1] ?? 'audio/webm';
    const audioExt = audioMime.includes('mp4') ? 'mp4' : audioMime.includes('ogg') ? 'ogg' : 'webm';
    const voicePath = buffers.audio ? await put(buffers.audio, `voice_sample.${audioExt}`, audioMime) : null;

    const db = adminDb();
    const record = {
      id: avatarId,
      uid,
      name: name?.trim() || 'My avatar',
      paths: { front: frontPath, left: leftPath, right: rightPath },
      voicePath,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await db.collection('users').doc(uid).collection('avatars').doc(avatarId).set(record);
    await db
      .collection('users')
      .doc(uid)
      .set({ uid, latestAvatarId: avatarId, updatedAt: Date.now() }, { merge: true });

    const urls = {
      front: await signPath(frontPath, uid),
      left: await signPath(leftPath, uid),
      right: await signPath(rightPath, uid),
    };

    return NextResponse.json({ avatarId, avatar: { ...record, urls } });
  } catch (err) {
    console.error('[avatars] save failed', err);
    return NextResponse.json({ error: 'could not save that enrolment' }, { status: 500 });
  }
}

/**
 * The user's enrolled avatars, newest first, with freshly signed preview URLs.
 * This is what makes enrolment one-time: /studio reads it to offer a saved face
 * instead of asking for a photo the user already gave.
 */
export async function GET(req: Request) {
  let uid: string;
  try {
    uid = await requireUid(req);
  } catch {
    return NextResponse.json({ error: 'sign in to see your avatars' }, { status: 401 });
  }

  try {
    const snap = await adminDb()
      .collection('users')
      .doc(uid)
      .collection('avatars')
      .orderBy('createdAt', 'desc')
      .limit(20)
      .get();

    const avatars = await Promise.all(
      snap.docs.map(async (d) => {
        const a = d.data();
        return {
          id: d.id,
          name: a.name,
          createdAt: a.createdAt,
          hasVoice: !!a.voicePath,
          urls: {
            front: a.paths?.front ? await signPath(a.paths.front, uid) : null,
            left: a.paths?.left ? await signPath(a.paths.left, uid) : null,
            right: a.paths?.right ? await signPath(a.paths.right, uid) : null,
          },
        };
      }),
    );

    return NextResponse.json({ avatars }, { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    console.error('[avatars] list failed', err);
    return NextResponse.json({ error: 'could not load your avatars' }, { status: 500 });
  }
}
