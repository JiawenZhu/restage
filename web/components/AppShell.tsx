import Link from 'next/link';
import { ThemeToggle } from './ThemeToggle';

/*
 * The chrome Arcads gets right: a quiet top bar, a dark primary action rather
 * than a coloured one, and 1px borders doing the work shadows would otherwise do.
 */
export function AppShell({
  children,
  right,
}: {
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-canvas text-ink">
      <header className="flex h-[68px] shrink-0 items-center gap-5 border-b border-line bg-panel px-6">
        <Link href="/" className="flex items-center gap-2">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="3" y="3" width="18" height="18" rx="3" />
            <path d="M3 15l4.5-4.5a2 2 0 0 1 2.8 0L15 15" />
            <path d="M14 13.5l1.6-1.6a2 2 0 0 1 2.8 0L21 15" />
          </svg>
          <span className="text-[15px] font-bold tracking-tight">Restage</span>
        </Link>

        <nav className="flex items-center gap-1 text-[13.5px]">
          <Link href="/studio" className="rounded-md px-2.5 py-1.5 font-medium text-ink-2 hover:bg-subtle">New run</Link>
          <Link href="/library" className="rounded-md px-2.5 py-1.5 font-medium text-ink-2 hover:bg-subtle">Library</Link>
          <Link href="/enroll" className="rounded-md px-2.5 py-1.5 font-medium text-ink-2 hover:bg-subtle">Avatars</Link>
        </nav>

        <div className="ml-auto flex items-center gap-3">
          {right}
          <ThemeToggle />
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col">{children}</main>
    </div>
  );
}
