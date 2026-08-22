import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider } from '@/lib/auth-context';

export const metadata: Metadata = {
  title: 'Restage',
  description: 'UGC video ads with your own face. State the outcome; the agent plans, runs and grades the work.',
};

/*
 * Runs before first paint. Without it the page renders in light, then swaps to
 * dark once React hydrates — a visible flash on every load for anyone who chose
 * dark. It has to be inline and synchronous for that reason; a component effect
 * is already too late.
 *
 * Wrapped in try/catch because localStorage throws outright in some privacy
 * modes, and a theme preference is not worth a blank page.
 *
 * It deliberately does NOT fall back to prefers-color-scheme. Light is the
 * product's look right now and dark has not had its pass yet; following the OS
 * would show most people on dark machines the unfinished theme before they ever
 * saw the finished one. Dark is reachable, just not by default.
 */
const themeBootstrap = `
try {
  var t = localStorage.getItem('restage-theme');
  document.documentElement.setAttribute('data-theme', t === 'dark' ? 'dark' : 'light');
} catch (e) {
  document.documentElement.setAttribute('data-theme', 'light');
}
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
