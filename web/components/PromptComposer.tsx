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
 * Voice is the browser's own SpeechRecognition (Chrome and Edge ship it).
 *
 * IT IS NOT ON-DEVICE, and this comment used to say it was: "no server, no
 * upload — the audio never leaves the machine". That is false. Chrome streams
 * microphone audio to a Google speech service and receives transcripts back,
 * which is exactly why the spec has a 'network' error code — and why the
 * handler below tells the user it "could not reach the speech service". The
 * file contradicted itself two hundred lines apart, and on a product whose
 * premise is careful handling of somebody's likeness, a false claim about where
 * their voice goes is not a small inaccuracy.
 *
 * Nothing is sent to OUR servers, and no recording is stored anywhere. That is
 * the true and narrower claim.
 *
 * Where the API is missing the mic button is not rendered at all; typing and
 * keywords lose nothing.
 */

/**
 * The slice of SpeechRecognition this uses.
 *
 * `onerror` was typed as `() => void`, which is assignable-from a handler that
 * takes an argument, so the compiler was happy while the type said the error
 * event carries no information. It carries the only information that matters:
 * WHICH failure. That omission is why every outcome collapsed into one message,
 * including the benign 'aborted' that fires when a user stops dictating on
 * purpose. The union is spelled out so the next person handling a case can see
 * the ones they have not handled.
 */
type SpeechRecognitionErrorCode =
  | 'no-speech'
  | 'aborted'
  | 'audio-capture'
  | 'network'
  | 'not-allowed'
  | 'service-not-allowed'
  | 'bad-grammar'
  | 'language-not-supported';

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: SpeechRecognitionErrorCode }) => void) | null;
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
  seed,
  onPrompt,
}: {
  purpose: 'goal' | 'edit';
  keywords: string[];
  placeholder: string;
  /*
   * Text pushed IN from outside — applying or clearing a template. Deliberately
   * not the same value the parent receives from onPrompt.
   *
   * It used to be bound to the parent's `goal`, which onPrompt also sets. So
   * refining wrote the rewrite back in as if the user had typed it: their own
   * words were replaced by the model's, the AI card disappeared because its
   * source had "changed", and the two-card design destroyed itself on use.
   * Reproduced before this fix — "me using my coffee grinder in the morning"
   * became "A creator in cozy morning loungewear grinds fresh coffee bea…".
   */
  seed?: string;
  /** Called with the prompt that should actually be used: refined when it
   *  exists, the user's own words otherwise. */
  onPrompt: (finalPrompt: string, raw: string) => void;
}) {
  const { user } = useUser();
  const [raw, setRaw] = useState(seed || '');
  const [interim, setInterim] = useState('');
  const [refined, setRefined] = useState<string | null>(null);
  const [refining, setRefining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  /** Set while the user's own stop is in flight, so the abort it causes is not
   *  reported back to them as a failure. */
  const stoppingRef = useRef(false);

  /* Recognition holds the microphone. Leaving it running after the panel closes
     keeps the browser's recording indicator lit on a page that is no longer
     asking for anything — the same class of bug as the enrolment camera that
     was never released. */
  useEffect(() => {
    return () => {
      stoppingRef.current = true;
      try {
        /* abort(), not stop(). stop() asks for a final result and then delivers
           it — to handlers belonging to a component that no longer exists.
           abort() discards immediately, which is what unmounting means. */
        recRef.current?.abort();
      } catch {
        /* already gone */
      }
      recRef.current = null;
    };
  }, []);
  const rawRef = useRef(raw);
  rawRef.current = raw;

  // Applies only when the seed itself changes, so nothing the user or the
  // refiner does can feed back in here.
  const lastSeed = useRef(seed);
  useEffect(() => {
    if (seed === undefined || seed === lastSeed.current) return;
    lastSeed.current = seed;
    setRaw(seed);
    setRefined(null);
    onPrompt(seed, seed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);

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
      /* The user asked it to stop, so whatever comes back next is expected.
         Without this flag the abort that follows stop() is reported to them as
         "Dictation stopped unexpectedly" — an error message for doing exactly
         what they intended. */
      stoppingRef.current = true;
      recRef.current?.stop();
      return;
    }
    const rec = getRecognizer();
    /* Defensive only: the mic button is not rendered unless speechSupported, so
       this is unreachable in practice. It stays because the two checks could
       drift, and a silent no-op button is the worse failure. */
    if (!rec) {
      setError('This browser cannot dictate — Chrome and Edge can. Type instead.');
      return;
    }

    /* Detach the previous session before adopting a new one. Each toggle builds
       a fresh recognizer, and an old one still winding down would otherwise
       fire onend into the new session and switch the button off underneath it. */
    const previous = recRef.current;
    if (previous) {
      previous.onresult = null;
      previous.onend = null;
      previous.onerror = null;
      try {
        previous.abort();
      } catch {
        /* already gone */
      }
    }
    recRef.current = rec;
    setError(null);
    stoppingRef.current = false;
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
        const next = (rawRef.current + ' ' + finals).trim();
        setRaw(next);
        setRefined(null);
        onPrompt(next, next);
      }
      setInterim(interims);
    };
    rec.onend = () => {
      setListening(false);
      setInterim('');
      stoppingRef.current = false;
    };
    rec.onerror = (e) => {
      setListening(false);
      setInterim('');
      const why = e.error;
      const deliberate = stoppingRef.current;
      stoppingRef.current = false;

      /*
       * Only say something went wrong when something did.
       *
       * 'aborted' is not a failure. It fires when recognition is stopped —
       * by stop(), by the component unmounting, by navigating away — so the
       * catch-all below was showing "Dictation stopped unexpectedly" to people
       * who had just clicked the mic to turn it off. That is the report this
       * fixes, and it made the feature look broken every single time it was
       * used correctly.
       *
       * The rest are separated because they need different actions from the
       * user, and one sentence covering all of them tells them nothing they can
       * act on. 'network' in particular is not their fault at all: Chrome's
       * recognition runs against a Google service, so it fails when that is
       * unreachable.
       */
      if (why === 'aborted' || deliberate) return;

      setError(
        why === 'not-allowed' || why === 'service-not-allowed'
          ? 'Microphone access was blocked. Allow it in your browser, or type instead.'
          : why === 'no-speech'
            ? 'Nothing was heard. Press the mic and speak, or type instead.'
            : why === 'audio-capture'
              ? 'No microphone was found. Check your input device, or type instead.'
              : why === 'network'
                ? 'Dictation needs a network connection and could not reach the speech service. Type instead.'
                : 'Dictation stopped unexpectedly. You can type instead.',
      );
    };

    /*
     * start() throws InvalidStateError if recognition is already running, and
     * `listening` was being set before the call — so a throw left the button
     * lit, claiming to listen, with nothing running behind it.
     */
    try {
      rec.start();
      setListening(true);
    } catch {
      setListening(false);
      recRef.current = null;
      setError('Dictation could not start. Try once more, or type instead.');
    }
  }

  async function refine() {
    if (raw.trim().length < 2 || refining) return;
    setRefining(true);
    setError(null);
    try {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (user) headers.authorization = `Bearer ${await user.getIdToken()}`;
      const localKey = typeof window !== 'undefined' ? localStorage.getItem('rs-gemini-key') : null;
      if (localKey) headers['x-gemini-api-key'] = localKey;
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
                listening ? 'rs-cursor border-accent bg-accent-soft text-accent-ink' : 'border-line-strong text-ink-3 hover:text-ink'
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
          aria-label="Your prompt, in your own words"
          /* outline-none with nothing put back left keyboard users with no
             visible focus at all. The ring is drawn on the card instead, so the
             borderless look survives. */
          className="mt-2 w-full resize-none rounded bg-transparent text-[16px] leading-snug outline-none ring-offset-2 ring-offset-panel focus-visible:ring-2 focus-visible:ring-accent placeholder:text-ink-4"
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
        <div className="rs-enter rounded-card border border-accent/35 rs-tint-accent p-4">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-bold tracking-[0.12em] text-accent-ink">AI PROMPT — WHAT THE MODEL RECEIVES</p>
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
              aria-label="The prompt the model will receive"
              className="mt-2 w-full resize-none rounded bg-transparent text-[14px] leading-relaxed outline-none ring-offset-2 ring-offset-panel focus-visible:ring-2 focus-visible:ring-accent"
            />
          ) : (
            <p className="mt-2 flex items-center gap-2 text-[13px] text-ink-2">
              <span className="rs-cursor block h-[6px] w-[6px] rounded-full bg-accent" />
              rewriting your words into a model-ready prompt…
            </p>
          )}
        </div>
      )}

      {error && <p className="text-[12.5px] text-crit-ink">{error}</p>}
    </div>
  );
}
