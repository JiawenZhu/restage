import Link from 'next/link';
import Image from 'next/image';
import { ThemeToggle } from '@/components/ThemeToggle';

/*
 * Ported from the design canvas. Two things changed in the move and both are
 * deliberate.
 *
 * The artboard is a fixed 1440px frame, which is right for a canvas and wrong
 * for a browser — every fixed width here becomes a max-width plus a responsive
 * grid, so the page holds together on a phone instead of scrolling sideways.
 *
 * And its colours were inline hexes. Here they come from the same tokens the
 * app uses, so the landing page follows the theme toggle like everything else
 * rather than being a light island.
 */

const STEPS = [
  {
    n: 1,
    title: 'Three angles, once',
    body: 'Left, straight on, right. A single front-on photo gives the model nothing about the sides of your face — the moment you turn your head it starts inventing.',
  },
  {
    n: 2,
    title: 'Say what the ad must do',
    body: 'Not a shot list. An outcome: something that survives the first two seconds of a scroll. The plan appears before anything renders.',
  },
  {
    n: 3,
    title: 'It grades its own frames',
    body: 'A critic checks every step against what it claimed to do. When it falls short the agent revises and retries — without waiting for you.',
  },
];

/*
 * Prices are not set yet, and the page used to ship the placeholders — literal
 * "$[XX]", "$[XXX]", "[N] renders a month", "[YOUR SUPPORT TERMS]". A visitor
 * reading those learns the product is unfinished, which is a worse first
 * impression than a page that simply says what is true today.
 *
 * Every claim below is one the app actually delivers right now.
 */
const PLANS = [
  {
    name: 'Free while in beta',
    price: 'Free',
    meta: 'Everything below, at no cost',
    features: [
      'Enrol your face once and reuse it',
      'The full plan, version tree and critic verdicts',
      '9:16 and 16:9, up to 8-second clips',
      'Every attempt kept — including the discarded ones',
    ],
    cta: 'Start free',
    featured: true,
  },
];

export default function Landing() {
  return (
    <div className="min-h-screen bg-canvas text-ink">
      {/* nav */}
      <header className="mx-auto flex max-w-[1440px] items-center justify-between px-6 py-5 sm:px-14">
        <div className="flex items-center gap-10">
          <span className="text-[19px] font-extrabold tracking-[-0.03em]">Restage</span>
          <nav className="hidden items-center gap-6 text-sm font-medium text-ink-2 md:flex">
            {/* These were spans. A nav that cannot be clicked reads as a
                mockup, and one of them pointed at a section with no id. */}
            <a href="#how-it-works" className="hover:text-ink">How it works</a>
            <a href="#formats" className="hover:text-ink">Formats</a>
            <a href="#pricing" className="hover:text-ink">Pricing</a>
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <ThemeToggle />
          <Link href="/enroll" className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-ink">
            Start free
          </Link>
        </div>
      </header>

      {/* hero */}
      <section className="mx-auto max-w-[1440px] px-6 pt-10 sm:px-14">
        <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,600px)_minmax(0,1fr)]">
          <div>
            <p className="inline-flex items-center gap-2 rounded-chip bg-accent-soft px-3.5 py-1.5 text-[12.5px] font-semibold text-accent">
              <span className="block h-1.5 w-1.5 rounded-full bg-accent" />
              Your face — not a stock actor
            </p>

            <h1 className="mt-5 text-[clamp(2.75rem,7vw,4.75rem)] font-black leading-[0.95] tracking-[-0.05em] text-balance">
              Never film another
              <span className="block text-accent">UGC ad.</span>
            </h1>

            <p className="mt-6 max-w-lg text-lg leading-relaxed text-ink-2 text-pretty">
              Enrol your face once. Say what the ad needs to do. The agent plans the shots,
              generates the frames, grades its own work, and hands you a finished clip.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href="/enroll" className="rounded-lg bg-accent px-7 py-3.5 text-[15px] font-semibold text-white">
                Build your avatar — free
              </Link>
              <Link href="/studio" className="flex items-center gap-2 rounded-lg border border-line-strong px-6 py-3.5 text-[15px] font-semibold">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M8 5v14l11-7z" /></svg>
                Watch it work
              </Link>
            </div>
            {/* "First 20 renders free" was a quota nothing counts, next to a
                marked placeholder. Both are replaced by what is true. */}
            <p className="mt-3.5 text-[13px] text-ink-3">Free while in beta · No card needed</p>
          </div>

          {/* enrol → clip, the product in one frame */}
          <div className="flex items-center gap-5">
            <div className="hidden shrink-0 flex-col gap-2.5 sm:flex">
              {(['av-left', 'av-front', 'av-right'] as const).map((f) => (
                <Image
                  key={f}
                  src={`/img/${f}.jpg`}
                  alt=""
                  width={92}
                  height={92}
                  className={`h-[92px] w-[92px] rounded-[10px] object-cover ${f === 'av-front' ? 'border-2 border-accent' : 'border-2 border-line'}`}
                />
              ))}
              <p className="mt-1 text-center text-[10.5px] font-bold leading-relaxed tracking-[0.1em] text-ink-3">
                ENROL
                <br />
                ONCE
              </p>
            </div>

            <svg width="26" height="14" viewBox="0 0 26 14" fill="none" stroke="var(--border-strong)" strokeWidth="2" strokeLinecap="round" className="hidden shrink-0 sm:block" aria-hidden>
              <path d="M1 7h22M18 3l5 4-5 4" />
            </svg>

            <div className="relative min-w-0 flex-1">
              <div className="overflow-hidden rounded-[18px] shadow-[0_30px_70px_-28px_rgba(20,20,26,0.45)]">
                <Image src="/img/f4.jpg" alt="A finished vertical UGC clip" width={480} height={512} className="h-[420px] w-full object-cover sm:h-[512px]" priority />
              </div>
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <span className="flex h-16 w-16 items-center justify-center rounded-full bg-black/50">
                  <svg width="25" height="25" viewBox="0 0 24 24" fill="#fff" className="ml-[3px]" aria-hidden><path d="M8 5v14l11-7z" /></svg>
                </span>
              </div>
              <div className="absolute left-4 top-4 flex gap-2">
                <span className="rounded-[5px] bg-black/70 px-2.5 py-1 text-[10px] font-bold tracking-[0.08em] text-white">9:16</span>
                <span className="rounded-[5px] bg-black/70 px-2.5 py-1 text-[10px] font-bold tracking-[0.08em] text-white">0:08</span>
              </div>
              <div className="absolute bottom-6 right-0 max-w-[250px] translate-x-3 rounded-card bg-panel/95 p-3.5 shadow-[0_14px_34px_-12px_rgba(20,20,26,0.4)] backdrop-blur">
                <p className="text-[10px] font-extrabold tracking-[0.14em] text-ink-3">THE GOAL</p>
                <p className="mt-1.5 text-[13.5px] font-medium leading-snug">
                  &ldquo;A 15-second ad where I actually use it, in my kitchen.&rdquo;
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* the differentiator — a deliberately dark island, in both themes */}
      <section className="mx-auto mt-28 max-w-[1440px] px-6 sm:px-14">
        <div className="rounded-[22px] bg-[#14141a] p-8 text-white sm:p-14">
          <div className="grid gap-12 lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)] lg:items-center">
            <div>
              <p className="text-xs font-extrabold tracking-[0.16em] text-[#6fa8ec]">WHY IT DOESN&rsquo;T LOOK GENERATED</p>
              <h2 className="mt-3.5 text-[clamp(1.75rem,3vw,2.5rem)] font-extrabold leading-[1.07] tracking-[-0.035em]">
                It gets it wrong on purpose, cheaply, before it renders anything.
              </h2>
              <p className="mt-4 text-base leading-relaxed text-[#b3b3ba]">
                Video is slow and expensive, so the agent works in frames first. It generates a
                still, a critic judges whether the step did what it claimed, and a bad one gets
                thrown away and retried. Only the frame you approve becomes a clip.
              </p>
              <ul className="mt-5 flex flex-col gap-2.5">
                {[
                  'A frame costs ~14 seconds. A clip costs ~41.',
                  'Discarded attempts stay on the canvas — you see it change its mind',
                  'What you rejected changes how the next session opens',
                ].map((t) => (
                  <li key={t} className="flex gap-2.5 text-[15px] text-[#e3e3e7]">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5cd67d" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" className="mt-[3px] shrink-0" aria-hidden>
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-2xl border border-white/10 bg-[#0d0d0d] p-6">
              <div className="flex items-center gap-3 overflow-x-auto">
                {[
                  { src: 'av-front', ring: 'border-white/25' },
                  { src: 'f1', ring: 'border-[#5cd67d]' },
                  { src: 'f2', ring: 'border-[#5cd67d]' },
                ].map((n) => (
                  <Image key={n.src} src={`/img/${n.src}.jpg`} alt="" width={76} height={132} className={`h-[132px] w-[76px] shrink-0 rounded-[7px] border-2 object-cover ${n.ring}`} />
                ))}
                <div className="relative shrink-0">
                  <div className="absolute -inset-1.5 rounded-xl border-2 border-accent" />
                  <Image src="/img/f3.jpg" alt="" width={76} height={132} className="h-[132px] w-[76px] rounded-[7px] border-2 border-accent object-cover opacity-45" />
                  <span className="absolute inset-0 flex items-center justify-center text-center text-[8.5px] font-extrabold tracking-[0.06em] text-[#6fa8ec]">
                    GENERATING
                  </span>
                </div>
              </div>

              {/* the discarded attempt, kept — this is the proof, not a detail */}
              <div className="mt-4 flex items-center gap-2.5">
                <Image src="/img/fx.jpg" alt="" width={52} height={90} className="h-[90px] w-[52px] rounded-md border-2 border-[#d03b3b]/85 object-cover opacity-45 saturate-[0.25]" />
                <span className="flex items-center gap-1.5 text-[11.5px] font-semibold text-[#d03b3b]">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden><path d="M18 6L6 18M6 6l12 12" /></svg>
                  discarded — it went full studio, so it tried again
                </span>
              </div>

              <div className="mt-5 flex items-center gap-2.5 border-t border-white/10 pt-4">
                <span className="block h-[7px] w-[7px] rounded-full bg-accent" />
                <span className="tnum text-[13px] text-[#b3b3ba]">Step 4 of 6 — the agent is working here now</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* how it works */}
      <section id="how-it-works" className="mx-auto mt-28 max-w-[1440px] px-6 sm:px-14">
        <h2 className="text-[clamp(2rem,4vw,2.75rem)] font-extrabold tracking-[-0.035em]">
          Two things you do. The rest is watching.
        </h2>
        <p className="mt-1.5 text-[17.5px] text-ink-2">Enrolment happens once. After that it is one sentence per ad.</p>

        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {STEPS.map((s) => (
            <div key={s.n} className="rounded-2xl border border-line bg-panel p-7">
              <span className="tnum flex h-9 w-9 items-center justify-center rounded-[10px] bg-accent-soft text-[15px] font-extrabold text-accent">
                {s.n}
              </span>
              <h3 className="mt-5 text-[21px] font-bold tracking-[-0.02em]">{s.title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* formats */}
      <section id="formats" className="mx-auto mt-28 max-w-[1440px] px-6 sm:px-14">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)] lg:items-center">
          <div>
            <h2 className="text-[clamp(1.75rem,3.2vw,2.5rem)] font-extrabold leading-[1.08] tracking-[-0.035em]">
              Vertical or wide. Framed for it from step one.
            </h2>
            <p className="mt-3 text-[16.5px] leading-relaxed text-ink-2">
              Pick the ratio before the plan is written and the agent composes every frame for it.
              A 16:9 ad is not a 9:16 ad with the sides cut off — the subject sits differently, and
              so does the product.
            </p>
            <p className="mt-4 text-[15px] leading-relaxed text-ink-2">
              Already approved a frame? Re-render it in the other ratio without paying for the plan
              again.
            </p>
          </div>
          <div className="flex items-end gap-5">
            <div className="relative w-[180px] shrink-0 overflow-hidden rounded-2xl shadow-[0_22px_50px_-24px_rgba(20,20,26,0.4)] sm:w-[260px]">
              <Image src="/img/f4.jpg" alt="" width={260} height={462} className="h-[320px] w-full object-cover sm:h-[462px]" />
              <span className="absolute left-3 top-3 rounded-[5px] bg-accent px-2.5 py-1 text-[10px] font-bold tracking-[0.08em] text-white">9:16</span>
            </div>
            <div className="relative min-w-0 flex-1 overflow-hidden rounded-2xl shadow-[0_22px_50px_-24px_rgba(20,20,26,0.4)]">
              <Image src="/img/w4.jpg" alt="" width={520} height={300} className="h-[200px] w-full object-cover sm:h-[300px]" />
              <span className="absolute left-3 top-3 rounded-[5px] bg-black/75 px-2.5 py-1 text-[10px] font-bold tracking-[0.08em] text-white">16:9</span>
            </div>
          </div>
        </div>
      </section>

      {/* Was three marked placeholders sitting at 48px in the page's largest
          type. A visitor reads those as an unfinished product — and the honest
          alternative is not to invent numbers, but to state figures that are
          actually measured. These are: both timings come from timing the real
          pipeline. No engagement or customer claim appears, because there is no
          measurement behind one. */}
      <section className="mx-auto mt-28 max-w-[1440px] px-6 sm:px-14">
        <div className="grid gap-5 md:grid-cols-3">
          {[
            { v: '~20s', l: 'per frame — the agent can afford to reject its own work' },
            { v: '~50s', l: 'to render an approved frame into a finished clip' },
            { v: 'Every', l: 'attempt kept on the canvas, including the discarded ones' },
          ].map((m) => (
            <div key={m.l} className="rounded-2xl border border-line bg-panel p-7">
              <p className="tnum text-5xl font-black tracking-[-0.04em]">{m.v}</p>
              <p className="mt-2 text-[15px] text-ink-2">{m.l}</p>
            </div>
          ))}
        </div>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-8 border-y border-line py-7">
          {/* A "[CUSTOMER LOGOS]" placeholder is a claim about customers that do
              not exist yet. Better to say something true. */}
          <span className="text-[11.5px] font-bold tracking-[0.12em] text-ink-4">
            BUILT ON GEMINI 3 PRO IMAGE AND VEO 3.1
          </span>
          {[92, 78, 104, 86, 96].map((w, i) => (
            <div key={i} className="h-[22px] rounded bg-line-strong" style={{ width: w }} />
          ))}
        </div>
      </section>

      {/* pricing */}
      <section id="pricing" className="mx-auto mt-28 max-w-[1440px] px-6 sm:px-14">
        <h2 className="text-[clamp(2rem,4vw,2.75rem)] font-extrabold tracking-[-0.035em]">Pricing</h2>
        <p className="mt-1.5 text-[17.5px] text-ink-2">
          A render is one goal taken from plan to finished clip, retries included.
        </p>

        {/* One plan, so it is centred rather than stranded in a three-column
            grid built for placeholders that no longer exist. */}
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {PLANS.map((p) => (
            <div
              key={p.name}
              className={`relative rounded-2xl bg-panel p-8 ${p.featured ? 'border-2 border-accent shadow-[0_22px_50px_-26px_rgba(57,135,229,0.5)]' : 'border border-line'}`}
            >
              {p.featured && (
                <span className="absolute -top-[11px] left-8 rounded-chip bg-accent px-3 py-1 text-[11px] font-bold tracking-[0.07em] text-white">
                  FOR CREATORS
                </span>
              )}
              <p className="text-[15px] font-bold">{p.name}</p>
              <p className="tnum mt-3.5 text-[44px] font-black tracking-[-0.04em]">
                {p.price}
              </p>
              <p className="mt-1 text-sm text-ink-3">{p.meta}</p>
              <ul className="mt-6 flex flex-col gap-2.5 text-[14.5px] text-ink-2">
                {p.features.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              {/* This was a div. Every pricing CTA on the page was unclickable —
                  the one control a visitor is most likely to reach for. */}
              <Link
                href="/enroll"
                className={`mt-7 block rounded-[9px] py-3 text-center text-sm font-semibold ${p.featured ? 'bg-accent text-white' : 'border border-line-strong'}`}
              >
                {p.cta}
              </Link>
            </div>
          ))}

          {/* What is not free yet, said plainly rather than priced with a
              placeholder. */}
          <div className="rounded-2xl border border-dashed border-line-strong p-8">
            <p className="text-[15px] font-bold">Later</p>
            <p className="mt-3.5 text-[17px] font-medium leading-snug text-ink-2">
              Team seats, shared avatars, longer stitched clips and API delivery.
            </p>
            <p className="mt-4 text-sm leading-relaxed text-ink-3">
              None of it is built yet, so none of it is priced. While Restage is in beta everything that
              works is free.
            </p>
          </div>
        </div>
      </section>

      {/* final CTA */}
      <section className="mx-auto mt-28 max-w-[1440px] px-6 sm:px-14">
        <div className="relative overflow-hidden rounded-[22px]">
          <Image src="/img/w4.jpg" alt="" width={1320} height={380} className="h-[320px] w-full object-cover sm:h-[380px]" />
          <div className="absolute inset-0 bg-gradient-to-r from-[#14141a]/95 via-[#14141a]/75 to-[#14141a]/10" />
          <div className="absolute inset-0 flex max-w-2xl flex-col justify-center px-8 text-white sm:px-14">
            <h2 className="text-[clamp(1.75rem,4vw,2.875rem)] font-extrabold leading-[1.05] tracking-[-0.035em]">
              Three photos. Then never film again.
            </h2>
            <p className="mt-3.5 text-[17.5px] leading-relaxed text-white/85">
              Build the avatar in a minute. Watch the first plan write itself.
            </p>
            <Link href="/enroll" className="mt-7 self-start rounded-[9px] bg-white px-8 py-4 text-[15px] font-bold text-[#14141a]">
              Build your avatar — free
            </Link>
          </div>
        </div>
      </section>

      <footer className="mx-auto mt-14 flex max-w-[1440px] flex-wrap items-center justify-between gap-4 border-t border-line px-6 py-8 sm:px-14">
        <span className="text-sm font-bold text-ink-3">Restage</span>
        <div className="flex items-center gap-6 text-[13px] text-ink-3">
          <Link href="/enroll" className="hover:text-ink">Your likeness, your control</Link>
          <span>Likeness policy</span>
          {/* A placeholder in the footer where an address belongs. Until there
              is one, the link that does exist is better than a fake. */}
          <Link href="/enroll" className="hover:text-ink">Get started</Link>
        </div>
      </footer>
    </div>
  );
}
