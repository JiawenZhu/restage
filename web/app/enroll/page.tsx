import { AppShell } from '@/components/AppShell';

const ANGLES = [
  { key: 'left', label: 'Left, about 60°' },
  { key: 'front', label: 'Straight on' },
  { key: 'right', label: 'Right, about 60°' },
] as const;

export default function Enroll() {
  return (
    <AppShell>
      <div className="mx-auto w-full max-w-5xl px-6 py-14">
        <h1 className="text-center text-[32px] font-bold tracking-[-0.025em]">Three angles. Once.</h1>
        <p className="mx-auto mt-2 max-w-xl text-center text-base leading-relaxed text-ink-3">
          Everything you generate from now on uses this face. Do it properly once and never upload again.
        </p>

        <div className="mt-10 grid grid-cols-3 gap-5">
          {ANGLES.map((a) => (
            <div key={a.key}>
              <div className="flex aspect-square items-center justify-center rounded-card border-[1.5px] border-dashed border-line-strong bg-panel">
                <span className="text-[13px] text-ink-4">Capture or upload</span>
              </div>
              <p className="mt-3 text-sm font-semibold">{a.label}</p>
            </div>
          ))}
        </div>

        {/* Stated plainly because it is the question every user asks, and because
            a face is not a file — the answer has to be true on day one. */}
        <div className="mt-9 flex gap-7 rounded-card border border-line bg-panel px-6 py-5">
          <div className="flex-1">
            <p className="text-[13.5px] font-semibold">Why three and not one</p>
            <p className="mt-1.5 text-[13px] leading-relaxed text-ink-3">
              A single front-on photo gives the model nothing about the sides of your face. The
              moment you turn your head in a clip, it starts inventing.
            </p>
          </div>
          <div className="w-px self-stretch bg-line" />
          <div className="flex-1">
            <p className="text-[13.5px] font-semibold">Where these live</p>
            <p className="mt-1.5 text-[13px] leading-relaxed text-ink-3">
              Stored against your account and used only for your own clips. Delete the avatar and
              the captures go with it. <span className="text-accent">[YOUR RETENTION POLICY]</span>
            </p>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
