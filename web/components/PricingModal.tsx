'use client';

import React, { useState } from 'react';
import { useAuth } from '@/lib/auth-context';

interface PricingModalProps {
  open: boolean;
  onClose: () => void;
  onOpenApiKey?: () => void;
}

export function PricingModal({ open, onClose, onOpenApiKey }: PricingModalProps) {
  const { user } = useAuth();
  const [annual, setAnnual] = useState(false);
  const [loading, setLoading] = useState(false);
  const [subscribed, setSubscribed] = useState(false);

  if (!open) return null;

  async function handleSubscribe() {
    setLoading(true);
    // Simulate activation or redirect to billing portal
    setTimeout(() => {
      setLoading(false);
      setSubscribed(true);
    }, 900);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/75 backdrop-blur-sm transition-opacity" onClick={onClose} />

      {/* Modal Dialog */}
      <div className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-line bg-panel p-6 sm:p-8 shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1 text-xs font-bold text-accent-ink border border-accent/20">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
              </svg>
              CREATOR MEMBERSHIP
            </div>
            <h2 className="mt-3 text-2xl font-bold tracking-tight text-ink sm:text-3xl">
              Cloud Storage & Platform Access
            </h2>
            <p className="mt-1 text-xs sm:text-sm text-ink-3">
              Zero markup on AI generations. Bring your own Gemini API key, we cover the cloud.
            </p>
          </div>

          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-ink-3 hover:bg-subtle hover:text-ink transition-colors shrink-0"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Billing Toggle */}
        <div className="mt-6 flex items-center justify-center">
          <div className="inline-flex items-center rounded-xl bg-subtle p-1 border border-line">
            <button
              type="button"
              onClick={() => setAnnual(false)}
              className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all ${
                !annual ? 'bg-panel text-ink shadow-sm' : 'text-ink-3 hover:text-ink'
              }`}
            >
              Monthly billing
            </button>
            <button
              type="button"
              onClick={() => setAnnual(true)}
              className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all ${
                annual ? 'bg-panel text-ink shadow-sm' : 'text-ink-3 hover:text-ink'
              }`}
            >
              <span>Annual billing</span>
              <span className="rounded-full bg-ok/20 px-1.5 py-0.5 text-[10px] font-bold text-ok">
                Save $10
              </span>
            </button>
          </div>
        </div>

        {/* Pricing Card */}
        <div className="mt-6 rounded-2xl border-2 border-accent bg-panel p-6 shadow-[0_16px_40px_-20px_rgba(57,135,229,0.35)]">
          <div className="flex items-baseline justify-between">
            <div>
              <span className="text-4xl font-extrabold tracking-tight text-ink sm:text-5xl">
                {annual ? '$50' : '$5'}
              </span>
              <span className="ml-2 text-sm font-medium text-ink-3">
                {annual ? '/ year ($4.16/mo)' : '/ month'}
              </span>
            </div>
            <span className="rounded-full bg-accent-strong px-2.5 py-0.5 text-[11px] font-bold tracking-wide text-white">
              FLAT RATE
            </span>
          </div>

          <p className="mt-2 text-xs text-ink-2">
            Includes full cloud video storage, avatar database, permanent download URLs, and unlimited runs.
          </p>

          {/* BYOK Explainer Note */}
          <div className="mt-4 rounded-xl border border-line bg-subtle/70 p-3 text-xs text-ink-2">
            <div className="flex items-center gap-1.5 font-semibold text-accent-ink">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 2l-2 2m-1-1l-2 2m-2-2l-2 2m-2-2l-2 2M3 21l9-9m3.5-3.5a4.95 4.95 0 1 0-7-7 4.95 4.95 0 0 0 7 7z" />
              </svg>
              Why Bring Your Own Key (BYOK)?
            </div>
            <p className="mt-1 text-ink-3 leading-relaxed">
              Google provides generous free AI generation quotas directly via Google AI Studio. Instead of marking up credits by 500% like other tools, you use your own key for $0 AI compute markup and only pay $5/mo for our cloud storage & rendering pipeline.
            </p>
          </div>

          {/* Feature list */}
          <ul className="mt-5 space-y-2.5 text-xs text-ink-2">
            {[
              'Cloudflare R2 & Firebase persistent video storage & permanent download links',
              'Multi-angle face likeness profile storage (enrol once, reuse forever)',
              'Unlimited canvas storyboards, version trees, and shot branch regenerations',
              'Multi-shot video stitching pipeline with audio muxing & burned-in captions',
              'Veo 3.1 & Gemini Omni video generation with 9:16 vertical & 16:9 landscape',
              'AES-256-GCM encrypted server-side key security for your Google Gemini API key',
            ].map((f) => (
              <li key={f} className="flex items-start gap-2">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-ok shrink-0 mt-0.5">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span>{f}</span>
              </li>
            ))}
          </ul>

          {/* Subscribe Action */}
          <div className="mt-6">
            {subscribed ? (
              <div className="rounded-xl border border-ok/40 bg-ok/10 p-3 text-center text-xs font-semibold text-ok">
                ✓ Cloud Storage Membership Active! You can now render and save unlimited UGC ads.
              </div>
            ) : (
              <button
                type="button"
                onClick={handleSubscribe}
                disabled={loading}
                className="w-full rounded-xl bg-primary py-3 text-center text-sm font-bold text-primary-ink shadow-lg transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {loading ? 'Setting up Cloud Access…' : annual ? 'Start Annual Membership ($50/year)' : 'Start Membership ($5/month)'}
              </button>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-xs text-ink-3">
          <div className="flex items-center gap-1.5">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            <span>Cancel anytime with one click</span>
          </div>

          {onOpenApiKey && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenApiKey();
              }}
              className="font-medium text-accent-ink hover:underline"
            >
              Configure Gemini API Key →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
