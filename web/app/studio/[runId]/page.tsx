import { AppShell } from '@/components/AppShell';

/*
 * The screen that gets filmed. One route, not a wizard: the plan, the tree and
 * the inspector are panes of the same page because the whole point is that you
 * watch it happen rather than click through steps.
 *
 * Panes are shells for now — the tree binds to /api/runs/:id/events (SSE) once
 * the run pipeline lands.
 */
export default async function Run({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;

  return (
    <AppShell
      right={
        <span className="flex items-center gap-2 rounded-chip border border-accent/40 bg-accent-soft px-3.5 py-1.5">
          <span className="rs-cursor block h-[7px] w-[7px] rounded-full bg-accent" />
          <span className="tnum text-[13px] font-semibold text-accent">Step 4 of 6</span>
        </span>
      }
    >
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[300px] shrink-0 flex-col border-r border-line bg-panel">
          <p className="px-[18px] pb-3 pt-[18px] text-[11px] font-bold tracking-[0.12em] text-ink-3">PLAN</p>
          <p className="px-[18px] text-[13px] leading-relaxed text-ink-4">
            Steps land here as the agent writes them, each with the reason it is there.
          </p>
        </aside>

        <section
          className="min-w-0 flex-1 bg-canvas"
          style={{
            backgroundImage: 'radial-gradient(var(--border-subtle) 1px, transparent 1px)',
            backgroundSize: '26px 26px',
          }}
        >
          <div className="flex h-full items-center justify-center">
            <p className="tnum text-[13px] text-ink-4">version tree · run {runId}</p>
          </div>
        </section>

        <aside className="w-[372px] shrink-0 border-l border-line bg-panel">
          <p className="px-[18px] pb-3 pt-[18px] text-[11px] font-bold tracking-[0.12em] text-ink-3">INSPECTOR</p>
          <p className="px-[18px] text-[13px] leading-relaxed text-ink-4">
            Select a node for its instruction, the agent&rsquo;s reasoning and the critic&rsquo;s verdict.
          </p>
        </aside>
      </div>
    </AppShell>
  );
}
