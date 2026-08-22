'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { ThemeToggle } from './ThemeToggle';
import { useAuth } from '@/lib/auth-context';
import { AuthModal } from './AuthModal';

export function AppShell({
  children,
  right,
}: {
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  const { user, loading, logout } = useAuth();
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');

  const openSignIn = () => {
    setAuthMode('signin');
    setAuthModalOpen(true);
  };

  const openSignUp = () => {
    setAuthMode('signup');
    setAuthModalOpen(true);
  };

  return (
    <div className="flex min-h-screen flex-col bg-canvas text-ink">
      {/* The workspace now stacks down to phone widths, so the header has to
          go with it: at 420px the wordmark, three nav items and the account
          cluster collided. Nav moves into a sheet below md. */}
      <header className="flex h-[68px] shrink-0 items-center gap-3 border-b border-line bg-panel px-4 md:gap-5 md:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--accent)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <rect x="3" y="3" width="18" height="18" rx="3" />
            <path d="M3 15l4.5-4.5a2 2 0 0 1 2.8 0L15 15" />
            <path d="M14 13.5l1.6-1.6a2 2 0 0 1 2.8 0L21 15" />
          </svg>
          <span className="text-[15px] font-bold tracking-tight">Restage</span>
        </Link>

        <nav className="hidden items-center gap-1 text-[13.5px] md:flex">
          <Link href="/studio" className="rounded-md px-2.5 py-1.5 font-medium text-ink-2 hover:bg-subtle">
            New run
          </Link>
          <Link href="/library" className="rounded-md px-2.5 py-1.5 font-medium text-ink-2 hover:bg-subtle">
            Library
          </Link>
          {/* Pointed at /enroll, so "Avatars" opened the capture wizard and the
              only thing you could do with an enrolled face was enrol another. */}
          <Link href="/avatars" className="rounded-md px-2.5 py-1.5 font-medium text-ink-2 hover:bg-subtle">
            Avatars
          </Link>
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-2 md:gap-3">
          <button
            type="button"
            onClick={() => setNavOpen((v) => !v)}
            aria-expanded={navOpen}
            aria-label="Menu"
            className="rounded-md p-2 text-ink-2 hover:bg-subtle md:hidden"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <path d="M3 6h18M3 12h18M3 18h18" />
            </svg>
          </button>

          {right}
          <ThemeToggle />

          {!loading && (
            <>
              {user ? (
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    {user.photoURL ? (
                      <img
                        src={user.photoURL}
                        alt=""
                        className="h-8 w-8 rounded-full border border-line object-cover"
                      />
                    ) : (
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-soft text-xs font-bold text-accent">
                        {(user.displayName || user.email || 'U')[0].toUpperCase()}
                      </div>
                    )}
                    <span className="hidden text-xs font-medium text-ink-2 md:inline">
                      {user.displayName || user.email}
                    </span>
                  </div>
                  <button
                    onClick={() => logout()}
                    className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink-2 transition-colors hover:bg-subtle hover:text-ink"
                  >
                    Sign out
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    onClick={openSignIn}
                    className="rounded-lg px-3 py-1.5 text-xs font-semibold text-ink-2 transition-colors hover:bg-subtle hover:text-ink"
                  >
                    Sign in
                  </button>
                  <button
                    onClick={openSignUp}
                    className="rounded-lg bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-ink transition-opacity hover:opacity-90"
                  >
                    Sign up
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </header>

      {navOpen && (
        <nav className="rs-enter flex flex-col border-b border-line bg-panel px-4 py-2 md:hidden">
          {[
            ['/studio', 'New run'],
            ['/library', 'Library'],
            ['/avatars', 'Avatars'],
          ].map(([href, label]) => (
            <Link
              key={href}
              href={href}
              onClick={() => setNavOpen(false)}
              className="rounded-md px-2 py-2.5 text-[14px] font-medium text-ink-2 hover:bg-subtle"
            >
              {label}
            </Link>
          ))}
        </nav>
      )}

      <main className="flex min-h-0 flex-1 flex-col">{children}</main>

      <AuthModal
        isOpen={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        initialMode={authMode}
      />
    </div>
  );
}
