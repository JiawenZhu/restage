/*
 * The user's own API key: save it, check it, forget it.
 *
 * THE KEY IS NEVER RETURNED. Not on GET, not after a save, not in an error.
 * Once it is stored, the only thing this route will say about it is a mask
 * (AIza••••x9Qf) — enough to recognise which key is saved, useless to anyone
 * who obtains it. A settings screen that shows you your own secret is a
 * settings screen that shows it to anyone who gets a look at your laptop, and
 * it gives no information the mask does not.
 *
 * THE PLAN IS NOT SETTABLE HERE, deliberately. `plan: 'paid'` routes work onto
 * infrastructure Restage pays for, so an endpoint that let a signed-in user
 * write that field would be a free upgrade for anyone who read the network tab.
 * It moves when money moves — a Stripe webhook, or an admin — and neither of
 * those is this route.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUid } from '@/lib/firebaseAdmin';
import { consume, tooMany } from '@/lib/rateLimit';
import {
  accountDoc,
  encryptSecret,
  forgetUserKey,
  looksLikeGoogleKey,
  maskKey,
  planFor,
  scrub,
} from '@/lib/provider';

export const runtime = 'nodejs';
export const maxDuration = 30;

const Body = z.object({ key: z.string().min(20).max(200) });

/** What is saved, without saying what it is. */
export async function GET(req: Request) {
  let uid: string;
  try {
    uid = await requireUid(req);
  } catch {
    return NextResponse.json({ error: 'sign in first' }, { status: 401 });
  }

  const data = (await accountDoc(uid).get()).data();
  return NextResponse.json({
    plan: await planFor(uid),
    /* The mask is stored alongside the ciphertext at save time so that showing
       it costs no decryption — and so a bug in this route cannot turn into a
       key disclosure. */
    keyPreview: (data?.geminiKeyMask as string) ?? null,
    keySavedAt: (data?.geminiKeySavedAt as number) ?? null,
  });
}

export async function POST(req: Request) {
  let uid: string;
  try {
    uid = await requireUid(req);
  } catch {
    return NextResponse.json({ error: 'sign in first' }, { status: 401 });
  }

  // Each save spends one live call to verify the key. Cheap, but not free, and
  // not something to allow unbounded.
  const rate = await consume(uid, 'text');
  if (!rate.ok) return tooMany(rate);

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'a key is required' }, { status: 400 });

  const key = parsed.data.key.trim();
  if (!looksLikeGoogleKey(key)) {
    return NextResponse.json(
      {
        error:
          'That does not look like a Google AI Studio key. They begin with AIza and are about 39 characters — you can make one at aistudio.google.com/apikey.',
      },
      { status: 400 },
    );
  }

  /*
   * Prove it works before saving it.
   *
   * A key that is well-formed and wrong is the worst outcome: it saves cleanly,
   * and then every run fails somewhere the user cannot connect to what they
   * typed. One cheap call here turns that into a sentence on the settings
   * screen. The call is made with the SUBMITTED key, not a stored one, so
   * nothing is written until it has answered.
   */
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
      { method: 'GET' },
    );
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      const why = body.error?.message ?? `Google refused it (${res.status})`;
      return NextResponse.json(
        {
          error:
            res.status === 400 || res.status === 401 || res.status === 403
              ? 'Google would not accept that key. Check it was copied whole, and that the Generative Language API is enabled for its project.'
              : `Could not check that key just now: ${scrub(why)}`,
        },
        { status: 400 },
      );
    }
  } catch (e) {
    return NextResponse.json(
      { error: `Could not reach Google to check that key: ${scrub(String(e))}` },
      { status: 502 },
    );
  }

  try {
    await accountDoc(uid).set(
      {
        /* Encrypted with a server-side secret. A Firestore export, a mis-scoped
           security rule, or a console session all yield ciphertext. */
        geminiKeyEnc: encryptSecret(key),
        geminiKeyMask: maskKey(key),
        geminiKeySavedAt: Date.now(),
      },
      { merge: true },
    );
  } catch (e) {
    // Never echo the exception verbatim: it can carry the value being stored.
    console.error('[account/key] save failed:', scrub(String(e)));
    return NextResponse.json({ error: 'could not save that key' }, { status: 500 });
  }

  // Drop any decrypted copy held for this user so the new key takes effect now.
  forgetUserKey(uid);
  return NextResponse.json({ ok: true, keyPreview: maskKey(key) });
}

export async function DELETE(req: Request) {
  let uid: string;
  try {
    uid = await requireUid(req);
  } catch {
    return NextResponse.json({ error: 'sign in first' }, { status: 401 });
  }

  const { FieldValue } = await import('firebase-admin/firestore');
  await accountDoc(uid).set(
    {
      geminiKeyEnc: FieldValue.delete(),
      geminiKeyMask: FieldValue.delete(),
      geminiKeySavedAt: FieldValue.delete(),
    },
    { merge: true },
  );
  forgetUserKey(uid);
  return NextResponse.json({ ok: true });
}
