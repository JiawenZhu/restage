import Link from 'next/link';
import { ThemeToggle } from '@/components/ThemeToggle';

export default function Landing() {
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <header className="flex items-center justify-between px-14 py-5">
        <span className="text-[19px] font-extrabold tracking-tight">Restage</span>
        <div className="flex items-center gap-4">
          <ThemeToggle />
          <Link href="/enroll" className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-ink">
            Start free
          </Link>
        </div>
      </header>

      <section className="mx-auto max-w-3xl px-6 pt-24 text-center">
        <p className="inline-flex items-center gap-2 rounded-chip bg-accent-soft px-3.5 py-1.5 text-[12.5px] font-semibold text-accent">
          Your face — not a stock actor
        </p>
        <h1 className="mt-6 text-6xl font-black leading-[0.98] tracking-[-0.045em] text-balance">
          Never film another <span className="text-accent">UGC ad.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-ink-2 text-pretty">
          Enrol your face once. Say what the ad needs to do. The agent plans the shots,
          generates the frames, grades its own work, and hands you a finished clip.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Link href="/enroll" className="rounded-lg bg-accent px-7 py-3.5 text-[15px] font-semibold text-white">
            Build your avatar — free
          </Link>
          <Link href="/studio" className="rounded-lg border border-line-strong px-6 py-3.5 text-[15px] font-semibold">
            See it work
          </Link>
        </div>
        <p className="mt-4 text-[13px] text-ink-3">First 20 renders free · [YOUR TRIAL TERMS]</p>
      </section>
    </div>
  );
}
