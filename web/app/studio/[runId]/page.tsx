import { AppShell } from '@/components/AppShell';
import { AuthButton } from '@/components/AuthGate';
import { LiveRun } from '@/components/LiveRun';

/*
 * The screen that gets filmed. One route, not a wizard: the plan, the tree and
 * the inspector are panes of the same page because the product's claim is that
 * you watch it happen rather than click through steps.
 */
export default async function Run({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  return (
    <AppShell right={<AuthButton />}>
      <LiveRun runId={runId} />
    </AppShell>
  );
}
