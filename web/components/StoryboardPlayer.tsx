'use client';

/*
 * Watch the ad before paying to render it.
 *
 * Everything needed is already on the canvas: the shots, the order, the length
 * the user chose, and the line they are going to say. That IS the ad — the only
 * thing a render adds is motion inside each shot. So the question a render was
 * being bought to answer, "does this cut work", can be answered for nothing.
 *
 * The picture always plays. The voiceover joins it if it can — see the clock
 * comment below for why that order matters and what happened when it was the
 * other way round.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { shotPlan } from '@/lib/sequence';
import type { Run, ShotKind, TreeNode } from '@/lib/types';

const KIND_WORD: Record<ShotKind, string> = {
  person: 'you',
  product: 'product',
  detail: 'close-up',
  scene: 'the place',
};

export function StoryboardPlayer({
  run,
  shots,
  seconds,
  onClose,
}: {
  run: Run;
  shots: TreeNode[];
  /** The length chosen for the render, so pacing matches what will be made. */
  seconds: number;
  onClose: () => void;
}) {
  const plan = shotPlan(seconds, shots.length);
  const perShot = plan.perShot;
  const total = perShot * shots.length;

  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(true);
  const audioRef = useRef<HTMLAudioElement>(null);
  const rafRef = useRef<number | null>(null);
  const startedAt = useRef<number>(0);
  const offset = useRef<number>(0);

  const index = Math.min(shots.length - 1, Math.floor(t / perShot));
  const current = shots[index];

  /* Every frame decoded before playback starts. Without this the first pass
     through the storyboard stutters on each new shot, which reads as the ad
     being bad rather than the loader being slow. */
  useEffect(() => {
    for (const s of shots) {
      if (!s.frameUrl) continue;
      const im = new Image();
      im.src = s.frameUrl;
    }
  }, [shots]);

  const stop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!playing) {
      stop();
      audio?.pause();
      return;
    }

    /*
     * The timer is the clock; the voiceover follows it.
     *
     * This had it the other way round — audio.currentTime drove the frames —
     * and a preview whose audio failed to load simply never started. Observed
     * exactly that: readyState 0, networkState IDLE, paused true, and the
     * playhead frozen at 0.0s while the picture sat there looking broken. The
     * point of this screen is to watch the cut, and the cut must play whether
     * or not a voiceover exists, is still downloading, or is blocked by an
     * autoplay policy.
     *
     * Sync is kept by CORRECTING the timer from the audio once the audio is
     * genuinely running, rather than by depending on it to run at all.
     */
    startedAt.current = performance.now();
    offset.current = t;

    if (audio) {
      const seek = () => {
        // Only once metadata exists. Setting currentTime at readyState 0 is at
        // best ignored and at worst aborts the load.
        if (audio.readyState >= 1) audio.currentTime = Math.min(t, audio.duration || t);
      };
      if (audio.readyState >= 1) seek();
      else audio.addEventListener('loadedmetadata', seek, { once: true });
      // Best effort. A rejection here is not a reason to stop the picture.
      void audio.play().catch(() => {});
    }

    const tick = () => {
      let elapsed = offset.current + (performance.now() - startedAt.current) / 1000;

      // Audio wins when it is actually playing, so the two cannot drift.
      if (audio && !audio.paused && audio.readyState >= 2 && audio.currentTime > 0) {
        elapsed = audio.currentTime;
        offset.current = elapsed;
        startedAt.current = performance.now();
      }

      if (elapsed >= total) {
        setT(total);
        setPlaying(false);
        audio?.pause();
        return;
      }
      setT(elapsed);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, total, stop]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === ' ') {
        e.preventDefault();
        setPlaying((p) => !p);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const jump = (i: number) => {
    const to = i * perShot;
    setT(to);
    if (audioRef.current) audioRef.current.currentTime = to;
    offset.current = to;
    startedAt.current = performance.now();
  };

  const restart = () => {
    jump(0);
    setPlaying(true);
  };

  return (
    /* Anchored to the VIEWPORT below lg, to the canvas above it.
       This was `absolute inset-0` against the canvas <section>, which is right
       on a wide screen where that section fills the window — and wrong once the
       three panes stack, because the section then sits partway down a 2800px
       document and the "modal" opens as a box below the fold rather than over
       the window. Measured at 900px wide: the play button and caption landed at
       document y 1617 with the window showing 0-820. */
    <div className="fixed inset-0 z-40 flex flex-col bg-black/70 lg:absolute" onClick={onClose}>
      <div
        className="flex min-h-0 flex-1 flex-col p-5"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Preview the ad"
      >
        <div className="flex shrink-0 items-baseline justify-between gap-3 pb-3">
          <div className="min-w-0">
            <p className="text-[10.5px] font-bold tracking-[0.12em] text-white/60">PREVIEW · NOTHING IS GENERATED</p>
            <p className="mt-0.5 truncate text-[13.5px] font-semibold text-white">
              {shots.length} shots · {perShot}s each · {total}s
              {!plan.honoursRequest && <span className="text-white/60"> (you asked for {seconds}s)</span>}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg border border-white/25 px-3 py-1.5 text-[12.5px] font-semibold text-white"
          >
            Close
          </button>
        </div>

        <div className="flex min-h-0 flex-1 items-center justify-center">
          {current?.frameUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={current.frameUrl}
              alt={current.label ?? `Shot ${index + 1}`}
              className="max-h-full max-w-full rounded-card object-contain shadow-[0_20px_60px_-20px_rgba(0,0,0,0.8)]"
            />
          ) : (
            <p className="text-[13px] text-white/70">This shot has no frame yet.</p>
          )}
        </div>

        <div className="shrink-0 pt-3">
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => (t >= total ? restart() : setPlaying((p) => !p))}
              aria-label={t >= total ? 'Play again' : playing ? 'Pause' : 'Play'}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-black"
            >
              {t >= total ? (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden><path d="M1 4v6h6" /><path d="M3.5 15a9 9 0 1 0 2.1-9.4L1 10" /></svg>
              ) : playing ? (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="ml-0.5" aria-hidden><path d="M8 5v14l11-7z" /></svg>
              )}
            </button>

            {/* One segment per shot, so the bar doubles as the shot list —
                where you are, how long each holds, and what each one is. */}
            <div className="flex min-w-0 flex-1 gap-1">
              {shots.map((s, i) => {
                const fill = Math.max(0, Math.min(1, (t - i * perShot) / perShot));
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => jump(i)}
                    title={`${s.label ?? `Shot ${i + 1}`} — ${KIND_WORD[(s.shot ?? 'person') as ShotKind]}`}
                    className="group min-w-0 flex-1 py-2"
                  >
                    <span className="block h-1 w-full overflow-hidden rounded-full bg-white/25">
                      <span className="block h-full rounded-full bg-white" style={{ width: `${fill * 100}%` }} />
                    </span>
                    <span className={`mt-1.5 block truncate text-left text-[10.5px] ${i === index ? 'text-white' : 'text-white/45'}`}>
                      {s.label ?? `Shot ${i + 1}`}
                    </span>
                  </button>
                );
              })}
            </div>

            <span className="tnum shrink-0 text-[12px] text-white/60">
              {t.toFixed(1)}s / {total}s
            </span>
          </div>

          <p className="mt-1.5 text-[11.5px] text-white/55">
            {run.audioUrl
              ? 'Playing with the voiceover, so the pacing is the real pacing.'
              : 'No voiceover on this run yet — the timing is the shot plan only.'}
            {' '}Space to play or pause, Esc to close.
          </p>
        </div>

        {run.audioUrl && <audio ref={audioRef} src={run.audioUrl} preload="auto" className="hidden" />}
      </div>
    </div>
  );
}
