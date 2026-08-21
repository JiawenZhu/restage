import { AppShell } from '@/components/AppShell';

export default function Library() {
  return (
    <AppShell>
      <div className="mx-auto w-full max-w-6xl px-6 py-14">
        <h1 className="text-[28px] font-bold tracking-[-0.02em]">Your runs</h1>
        <p className="mt-1.5 text-[14.5px] text-ink-3">Every tree stays — branch from any node in any past run.</p>
        <div className="mt-8 rounded-card border border-line bg-panel py-20 text-center">
          <p className="text-[14px] text-ink-3">Nothing here yet.</p>
        </div>
      </div>
    </AppShell>
  );
}
