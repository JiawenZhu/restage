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
      <header className="flex h-[68px] shrink-0 items-center gap-5 border-b border-line bg-panel px-6">
        <Link href="/" className="flex items-center gap-2">
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

        <nav className="flex items-center gap-1 text-[13.5px]">
          <Link href="/studio" className="rounded-md px-2.5 py-1.5 font-medium text-ink-2 hover:bg-subtle">
            New run
          </Link>
          <Link href="/library" className="rounded-md px-2.5 py-1.5 font-medium text-ink-2 hover:bg-subtle">
            Library
          </Link>
          <Link href="/enroll" className="rounded-md px-2.5 py-1.5 font-medium text-ink-2 hover:bg-subtle">
            Avatars
          </Link>
        </nav>

        <div className="ml-auto flex items-center gap-3">
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
                    退出
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    onClick={openSignIn}
                    className="rounded-lg px-3 py-1.5 text-xs font-semibold text-ink-2 transition-colors hover:bg-subtle hover:text-ink"
                  >
                    登录
                  </button>
                  <button
                    onClick={openSignUp}
                    className="rounded-lg bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-ink transition-opacity hover:opacity-90"
                  >
                    注册
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col">{children}</main>

      <AuthModal
        isOpen={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        initialMode={authMode}
      />
    </div>
  );
}
