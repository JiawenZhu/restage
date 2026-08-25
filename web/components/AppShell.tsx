'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { ThemeToggle } from './ThemeToggle';
import { useAuth } from '@/lib/auth-context';
import { AuthModal } from './AuthModal';
import { ApiKeyModal } from './ApiKeyModal';
import { PricingModal } from './PricingModal';

export function AppShell({
  children,
  fill = false,
  right,
}: {
  children: React.ReactNode;
  right?: React.ReactNode;
  /**
   * Bound the shell to the viewport instead of letting it grow.
   */
  fill?: boolean;
}) {
  const { user, loading, logout } = useAuth();
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [apiKeyModalOpen, setApiKeyModalOpen] = useState(false);
  const [pricingModalOpen, setPricingModalOpen] = useState(false);
  const [isWelcomePrompt, setIsWelcomePrompt] = useState(false);
  const [keyMask, setKeyMask] = useState<string | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');

  useEffect(() => {
    function checkKey() {
      const localKey = typeof window !== 'undefined' ? localStorage.getItem('rs-gemini-key') : null;
      if (localKey && localKey.length >= 20) {
        setKeyMask(`${localKey.slice(0, 4)}••••${localKey.slice(-4)}`);
      } else {
        setKeyMask(null);
      }
    }

    checkKey();
    window.addEventListener('rs-key-changed', checkKey);
    return () => window.removeEventListener('rs-key-changed', checkKey);
  }, []);

  /* Post-login check: If user logs in and has no API key configured, prompt them automatically. */
  useEffect(() => {
    if (!user) return;
    let active = true;

    (async () => {
      try {
        const token = await user.getIdToken();
        const res = await fetch('/api/account/key', {
          headers: { authorization: `Bearer ${token}` },
        });
        if (!active) return;

        let hasAccountKey = false;
        if (res.ok) {
          const data = await res.json();
          if (data.keyPreview) {
            hasAccountKey = true;
            setKeyMask(data.keyPreview);
          }
        }

        const localKey = typeof window !== 'undefined' ? localStorage.getItem('rs-gemini-key') : null;
        const dismissed = typeof window !== 'undefined' ? sessionStorage.getItem('rs-key-prompt-dismissed') : null;

        if (!hasAccountKey && (!localKey || localKey.length < 20) && !dismissed) {
          setIsWelcomePrompt(true);
          setApiKeyModalOpen(true);
        }
      } catch {}
    })();

    return () => {
      active = false;
    };
  }, [user]);

  const openSignIn = () => {
    setAuthMode('signin');
    setAuthModalOpen(true);
  };

  const openSignUp = () => {
    setAuthMode('signup');
    setAuthModalOpen(true);
  };

  return (
    <div
      className={`flex min-h-screen flex-col bg-canvas text-ink ${
        fill ? 'lg:h-screen lg:min-h-0 lg:overflow-hidden' : ''
      }`}
    >
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
          <Link href="/avatars" className="rounded-md px-2.5 py-1.5 font-medium text-ink-2 hover:bg-subtle">
            Avatars
          </Link>
          <button
            type="button"
            onClick={() => setPricingModalOpen(true)}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 font-medium text-ink-2 hover:bg-subtle transition-colors"
          >
            <span>Pricing</span>
            <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[10px] font-bold text-accent-ink flex items-center gap-1">
              <span className="line-through opacity-60 decoration-danger decoration-[1.5px]">$5</span>
              <span>$0/mo</span>
            </span>
          </button>
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

          {/* Gemini API Key Button */}
          <button
            type="button"
            onClick={() => {
              setIsWelcomePrompt(false);
              setApiKeyModalOpen(true);
            }}
            className="flex items-center gap-1.5 rounded-lg border border-line bg-subtle/80 px-2.5 py-1.5 text-xs font-semibold text-ink-2 hover:border-accent/50 hover:bg-subtle hover:text-ink transition-all"
            title="Configure your Google Gemini API Key"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent">
              <path d="M21 2l-2 2m-1-1l-2 2m-2-2l-2 2m-2-2l-2 2M3 21l9-9m3.5-3.5a4.95 4.95 0 1 0-7-7 4.95 4.95 0 0 0 7 7z" />
            </svg>
            {keyMask ? (
              <span className="flex items-center gap-1.5">
                <span className="hidden sm:inline text-ink-3">Key:</span>
                <span className="font-mono text-[11px] text-accent-ink">{keyMask}</span>
                <span className="h-1.5 w-1.5 rounded-full bg-ok" />
              </span>
            ) : (
              <span className="text-ink-2">API Key</span>
            )}
          </button>

          {right}
          <ThemeToggle />

          {loading && <span aria-hidden className="h-7 w-[132px] rounded-lg bg-subtle" />}

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
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-soft text-xs font-bold text-accent-ink">
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
          <button
            type="button"
            onClick={() => {
              setNavOpen(false);
              setPricingModalOpen(true);
            }}
            className="flex items-center gap-2 rounded-md px-2 py-2.5 text-[14px] font-medium text-ink-2 hover:bg-subtle text-left"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
            </svg>
            <span>Pricing (<span className="line-through opacity-60 decoration-danger decoration-[1.5px] mr-1">$5</span>$0/mo Free Beta)</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setNavOpen(false);
              setIsWelcomePrompt(false);
              setApiKeyModalOpen(true);
            }}
            className="flex items-center gap-2 rounded-md px-2 py-2.5 text-[14px] font-medium text-accent-ink hover:bg-subtle text-left"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 2l-2 2m-1-1l-2 2m-2-2l-2 2m-2-2l-2 2M3 21l9-9m3.5-3.5a4.95 4.95 0 1 0-7-7 4.95 4.95 0 0 0 7 7z" />
            </svg>
            {keyMask ? `Gemini API Key (${keyMask})` : 'Set Gemini API Key'}
          </button>
        </nav>
      )}

      <main className="flex min-h-0 flex-1 flex-col">{children}</main>

      <AuthModal
        isOpen={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        initialMode={authMode}
      />

      <ApiKeyModal
        open={apiKeyModalOpen}
        onClose={() => {
          setApiKeyModalOpen(false);
          setIsWelcomePrompt(false);
        }}
        onOpenPricing={() => setPricingModalOpen(true)}
        isWelcomePrompt={isWelcomePrompt}
      />

      <PricingModal
        open={pricingModalOpen}
        onClose={() => setPricingModalOpen(false)}
        onOpenApiKey={() => {
          setIsWelcomePrompt(false);
          setApiKeyModalOpen(true);
        }}
      />
    </div>
  );
}
