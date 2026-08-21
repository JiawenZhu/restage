import { AppShell } from '@/components/AppShell';
import { RunWorkspace } from '@/components/RunWorkspace';
import { demoNodes, demoRun } from '@/lib/demoRun';

/*
 * The screen that gets filmed. One route, not a wizard: the plan, the tree and
 * the inspector are panes of the same page because the product's claim is that
 * you watch it happen rather than click through steps.
 *
 * Data is demo data until the run pipeline lands. The shapes are the real ones
 * from lib/types, so swapping the source is a fetch, not a rewrite.
 */
export default async function Run({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const run = { ...demoRun, id: runId };

  return (
    <AppShell
      right={
        <span className="flex items-center gap-2 rounded-chip border border-accent/40 bg-accent-soft px-3.5 py-1.5">
          <span className="rs-cursor block h-[7px] w-[7px] rounded-full bg-accent" />
          <span className="tnum text-[13px] font-semibold text-accent">Step 4 of 6</span>
        </span>
      }
    >
      <RunWorkspace run={run} nodes={demoNodes} />
    </AppShell>
  );
}
