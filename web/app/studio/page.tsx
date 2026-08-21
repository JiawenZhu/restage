'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { AuthButton, useUser } from '@/components/AuthGate';
import type { Aspect } from '@/lib/types';
import { PromptComposer } from '@/components/PromptComposer';

const GOAL_KEYWORDS = [
  'in my kitchen',
  'I hold the product',
  'talking to camera',
  'feels filmed on a phone',
  'morning window light',
  'survives the first two seconds',
];

export default function NewRun() {
  const router = useRouter();
  const { user, ready } = useUser();
  const fileRef = useRef<HTMLInputElement>(null);

  const [goal, setGoal] = useState('');
  const [aspect, setAspect] = useState<Aspect>('9:16');
  const [seconds, setSeconds] = useState<8 | 15 | 30>(15);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canStart = !!user && !!avatar && goal.trim().length >= 8 && !busy;

  async function pickFile(file: File) {
    // Read to a data URL so the same bytes reach the model as a reference and
    // the tree root without a round trip through storage first.
    const reader = new FileReader();
    reader.onload = () => setAvatar(String(reader.result));
    reader.readAsDataURL(file);
  }

  async function start() {
    if (!user || !avatar) return;
    setBusy(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ goal: goal.trim(), aspect, seconds, avatarDataUrl: avatar }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'could not start the run');
      router.push(`/studio/${json.runId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not start the run');
      setBusy(false);
    }
  }

  return (
    <AppShell right={<AuthButton />}>
      <div className="mx-auto w-full max-w-4xl px-6 py-14">
        <h1 className="text-[32px] font-bold tracking-[-0.025em]">What should this ad do?</h1>
        <p className="mt-2 text-base text-ink-3">Describe the result, not the shots. The agent works out the shots.</p>

        {ready && !user && (
          <div className="mt-6 rounded-card border border-line bg-panel px-5 py-4 text-[13.5px] text-ink-2">
            Sign in first — runs are stored against your account, and the frames are your face.
          </div>
        )}

        <p className="mt-9 text-[10.5px] font-bold tracking-[0.12em] text-ink-3">WHO IS IN IT</p>
        <div className="mt-2.5 flex items-center gap-3">
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && pickFile(e.target.files[0])} />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className={`flex items-center gap-3 rounded-card p-2.5 pr-4 text-left ${avatar ? 'border-2 border-accent bg-panel' : 'border-[1.5px] border-dashed border-line-strong'}`}
          >
            {avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatar} alt="" className="h-11 w-11 rounded-lg object-cover" />
            ) : (
              <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-subtle text-ink-4">+</span>
            )}
            <span>
              <span className="block text-[13.5px] font-semibold">{avatar ? 'Change photo' : 'Upload a photo of yourself'}</span>
              <span className="block text-[11.5px] text-ink-3">Face clearly visible, good light</span>
            </span>
          </button>
        </div>

        <p className="mt-7 text-[10.5px] font-bold tracking-[0.12em] text-ink-3">THE GOAL</p>
        {/* Two cards: the user's words stay visible, and the model-facing
            rewrite appears beside them. What gets planned is the refined one
            when it exists, the raw one otherwise. */}
        <div className="mt-2.5">
          <PromptComposer
            purpose="goal"
            keywords={GOAL_KEYWORDS}
            placeholder="Say or type the outcome you want — not the shots."
            onPrompt={(finalPrompt) => setGoal(finalPrompt)}
          />
        </div>

        <div className="mt-7 grid gap-5 sm:grid-cols-2">
          <div>
            <p className="text-[10.5px] font-bold tracking-[0.12em] text-ink-3">FORMAT</p>
            <div className="mt-2.5 flex gap-2.5">
              {(['9:16', '16:9'] as const).map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setAspect(a)}
                  className={`flex flex-1 items-center gap-3 rounded-card bg-panel p-4 text-left ${aspect === a ? 'border-2 border-accent' : 'border border-line'}`}
                >
                  <span className={`shrink-0 rounded border-2 ${aspect === a ? 'border-accent' : 'border-ink-4'} ${a === '9:16' ? 'h-11 w-6' : 'h-6 w-11'}`} />
                  <span>
                    <span className="block text-sm font-semibold">{a}</span>
                    <span className="block text-[11.5px] text-ink-3">{a === '9:16' ? 'Reels, TikTok, Shorts' : 'YouTube, site, pre-roll'}</span>
                  </span>
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-ink-4">The agent frames every step for this ratio — it is not a crop at the end.</p>
          </div>

          <div>
            <p className="text-[10.5px] font-bold tracking-[0.12em] text-ink-3">LENGTH</p>
            <div className="mt-2.5 flex gap-2">
              {([8, 15, 30] as const).map((s) => (
                <button key={s} type="button" onClick={() => setSeconds(s)} className={`flex-1 rounded-card bg-panel py-5 text-sm font-semibold ${seconds === s ? 'border-2 border-accent' : 'border border-line text-ink-2'}`}>
                  {s}s
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-ink-4">Longer runs cost more credits and take longer to render.</p>
          </div>
        </div>

        {error && <p className="mt-6 rounded-card border border-crit/40 bg-crit-soft px-4 py-3 text-[13.5px] text-crit">{error}</p>}

        <div className="mt-8 flex items-center justify-between gap-4">
          <span className="text-[13px] text-ink-4">
            The plan appears first, then the frames. A run takes two to four minutes.
          </span>
          <button
            type="button"
            disabled={!canStart}
            onClick={start}
            className="shrink-0 rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-primary-ink disabled:opacity-40"
          >
            {busy ? 'Starting…' : 'Plan the run'}
          </button>
        </div>
      </div>
    </AppShell>
  );
}
