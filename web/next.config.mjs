/** @type {import('next').NextConfig} */
export default {
  // Frames come from Firebase Storage, finished videos from R2 behind signed
  // URLs. Both are remote, so they have to be declared before next/image will
  // touch them.
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'firebasestorage.googleapis.com' },
      { protocol: 'https', hostname: '*.r2.cloudflarestorage.com' },
    ],
  },
};
