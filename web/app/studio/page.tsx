'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { AuthButton, useUser } from '@/components/AuthGate';
import type { Aspect } from '@/lib/types';
import { PromptComposer } from '@/components/PromptComposer';

import { TemplateGallery } from '@/components/TemplateGallery';
import { CREATIVE_TEMPLATES } from '@/lib/templates';
import type { CreativeTemplate } from '@/lib/templates';

const DEFAULT_KEYWORDS = [
  'in my kitchen',
  'I hold the product',
  'talking to camera',
  'feels filmed on a phone',
  'morning window light',
  'survives the first two seconds',
];

interface EnrolledAvatar {
  id: string;
  name: string;
  createdAt: number;
  hasVoice: boolean;
  /** Signed, short-lived read URLs. The orchestrator accepts http(s) as well as
   *  data URLs, so these pass straight through. */
  urls: { front: string | null; left: string | null; right: string | null };
}

/*
 * useSearchParams opts the subtree out of prerendering, so Next requires a
 * Suspense boundary around it — the production build fails without one, while
 * dev renders happily. The param is only the "which avatar" hint from
 * /avatars, so the fallback is the same page minus a preselection.
 */
export default function NewRunPage() {
  return (
    <Suspense fallback={<AppShell><div className="flex flex-1 items-center justify-center"><p className="text-[13px] text-ink-4">Loading…</p></div></AppShell>}>
      <NewRun />
    </Suspense>
  );
}

function NewRun() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, ready } = useUser();
  const fileRef = useRef<HTMLInputElement>(null);

  const [goal, setGoal] = useState('');
  const [aspect, setAspect] = useState<Aspect>('9:16');
  const [seconds, setSeconds] = useState<4 | 6 | 8>(8);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [multiViews, setMultiViews] = useState<{ front?: string; left?: string; right?: string } | null>(null);
  const [avatarName, setAvatarName] = useState<string | null>(null);
  const [avatarId, setAvatarId] = useState<string | null>(null);
  const [enrolled, setEnrolled] = useState<EnrolledAvatar[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<CreativeTemplate | null>(null);
  const [pendingTemplate, setPendingTemplate] = useState<CreativeTemplate | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * Load the user's enrolled faces from their account.
   *
   * This read `restage_latest_avatar` from localStorage — a browser-global key,
   * so signing out and into a second account on the same machine offered the
   * first account's face, and the enrolled avatar was invisible on any other
   * device. The face belongs to the account, so it comes from the server.
   *
   * The images arrive as signed URLs. The orchestrator accepts http(s) as well
   * as data URLs, so they can be passed straight through without the client
   * ever holding megabytes of base64.
   */
  useEffect(() => {
    if (!user) {
      setEnrolled([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const token = await user.getIdToken();
        const res = await fetch('/api/avatars', { headers: { authorization: `Bearer ${token}` } });
        if (!res.ok) return;
        const json = await res.json();
        if (cancelled) return;
        const list: EnrolledAvatar[] = json.avatars ?? [];
        setEnrolled(list);

        // Preselect: whichever /avatars sent us to, else the newest.
        const wanted = searchParams.get('avatar');
        const pick = (wanted && list.find((a) => a.id === wanted)) || list[0];
        if (pick?.urls.front && !avatar) useEnrolled(pick);
      } catch {
        /* the upload path still works */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  function useEnrolled(a: EnrolledAvatar) {
    if (!a.urls.front) return;
    setAvatar(a.urls.front);
    setAvatarId(a.id);
    setAvatarName(a.name);
    setMultiViews({
      front: a.urls.front,
      left: a.urls.left ?? undefined,
      right: a.urls.right ?? undefined,
    });
  }

  /* Signing in belongs in the precondition, not in the 401 that comes back
     three clicks later. Without it the button was enabled while signed out and
     the run was created under whatever identity the server fell back to. */
  const canStart = !!avatar && goal.trim().length >= 8 && !busy && !!user;

  async function pickFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      setAvatar(dataUrl);
      setAvatarName(file.name);
      setAvatarId(null);
      // A single upload really is one view. Dropping the enrolled left/right
      // silently was the bug; saying so is the fix, and the enrolled avatar is
      // one click away above.
      setMultiViews({ front: dataUrl });
    };
    reader.readAsDataURL(file);
  }

  /*
   * Applying a template replaces the goal text, so it must not do that silently
   * to work the user already did — a dictated goal can represent a minute of
   * talking plus a paid /api/refine round-trip. When the box holds only a
   * previous template's prose, there is nothing of the user's to lose and the
   * swap is immediate.
   */
  function handleSelectTemplate(tpl: CreativeTemplate) {
    const current = goal.trim();
    const isUserWriting =
      current.length > 0 && !CREATIVE_TEMPLATES.some((t) => t.defaultPrompt.trim() === current);

    if (isUserWriting) {
      setPendingTemplate(tpl);
      return;
    }
    applyTemplate(tpl);
  }

  function applyTemplate(tpl: CreativeTemplate) {
    setSelectedTemplate(tpl);
    setGoal(tpl.defaultPrompt);
    setPendingTemplate(null);
  }

  /* Clearing a template used to leave its prose in the goal box, so the screen
     said "no template applied" while the goal still read like one. Clearing now
     removes what applying put there — and only that. */
  function clearTemplate() {
    if (selectedTemplate && goal.trim() === selectedTemplate.defaultPrompt.trim()) setGoal('');
    setSelectedTemplate(null);
  }

  async function start() {
    if (!avatar) return;
    setBusy(true);
    setError(null);
    try {
      if (!user) throw new Error('sign in to start a run');
      const token = await user.getIdToken();
      const res = await fetch('/api/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({
          goal: goal.trim(),
          aspect,
          seconds,
          avatarId,
          templateId: selectedTemplate?.id,
          avatarDataUrl: avatar,
          avatarMultiViews: multiViews || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'could not start the run');
      router.push(`/studio/${json.runId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not start the run');
      setBusy(false);
    }
  }

  const activeKeywords = selectedTemplate ? selectedTemplate.keywords : DEFAULT_KEYWORDS;

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-4xl px-6 py-14">
        <h1 className="text-[32px] font-bold tracking-[-0.025em]">What should this ad do?</h1>
        <p className="mt-2 text-base text-ink-3">
          Choose a scenario template below or describe a custom outcome. The AI agent plans the cinematic shots.
        </p>

        {ready && !user && (
          <div className="mt-6 rounded-card border border-line bg-panel px-5 py-4 text-[13.5px] text-ink-2">
            Sign in first — runs are stored against your account, and the frames are your face.
          </div>
        )}

        {/* 1. Who is in it — enrolled faces first, upload as the fallback.
             There was only an upload button, so the photo a user gave at /enroll
             was thrown away after one run and they were asked for it again every
             time, which is the opposite of the one-time enrolment promised. */}
        <p className="mt-9 text-[10.5px] font-bold tracking-[0.12em] text-ink-3">WHO IS IN IT</p>

        {enrolled.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-2.5">
            {enrolled.map((a) => {
              const active = avatarId === a.id;
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => useEnrolled(a)}
                  className={`flex items-center gap-2.5 rounded-card p-2 pr-3.5 text-left ${
                    active ? 'border-2 border-accent bg-panel' : 'border border-line bg-panel hover:border-line-strong'
                  }`}
                >
                  {a.urls.front ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={a.urls.front} alt="" className="h-10 w-10 rounded-lg object-cover" />
                  ) : (
                    <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-subtle text-ink-4">?</span>
                  )}
                  <span>
                    <span className="block text-[13px] font-semibold">{a.name}</span>
                    <span className="block text-[11px] text-ink-3">
                      {[a.urls.front, a.urls.left, a.urls.right].filter(Boolean).length} angles
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <div className="mt-2.5 flex flex-wrap items-center gap-3">
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && pickFile(e.target.files[0])} />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className={`flex items-center gap-3 rounded-card p-2.5 pr-4 text-left ${
              avatar && !avatarId ? 'border-2 border-accent bg-panel' : 'border-[1.5px] border-dashed border-line-strong'
            }`}
          >
            {avatar && !avatarId ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatar} alt="" className="h-11 w-11 rounded-lg object-cover" />
            ) : (
              <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-subtle text-ink-4">+</span>
            )}
            <span>
              <span className="block text-[13.5px] font-semibold">
                {enrolled.length ? 'Or upload a one-off photo' : 'Upload a photo of yourself'}
              </span>
              <span className="block text-[11.5px] text-ink-3">
                {avatar && !avatarId ? 'One view only — a face stays steadier across scenes with three' : 'Face clearly visible, good light'}
              </span>
            </span>
          </button>

          {user && enrolled.length === 0 && (
            <Link href="/enroll" className="text-[12.5px] font-semibold text-accent hover:underline">
              Enrol a face once instead →
            </Link>
          )}
        </div>

        {avatarId && avatarName && (
          <p className="mt-2 text-[12px] text-ink-3">
            Using <span className="font-semibold text-ink-2">{avatarName}</span> from your enrolled avatars.
          </p>
        )}

        {/* 2. Creative Thematic Scenario Templates */}
        <div className="mt-8">
          <div className="flex items-center justify-between">
            <p className="text-[10.5px] font-bold tracking-[0.12em] text-ink-3">SCENARIO TEMPLATES</p>
            {selectedTemplate && (
              <button
                type="button"
                onClick={clearTemplate}
                className="text-[11px] font-semibold text-accent hover:underline"
              >
                Clear template ({selectedTemplate.name})
              </button>
            )}
          </div>
          {pendingTemplate && (
            <div className="rs-enter mt-2.5 flex flex-wrap items-center gap-3 rounded-card border border-warn/40 bg-warn-soft/40 px-3.5 py-3">
              <p className="min-w-0 flex-1 text-[13px] leading-snug">
                Applying <span className="font-semibold">{pendingTemplate.name}</span> will replace the goal you wrote.
              </p>
              <button
                type="button"
                onClick={() => applyTemplate(pendingTemplate)}
                className="rounded-lg bg-primary px-3 py-1.5 text-[12.5px] font-semibold text-primary-ink"
              >
                Replace it
              </button>
              <button
                type="button"
                onClick={() => setPendingTemplate(null)}
                className="rounded-lg border border-line-strong px-3 py-1.5 text-[12.5px] font-semibold text-ink-2"
              >
                Keep mine
              </button>
            </div>
          )}

          <div className="mt-2.5">
            <TemplateGallery
              selectedTemplateId={selectedTemplate?.id || null}
              onSelectTemplate={handleSelectTemplate}
            />
          </div>
        </div>

        {/* 3. The Goal & Prompt Composer */}
        <div className="mt-8">
          <div className="flex items-center justify-between">
            <p className="text-[10.5px] font-bold tracking-[0.12em] text-ink-3">THE GOAL & SCRIPT PROMPT</p>
            {selectedTemplate && (
              <span className="text-[11px] font-semibold text-ink-3">
                Applied: <span className="text-accent font-bold">{selectedTemplate.name}</span>
              </span>
            )}
          </div>
          <div className="mt-2.5">
            <PromptComposer
              purpose="goal"
              value={goal}
              keywords={activeKeywords}
              placeholder="Say or type the outcome you want — or choose a scenario template above."
              onPrompt={(finalPrompt) => setGoal(finalPrompt)}
            />
          </div>
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
              {([4, 6, 8] as const).map((s) => (
                <button key={s} type="button" onClick={() => setSeconds(s)} className={`flex-1 rounded-card bg-panel py-5 text-sm font-semibold ${seconds === s ? 'border-2 border-accent' : 'border border-line text-ink-2'}`}>
                  {s}s
                </button>
              ))}
            </div>
            {/* This said "longer runs cost more credits and take longer to
                render", which was false in both halves: every choice produced
                the same 8s clip. The model's range is 4-8s; anything longer is
                several renders stitched together, which is not built yet. */}
            <p className="mt-2 text-xs text-ink-4">
              The clip model renders up to 8 seconds. Longer edits are stitched from several clips — not available yet.
            </p>
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
