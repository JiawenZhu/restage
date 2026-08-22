'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { AuthModal } from '@/components/AuthModal';
import { CaptureHud } from './CaptureHud';

type Mode = 'camera' | 'upload';
type Step = 'ready' | 'front' | 'left' | 'right' | 'audio' | 'review' | 'saving' | 'done';
type RetakeTarget = 'front' | 'left' | 'right' | 'audio' | null;

const TELEPROMPTER_TEXT =
  "I'm testing my personal voice and likeness sample for Restage AI. Everything from lighting to tone feels authentic and ready to create.";

/*
 * Did the head actually turn?
 *
 * The turn detector is a brightness heuristic rather than a pose measurement —
 * its own comment says so, and turning toward a lamp moves the reading without
 * moving the head. In a real enrolment it fired on room lighting, and the
 * resulting "left profile" was very nearly the straight-on shot. Three angles
 * that are all the same angle give the model nothing extra to hold a face with,
 * which is the entire reason enrolment takes three.
 *
 * This does not try to measure the sensor better. It checks the RESULT, and it
 * needs no magic threshold, because the useful signal is a comparison rather
 * than a number: of the three pairs, LEFT vs RIGHT must be the most different.
 * They are the two extremes, so nothing else can be further apart. Measured on
 * the enrolment that went wrong, they were the CLOSEST pair —
 *
 *     front vs left   0.117
 *     front vs right  0.117
 *     left  vs right  0.061   ← should have been the largest
 *
 * which says plainly that the two "profiles" are the same pose. Lighting and
 * background are identical across the three captures, so almost all of the
 * difference that survives the comparison is the head having moved.
 */
async function poseDifference(a: string, b: string): Promise<number> {
  const load = (src: string) =>
    new Promise<HTMLImageElement>((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = rej;
      im.src = src;
    });
  const [ia, ib] = await Promise.all([load(a), load(b)]);
  const W = 48;
  const H = 64;
  const grey = (im: HTMLImageElement) => {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(im, 0, 0, W, H);
    const d = ctx.getImageData(0, 0, W, H).data;
    const out = new Float64Array(W * H);
    for (let i = 0; i < W * H; i++) out[i] = (d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2]) / 3;
    return out;
  };
  const ga = grey(ia);
  const gb = grey(ib);
  if (!ga || !gb) return 1;
  let sum = 0;
  for (let i = 0; i < ga.length; i++) sum += Math.abs(ga[i] - gb[i]);
  return sum / ga.length / 255;
}

export function EnrollmentCamera() {
  const { user } = useAuth();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  /* The unmount cleanup below cannot read `stream` state — see the comment
     there — so the live stream is mirrored here. */
  const streamRef = useRef<MediaStream | null>(null);
  /** Set when Save was pressed while signed out, so it can resume after login. */
  const wantsSaveRef = useRef(false);

  // Hidden File input refs for single-item replace
  const fileInputFrontRef = useRef<HTMLInputElement>(null);
  const fileInputLeftRef = useRef<HTMLInputElement>(null);
  const fileInputRightRef = useRef<HTMLInputElement>(null);
  const fileInputAudioRef = useRef<HTMLInputElement>(null);

  const [mode, setMode] = useState<Mode>('camera');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [step, setStep] = useState<Step>('ready');
  const [retakeTarget, setRetakeTarget] = useState<RetakeTarget>(null);
  const [isCapturingBurst, setIsCapturingBurst] = useState(false);
  const [burstProgress, setBurstProgress] = useState(0);
  /** What the burst actually chose, so the interface can say so truthfully. */
  const [burstStats, setBurstStats] = useState<Record<string, { kept: number; score: number }>>({});
  const [turnWarning, setTurnWarning] = useState<string | null>(null);
  const [avatarName, setAvatarName] = useState('My Personal Avatar');
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [audioLevel, setAudioLevel] = useState<number>(0);

  // Real-time Head Pose / Yaw Tracking
  const [headYaw, setHeadYaw] = useState<number>(0);
  const [angleLocked, setAngleLocked] = useState(false);
  const isTriggeringAutoRef = useRef(false);
  /** The detector must see a near-centre pose before it will fire again. */
  const armedRef = useRef(true);

  // Stored 3 keyframe representations for UI review and diffusion conditioning
  const [capturedFrames, setCapturedFrames] = useState<{
    front: string | null;
    left: string | null;
    right: string | null;
  }>({
    front: null,
    left: null,
    right: null,
  });

  // Behind-the-scenes burst frame buffer for dense multi-view temporal data
  /** Every burst frame with its sharpness, so the best one can actually win.
   *  This used to hold data URLs that were measured by nothing and discarded. */
  const burstBufferRef = useRef<{
    front: { dataUrl: string; sharpness: number }[];
    left: { dataUrl: string; sharpness: number }[];
    right: { dataUrl: string; sharpness: number }[];
  }>({
    front: [],
    left: [],
    right: [],
  });

  // Attach stream to video tag whenever stream or step changes
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch((err) => console.error('Video play error:', err));
    }
  }, [stream, step]);

  /*
   * Release the camera and microphone on unmount.
   *
   * This closed over `stream` from the FIRST render with an empty dependency
   * array, and `stream` is null on the first render — so `if (stream)` was
   * always false and the tracks were never stopped. Clicking any nav link left
   * the webcam and microphone live for the rest of the session, recording
   * indicator and all, with the vision loop still reading frames. On the page
   * that promises a privacy vault, that is the worst possible thing to get
   * wrong.
   *
   * A ref is used rather than adding `stream` to the deps, because that would
   * tear the stream down on every state change instead of on unmount.
   */
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
      }
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (user && wantsSaveRef.current) {
      wantsSaveRef.current = false;
      setAuthModalOpen(false);
      void handleSaveAvatar();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  /*
   * Check the three captures against each other once they are all in.
   *
   * Run on entering review rather than at capture time, because the question is
   * about the SET — whether these three are three angles or one angle three
   * times — and that cannot be asked until the third one exists.
   */
  useEffect(() => {
    if (step !== 'review') return;
    const { front, left, right } = capturedFrames;
    if (!front || !left || !right) return;
    let cancelled = false;
    void (async () => {
      try {
        const [fl, fr, lr] = await Promise.all([
          poseDifference(front, left),
          poseDifference(front, right),
          poseDifference(left, right),
        ]);
        if (cancelled) return;
        console.info(
          `[enrol] pose spread — front/left ${fl.toFixed(3)}, front/right ${fr.toFixed(3)}, left/right ${lr.toFixed(3)}`,
        );
        // The two extremes have to be further apart than either is from centre.
        setTurnWarning(
          lr > Math.max(fl, fr)
            ? null
            : 'Your left and right shots look more alike than either looks like the straight-on one, ' +
              'which usually means the head did not turn far enough. Retake them and turn until one ear ' +
              'is pointing at the lens — about a sixty-degree turn. Three angles is what holds the face; ' +
              'three copies of one angle will not.',
        );
      } catch {
        /* A check that cannot run is not a reason to block enrolment. */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [step, capturedFrames]);

  // Initialize WebRTC and Real-time Vision/Audio Analysis Loop
  const startMedia = async (targetStep: Step = 'front') => {
    try {
      setErrorMessage(null);
      let mediaStream = stream;
      if (!mediaStream || !mediaStream.active) {
        /*
         * Ask for the most the camera has, not 720p.
         *
         * This requested 1280x720 and got exactly that, which is what a real
         * enrolment produced: three 166-210 KB landscape frames in which the
         * face occupied maybe a third of the width. Every frame of every run is
         * generated against those pixels, so the reference is the ceiling on
         * the whole product — and it was being set, by hand, to the lowest
         * resolution any laptop camera still supports.
         *
         * `ideal` degrades on its own when a device cannot deliver, so asking
         * high costs nothing on a weak camera and gains a great deal on a good
         * one. applyConstraints then pushes to whatever the track reports it can
         * actually do, which is often higher than any fixed number worth
         * hardcoding.
         */
        mediaStream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 3840 }, height: { ideal: 2160 }, facingMode: 'user' },
          audio: true,
        });

        const track = mediaStream.getVideoTracks()[0];
        try {
          const caps = track?.getCapabilities?.() as { width?: { max?: number }; height?: { max?: number } } | undefined;
          if (caps?.width?.max && caps?.height?.max) {
            await track.applyConstraints({
              width: { ideal: caps.width.max },
              height: { ideal: caps.height.max },
            });
          }
        } catch {
          /* Not every browser reports capabilities, and the ideal request above
             already got us the best it was willing to give. */
        }
        const got = track?.getSettings?.();
        if (got?.width) console.info(`[enrol] capturing at ${got.width}x${got.height}`);

        setStream(mediaStream);
        streamRef.current = mediaStream;

        // Setup Web Audio Analyser
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        audioContextRef.current = audioCtx;
        const source = audioCtx.createMediaStreamSource(mediaStream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        analyserRef.current = analyser;
      }

      setStep(targetStep);
      startVisionLoop();
    } catch (err: any) {
      console.error('Camera/Mic access error:', err);
      setErrorMessage('Unable to access camera or microphone. Please ensure permissions are granted.');
    }
  };

  // Real-time Optical Pose & Audio Analysis Frame Loop
  const startVisionLoop = () => {
    const dataArray = new Uint8Array(128);
    const smallCanvas = document.createElement('canvas');
    smallCanvas.width = 120;
    smallCanvas.height = 90;
    const smallCtx = smallCanvas.getContext('2d', { willReadFrequently: true });

    let lastTime = 0;

    const checkFrame = (time: number) => {
      // 1. Audio Level
      if (analyserRef.current) {
        analyserRef.current.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
        const avg = sum / dataArray.length;
        setAudioLevel(Math.min(100, Math.round((avg / 128) * 100)));
      }

      // 2. Optical Head Pose & Symmetry Detection (10Hz throttle)
      if (time - lastTime > 100 && videoRef.current && videoRef.current.readyState >= 2 && smallCtx) {
        lastTime = time;
        try {
          const v = videoRef.current;
          smallCtx.drawImage(v, 0, 0, 120, 90);
          const imgData = smallCtx.getImageData(20, 15, 80, 60);
          const d = imgData.data;

          /*
           * A brightness-asymmetry heuristic, NOT a measured pose. Turning
           * toward a lamp shifts this reading without moving the head, and a
           * face-landmark model is what would actually measure yaw. It is good
           * enough to trigger a capture the user is already performing, which
           * is why the manual capture button stays the reliable path and the
           * HUD calls this a guide rather than a measurement.
           */
          let leftSum = 0;
          let rightSum = 0;
          const halfW = 40;

          for (let y = 0; y < 60; y += 2) {
            for (let x = 0; x < 80; x += 2) {
              const idx = (y * 80 + x) * 4;
              const brightness = (d[idx] + d[idx + 1] + d[idx + 2]) / 3;
              if (x < halfW) leftSum += brightness;
              else rightSum += brightness;
            }
          }

          const total = leftSum + rightSum || 1;
          const diffRatio = (rightSum - leftSum) / total;
          // Scale to approximate yaw angle (-60 to +60)
          const angle = Math.max(-60, Math.min(60, Math.round(diffRatio * 180)));
          setHeadYaw(angle);
        } catch (err) {
          // ignore transient canvas read errors
        }
      }

      animFrameRef.current = requestAnimationFrame(checkFrame);
    };

    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    animFrameRef.current = requestAnimationFrame(checkFrame);
  };

  /*
   * Automatic trigger for head turns — with two bugs removed.
   *
   * Both branches used to accept `>= 35 || <= -35`, so left and right had
   * IDENTICAL triggers and neither actually tested a direction. Combined with
   * the second bug that made the right capture wrong every time: the trigger
   * lock cleared after 300ms while the burst runs for 2600ms, so when the step
   * advanced the user was still turned left, the reading was still past the
   * threshold, and the "right profile" was captured from the left-turned pose.
   * Enrolment then conditioned the model on two left profiles.
   *
   * Each direction now tests its own sign, and the detector must be re-armed by
   * returning near centre before it can fire again. Facing forward between
   * angles is what a person naturally does, so the gate costs nothing and makes
   * a stale pose impossible to capture.
   */
  useEffect(() => {
    if (isCapturingBurst || isTriggeringAutoRef.current) return;

    // Re-arm only after the head comes back to roughly centre.
    if (!armedRef.current) {
      if (Math.abs(headYaw) < 12) armedRef.current = true;
      return;
    }

    const wantsLeft = step === 'left' && headYaw <= -35;
    const wantsRight = step === 'right' && headYaw >= 35;
    if (!wantsLeft && !wantsRight) return;

    const which = wantsLeft ? 'left' : 'right';
    setAngleLocked(true);
    isTriggeringAutoRef.current = true;
    armedRef.current = false;

    setTimeout(() => {
      startBurstSweep(which, 2600);
      setAngleLocked(false);
      // Held for the full burst, not 300ms, so the next step cannot inherit
      // this pose.
      setTimeout(() => {
        isTriggeringAutoRef.current = false;
      }, 2700);
    }, 300);
  }, [headYaw, step, isCapturingBurst]);

  const stopMedia = () => {
    // Stop from the ref, which is always current, and tear down the analysis
    // loop with it — a running requestAnimationFrame on a dead stream is just
    // battery.
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setStream(null);
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
  };

  // Grab single frame from video element
  /*
   * Sharpness, as the variance of a Laplacian over the centre of the frame.
   *
   * A blurred image has little high-frequency detail, so the second derivative
   * stays near zero everywhere and its variance is low; a sharp one has edges,
   * so the variance is high. Measured on the middle of the frame because that
   * is where the face is — a sharp bookshelf behind a motion-blurred face would
   * otherwise win.
   *
   * This runs on a small copy: at full resolution it would cost more than the
   * 130ms between burst frames.
   */
  const sharpnessOf = (canvas: HTMLCanvasElement): number => {
    const W = 160;
    const H = 120;
    const small = document.createElement('canvas');
    small.width = W;
    small.height = H;
    const sctx = small.getContext('2d', { willReadFrequently: true });
    if (!sctx) return 0;

    // The centre half of the frame, where a face sits.
    const sx = canvas.width * 0.25;
    const sy = canvas.height * 0.15;
    sctx.drawImage(canvas, sx, sy, canvas.width * 0.5, canvas.height * 0.7, 0, 0, W, H);
    const d = sctx.getImageData(0, 0, W, H).data;

    const gray = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) {
      gray[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    }

    let sum = 0;
    let sumSq = 0;
    let n = 0;
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        // 4-neighbour Laplacian
        const lap = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - W] - gray[i + W];
        sum += lap;
        sumSq += lap * lap;
        n++;
      }
    }
    if (!n) return 0;
    const mean = sum / n;
    return sumSq / n - mean * mean;
  };

  const grabFrame = (): { dataUrl: string; sharpness: number } | null => {
    if (!videoRef.current || !canvasRef.current) return null;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return { dataUrl: canvas.toDataURL('image/jpeg', 0.95), sharpness: sharpnessOf(canvas) };
  };

  // Trigger Retake for a specific target
  const handleRetake = (target: 'front' | 'left' | 'right' | 'audio') => {
    setRetakeTarget(target);
    startMedia(target);
  };

  // Cancel retake and jump back to review screen
  const cancelRetake = () => {
    // Returning to review from a retake left the webcam live, same as the
    // original review-screen bug.
    stopMedia();
    setRetakeTarget(null);
    setStep('review');
  };

  // Continuous Multi-Frame Burst Sweep Capture
  const startBurstSweep = (angle: 'front' | 'left' | 'right', durationMs: number = 2600) => {
    setIsCapturingBurst(true);
    setBurstProgress(0);
    burstBufferRef.current[angle] = [];

    const intervalTime = 130;
    const totalTicks = Math.floor(durationMs / intervalTime);
    let ticks = 0;

    const timer = setInterval(() => {
      ticks++;
      const currentPct = Math.min(100, Math.round((ticks / totalTicks) * 100));
      setBurstProgress(currentPct);

      // Snap burst frame
      const frame = grabFrame();
      if (frame) burstBufferRef.current[angle].push(frame);

      if (ticks >= totalTicks) {
        clearInterval(timer);
        setIsCapturingBurst(false);
        setBurstProgress(100);

        /*
         * Pick the sharpest frame, within the window where the pose is right.
         *
         * The comment here used to say "sharpest / middle-peak frame" while the
         * code took a frame by POSITION — the middle one for front, 75% for a
         * profile — so twenty frames were captured, measured by nothing, and
         * nineteen thrown away. Position still matters, because a profile shot
         * is only a profile near the end of the turn, so it constrains the
         * WINDOW; sharpness decides within it. The face is the one input this
         * whole product depends on, and a motion-blurred one poisons every
         * frame generated from it.
         */
        const frames = burstBufferRef.current[angle];
        const window = angle === 'front'
          ? frames.slice(Math.floor(frames.length * 0.3), Math.ceil(frames.length * 0.8))
          : frames.slice(Math.floor(frames.length * 0.6));
        const pool = window.length ? window : frames;
        const best = pool.reduce((a, b) => (b.sharpness > a.sharpness ? b : a), pool[0]);

        if (best) {
          const scores = pool.map((f) => f.sharpness);
          console.info(
            `[enrol] ${angle}: kept the sharpest of ${pool.length} (${best.sharpness.toFixed(0)}, ` +
              `worst ${Math.min(...scores).toFixed(0)})`,
          );
          setCapturedFrames((curr) => ({ ...curr, [angle]: best.dataUrl }));
          setBurstStats((curr) => ({ ...curr, [angle]: { kept: pool.length, score: best.sharpness } }));
        }

        // The buffer has done its job; twenty full-resolution data URLs per
        // angle is not something to keep holding.
        burstBufferRef.current[angle] = [];

        setTimeout(() => {
          setBurstProgress(0);
          if (retakeTarget) {
            // Finishing a retake goes back to review, where no camera is needed.
            stopMedia();
            setRetakeTarget(null);
            setStep('review');
          } else {
            if (angle === 'front') setStep('left');
            else if (angle === 'left') setStep('right');
            else if (angle === 'right') setStep('audio');
          }
        }, 400);
      }
    }, intervalTime);
  };

  // Teleprompter Audio Recording
  const startAudioRecording = () => {
    if (!stream) return;
    audioChunksRef.current = [];
    const audioTrack = stream.getAudioTracks()[0];
    if (!audioTrack) {
      setErrorMessage('Microphone stream unavailable');
      return;
    }

    const audioStream = new MediaStream([audioTrack]);
    const recorder = new MediaRecorder(audioStream);
    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunksRef.current.push(e.data);
    };

    recorder.onstop = () => {
      // Review needs no camera. It stayed live through the whole review screen,
      // recording indicator and all.
      stopMedia();
      /*
       * Whatever the browser actually recorded. MediaRecorder produces WebM
       * (or MP4 on Safari) — never WAV — so labelling the blob 'audio/wav' put
       * WebM bytes in a file called voice_sample.wav. Anything that later reads
       * it by extension gets a file that is not what it claims to be.
       */
      const type = recorder.mimeType || audioChunksRef.current[0]?.type || 'audio/webm';
      const blob = new Blob(audioChunksRef.current, { type });
      setAudioBlob(blob);
      setAudioUrl(URL.createObjectURL(blob));
      setRetakeTarget(null);
      setStep('review');
    };

    recorder.start();
    setIsCapturingBurst(true);
    setBurstProgress(0);

    /* The label said 5s, this ran 6s, and the prompter script needs about 9s to
       read — so every sample was cut off mid-sentence. Ten seconds fits the
       script with room to breathe, and the label below says the same number. */
    const duration = 10000;
    const interval = 100;
    let elapsed = 0;

    const timer = setInterval(() => {
      elapsed += interval;
      const pct = Math.min(100, Math.round((elapsed / duration) * 100));
      setBurstProgress(pct);

      if (elapsed >= duration) {
        clearInterval(timer);
        setIsCapturingBurst(false);
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
          mediaRecorderRef.current.stop();
        }
      }
    }, interval);
  };

  // Handle local files upload fallback & individual replacements
  const handleFileUpload = (angle: 'front' | 'left' | 'right', file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      setCapturedFrames((curr) => ({ ...curr, [angle]: String(reader.result) }));
    };
    reader.readAsDataURL(file);
  };

  const handleAudioUpload = (file: File) => {
    setAudioBlob(file);
    setAudioUrl(URL.createObjectURL(file));
  };

  // Upload to Firebase Storage & Firestore via Server API
  const handleSaveAvatar = async () => {
    if (!capturedFrames.front || !capturedFrames.left || !capturedFrames.right) {
      setErrorMessage('Missing required multi-angle frames (Front, Left 60°, Right 60°)');
      return;
    }

    /*
     * Sign-in is a precondition of saving a face, not a fallback.
     *
     * This used to mint a random `guest_xxxxx` uid and save under it, so the
     * enrolment succeeded and then belonged to nobody: /studio could never
     * offer it, the library could never show it, and the user could not delete
     * it — while the screen promised a private vault they controlled. The
     * modal is already mounted; it only needed to be opened.
     */
    if (!user) {
      // Remember that a save was wanted, so it resumes when auth arrives rather
      // than silently doing nothing and requiring a second press.
      wantsSaveRef.current = true;
      setAuthModalOpen(true);
      return;
    }

    setStep('saving');
    try {
      // Convert audioBlob to base64 if present
      let audioBase64 = null;
      if (audioBlob) {
        audioBase64 = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(audioBlob);
        });
      }

      const token = await user.getIdToken();

      const res = await fetch('/api/avatars', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        // No uid in the body: the server reads it from the token. Sending one
        // was how any caller could write into another user's collection.
        body: JSON.stringify({
          name: avatarName || 'My Personal Avatar',
          front: capturedFrames.front,
          left: capturedFrames.left,
          right: capturedFrames.right,
          // undefined, not null — the field is optional, and null is a value.
          audio: audioBase64 ?? undefined,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Failed to save avatar');
      }

      stopMedia();
      setStep('done');

      /*
       * Cached AFTER the save is committed and in its own try, because this is
       * a convenience and not part of the result. It used to sit inside the
       * request's try block holding the full base64 payload — several MB — so
       * a QuotaExceededError from a successful save was caught by the handler
       * below and reported to the user as a failed enrolment. Only the light
       * fields are stored now, and the key is namespaced by uid so one
       * browser's two accounts cannot inherit each other's face.
       */
      try {
        if (typeof window !== 'undefined' && json.avatar) {
          localStorage.setItem(
            `restage_latest_avatar:${user.uid}`,
            JSON.stringify({ id: json.avatar.id, name: json.avatar.name, urls: json.avatar.urls }),
          );
        }
      } catch {
        /* the avatar is saved on the server; the cache is optional */
      }
    } catch (err: unknown) {
      console.error('Error saving avatar:', err);
      setErrorMessage(err instanceof Error ? err.message : 'Failed to save avatar. Please try again.');
      setStep('review');
    }
  };

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6">
      <canvas ref={canvasRef} className="hidden" />

      {/* Hidden File Inputs for Individual Direct Replacement */}
      <input
        ref={fileInputFrontRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => e.target.files?.[0] && handleFileUpload('front', e.target.files[0])}
      />
      <input
        ref={fileInputLeftRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => e.target.files?.[0] && handleFileUpload('left', e.target.files[0])}
      />
      <input
        ref={fileInputRightRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => e.target.files?.[0] && handleFileUpload('right', e.target.files[0])}
      />
      <input
        ref={fileInputAudioRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(e) => e.target.files?.[0] && handleAudioUpload(e.target.files[0])}
      />

      {/* Mode Switcher */}
      {step === 'ready' && (
        <div className="mb-6 flex justify-center">
          <div className="inline-flex rounded-xl border border-line bg-panel p-1 shadow-xs">
            {/* Emoji as iconography reads as a placeholder somebody meant to
                replace, and "Auto-Detect 3D Sweep" named a mechanism rather
                than an action. */}
            <button
              onClick={() => setMode('camera')}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 text-[12.5px] font-semibold transition-all ${
                mode === 'camera' ? 'bg-primary text-primary-ink shadow-xs' : 'text-ink-3 hover:text-ink'
              }`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
              Use my camera
            </button>
            <button
              onClick={() => setMode('upload')}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 text-[12.5px] font-semibold transition-all ${
                mode === 'upload' ? 'bg-primary text-primary-ink shadow-xs' : 'text-ink-3 hover:text-ink'
              }`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 9l5-5 5 5" /><path d="M12 4v12" />
              </svg>
              Upload photos
            </button>
          </div>
        </div>
      )}

      {errorMessage && (
        <div className="mb-6 rounded-xl border border-crit/30 bg-crit-soft p-4 text-sm text-crit-ink">
          {errorMessage}
        </div>
      )}

      {/* Ready View */}
      {step === 'ready' && mode === 'camera' && (
        <div className="rounded-2xl border border-line bg-panel p-10 text-center shadow-sm">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-accent-soft text-accent-ink">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
          </div>
          <h2 className="mt-5 text-[26px] font-bold tracking-[-0.02em]">About a minute, and you turn your head</h2>
          <p className="mx-auto mt-2.5 max-w-lg text-[14px] leading-relaxed text-ink-2">
            Face the camera, then turn left, back to centre, and right. Each shot fires on its own once you have
            turned far enough — and the button is always there if you would rather take it yourself.
          </p>
          <p className="mx-auto mt-3 max-w-lg text-[12.5px] leading-relaxed text-ink-3">
            Every shot is picked from about twenty frames: the sharpest one wins, so a moment of motion blur does not
            become the face every ad is built from.
          </p>
          <button
            onClick={() => startMedia('front')}
            className="mt-7 inline-flex items-center gap-2 rounded-xl bg-accent-strong px-8 py-3.5 text-[14px] font-semibold text-white shadow-md transition-transform hover:scale-[1.02] active:scale-[0.98]"
          >
            Start
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </button>
        </div>
      )}

      {/* Local Upload Mode */}
      {step === 'ready' && mode === 'upload' && (
        <div className="rounded-2xl border border-line bg-panel p-8 shadow-sm">
          <h2 className="text-xl font-bold">Upload 3-Angle Reference Photos</h2>
          <p className="mt-1 text-sm text-ink-3">Select your Front, Left Profile (~60°), and Right Profile (~60°) photos:</p>

          <div className="mt-6 grid grid-cols-3 gap-5">
            <div>
              <label className="flex aspect-square cursor-pointer flex-col items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-line-strong bg-subtle hover:border-accent">
                {capturedFrames.left ? (
                  <img src={capturedFrames.left} alt="Left" className="h-full w-full object-cover" />
                ) : (
                  <div className="text-center p-3">
                    <span className="text-2xl">👈</span>
                    <span className="mt-2 block text-xs font-semibold text-ink-2">Left Profile (~60°)</span>
                  </div>
                )}
                <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && handleFileUpload('left', e.target.files[0])} />
              </label>
            </div>

            <div>
              <label className="flex aspect-square cursor-pointer flex-col items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-accent bg-subtle hover:opacity-90">
                {capturedFrames.front ? (
                  <img src={capturedFrames.front} alt="Front" className="h-full w-full object-cover" />
                ) : (
                  <div className="text-center p-3">
                    <span className="text-2xl">👤</span>
                    <span className="mt-2 block text-xs font-semibold text-accent-ink">Front Face (Base)</span>
                  </div>
                )}
                <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && handleFileUpload('front', e.target.files[0])} />
              </label>
            </div>

            <div>
              <label className="flex aspect-square cursor-pointer flex-col items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-line-strong bg-subtle hover:border-accent">
                {capturedFrames.right ? (
                  <img src={capturedFrames.right} alt="Right" className="h-full w-full object-cover" />
                ) : (
                  <div className="text-center p-3">
                    <span className="text-2xl">👉</span>
                    <span className="mt-2 block text-xs font-semibold text-ink-2">Right Profile (~60°)</span>
                  </div>
                )}
                <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && handleFileUpload('right', e.target.files[0])} />
              </label>
            </div>
          </div>

          <div className="mt-6 rounded-xl border border-line bg-canvas p-4">
            <label className="flex cursor-pointer items-center justify-between">
              <div>
                <p className="text-xs font-bold text-ink">Audio Sample (Optional WAV / MP3)</p>
                {/* Said "For voice timbre cloning". The sample is stored but
                    nothing reads it — clips use a stock voice — so the claim
                    was for a feature that does not exist yet. */}
                <p className="text-xs text-ink-3">{audioUrl ? 'Sample recorded' : 'Optional — saved for voice matching later'}</p>
              </div>
              <span className="rounded-lg bg-subtle px-3 py-1.5 text-xs font-semibold text-ink-2 border border-line">
                {audioUrl ? 'Change File' : 'Choose Audio'}
              </span>
              <input type="file" accept="audio/*" className="hidden" onChange={(e) => e.target.files?.[0] && handleAudioUpload(e.target.files[0])} />
            </label>
            {audioUrl && <audio controls src={audioUrl} className="mt-3 h-8 w-full" />}
          </div>

          <div className="mt-6 flex justify-end">
            <button
              disabled={!capturedFrames.front || !capturedFrames.left || !capturedFrames.right}
              onClick={() => setStep('review')}
              className="rounded-xl bg-accent-strong px-8 py-3 text-sm font-semibold text-white shadow-sm disabled:opacity-40"
            >
              Next: Review & Save
            </button>
          </div>
        </div>
      )}

      {/* Camera Guided Experience with Automatic Angle Lock */}
      {(step === 'front' || step === 'left' || step === 'right' || step === 'audio') && (
        <div className="flex flex-col items-center">
          {/* Header Step Pill */}
          <div className="mb-4 text-center">
            <div className="flex items-center justify-center gap-3">
              <span className="rounded-chip bg-accent-soft px-4 py-1.5 text-xs font-bold text-accent-ink">
                {retakeTarget
                  ? `Retaking ${retakeTarget.toUpperCase()} Capture`
                  : step === 'front'
                  ? 'Step 1 / 4 • Base Front Face'
                  : step === 'left'
                  ? 'Step 2 / 4 • Turn Head Left (~60°)'
                  : step === 'right'
                  ? 'Step 3 / 4 • Turn Head Right (~60°)'
                  : 'Step 4 / 4 • Teleprompter Speech'}
              </span>
              {retakeTarget && (
                <button
                  onClick={cancelRetake}
                  className="rounded-chip border border-line bg-panel px-3 py-1 text-xs font-medium text-ink-3 hover:text-ink"
                >
                  Cancel & Back to Review
                </button>
              )}
            </div>

            <h3 className="mt-2 text-2xl font-bold tracking-tight">
              {step === 'front' && 'Look straight at camera — Click capture to begin'}
              {step === 'left' && 'Turn your head LEFT slowly — AI will auto-capture at 60°'}
              {step === 'right' && 'Turn your head RIGHT slowly — AI will auto-capture at 60°'}
              {step === 'audio' && 'Read the teleprompter text aloud clearly'}
            </h3>
          </div>

          {/* Interactive HUD Container */}
          <div className="relative aspect-video w-full max-w-2xl overflow-hidden rounded-2xl border border-line-strong bg-black shadow-2xl">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="h-full w-full object-cover [transform:scaleX(-1)]"
            />

            <CaptureHud
              step={step as 'front' | 'left' | 'right' | 'audio'}
              yaw={headYaw}
              locked={angleLocked}
              capturing={isCapturingBurst}
              burstProgress={burstProgress}
              audioLevel={audioLevel}
              retaking={!!retakeTarget}
            />
          </div>

          {/* Teleprompter Card during Step 4 */}
          {step === 'audio' && (
            <div className="mt-5 w-full max-w-2xl rounded-2xl border-2 border-accent/40 bg-panel p-5 shadow-lg">
              <div className="flex items-center justify-between border-b border-line pb-3">
                <span className="flex items-center gap-2 text-xs font-bold text-accent-ink">
                  <span className="h-2 w-2 rounded-full bg-accent animate-ping" />
                  TELEPROMPTER • READ OUT LOUD
                </span>
                <span className="text-xs text-ink-3">10s voice sample</span>
              </div>
              <p className="mt-4 text-base font-semibold leading-relaxed tracking-tight text-ink">
                &ldquo;{TELEPROMPTER_TEXT}&rdquo;
              </p>
              {isCapturingBurst && (
                <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-subtle">
                  <div
                    className="h-full bg-accent transition-all duration-100"
                    style={{ width: `${burstProgress}%` }}
                  />
                </div>
              )}
            </div>
          )}

          {/* Action Buttons (Auto-Mode + Manual Fallback) */}
          <div className="mt-6 flex items-center gap-4">
            {step === 'front' && (
              <button
                disabled={isCapturingBurst}
                onClick={() => startBurstSweep('front', 2000)}
                className="flex items-center gap-2 rounded-xl bg-accent-strong px-8 py-3 text-sm font-semibold text-white shadow-md hover:opacity-90 disabled:opacity-50"
              >
                Take the front shot
              </button>
            )}

            {step === 'left' && (
              <button
                disabled={isCapturingBurst}
                onClick={() => startBurstSweep('left', 2600)}
                className="flex items-center gap-2 rounded-xl border border-line bg-panel px-6 py-2.5 text-xs font-medium text-ink-3 hover:text-ink hover:bg-subtle disabled:opacity-50"
              >
                Or take it now
              </button>
            )}

            {step === 'right' && (
              <button
                disabled={isCapturingBurst}
                onClick={() => startBurstSweep('right', 2600)}
                className="flex items-center gap-2 rounded-xl border border-line bg-panel px-6 py-2.5 text-xs font-medium text-ink-3 hover:text-ink hover:bg-subtle disabled:opacity-50"
              >
                Or take it now
              </button>
            )}

            {step === 'audio' && (
              <button
                disabled={isCapturingBurst}
                onClick={startAudioRecording}
                className="flex items-center gap-2 rounded-xl bg-good px-8 py-3 text-sm font-semibold text-white shadow-md hover:opacity-90 disabled:opacity-50"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                </svg>
                {isCapturingBurst ? 'Recording Speech Sample…' : 'Start Reading Prompter'}
              </button>
            )}

            {/* The only transition out of this step was recorder.onstop, so a
                user who would not record simply could not finish enrolling —
                on a step the upload path itself calls optional and which
                nothing reads yet. */}
            {!isCapturingBurst && (
              <button
                type="button"
                onClick={() => {
                  stopMedia();
                  setStep('review');
                }}
                className="rounded-xl border border-line-strong px-6 py-3 text-sm font-semibold text-ink-2 hover:bg-subtle"
              >
                Skip — no voice sample
              </button>
            )}
          </div>
        </div>
      )}

      {/* Review Screen with Individual Hover Retake / Reset Overlays */}
      {step === 'review' && (
        <div className="rounded-2xl border border-line bg-panel p-8 shadow-sm">
          <div className="flex items-center justify-between border-b border-line pb-4">
            <div>
              <h3 className="text-[19px] font-bold tracking-[-0.01em]">Does this look like you?</h3>
              <p className="mt-1 text-[12.5px] text-ink-3">Hover any of them to retake that one on its own.</p>
            </div>
            <span className="rounded-chip bg-good-soft px-3 py-1 text-xs font-bold text-good-ink">
              {[capturedFrames.front, capturedFrames.left, capturedFrames.right].filter(Boolean).length} angles
              captured{audioUrl ? ' · voice sample saved' : ''}
            </span>
          </div>

          {/*
            One card, mapped three times.

            This was the same forty lines pasted three times with the angle
            swapped, which is how "Left Profile (~60°)" ended up asserting a
            measured angle in three places — a number the brightness heuristic
            behind the capture cannot actually measure.

            The front shot leads because it IS the base the others support, and
            each card reports what its burst chose: "sharpest of 14" is real
            information about the capture, and the reason to trust it.
          */}
          {turnWarning && (
            <div className="mt-5 rounded-card border border-warn/40 bg-warn-soft px-4 py-3">
              <p className="text-[13px] font-semibold text-warn-ink">These may be the same angle three times</p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">{turnWarning}</p>
            </div>
          )}

          <div className="mt-6 grid gap-5 sm:grid-cols-3">
            {([
              { key: 'left' as const, label: 'Left', hint: 'Turned away from the lens', input: fileInputLeftRef },
              { key: 'front' as const, label: 'Straight on', hint: 'The base every frame starts from', input: fileInputFrontRef },
              { key: 'right' as const, label: 'Right', hint: 'The other side', input: fileInputRightRef },
            ]).map(({ key, label, hint, input }) => {
              const src = capturedFrames[key];
              const stat = burstStats[key];
              const primary = key === 'front';
              return (
                <div
                  key={key}
                  className={`group relative overflow-hidden rounded-card bg-canvas ${
                    primary ? 'border-2 border-accent' : 'border border-line'
                  }`}
                >
                  {src ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={src}
                      alt={`${label} capture`}
                      className="h-48 w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-48 w-full items-center justify-center bg-subtle text-[12px] text-ink-4">
                      not captured
                    </div>
                  )}

                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 p-3 opacity-0 backdrop-blur-[2px] transition-opacity duration-200 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
                    <button
                      type="button"
                      onClick={() => handleRetake(key)}
                      className="rounded-lg bg-accent-strong px-3.5 py-1.5 text-[12.5px] font-semibold text-white active:scale-95"
                    >
                      Retake
                    </button>
                    <button
                      type="button"
                      onClick={() => input.current?.click()}
                      className="rounded-lg border border-white/35 bg-white/10 px-3.5 py-1.5 text-[12.5px] font-medium text-white hover:bg-white/20 active:scale-95"
                    >
                      Use a photo instead
                    </button>
                  </div>

                  <div className="px-2.5 py-2 text-center">
                    <p className="text-[12.5px] font-semibold">{label}</p>
                    <p className="mt-0.5 text-[11px] leading-snug text-ink-3">
                      {stat ? `Sharpest of ${stat.kept}` : hint}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Voice Sample Playback & Individual Hover/Action Bar */}
          {audioUrl && (
            <div className="group relative mt-6 flex items-center justify-between rounded-xl border border-line bg-subtle p-4 transition-colors hover:border-accent/50">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-soft text-accent-ink">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                    <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
                  </svg>
                </span>
                <div>
                  <p className="text-xs font-bold text-ink">Recorded Voice Profile</p>
                  <p className="text-xs text-ink-3">Clean 24kHz audio sample</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <audio controls src={audioUrl} className="h-9 max-w-[240px]" />
                <button
                  type="button"
                  onClick={() => handleRetake('audio')}
                  className="flex items-center gap-1 rounded-lg border border-line bg-panel px-3 py-1.5 text-xs font-semibold text-ink transition-colors hover:border-accent hover:text-accent-ink active:scale-95"
                >
                  Re-record
                </button>
                <button
                  type="button"
                  onClick={() => fileInputAudioRef.current?.click()}
                  className="flex items-center gap-1 rounded-lg border border-line bg-panel px-3 py-1.5 text-xs font-semibold text-ink-2 transition-colors hover:bg-subtle active:scale-95"
                >
                  Replace
                </button>
              </div>
            </div>
          )}

          {/* Avatar Name */}
          <div className="mt-6">
            <label className="block text-xs font-semibold text-ink-2">Avatar Name</label>
            <input
              type="text"
              value={avatarName}
              onChange={(e) => setAvatarName(e.target.value)}
              className="mt-1.5 w-full max-w-sm rounded-lg border border-line bg-canvas px-3.5 py-2 text-sm text-ink outline-none focus:border-accent"
              placeholder="e.g. Alex - Personal Avatar"
            />
          </div>

          {/* Actions */}
          <div className="mt-8 flex items-center gap-3">
            <button
              onClick={handleSaveAvatar}
              className="rounded-xl bg-primary px-8 py-3 text-sm font-semibold text-primary-ink shadow-sm hover:opacity-90 active:scale-95"
            >
              Confirm & Save to Identity Vault
            </button>
            <button
              onClick={() => {
                // Reset means reset, camera included — it stayed live after this.
                stopMedia();
                setCapturedFrames({ front: null, left: null, right: null });
                setAudioBlob(null);
                setAudioUrl(null);
                setRetakeTarget(null);
                setStep('ready');
              }}
              className="rounded-xl border border-line px-5 py-3 text-sm font-medium text-ink-2 hover:bg-subtle"
            >
              Reset All
            </button>
          </div>
        </div>
      )}

      {step === 'saving' && (
        <div className="rounded-2xl border border-line bg-panel p-12 text-center">
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-3 border-accent border-t-transparent" />
          <h3 className="mt-5 text-lg font-bold">Uploading & Extracting Features…</h3>
          {/* "Encrypting … to your private vault" described an encryption step
              that does not happen here. Storage is private and owner-only,
              which is the true and still-reassuring version. */}
          <p className="mt-1 text-xs text-ink-3">Uploading your captures to private storage only you can read</p>
        </div>
      )}

      {step === 'done' && (
        <div className="rounded-2xl border border-line bg-panel p-10 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-good-soft text-good-ink">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
              <path d="M20 6L9 17l-5-5" />
            </svg>
          </div>
          <h3 className="mt-4 text-2xl font-bold">Avatar Enrolled Successfully!</h3>
          <p className="mt-1.5 text-sm text-ink-3">
            Your captures are saved to your account. Every run from now on can use this face — you only do this once.
          </p>
          <div className="mt-7 flex justify-center gap-4">
            <a
              href="/studio"
              className="rounded-xl bg-accent-strong px-7 py-3 text-sm font-semibold text-white shadow-md hover:opacity-90"
            >
              Go to Studio & Create Ad
            </a>
          </div>
        </div>
      )}

      <AuthModal isOpen={authModalOpen} onClose={() => setAuthModalOpen(false)} />
    </div>
  );
}
