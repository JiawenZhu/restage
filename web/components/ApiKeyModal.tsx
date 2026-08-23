'use client';

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';

interface ApiKeyModalProps {
  open: boolean;
  onClose: () => void;
  onOpenPricing?: () => void;
  isWelcomePrompt?: boolean;
}

export function ApiKeyModal({ open, onClose, onOpenPricing, isWelcomePrompt = false }: ApiKeyModalProps) {
  const { user } = useAuth();
  const [keyInput, setKeyInput] = useState('');
  const [keyPreview, setKeyPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showPlain, setShowPlain] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSuccess(null);
    setFetching(true);

    const localKey = typeof window !== 'undefined' ? localStorage.getItem('rs-gemini-key') : null;
    if (localKey && localKey.length >= 20) {
      setKeyPreview(maskKey(localKey));
    }

    if (user) {
      (async () => {
        try {
          const token = await user.getIdToken();
          const res = await fetch('/api/account/key', {
            headers: { authorization: `Bearer ${token}` },
          });
          if (res.ok) {
            const data = await res.json();
            if (data.keyPreview) {
              setKeyPreview(data.keyPreview);
            }
          }
        } catch {
          // Ignore fetch error
        } finally {
          setFetching(false);
        }
      })();
    } else {
      setFetching(false);
    }
  }, [open, user]);

  if (!open) return null;

  function maskKey(k: string): string {
    if (k.length <= 10) return '••••';
    return `${k.slice(0, 4)}••••${k.slice(-4)}`;
  }

  async function handleSave() {
    const raw = keyInput.trim();
    if (!raw) {
      setError('Please paste your Gemini API key.');
      return;
    }

    if (!raw.startsWith('AIza') && !raw.startsWith('AQ.')) {
      setError('Google Gemini API keys typically begin with AIza or AQ. Check that you copied the complete key.');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      // 1. If signed in, save via server endpoint
      if (user) {
        const token = await user.getIdToken();
        const res = await fetch('/api/account/key', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ key: raw }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Failed to validate API key with Google.');
        }
        setKeyPreview(data.keyPreview || maskKey(raw));
      } else {
        // Guest mode validation against Google API
        const testRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(raw)}`,
        );
        if (!testRes.ok) {
          const body = await testRes.json().catch(() => ({}));
          throw new Error(body.error?.message || `Google refused this key (${testRes.status}).`);
        }
        setKeyPreview(maskKey(raw));
      }

      // 2. Save locally in browser
      localStorage.setItem('rs-gemini-key', raw);
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('rs-key-prompt-dismissed', '1');
      }
      window.dispatchEvent(new CustomEvent('rs-key-changed', { detail: { keyPreview: maskKey(raw) } }));

      setSuccess('Gemini API key verified & securely encrypted for your account!');
      setKeyInput('');
      setTimeout(() => {
        onClose();
      }, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not verify that key with Google.');
    } finally {
      setLoading(false);
    }
  }

  async function handleRemove() {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      if (user) {
        const token = await user.getIdToken();
        await fetch('/api/account/key', {
          method: 'DELETE',
          headers: { authorization: `Bearer ${token}` },
        });
      }
      localStorage.removeItem('rs-gemini-key');
      window.dispatchEvent(new CustomEvent('rs-key-changed', { detail: { keyPreview: null } }));
      setKeyPreview(null);
      setKeyInput('');
      setSuccess('API key removed.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove key.');
    } finally {
      setLoading(false);
    }
  }

  function handleDismiss() {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('rs-key-prompt-dismissed', '1');
    }
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/75 backdrop-blur-sm transition-opacity" onClick={handleDismiss} />

      {/* Dialog */}
      <div className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-line bg-panel p-6 sm:p-7 shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-ink border border-accent/20">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 2l-2 2m-1-1l-2 2m-2-2l-2 2m-2-2l-2 2M3 21l9-9m3.5-3.5a4.95 4.95 0 1 0-7-7 4.95 4.95 0 0 0 7 7z" />
              </svg>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold tracking-tight text-ink">Google Gemini API Key</h2>
                {isWelcomePrompt && (
                  <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-bold text-accent-ink">
                    WELCOME
                  </span>
                )}
              </div>
              <p className="text-xs text-ink-3">Bring your own key for planning, image restaging, and video rendering.</p>
            </div>
          </div>

          <button
            onClick={handleDismiss}
            className="rounded-lg p-1.5 text-ink-3 hover:bg-subtle hover:text-ink transition-colors"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Security & Pricing Context Banner */}
        <div className="mt-4 rounded-xl border border-accent/20 bg-accent-soft/40 p-3.5 text-xs text-ink-2">
          <div className="flex items-center gap-1.5 font-bold text-accent-ink">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            <span>Secure Storage & $0 AI Generation Markup (BYOK)</span>
          </div>
          <p className="mt-1 text-ink-2 leading-relaxed">
            Your key is encrypted with <strong>AES-256-GCM</strong> on the server and only used for your own requests. We charge only <strong>$5/month</strong> for cloud storage & platform access, and $0 for AI model generations.
          </p>
          {onOpenPricing && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenPricing();
              }}
              className="mt-1.5 inline-flex items-center gap-1 font-semibold text-accent-ink hover:underline"
            >
              Learn about our $5/mo Cloud Storage plan →
            </button>
          )}
        </div>

        {/* Current Key Status Badge */}
        <div className="mt-4 rounded-xl border border-line bg-subtle p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-ink-3 uppercase tracking-wider">Active Key Status</span>
            {keyPreview ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-ok/10 border border-ok/30 px-2.5 py-0.5 text-[11px] font-semibold text-ok">
                <span className="h-1.5 w-1.5 rounded-full bg-ok animate-pulse" />
                Active ({keyPreview})
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-warn/10 border border-warn/30 px-2.5 py-0.5 text-[11px] font-semibold text-warn">
                No key configured
              </span>
            )}
          </div>
        </div>

        {/* Input */}
        <div className="mt-4 space-y-2">
          <label className="block text-xs font-semibold text-ink-2">
            {keyPreview ? 'Update Gemini API Key' : 'Paste your Gemini API Key'}
          </label>
          <div className="relative">
            <input
              type={showPlain ? 'text' : 'password'}
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="AIzaSy..."
              className="w-full rounded-xl border border-line bg-canvas px-3.5 py-2.5 pr-10 text-sm font-mono text-ink placeholder:text-ink-4 focus:border-accent focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setShowPlain(!showPlain)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-3 hover:text-ink p-1"
            >
              {showPlain ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
          </div>

          <div className="flex items-center justify-between pt-1">
            <a
              href="https://aistudio.google.com/apikey"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs font-semibold text-accent-ink hover:underline"
            >
              Get a free Gemini key at Google AI Studio
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3" />
              </svg>
            </a>
          </div>
        </div>

        {/* Feedback Alerts */}
        {error && (
          <div className="mt-4 rounded-xl border border-crit/40 bg-crit-soft px-3.5 py-2.5 text-xs text-crit-ink">
            {error}
          </div>
        )}
        {success && (
          <div className="mt-4 rounded-xl border border-ok/40 bg-ok/10 px-3.5 py-2.5 text-xs text-ok">
            {success}
          </div>
        )}

        {/* Footer Actions */}
        <div className="mt-6 flex items-center justify-between gap-3 border-t border-line pt-4">
          {keyPreview ? (
            <button
              type="button"
              onClick={handleRemove}
              disabled={loading}
              className="rounded-lg px-3 py-2 text-xs font-semibold text-crit-ink hover:bg-crit-soft transition-colors disabled:opacity-50"
            >
              Remove key
            </button>
          ) : (
            <button
              type="button"
              onClick={handleDismiss}
              className="text-xs font-medium text-ink-3 hover:text-ink transition-colors"
            >
              Skip for now
            </button>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDismiss}
              className="rounded-lg border border-line px-3.5 py-2 text-xs font-semibold text-ink-2 hover:bg-subtle hover:text-ink transition-colors"
            >
              Close
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={loading || !keyInput.trim()}
              className="rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-ink transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {loading ? 'Verifying with Google…' : 'Save & Encrypt Key'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
