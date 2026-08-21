import { AppShell } from '@/components/AppShell';
import { RunWorkspace } from '@/components/RunWorkspace';
import { demoNodes, demoRun } from '@/lib/demoRun';

/*
 * A design preview of the run workspace on canned data — no auth, no API calls.
 * It exists so tree interactions (drag, hover, selection) can be exercised and
 * screenshotted without burning a real run, and it is the surface the demo film
 * can fall back to. Everything here renders through the same components a real
 * run uses; only the data is canned.
 */
export default function Preview() {
  return (
    <AppShell right={<span className="text-[12px] font-semibold tracking-[0.08em] text-ink-4">DESIGN PREVIEW</span>}>
      <RunWorkspace run={demoRun} nodes={demoNodes} />
    </AppShell>
  );
}
