import type { Metadata } from 'next';
import { Instrument_Serif, Archivo } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/lib/auth-context';

/*
 * Two real typefaces, because there were none.
 *
 * The whole site rendered in `system-ui` — San Francisco on a Mac, Segoe on
 * Windows, something else again on Linux. That is not a neutral choice, it is
 * the absence of one, and it is most of why the landing page read as a
 * template: a 76px headline at weight 900 in the OS default font is mass
 * without character.
 *
 * INSTRUMENT SERIF for display. A film product should not be shouting in a
 * grotesk — the editorial serif is the register of a title card, and it is
 * distinctive enough to be recognisable while being far outside the Inter /
 * Space Grotesk cluster that every AI product currently lives in.
 *
 * ARCHIVO for interface. A grotesk with more width and personality than Inter,
 * still boring where boring matters: numbers, labels, buttons, long paragraphs.
 *
 * next/font self-hosts both at build time, so there is no request to Google at
 * runtime, no layout shift, and no dependency on a third party staying up.
 */
const display = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  style: ['normal', 'italic'],
  variable: '--font-display',
  display: 'swap',
});

const ui = Archivo({
  subsets: ['latin'],
  variable: '--font-ui',
  display: 'swap',
});

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
    <html
      lang="en"
      data-theme="light"
      suppressHydrationWarning
      /* Variables only — neither face is applied globally. The product's
         interface keeps the system stack it was tuned on; the landing page opts
         in through .rs-cinema. */
      className={`${display.variable} ${ui.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
