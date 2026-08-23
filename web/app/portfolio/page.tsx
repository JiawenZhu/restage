'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/AppShell';

interface PortfolioItem {
  id: string;
  runId: string;
  title: string;
  category: string;
  aspect: '9:16' | '16:9';
  payoutRange: string;
  targetPlatforms: string[];
  hook: string;
  audioScript: string;
  videoUrl: string;
  directR2Url: string;
  tags: string[];
  description: string;
  pitchAngle: string;
}

const PORTFOLIO_ITEMS: PortfolioItem[] = [
  {
    id: 'ad-1-fintech',
    runId: 'rhCruSevWcDP9uBL5wrN',
    title: 'Travel & Fintech Savings App',
    category: 'Fintech & Digital Apps',
    aspect: '9:16',
    payoutRange: '$100 – $225 / video',
    targetPlatforms: ['Relay', 'Influee', 'Billo', 'UGC Shop'],
    hook: '“I literally saved $340 on my holiday flights because this app froze the price before it went up.”',
    audioScript: 'I literally saved three forty on my holiday flights because this app froze the price before it went up.',
    videoUrl: '/api/runs/rhCruSevWcDP9uBL5wrN/video?nodeId=r6GWdtwFtc2cckeZ2O3p',
    directR2Url: 'https://video-renders.14383fdccda7fa25e4ec34718f36c5da.r2.cloudflarestorage.com/ypGBh9tgrxQixPdJWwI6k40lF812/rhCruSevWcDP9uBL5wrN/r6GWdtwFtc2cckeZ2O3p.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=848a879124ade116a6754ecc8e147b14%2F20260823%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20260823T220657Z&X-Amz-Expires=604800&X-Amz-Signature=80e49c7efafe98e94c541597d8522433bee49fd2c3e7658a58e4842507fe1849&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject',
    tags: ['App Demo', 'Problem / Solution', 'Conversational', 'Price-Freeze'],
    description: 'Relatable lifestyle setting with natural morning window lighting, screen-capture interaction, and verified peer-to-peer recommendation delivery.',
    pitchAngle: 'Target apps like Hopper, Super.com, Koho, and Neo Financial looking for relatable app walkthroughs without staged studio lighting.',
  },
  {
    id: 'ad-2-dtc-lifestyle',
    runId: 'bCPK2SQD8qlGdrj9ESk2',
    title: 'Active DTC Polarized Sunglasses',
    category: 'E-Commerce DTC & Lifestyle',
    aspect: '9:16',
    payoutRange: '$150 – $300 / video',
    targetPlatforms: ['Vidovo', 'Cohley', 'The UGC Shop', 'Billo'],
    hook: '“If you hate sunglasses that slide down your nose the second you start sweating, these polarized shades are a game-changer.”',
    audioScript: 'If you hate sunglasses that slide down your nose the second you start sweating, these polarized shades are a game changer.',
    videoUrl: '/api/runs/bCPK2SQD8qlGdrj9ESk2/video?nodeId=Mhidrkg3JHydYIKbDV3X',
    directR2Url: 'https://video-renders.14383fdccda7fa25e4ec34718f36c5da.r2.cloudflarestorage.com/ypGBh9tgrxQixPdJWwI6k40lF812/bCPK2SQD8qlGdrj9ESk2/Mhidrkg3JHydYIKbDV3X.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=848a879124ade116a6754ecc8e147b14%2F20260823%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20260823T221012Z&X-Amz-Expires=604800&X-Amz-Signature=fd07c696c1be7489c869599b9994b3efc4cbfbd5e48ba4a642eee3b18644bec1&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject',
    tags: ['Outdoor DTC', 'Wear Test', 'Anti-Slip', 'High Energy'],
    description: 'Crisp outdoor sunlight, active lifestyle framing, tactile product examination, and physical wear-test demonstration.',
    pitchAngle: 'Target DTC consumer brands like Goodr, Scosche, Blacklight, and athletic accessories testing high-CTR TikTok hook angles.',
  },
  {
    id: 'ad-3-tech-saas',
    runId: 'RWijv6n7yx3VStPFMoSh',
    title: 'Autonomous AI Creative Director SaaS',
    category: 'AI SaaS & Tech Product',
    aspect: '16:9',
    payoutRange: '$400 – $1,000 / retainer',
    targetPlatforms: ['Aura Ads', 'Direct Agency Retainers', 'TikTok Shop'],
    hook: '“The way we produce video ads is undergoing a massive shift: moving from 4-hour shoots to 2-minute autonomous AI storyboards.”',
    audioScript: 'The way we produce video ads is undergoing a massive shift: moving from 4-hour shoots to 2-minute autonomous AI storyboards.',
    videoUrl: '/api/runs/RWijv6n7yx3VStPFMoSh/video?nodeId=DNg1TT8W78h5A0L3tHfK',
    directR2Url: 'https://video-renders.14383fdccda7fa25e4ec34718f36c5da.r2.cloudflarestorage.com/ypGBh9tgrxQixPdJWwI6k40lF812/RWijv6n7yx3VStPFMoSh/DNg1TT8W78h5A0L3tHfK.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=848a879124ade116a6754ecc8e147b14%2F20260823%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20260823T221322Z&X-Amz-Expires=604800&X-Amz-Signature=064c7f118b36faf9b96ef31735f191c31a219633ac4084a78181831c49c06141&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject',
    tags: ['SaaS Demo', '16:9 Hero', 'Agency Pitch', 'High Ticket'],
    description: 'High-end tech pavilion background, authoritative founder presentation, and multi-angle workflow demonstration built for YouTube & desktop landing pages.',
    pitchAngle: 'Target performance agencies (like Aura Ads) and SaaS founders wanting continuous creative iteration without actor burnout.',
  },
];

export default function PortfolioPage() {
  const [selectedAd, setSelectedAd] = useState<PortfolioItem>(PORTFOLIO_ITEMS[0]);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copyLink = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl px-4 py-8 md:py-12">
        {/* Header */}
        <div className="mb-8 md:mb-12">
          <div className="inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent-soft px-3 py-1 text-xs font-semibold text-accent-ink mb-3">
            <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
            Verified Creator Portfolio
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-ink md:text-4xl">
            UGC Video Portfolio & Pitch Kit
          </h1>
          <p className="mt-2 text-base text-ink-2 max-w-2xl">
            Commercial-ready video ads produced with Restage Autonomous Creative Engine. Built for applications on Relay, Vidovo, Cohley, Billo, Influee, and direct agency retainers.
          </p>
        </div>

        {/* Main Grid: Player + Ad Details */}
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 mb-12">
          {/* Video Preview Player */}
          <div className="lg:col-span-6 flex flex-col items-center justify-center rounded-2xl border border-line bg-card p-6 shadow-sm">
            <div className="relative w-full flex items-center justify-center bg-subtle/50 rounded-xl overflow-hidden min-h-[440px]">
              <video
                key={selectedAd.videoUrl}
                src={selectedAd.videoUrl}
                controls
                autoPlay
                loop
                playsInline
                className={`rounded-lg object-contain shadow-lg ${
                  selectedAd.aspect === '9:16' ? 'max-h-[480px] w-auto' : 'w-full max-h-[360px]'
                }`}
              />
            </div>

            <div className="mt-4 flex w-full items-center justify-between gap-3">
              <span className="text-xs font-medium text-ink-3">
                Format: <span className="font-mono text-ink-2 font-bold">{selectedAd.aspect}</span> • Run: <span className="font-mono text-ink-3">{selectedAd.runId}</span>
              </span>
              <a
                href={selectedAd.directR2Url}
                download={`${selectedAd.id}.mp4`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-accent/90 transition-all"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
                </svg>
                Download MP4
              </a>
            </div>
          </div>

          {/* Ad Info & Pitch Insights */}
          <div className="lg:col-span-6 flex flex-col justify-between space-y-6">
            <div className="rounded-2xl border border-line bg-card p-6 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-accent-ink bg-accent-soft px-2.5 py-1 rounded-md">
                  {selectedAd.category}
                </span>
                <span className="text-sm font-semibold text-ok bg-ok/10 px-2.5 py-0.5 rounded-full border border-ok/20">
                  {selectedAd.payoutRange}
                </span>
              </div>

              <h2 className="text-2xl font-bold text-ink">{selectedAd.title}</h2>
              <p className="text-sm text-ink-2 leading-relaxed">{selectedAd.description}</p>

              {/* Hook Quote Box */}
              <div className="rounded-xl border border-line bg-subtle/80 p-4">
                <p className="text-xs font-bold uppercase tracking-wider text-ink-3 mb-1">Spoken Script Hook</p>
                <p className="text-sm italic font-medium text-ink">“{selectedAd.audioScript}”</p>
              </div>

              {/* Target Platforms */}
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-ink-3 mb-2">Ideal Platform Applications</p>
                <div className="flex flex-wrap gap-1.5">
                  {selectedAd.targetPlatforms.map((p) => (
                    <span key={p} className="rounded-md border border-line bg-subtle px-2.5 py-1 text-xs font-semibold text-ink-2">
                      {p}
                    </span>
                  ))}
                </div>
              </div>

              {/* Pitch Angle */}
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-ink-3 mb-1">Winning Pitch Strategy</p>
                <p className="text-xs text-ink-2">{selectedAd.pitchAngle}</p>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => copyLink(selectedAd.directR2Url, selectedAd.id)}
                className="flex-1 rounded-xl border border-line bg-card py-2.5 text-xs font-semibold text-ink hover:bg-subtle transition-colors flex items-center justify-center gap-2"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
                {copiedId === selectedAd.id ? 'Copied Share Link!' : 'Copy Direct Video Link'}
              </button>

              <Link
                href={`/studio/${selectedAd.runId}`}
                className="rounded-xl border border-line bg-card px-4 py-2.5 text-xs font-semibold text-ink-2 hover:bg-subtle transition-colors"
              >
                Inspect in Studio →
              </Link>
            </div>
          </div>
        </div>

        {/* Ad Selector Tabs */}
        <div className="mb-12">
          <h3 className="text-lg font-bold text-ink mb-4">Select Portfolio Video</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {PORTFOLIO_ITEMS.map((ad, idx) => (
              <button
                key={ad.id}
                type="button"
                onClick={() => setSelectedAd(ad)}
                className={`text-left p-4 rounded-xl border transition-all ${
                  selectedAd.id === ad.id
                    ? 'border-accent bg-accent-soft/30 shadow-sm'
                    : 'border-line bg-card hover:border-line-strong hover:bg-subtle/50'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-ink-3">Ad {idx + 1} • {ad.aspect}</span>
                  <span className="text-xs font-semibold text-accent-ink">{ad.payoutRange.split(' ')[0]}</span>
                </div>
                <h4 className="text-sm font-bold text-ink truncate">{ad.title}</h4>
                <p className="text-xs text-ink-2 mt-1 line-clamp-2">{ad.hook}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Platform Application Checklist */}
        <div className="rounded-2xl border border-line bg-card p-6 md:p-8 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-xl font-bold text-ink">Creator Marketplace Application Playbook</h3>
              <p className="text-xs text-ink-2 mt-1">Submit these 3 sample video links directly when applying for creator rosters:</p>
            </div>
            <Link
              href="/studio"
              className="hidden sm:inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-accent/90"
            >
              Generate New Ad
            </Link>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { name: 'Relay.club', role: 'Fast-turnaround App briefs', payout: '$100/vid', sample: 'Ad 1 (Fintech)' },
              { name: 'Cohley.com', role: 'Premium DTC & Lifestyle', payout: '$150-$250/vid', sample: 'Ad 2 (Goodr)' },
              { name: 'Vidovo.com', role: 'Beauty & Activewear briefs', payout: '$100-$300/vid', sample: 'Ad 2 (Goodr)' },
              { name: 'Aura Ads / Agencies', role: 'Monthly bulk testing retainers', payout: '$500-$1000/mo', sample: 'Ad 3 (SaaS)' },
            ].map((p) => (
              <div key={p.name} className="p-4 rounded-xl border border-line bg-subtle/50 space-y-1.5">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-ink">{p.name}</h4>
                  <span className="text-[10px] font-bold text-ok">{p.payout}</span>
                </div>
                <p className="text-[11px] text-ink-2">{p.role}</p>
                <div className="pt-2 border-t border-line text-[10px] font-medium text-ink-3">
                  Recommended: <span className="font-semibold text-ink-2">{p.sample}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
