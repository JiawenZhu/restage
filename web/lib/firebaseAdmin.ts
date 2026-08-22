/*
 * Admin SDK. SERVER ONLY, and more dangerous than the other secrets in this
 * repo: the service account bypasses every security rule, so a rule that
 * protects a user's face protects nothing on this side. Everything written
 * through here has to check ownership itself.
 */

if (typeof window !== 'undefined') {
  throw new Error('lib/firebaseAdmin is server-only — it bypasses every security rule.');
}

import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';

let cached: App | null = null;

function admin(): App {
  if (cached) return cached;
  if (getApps().length) return (cached = getApps()[0]);

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not set');

  // The value may be the JSON itself or a JSON-encoded string of it, depending
  // on how it was written into .env — accept both rather than making the shape
  // a thing anyone has to remember.
  let parsed: Record<string, string>;
  try {
    const once = JSON.parse(raw);
    parsed = typeof once === 'string' ? JSON.parse(once) : once;
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON');
  }

  cached = initializeApp({
    credential: cert(parsed as never),
    projectId: parsed.project_id,
    storageBucket: `${parsed.project_id}.firebasestorage.app`,
  });
  return cached;
}

export const adminDb = () => getFirestore(admin());
export const adminAuth = () => getAuth(admin());
export const adminStorage = () => getStorage(admin());

/**
 * Every route that writes on a user's behalf calls this first. The admin SDK
 * ignores security rules, so this is the only thing standing between one user's
 * token and another user's data.
 */
export async function requireUid(req: Request): Promise<string> {
  const header = req.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token || token === 'guest') {
    const devUid = process.env.RESTAGE_DEV_UID;
    if (process.env.NODE_ENV === 'development' && devUid) return devUid;
    throw new Error('unauthenticated');
  }

  const decoded = await adminAuth().verifyIdToken(token);
  return decoded.uid;
}
