'use client';

import { useEffect, useRef, useState } from 'react';
import { useUser } from './AuthGate';

/*
 * The two-card prompt system. The user speaks (or types, or taps keywords) and
 * their own words stay visible as the first card; the model's rewrite — the
 * detailed English prompt that will actually be sent — is the second. Showing
 * both is the point: the user keeps ownership of what they meant, and can see
 * exactly what the machine understood before anything is spent on it.
 *
 * Voice is the browser's own SpeechRecognition (Chrome ships it; no server, no
 * upload — the audio never leaves the machine). Where the API is missing the
 * mic button simply is not rendered; typing and keywords lose nothing.
 */

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};

function getRecognizer(): SpeechRecognitionLike | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

export function PromptComposer({
  purpose,
  keywords,
  placeholder,
  onPrompt,
}: {
  purpose: 'goal' | 'edit';
  keywords: string[];
  placeholder: string;
  /** Called with the prompt that should actually be used: refined when it
   *  exists, the user's own words otherwise. */
  onPrompt: (finalPrompt: string, raw: string) => void;
}) {
  const { user } = useUser();
  const [raw, setRaw] = useState('');
  const [interim, setInterim] = useState('');
  const [refined, setRefined] = useState<string | null>(null);
  const [refining, setRefining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    setSpeechSupported(!!getRecognizer());
  }, []);

  // Any change to the source words invalidates the rewrite — a stale refined
  // card that no longer matches what the user said is worse than none.
  const setRawInvalidating = (next: string) => {
    setRaw(next);
    setRefined(null);
    onPrompt(next, next);
  };

  function toggleMic() {
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const rec = getRecognizer();
    if (!rec) return;
    recRef.current = rec;
    rec.lang = navigator.language || 'en-US';
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let finals = '';
      let interims = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finals += r[0].transcript;
        else interims += r[0].transcript;
      }
      if (finals) {
        setRaw((prev) => {
          const next = (prev + ' ' + finals).trim();
          setRefined(null);
          onPrompt(next, next);
          return next;
        });
      }
      setInterim(interims);
    };
    rec.onend = () => {
      setListening(false);
      setInterim('');
    };
    rec.onerror = () => {
      setListening(false);
      setInterim('');
    };
    setListening(true);
    rec.start();
  }

  async function refine() {
    if (raw.trim().length < 2 || refining) return;
    setRefining(true);
    setError(null);
    try {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (user) headers.authorization = `Bearer ${await user.getIdToken()}`;
      const res = await fetch('/api/refine', {
        method: 'POST',
        headers,
        body: JSON.stringify({ raw: raw.trim(), purpose }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'refine failed');
      setRefined(json.refined);
      onPrompt(json.refined, raw.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'refine failed');
    } finally {
      setRefining(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {/* card 1 — the user's own words */}
      <div className={`rounded-card border bg-panel p-4 ${listening ? 'border-accent' : 'border-line'}`}>
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-bold tracking-[0.12em] text-ink-3">YOUR PROMPT</p>
          {speechSupported && (
            <button
              type="button"
              onClick={toggleMic}
              aria-pressed={listening}
              aria-label={listening ? 'Stop dictating' : 'Dictate'}
              className={`flex h-7 w-7 items-center justify-center rounded-full border transition-colors ${
                listening ? 'rs-cursor border-accent bg-accent-soft text-accent' : 'border-line-strong text-ink-3 hover:text-ink'
              }`}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <rect x="9" y="2" width="6" height="12" rx="3" />
                <path d="M5 10a7 7 0 0 0 14 0M12 17v4" />
              </svg>
            </button>
          )}
        </div>
        <textarea
          rows={2}
          value={raw}
          onChange={(e) => setRawInvalidating(e.target.value)}
          placeholder={listening ? 'Listening…' : placeholder}
          className="mt-2 w-full resize-none bg-transparent text-[16px] leading-snug outline-none placeholder:text-ink-4"
        />
        {interim && <p className="text-[13px] italic text-ink-3">{interim}…</p>}

        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-line pt-2.5">
          {keywords.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setRawInvalidating(raw ? `${raw.trim()}, ${k}` : k)}
              className="rounded-chip border border-line-strong bg-elevated px-2.5 py-1 text-[12px] text-ink-2 hover:border-accent"
            >
              {k}
            </button>
          ))}
          <button
            type="button"
            disabled={raw.trim().length < 2 || refining}
            onClick={refine}
            className="ml-auto flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[12px] font-semibold text-primary-ink disabled:opacity-40"
          >
            {refining ? 'Refining…' : 'Refine for the model →'}
          </button>
        </div>
      </div>

      {/* card 2 — what the model will actually receive */}
      {(refined || refining) && (
        <div className="rs-enter rounded-card border border-accent/35 bg-accent-soft/40 p-4">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-bold tracking-[0.12em] text-accent">AI PROMPT — WHAT THE MODEL RECEIVES</p>
            {refined && (
              <button type="button" onClick={refine} className="text-[11.5px] font-medium text-ink-3 hover:text-ink" disabled={refining}>
                rewrite again
              </button>
            )}
          </div>
          {refined ? (
            <textarea
              rows={3}
              value={refined}
              onChange={(e) => {
                setRefined(e.target.value);
                onPrompt(e.target.value, raw);
              }}
              className="mt-2 w-full resize-none bg-transparent text-[14px] leading-relaxed outline-none"
            />
          ) : (
            <p className="mt-2 flex items-center gap-2 text-[13px] text-ink-2">
              <span className="rs-cursor block h-[6px] w-[6px] rounded-full bg-accent" />
              rewriting your words into a model-ready prompt…
            </p>
          )}
        </div>
      )}

      {error && <p className="text-[12.5px] text-crit">{error}</p>}
    </div>
  );
}
