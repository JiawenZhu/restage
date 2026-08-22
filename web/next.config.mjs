/** @type {import('next').NextConfig} */
export default {
  /*
   * A self-contained server bundle, for the container.
   *
   * Without this, running the app in an image means shipping the whole
   * node_modules tree and hoping the runtime resolves it the same way the
   * builder did. `standalone` traces exactly which files the server actually
   * reaches and emits a .next/standalone directory with its own server.js —
   * a few hundred MB smaller, and it starts without an npm install.
   *
   * That server.js also reads PORT from the environment, which is what Cloud
   * Run injects and health-checks.
   */
  output: 'standalone',
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
