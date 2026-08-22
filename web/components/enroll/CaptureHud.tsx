'use client';

/*
 * Everything drawn over the camera during enrolment.
 *
 * Pulled out of EnrollmentCamera for two reasons. It is the part of this
 * product that most needs to be looked at and could least be looked at —
 * seeing it required a webcam and a face — and /enroll/preview can now render
 * it in every state with no camera at all. And a HUD is presentation: it should
 * not be able to reach into capture state, only to receive it.
 *
 * The tone changed with the extraction. It read as a science-fiction prop:
 * "AUTO-DETECTOR READY", "✓ 60° ANGLE LOCKED!", "CAPTURING DENSE SWEEP (64%)",
 * an arrow set to `animate-bounce` beside a person being asked to hold still.
 * Shouting at somebody in capitals while they try to hold a pose is not
 * confidence, and the words were describing the machinery rather than telling
 * them what to do.
 *
 * The turn meter replaces the biggest omission. The detector had exactly two
 * states, "ready" and "locked", so a person turning their head got no feedback
 * until it fired — no way to know they were nearly there, or that turning
 * further would not help. It shows the real signal instead.
 */

export type CaptureStep = 'front' | 'left' | 'right' | 'audio';

export interface CaptureHudProps {
  step: CaptureStep;
  /** Signed turn estimate, roughly -60..60. Negative is the viewer's left. */
  yaw: number;
  /** The threshold has been crossed and a capture is about to fire. */
  locked: boolean;
  capturing: boolean;
  /** 0-100 while a burst runs. */
  burstProgress: number;
  /** 0-100 microphone level. */
  audioLevel: number;
  retaking: boolean;
}

/** Matches the trigger in EnrollmentCamera. Shown, so the meter is honest. */
const TRIGGER_YAW = 35;

export function CaptureHud({ step, yaw, locked, capturing, burstProgress, audioLevel, retaking }: CaptureHudProps) {
  const turning = step === 'left' || step === 'right';
  const wanted = step === 'left' ? -TRIGGER_YAW : TRIGGER_YAW;
  // How far toward the trigger, 0..1. Turning the wrong way reads as zero
  // rather than as negative progress.
  const progress = turning ? Math.max(0, Math.min(1, yaw / wanted)) : 0;

  return (
    <>
      {/*
        The frame guide. One shape, no crosshairs — four extra marks over a face
        is decoration competing with the thing being framed.

        The width is set in aspect-ratio units, not as a share of a 16:9 box: at
        47% of the width it computed to an oval nearly as wide as it was tall,
        which is not the shape of a head. A face is roughly 3:4, so the width
        follows the height.
      */}
      {/* Not on the voice step: that one records audio only, so a framing guide
          for a photo nobody is taking is decoration over somebody's face. */}
      {step !== 'audio' && (
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        {/*
          Two strokes, not one. A single white ring vanishes against a bright
          wall and a single dark one vanishes against hair; an outer dark ring
          under an inner light one reads on both, which is what a framing guide
          has to do on a camera pointed at anything.

          The vignette is deliberately light. It says where to put your face
          without dimming the view of it, and at 0.22 it was invisible — which
          is the same as not having decided.
        */}
        {/*
          COLOURLESS WHILE IT CAPTURES.

          The lock state used to paint the ring green and throw a 46px green
          glow at 0.75 alpha around it — and the burst fires WHILE locked, for
          2.6 seconds, at a face roughly half a metre from the screen. Glasses
          reflect the screen. The green was visible in both lenses of a real
          enrolment photo, and from there it goes into the identity reference
          that every frame of every run is generated against.

          A capture indicator must not be a light source. The ring stays white
          for the duration; "you got there" is already said by the chip at the
          bottom of the frame, which is small, off the face, and not reflected
          in anything that matters.
        */}
        <div
          className={`relative h-[76%] rounded-[50%] transition-all duration-300 ${
            locked && !capturing
              ? 'shadow-[0_0_0_9999px_rgba(0,0,0,0.34),0_0_46px_rgba(10,143,60,0.75)]'
              : 'shadow-[0_0_0_9999px_rgba(0,0,0,0.34)]'
          }`}
          style={{ aspectRatio: '3 / 4' }}
        >
          <span className="absolute -inset-[3px] rounded-[50%] border-[5px] border-black/35" />
          <span
            className={`absolute inset-0 rounded-[50%] border-[3px] transition-colors duration-300 ${
              locked && !capturing ? 'border-good' : 'border-white'
            }`}
          />
        </div>
      </div>
      )}

      {/* The turn meter — the whole point of the left and right steps. */}
      {turning && !capturing && (
        <div className="pointer-events-none absolute inset-x-0 bottom-5 flex flex-col items-center gap-2.5">
          {/* On its own dark plate: a bare bar over a bright frame is invisible
              exactly when the frame is well lit. */}
          <div className="relative h-2 w-[58%] max-w-[300px] overflow-hidden rounded-full bg-black/55 ring-1 ring-white/25 backdrop-blur-sm">
            <div
              className={`h-full rounded-full transition-[width] duration-100 ${locked ? 'bg-good' : 'bg-white'}`}
              style={{ width: `${progress * 100}%` }}
            />
          </div>
          <span className="rounded-chip bg-black/70 px-3 py-1.5 text-[12px] font-semibold text-white backdrop-blur-sm">
            {locked
              ? 'Hold it there'
              : progress > 0.75
                ? 'Almost — keep turning'
                : step === 'left'
                  ? 'Turn your head to the left'
                  : 'Now to the right'}
          </span>
        </div>
      )}

      {/* Front step: the one instruction that matters. */}
      {step === 'front' && !capturing && (
        <div className="pointer-events-none absolute inset-x-0 bottom-5 flex justify-center">
          <span className="rounded-chip bg-black/70 px-3 py-1.5 text-[12px] font-semibold text-white backdrop-blur-sm">
            Look at the lens and hold still
          </span>
        </div>
      )}

      {/* During a burst. It said "CAPTURING DENSE SWEEP" — a description of the
          mechanism, in capitals, to somebody who needs to keep their head
          steady for two more seconds. */}
      {/*
        Nothing over the face during a burst.
        
        This used to dim the whole frame and put a spinner and the words over
        the subject's mouth — while asking them to hold a pose. Somebody holding
        still needs to SEE themselves holding still. The ring and the words move
        to the same bottom strip everything else uses, and the frame stays clear.
      */}
      {capturing && (
        <div className="pointer-events-none absolute inset-x-0 bottom-5 flex items-center justify-center gap-2.5">
          <span className="flex items-center gap-2.5 rounded-chip bg-black/70 py-1.5 pl-2 pr-3.5 backdrop-blur-sm">
            <svg viewBox="0 0 48 48" className="h-6 w-6 -rotate-90" aria-hidden>
              <circle cx="24" cy="24" r="20" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="6" />
              <circle
                cx="24" cy="24" r="20" fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round"
                strokeDasharray={2 * Math.PI * 20}
                strokeDashoffset={2 * Math.PI * 20 * (1 - burstProgress / 100)}
                style={{ transition: 'stroke-dashoffset 120ms linear' }}
              />
            </svg>
            <span className="text-[12.5px] font-semibold text-white">Keep still</span>
          </span>
        </div>
      )}

      {/* Retake, so it is obvious this is not the main sequence. */}
      {retaking && (
        <span className="absolute left-4 top-4 rounded-chip bg-black/70 px-2.5 py-1.5 text-[11px] font-semibold text-white backdrop-blur-sm">
          Retaking {step}
        </span>
      )}

      {/* Mic level. Only during the voice step: on the three photo steps it was
          a meter for something nobody was being asked to do. */}
      {step === 'audio' && (
        <div className="absolute bottom-3 left-4 flex items-center gap-2 rounded-lg bg-black/60 px-3 py-1.5 backdrop-blur-md">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10a7 7 0 0 0 14 0M12 17v4" />
          </svg>
          <span className="flex h-3 w-20 items-end gap-0.5 overflow-hidden rounded bg-white/20 p-0.5">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((bar) => (
              <span
                key={bar}
                className={`flex-1 rounded-xs transition-all duration-75 ${audioLevel > bar * 12 ? 'bg-good' : 'bg-white/25'}`}
                style={{ height: `${bar * 12.5}%` }}
              />
            ))}
          </span>
        </div>
      )}
    </>
  );
}
