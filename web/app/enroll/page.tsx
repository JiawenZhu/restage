import { AppShell } from '@/components/AppShell';
import { EnrollmentCamera } from '@/components/enroll/EnrollmentCamera';

export default function Enroll() {
  return (
    <AppShell>
      <div className="mx-auto w-full max-w-5xl px-6 py-8">
        <h1 className="text-center text-[32px] font-bold tracking-[-0.025em]">Three Angles. Once.</h1>
        <p className="mx-auto mt-2 max-w-xl text-center text-base leading-relaxed text-ink-3">
          Capture once. Every UGC ad generated from now on uses this face and voice.
        </p>

        <div className="mt-6">
          <EnrollmentCamera />
        </div>

        {/* Technical rationale */}
        <div className="mx-auto mt-8 flex max-w-4xl gap-7 rounded-card border border-line bg-panel px-6 py-5">
          <div className="flex-1">
            <p className="text-[13.5px] font-semibold">Why three angles and not one?</p>
            <p className="mt-1.5 text-[13px] leading-relaxed text-ink-3">
              A single front-on photo gives the diffusion model nothing about the sides of your face.
              Sampling front, left 60°, and right 60° anchors your 3D facial geometry and skin texture.
            </p>
          </div>
          <div className="w-px self-stretch bg-line" />
          <div className="flex-1">
            <p className="text-[13.5px] font-semibold">Privacy & Identity Vault</p>
            <p className="mt-1.5 text-[13px] leading-relaxed text-ink-3">
              Captures are stored privately in your account. Only you can read them, and no link shares them.
              Deleting an avatar permanently purges all raw data.
            </p>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
