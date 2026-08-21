'use client';

import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, type User } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

/*
 * Client SDK. These five values are public by design — they ship in page source
 * and Firebase protects the data with security rules rather than secrecy. That
 * is the opposite of GEMINI_API_KEY and R2_SECRET_ACCESS_KEY, which is why only
 * these carry NEXT_PUBLIC_.
 */
const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET!,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
};

function app(): FirebaseApp {
  return getApps().length ? getApps()[0] : initializeApp(config);
}

export const auth = () => getAuth(app());
export const db = () => getFirestore(app());

export async function signInWithGoogle(): Promise<User> {
  const { user } = await signInWithPopup(auth(), new GoogleAuthProvider());
  return user;
}

export const signOutUser = () => signOut(auth());
export const watchAuth = (cb: (u: User | null) => void) => onAuthStateChanged(auth(), cb);
