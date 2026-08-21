import { AppShell } from '@/components/AppShell';

const EXAMPLES = [
  'A 15-second ad where I actually use the product, in my kitchen',
  'Make it feel filmed on a phone, not shot by an agency',
  'Something that survives the first two seconds of a scroll',
];

export default function NewRun() {
  return (
    <AppShell right={<span className="tnum text-[13px] text-ink-3">18 renders left</span>}>
      <div className="mx-auto w-full max-w-4xl px-6 py-14">
        <h1 className="text-[32px] font-bold tracking-[-0.025em]">What should this ad do?</h1>
        <p className="mt-2 text-base text-ink-3">Describe the result, not the shots. The agent works out the shots.</p>

        <p className="mt-9 text-[10.5px] font-bold tracking-[0.12em] text-ink-3">THE GOAL</p>
        <div className="mt-2.5 rounded-card border border-line bg-panel p-5">
          <textarea
            rows={2}
            placeholder="Describe the outcome you want — not the shots."
            className="w-full resize-none bg-transparent text-[19px] leading-snug outline-none placeholder:text-ink-4"
          />
          <div className="mt-5 flex flex-wrap gap-2 border-t border-line pt-4">
            {EXAMPLES.map((e) => (
              <button key={e} type="button" className="rounded-chip border border-line-strong bg-elevated px-3.5 py-2 text-[13px] text-ink-2 hover:border-accent">
                {e}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-7 grid grid-cols-2 gap-5">
          <div>
            <p className="text-[10.5px] font-bold tracking-[0.12em] text-ink-3">FORMAT</p>
            <div className="mt-2.5 flex gap-2.5">
              <button type="button" className="flex flex-1 items-center gap-3 rounded-card border-2 border-accent bg-panel p-4 text-left">
                <span className="h-11 w-6 shrink-0 rounded border-2 border-accent" />
                <span>
                  <span className="block text-sm font-semibold">9:16</span>
                  <span className="block text-[11.5px] text-ink-3">Reels, TikTok, Shorts</span>
                </span>
              </button>
              <button type="button" className="flex flex-1 items-center gap-3 rounded-card border border-line bg-panel p-4 text-left">
                <span className="h-6 w-11 shrink-0 rounded border-2 border-ink-4" />
                <span>
                  <span className="block text-sm font-semibold text-ink-2">16:9</span>
                  <span className="block text-[11.5px] text-ink-3">YouTube, site, pre-roll</span>
                </span>
              </button>
            </div>
            {/* The ratio is chosen before the plan exists so every frame is composed
                for it. A 16:9 ad is not a 9:16 ad with the sides removed. */}
            <p className="mt-2 text-xs text-ink-4">The agent frames every step for this ratio — it is not a crop at the end.</p>
          </div>

          <div>
            <p className="text-[10.5px] font-bold tracking-[0.12em] text-ink-3">LENGTH</p>
            <div className="mt-2.5 flex gap-2">
              {(['8s', '15s', '30s'] as const).map((l) => (
                <button key={l} type="button" className={`flex-1 rounded-card border bg-panel py-5 text-sm font-semibold ${l === '15s' ? 'border-2 border-accent' : 'border-line text-ink-2'}`}>
                  {l}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-ink-4">Longer runs cost more credits and take longer to render.</p>
          </div>
        </div>

        <div className="mt-8 flex items-center justify-between">
          <span className="text-[13px] text-ink-4">The plan appears first. Nothing renders until you have read it.</span>
          <button type="button" className="rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-primary-ink">
            Plan the run
          </button>
        </div>
      </div>
    </AppShell>
  );
}
