import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { EnrollmentCamera } from '@/components/enroll/EnrollmentCamera';

export const metadata = {
  title: 'Enrol your face — Restage',
};

/*
 * The page around the capture flow.
 *
 * Two things belong here and nothing else: what is about to happen, and what
 * happens to the result. Somebody is deciding whether to point a camera at
 * their own face, and the answer to "why should I" has to arrive before the
 * button does.
 *
 * The reassurance used to sit BELOW the camera, where it is read after the
 * decision it exists to inform — and it claimed a "Privacy & Identity Vault"
 * and a purge, one of which was a name for nothing and the other of which was
 * not happening. It says what the code does now, and it says it first.
 */

const STEPS = [
  { n: 1, label: 'Straight on', detail: 'Look at the lens and hold still' },
  { n: 2, label: 'Turn left', detail: 'Capture fires when you get there' },
  { n: 3, label: 'Turn right', detail: 'Back to centre first, then across' },
  { n: 4, label: 'Say a line', detail: 'Optional — ten seconds' },
];

export default function Enroll() {
  return (
    <AppShell>
      <div className="mx-auto w-full max-w-5xl px-6 py-10">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-[11px] font-bold tracking-[0.14em] text-ink-3">ENROL ONCE</p>
          <h1 className="mt-2.5 text-[clamp(1.9rem,4vw,2.5rem)] font-bold leading-[1.1] tracking-[-0.03em]">
            Three angles is what makes the face hold.
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-[15px] leading-relaxed text-ink-2">
            One photo gives the model a single view to guess from, and the face drifts the moment the agent turns or
            relights it. Left, straight on and right give it the geometry — so the person in the last frame is still
            the person in the first.
          </p>
        </div>

        {/*
          The four things that actually decide how good every run will look.

          These are the same rules the generator is given in look.ts — 85mm-ish
          distance, camera a little above eye level, soft light from the front —
          and they were told to the model and never to the person holding the
          camera. That asymmetry showed: a real enrolment came in shot from
          below with a ceiling light overhead and the subject mid-word, and the
          prompt then asked for the exact opposite of the reference it was
          locked to. No wording can win that argument. The reference is the
          ceiling on everything generated from it, so the advice belongs here,
          before the camera turns on.
        */}
        <div className="mx-auto mt-8 max-w-3xl rounded-card border border-line bg-panel px-5 py-4">
          <p className="text-[13px] font-semibold">Four things that decide how good this looks</p>
          <ul className="mt-2.5 grid gap-2 sm:grid-cols-2">
            {[
              ['Put the camera a little above your eyes', 'Shooting up from below is the least flattering angle there is.'],
              ['Face a window, and turn off the light above you', 'Overhead light drops shadows under your eyes and brows.'],
              ['Sit back to about arm’s length', 'Close to a wide lens enlarges your nose and narrows your cheeks.'],
              ['Plain wall behind you, mouth closed', 'Less for the model to remove, and a composed expression to copy.'],
            ].map(([t, why]) => (
              <li key={t} className="flex gap-2.5">
                <span className="mt-[7px] block h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                <span>
                  <span className="block text-[13px] font-medium leading-snug">{t}</span>
                  <span className="block text-[12px] leading-snug text-ink-3">{why}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* What the next minute looks like, before it starts. */}
        <ol className="mx-auto mt-6 grid max-w-3xl gap-2.5 sm:grid-cols-4">
          {STEPS.map((s) => (
            <li key={s.n} className="rounded-card border border-line bg-panel px-3.5 py-3">
              <span className="tnum flex h-6 w-6 items-center justify-center rounded-full bg-subtle text-[11.5px] font-bold text-ink-2">
                {s.n}
              </span>
              <p className="mt-2 text-[13.5px] font-semibold leading-snug">{s.label}</p>
              <p className="mt-0.5 text-[12px] leading-snug text-ink-3">{s.detail}</p>
            </li>
          ))}
        </ol>

        <div className="mt-8">
          <EnrollmentCamera />
        </div>

        <div className="mx-auto mt-10 max-w-3xl rounded-card border border-line bg-panel px-6 py-5">
          <p className="text-[13px] font-semibold">What happens to these captures</p>
          <ul className="mt-2.5 flex flex-col gap-2">
            {[
              'They are stored in your account only. The bucket denies reads by default and the rules allow a file only to the account that owns its folder.',
              'Deleting a face deletes the copies too — every run made from it, its frames and its rendered clips.',
              'The voice sample is optional, and stored for voice matching later. Nothing reads it yet; clips use a synthetic voice reading a line shown to you before rendering.',
            ].map((t) => (
              <li key={t} className="flex gap-2.5 text-[13px] leading-relaxed text-ink-2">
                <span className="mt-[7px] block h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                {t}
              </li>
            ))}
          </ul>
          <Link href="/likeness" className="mt-3 inline-block text-[12.5px] font-semibold text-accent-ink hover:underline">
            The longer answer →
          </Link>
        </div>
      </div>
    </AppShell>
  );
}
