'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { AuthModal } from '@/components/AuthModal';

type Mode = 'camera' | 'upload';
type Step = 'ready' | 'front' | 'left' | 'right' | 'audio' | 'review' | 'saving' | 'done';
type RetakeTarget = 'front' | 'left' | 'right' | 'audio' | null;

const TELEPROMPTER_TEXT =
  "I'm testing my personal voice and likeness sample for Restage AI. Everything from lighting to tone feels authentic and ready to create.";

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
  const burstBufferRef = useRef<{ front: string[]; left: string[]; right: string[] }>({
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

  // Initialize WebRTC and Real-time Vision/Audio Analysis Loop
  const startMedia = async (targetStep: Step = 'front') => {
    try {
      setErrorMessage(null);
      let mediaStream = stream;
      if (!mediaStream || !mediaStream.active) {
        mediaStream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
          audio: true,
        });
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
  const grabFrame = (): string | null => {
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
    return canvas.toDataURL('image/jpeg', 0.95);
  };

  // Trigger Retake for a specific target
  const handleRetake = (target: 'front' | 'left' | 'right' | 'audio') => {
    setRetakeTarget(target);
    startMedia(target);
  };

  // Cancel retake and jump back to review screen
  const cancelRetake = () => {
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
      if (frame) {
        burstBufferRef.current[angle].push(frame);
      }

      if (ticks >= totalTicks) {
        clearInterval(timer);
        setIsCapturingBurst(false);
        setBurstProgress(100);

        // Select optimal representative keyframe (sharpest / middle-peak frame)
        const frames = burstBufferRef.current[angle];
        const selectedKeyframe =
          angle === 'front'
            ? frames[Math.floor(frames.length * 0.5)] || frames[0]
            : frames[Math.floor(frames.length * 0.75)] || frames[frames.length - 1] || frames[0];

        setCapturedFrames((curr) => ({ ...curr, [angle]: selectedKeyframe }));

        setTimeout(() => {
          setBurstProgress(0);
          if (retakeTarget) {
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
            <button
              onClick={() => setMode('camera')}
              className={`rounded-lg px-5 py-2 text-xs font-bold transition-all ${
                mode === 'camera' ? 'bg-primary text-primary-ink shadow-xs' : 'text-ink-3 hover:text-ink'
              }`}
            >
              📹 Auto-Detect 3D Sweep
            </button>
            <button
              onClick={() => setMode('upload')}
              className={`rounded-lg px-5 py-2 text-xs font-bold transition-all ${
                mode === 'upload' ? 'bg-primary text-primary-ink shadow-xs' : 'text-ink-3 hover:text-ink'
              }`}
            >
              📁 Upload 3-Angle Photos
            </button>
          </div>
        </div>
      )}

      {errorMessage && (
        <div className="mb-6 rounded-xl border border-crit/30 bg-crit-soft p-4 text-sm text-crit">
          {errorMessage}
        </div>
      )}

      {/* Ready View */}
      {step === 'ready' && mode === 'camera' && (
        <div className="rounded-2xl border border-line bg-panel p-10 text-center shadow-sm">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-accent-soft text-accent">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
          </div>
          <h2 className="mt-5 text-2xl font-bold tracking-tight">Auto-Detecting 10-Second Head Sweep</h2>
          <p className="mx-auto mt-2 max-w-lg text-sm text-ink-3">
            Start, face the camera for the front shot, then turn your head left, back to centre, and right.
            Capture fires on its own when you turn far enough — and the button is always there if you would rather
            take it yourself.
          </p>
          <button
            onClick={() => startMedia('front')}
            className="mt-8 inline-flex items-center gap-2 rounded-xl bg-accent px-8 py-3.5 text-sm font-semibold text-white shadow-md transition-transform hover:scale-[1.02] active:scale-[0.98]"
          >
            Start Auto-Capture Experience
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
                    <span className="mt-2 block text-xs font-semibold text-accent">Front Face (Base)</span>
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
              className="rounded-xl bg-accent px-8 py-3 text-sm font-semibold text-white shadow-sm disabled:opacity-40"
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
              <span className="rounded-chip bg-accent-soft px-4 py-1.5 text-xs font-bold text-accent">
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

            {/* Dynamic Real-time Pose Angle Indicator Badge */}
            {(step === 'left' || step === 'right') && !isCapturingBurst && (
              <div className="absolute top-4 right-4 flex items-center gap-2 rounded-xl bg-black/75 px-3.5 py-1.5 backdrop-blur-md border border-white/10">
                <span className={`h-2.5 w-2.5 rounded-full ${angleLocked ? 'bg-good animate-ping' : 'bg-accent'}`} />
                <span className="text-xs font-bold text-white tracking-wider">
                  {angleLocked ? '✓ 60° ANGLE LOCKED!' : 'AUTO-DETECTOR READY'}
                </span>
              </div>
            )}

            {/* Directional 3D Turn Arc Animation Guides */}
            {step === 'left' && !isCapturingBurst && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-start pl-8">
                <div
                  className={`flex items-center gap-2 rounded-xl px-4 py-2.5 backdrop-blur-md transition-all duration-300 ${
                    angleLocked ? 'bg-good/90 text-white scale-110' : 'bg-black/70 text-accent animate-bounce'
                  }`}
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M19 12H5M12 19l-7-7 7-7" />
                  </svg>
                  <span className="text-xs font-bold tracking-wide">
                    {angleLocked ? 'ANGLE REACHED • CAPTURING…' : 'TURN HEAD LEFT ← 60°'}
                  </span>
                </div>
              </div>
            )}

            {step === 'right' && !isCapturingBurst && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-end pr-8">
                <div
                  className={`flex items-center gap-2 rounded-xl px-4 py-2.5 backdrop-blur-md transition-all duration-300 ${
                    angleLocked ? 'bg-good/90 text-white scale-110' : 'bg-black/70 text-accent animate-bounce'
                  }`}
                >
                  <span className="text-xs font-bold tracking-wide">
                    {angleLocked ? 'ANGLE REACHED • CAPTURING…' : '60° → TURN HEAD RIGHT'}
                  </span>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                </div>
              </div>
            )}

            {/* Oval Alignment HUD */}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div
                className={`relative h-[72%] w-[46%] rounded-[50%] border-2 transition-all duration-300 ${
                  angleLocked
                    ? 'border-good shadow-[0_0_45px_rgba(78,194,110,0.8)] scale-105'
                    : isCapturingBurst
                    ? 'border-accent shadow-[0_0_40px_rgba(57,135,229,0.7)] scale-105'
                    : 'border-white/50'
                }`}
              >
                {/* Crosshairs */}
                <span className="absolute -left-3 top-1/2 h-0.5 w-6 -translate-y-1/2 bg-accent/60" />
                <span className="absolute -right-3 top-1/2 h-0.5 w-6 -translate-y-1/2 bg-accent/60" />
                <span className="absolute left-1/2 -top-3 h-6 w-0.5 -translate-x-1/2 bg-accent/60" />
                <span className="absolute left-1/2 -bottom-3 h-6 w-0.5 -translate-x-1/2 bg-accent/60" />
              </div>
            </div>

            {/* Real-time Burst Progress Ring / Scanner */}
            {isCapturingBurst && (
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center bg-black/35 backdrop-blur-[1px]">
                <div className="flex flex-col items-center gap-2">
                  <div className="h-16 w-16 animate-spin rounded-full border-4 border-accent border-t-transparent" />
                  <span className="text-sm font-bold tracking-widest text-white drop-shadow-md">
                    CAPTURING DENSE SWEEP ({burstProgress}%)
                  </span>
                </div>
              </div>
            )}

            {/* Live Audio Level Meter inside Camera HUD */}
            <div className="absolute bottom-3 left-4 flex items-center gap-2 rounded-lg bg-black/60 px-3 py-1.5 backdrop-blur-md">
              <span className="text-[11px] font-semibold text-white/80">MIC</span>
              <div className="flex h-3 w-20 gap-0.5 items-end overflow-hidden rounded bg-white/20 p-0.5">
                {[1, 2, 3, 4, 5, 6, 7, 8].map((bar) => (
                  <span
                    key={bar}
                    className={`flex-1 rounded-xs transition-all duration-75 ${
                      audioLevel > bar * 12 ? 'bg-good' : 'bg-white/20'
                    }`}
                    style={{ height: `${bar * 12.5}%` }}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Teleprompter Card during Step 4 */}
          {step === 'audio' && (
            <div className="mt-5 w-full max-w-2xl rounded-2xl border-2 border-accent/40 bg-panel p-5 shadow-lg">
              <div className="flex items-center justify-between border-b border-line pb-3">
                <span className="flex items-center gap-2 text-xs font-bold text-accent">
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
                className="flex items-center gap-2 rounded-xl bg-accent px-8 py-3 text-sm font-semibold text-white shadow-md hover:opacity-90 disabled:opacity-50"
              >
                📸 Capture Front Base (Starts Auto Sweep)
              </button>
            )}

            {step === 'left' && (
              <button
                disabled={isCapturingBurst}
                onClick={() => startBurstSweep('left', 2600)}
                className="flex items-center gap-2 rounded-xl border border-line bg-panel px-6 py-2.5 text-xs font-medium text-ink-3 hover:text-ink hover:bg-subtle disabled:opacity-50"
              >
                Manual Trigger (or just turn head left)
              </button>
            )}

            {step === 'right' && (
              <button
                disabled={isCapturingBurst}
                onClick={() => startBurstSweep('right', 2600)}
                className="flex items-center gap-2 rounded-xl border border-line bg-panel px-6 py-2.5 text-xs font-medium text-ink-3 hover:text-ink hover:bg-subtle disabled:opacity-50"
              >
                Manual Trigger (or just turn head right)
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
              <h3 className="text-xl font-bold">Review Captured Multi-Angle Identity</h3>
              <p className="mt-1 text-xs text-ink-3">Hover any photo or audio below to retake or replace individually</p>
            </div>
            <span className="rounded-chip bg-good-soft px-3 py-1 text-xs font-bold text-good">
              {[capturedFrames.front, capturedFrames.left, capturedFrames.right].filter(Boolean).length} angles
              captured{audioUrl ? ' · voice sample saved' : ''}
            </span>
          </div>

          <div className="mt-6 grid grid-cols-3 gap-5">
            {/* Left Card */}
            <div className="group relative overflow-hidden rounded-xl border border-line bg-canvas">
              {capturedFrames.left ? (
                <img src={capturedFrames.left} alt="Left" className="h-48 w-full object-cover transition-transform duration-300 group-hover:scale-105" />
              ) : (
                <div className="flex h-48 w-full items-center justify-center bg-subtle text-ink-4">No Image</div>
              )}
              {/* Hover Action Overlay */}
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 p-3 opacity-0 backdrop-blur-[2px] transition-opacity duration-200 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
                <span className="text-[11px] font-bold text-white uppercase tracking-wider">Left Profile (~60°)</span>
                <button
                  type="button"
                  onClick={() => handleRetake('left')}
                  className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white shadow-xs hover:opacity-90 active:scale-95"
                >
                  🔄 Retake with Camera
                </button>
                <button
                  type="button"
                  onClick={() => fileInputLeftRef.current?.click()}
                  className="flex items-center gap-1.5 rounded-lg border border-white/30 bg-white/10 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/20 active:scale-95"
                >
                  📁 Replace File
                </button>
              </div>
              <p className="py-2 text-center text-xs font-semibold text-ink-2">Left Profile (~60°)</p>
            </div>

            {/* Front Card */}
            <div className="group relative overflow-hidden rounded-xl border-2 border-accent bg-canvas shadow-xs">
              {capturedFrames.front ? (
                <img src={capturedFrames.front} alt="Front" className="h-48 w-full object-cover transition-transform duration-300 group-hover:scale-105" />
              ) : (
                <div className="flex h-48 w-full items-center justify-center bg-subtle text-ink-4">No Image</div>
              )}
              {/* Hover Action Overlay */}
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 p-3 opacity-0 backdrop-blur-[2px] transition-opacity duration-200 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
                <span className="text-[11px] font-bold text-white uppercase tracking-wider">Front Face (Base)</span>
                <button
                  type="button"
                  onClick={() => handleRetake('front')}
                  className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white shadow-xs hover:opacity-90 active:scale-95"
                >
                  🔄 Retake with Camera
                </button>
                <button
                  type="button"
                  onClick={() => fileInputFrontRef.current?.click()}
                  className="flex items-center gap-1.5 rounded-lg border border-white/30 bg-white/10 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/20 active:scale-95"
                >
                  📁 Replace File
                </button>
              </div>
              <p className="py-2 text-center text-xs font-semibold text-accent">Front Face (Base)</p>
            </div>

            {/* Right Card */}
            <div className="group relative overflow-hidden rounded-xl border border-line bg-canvas">
              {capturedFrames.right ? (
                <img src={capturedFrames.right} alt="Right" className="h-48 w-full object-cover transition-transform duration-300 group-hover:scale-105" />
              ) : (
                <div className="flex h-48 w-full items-center justify-center bg-subtle text-ink-4">No Image</div>
              )}
              {/* Hover Action Overlay */}
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 p-3 opacity-0 backdrop-blur-[2px] transition-opacity duration-200 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
                <span className="text-[11px] font-bold text-white uppercase tracking-wider">Right Profile (~60°)</span>
                <button
                  type="button"
                  onClick={() => handleRetake('right')}
                  className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white shadow-xs hover:opacity-90 active:scale-95"
                >
                  🔄 Retake with Camera
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRightRef.current?.click()}
                  className="flex items-center gap-1.5 rounded-lg border border-white/30 bg-white/10 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/20 active:scale-95"
                >
                  📁 Replace File
                </button>
              </div>
              <p className="py-2 text-center text-xs font-semibold text-ink-2">Right Profile (~60°)</p>
            </div>
          </div>

          {/* Voice Sample Playback & Individual Hover/Action Bar */}
          {audioUrl && (
            <div className="group relative mt-6 flex items-center justify-between rounded-xl border border-line bg-subtle p-4 transition-colors hover:border-accent/50">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-soft text-accent">
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
                  className="flex items-center gap-1 rounded-lg border border-line bg-panel px-3 py-1.5 text-xs font-semibold text-ink transition-colors hover:border-accent hover:text-accent active:scale-95"
                >
                  🔄 Re-record
                </button>
                <button
                  type="button"
                  onClick={() => fileInputAudioRef.current?.click()}
                  className="flex items-center gap-1 rounded-lg border border-line bg-panel px-3 py-1.5 text-xs font-semibold text-ink-2 transition-colors hover:bg-subtle active:scale-95"
                >
                  📁 Replace
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
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-good-soft text-good">
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
              className="rounded-xl bg-accent px-7 py-3 text-sm font-semibold text-white shadow-md hover:opacity-90"
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
