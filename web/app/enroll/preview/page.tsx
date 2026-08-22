'use client';

import { useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { CaptureHud, type CaptureStep } from '@/components/enroll/CaptureHud';

/*
 * The capture overlay, in every state, with no camera.
 *
 * This exists because the enrolment HUD is the hardest surface in the product
 * to look at: seeing it meant having a webcam, a face, and the patience to turn
 * your head into each state — so it was the least reviewed part of the app and
 * had drifted furthest into shouting at people in capitals.
 *
 * The still behind it is a generated frame the pipeline already produced, so no
 * real person's face is used to lay out a control panel.
 */
const STEPS: CaptureStep[] = ['front', 'left', 'right', 'audio'];

export default function EnrolPreview() {
  const [step, setStep] = useState<CaptureStep>('left');
  const [yaw, setYaw] = useState(-20);
  const [capturing, setCapturing] = useState(false);
  const [burstProgress, setBurstProgress] = useState(45);
  const [audioLevel, setAudioLevel] = useState(60);
  const [retaking, setRetaking] = useState(false);

  const locked = (step === 'left' && yaw <= -35) || (step === 'right' && yaw >= 35);

  return (
    <AppShell right={<span className="text-[12px] font-semibold tracking-[0.08em] text-ink-4">HUD PREVIEW</span>}>
      <div className="mx-auto w-full max-w-3xl px-6 py-10">
        <h1 className="text-[24px] font-bold tracking-[-0.02em]">Capture overlay</h1>
        <p className="mt-1.5 text-[13.5px] text-ink-3">
          Every state the enrolment HUD can be in, without a camera. Drive it with the controls below.
        </p>

        <div className="relative mt-6 aspect-video w-full overflow-hidden rounded-2xl border border-line-strong bg-black">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/img/f4.jpg" alt="" className="h-full w-full object-cover opacity-90" />
          <CaptureHud
            step={step}
            yaw={yaw}
            locked={locked}
            capturing={capturing}
            burstProgress={burstProgress}
            audioLevel={audioLevel}
            retaking={retaking}
          />
        </div>

        <div className="mt-6 grid gap-5 rounded-card border border-line bg-panel p-5 sm:grid-cols-2">
          <div>
            <p className="text-[11px] font-bold tracking-[0.1em] text-ink-3">STEP</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {STEPS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStep(s)}
                  className={`rounded-chip px-3 py-1.5 text-[12.5px] font-medium ${
                    step === s ? 'bg-primary text-primary-ink' : 'border border-line-strong text-ink-2'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-[11px] font-bold tracking-[0.1em] text-ink-3" htmlFor="yaw">
              TURN <span className="tnum font-mono text-ink-2">{yaw}</span>
            </label>
            <input
              id="yaw"
              type="range"
              min={-60}
              max={60}
              value={yaw}
              onChange={(e) => setYaw(Number(e.target.value))}
              className="mt-2 w-full accent-[var(--accent)]"
            />
            <p className="mt-1 text-[11.5px] text-ink-4">Fires at ±35. {locked ? 'Locked.' : 'Not yet.'}</p>
          </div>

          <div>
            <label className="text-[11px] font-bold tracking-[0.1em] text-ink-3" htmlFor="burst">
              BURST <span className="tnum font-mono text-ink-2">{burstProgress}%</span>
            </label>
            <input
              id="burst"
              type="range"
              min={0}
              max={100}
              value={burstProgress}
              onChange={(e) => setBurstProgress(Number(e.target.value))}
              className="mt-2 w-full accent-[var(--accent)]"
            />
          </div>

          <div>
            <label className="text-[11px] font-bold tracking-[0.1em] text-ink-3" htmlFor="mic">
              MIC <span className="tnum font-mono text-ink-2">{audioLevel}</span>
            </label>
            <input
              id="mic"
              type="range"
              min={0}
              max={100}
              value={audioLevel}
              onChange={(e) => setAudioLevel(Number(e.target.value))}
              className="mt-2 w-full accent-[var(--accent)]"
            />
          </div>

          <div className="flex flex-wrap gap-4 sm:col-span-2">
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={capturing} onChange={(e) => setCapturing(e.target.checked)} />
              capturing
            </label>
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={retaking} onChange={(e) => setRetaking(e.target.checked)} />
              retaking
            </label>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
