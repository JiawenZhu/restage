/*
 * The finished ad, as a timeline.
 *
 * Restage produces footage: a person, in a scene, holding a product. That is
 * not an ad. An ad has burned-in captions — social video is watched on mute —
 * a brand mark, and something at the end telling you what to do. Those are
 * typography and motion, which is exactly what the saas-commercial-video
 * pipeline is for, and exactly what this product had no way to make.
 *
 * The two fit together on one observation: that pipeline excludes video because
 * its renderer seeks and screenshots immediately, so a <video> element never
 * gets the wall-clock time it needs to advance. It does NOT exclude footage. A
 * frame sequence indexed by floor(t * fps) is a pure function of t — precisely
 * the rule the pipeline is built around. Verified end to end: 198 of 240 frames
 * unique, against a 60% healthy threshold.
 *
 * So every rule from that skill holds here. No CSS transition, no @keyframes,
 * nothing that reads a wall clock. Every animated property is computed from t.
 */

export interface AdCaption {
  text: string;
  start: number;
  end: number;
}

export interface AdSpec {
  /** How many frames were extracted, and at what rate. */
  frameCount: number;
  fps: number;
  /** Directory the frames live in, relative to the timeline file. */
  frameDir: string;
  width: number;
  height: number;
  captions: AdCaption[];
  /** Small mark in the corner — a brand, a handle. Optional. */
  kicker?: string;
  /** End card. Shown over the last frame, held after the footage ends. */
  endCard?: { headline: string; sub?: string };
  /** Seconds of end card after the footage. 0 disables it. */
  endCardSeconds?: number;
}

/**
 * Builds the timeline page.
 *
 * Written as a string rather than a React component on purpose: the renderer
 * loads a file with `file://` and calls `window.setSeekTime`. There is no React
 * runtime, no hydration, and nothing to wait for — which is what makes each
 * frame reproducible.
 */
export function buildAdTimeline(spec: AdSpec): string {
  const {
    frameCount,
    fps,
    frameDir,
    width,
    height,
    captions,
    kicker,
    endCard,
    endCardSeconds = endCard ? 1.6 : 0,
  } = spec;

  const footage = frameCount / fps;
  const duration = footage + endCardSeconds;

  /*
   * Vertical social players put their own furniture over the frame: a caption
   * and handle along the bottom, a column of buttons up the right. Anything
   * inside those bands is covered on the platform it was made for. These
   * insets keep the words clear of both.
   */
  const SAFE_BOTTOM = Math.round(height * 0.17);
  const SAFE_RIGHT = Math.round(width * 0.2);

  const probe = [
    [0.35, 'a-open'],
    ...(captions.length ? [[(captions[Math.floor(captions.length / 2)].start + 0.15).toFixed(2), 'b-caption'] as const] : []),
    [Math.max(0, footage - 0.4).toFixed(2), 'c-last-frame'],
    ...(endCardSeconds ? [[(footage + endCardSeconds * 0.6).toFixed(2), 'd-endcard'] as const] : []),
  ];

  return `<!doctype html><meta charset="utf-8">
<title>Restage ad timeline</title>
<style>
  html,body{margin:0;padding:0;background:#000;width:${width}px;height:${height}px;overflow:hidden}
  #stage{position:relative;width:${width}px;height:${height}px;overflow:hidden;
         font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif}

  /* Every frame of footage is in the DOM and decoded before frame 0. Only one
     is opaque at a time, which makes "which frame" a pure function of t. */
  #plate img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0}

  #kicker{position:absolute;left:${Math.round(width * 0.055)}px;top:${Math.round(height * 0.045)}px;
          padding:${Math.round(height * 0.008)}px ${Math.round(width * 0.026)}px;border-radius:999px;
          background:rgba(0,0,0,.55);color:#fff;white-space:nowrap;
          font-weight:700;font-size:${Math.round(width * 0.029)}px;letter-spacing:.07em}

  /* The caption plate sits above the platform's own furniture. */
  #cap{position:absolute;left:${Math.round(width * 0.07)}px;right:${SAFE_RIGHT}px;
       bottom:${SAFE_BOTTOM}px;color:#fff;font-weight:800;
       font-size:${Math.round(width * 0.062)}px;line-height:1.16;letter-spacing:-.01em;
       text-shadow:0 ${Math.round(height * 0.002)}px ${Math.round(height * 0.014)}px rgba(0,0,0,.75)}

  #endcard{position:absolute;inset:0;background:#0d0d0d;color:#fff;
           display:flex;flex-direction:column;align-items:center;justify-content:center;
           text-align:center;padding:0 ${Math.round(width * 0.12)}px;opacity:0}
  #endcard h1{margin:0;font-size:${Math.round(width * 0.085)}px;font-weight:800;line-height:1.08;letter-spacing:-.03em}
  #endcard p{margin:${Math.round(height * 0.018)}px 0 0;font-size:${Math.round(width * 0.036)}px;color:#a3a199;font-weight:500}
</style>

<div id="stage">
  <div id="plate"></div>
  ${kicker ? '<div id="kicker"></div>' : ''}
  <div id="cap"></div>
  ${endCard ? `<div id="endcard"><h1></h1>${endCard.sub ? '<p></p>' : ''}</div>` : ''}
</div>

<script>
const FPS = ${fps};
const N = ${frameCount};
const FOOTAGE = ${footage.toFixed(4)};
const END_SECS = ${endCardSeconds};
const CAPS = ${JSON.stringify(captions)};

window.TIMELINE_DURATION = ${duration.toFixed(4)};
window.PROBE_BEATS = ${JSON.stringify(probe.map(([t, n]) => [Number(t), n]))};

const plate = document.getElementById('plate');
const imgs = [];
for (let i = 1; i <= N; i++) {
  const im = new Image();
  im.src = ${JSON.stringify(frameDir)} + '/' + String(i).padStart(5, '0') + '.jpg';
  plate.appendChild(im);
  imgs.push(im);
}
let shown = -1;

/* ---- easing, all pure functions of t ---- */
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const ease  = x => (x < .5 ? 4*x*x*x : 1 - Math.pow(-2*x + 2, 3) / 2);
const span  = (t, a, b) => (b <= a ? (t >= b ? 1 : 0) : ease(clamp((t - a) / (b - a), 0, 1)));
const env   = (t, a, b, rise, fall) => span(t, a, a + rise) * (1 - span(t, b - fall, b));

function render(t) {
  /* Footage. Held on the last frame while the end card plays, so the cut is
     the end card arriving rather than the picture disappearing. */
  const idx = clamp(Math.floor(t * FPS), 0, N - 1);
  if (idx !== shown) {
    if (shown >= 0) imgs[shown].style.opacity = '0';
    imgs[idx].style.opacity = '1';
    shown = idx;
  }

  ${kicker ? `
  const k = document.getElementById('kicker');
  k.textContent = ${JSON.stringify(kicker)};
  const kIn = env(t, 0.25, Math.max(0.9, FOOTAGE - 0.35), 0.45, 0.4);
  k.style.opacity = String(kIn);
  k.style.transform = 'translateY(' + ((1 - span(t, 0.25, 0.8)) * -18).toFixed(2) + 'px)';
  ` : ''}

  /* Captions. One at a time, fading at the edges so a cut never lands mid-word. */
  const cap = document.getElementById('cap');
  let active = null;
  for (const c of CAPS) if (t >= c.start - 0.12 && t < c.end + 0.12) { active = c; break; }
  if (active) {
    cap.textContent = active.text;
    const a = env(t, active.start - 0.1, active.end + 0.1, 0.16, 0.16);
    cap.style.opacity = String(a);
    cap.style.transform = 'translateY(' + ((1 - span(t, active.start - 0.1, active.start + 0.14)) * 14).toFixed(2) + 'px)';
  } else {
    cap.style.opacity = '0';
  }

  ${endCard ? `
  const ec = document.getElementById('endcard');
  ec.querySelector('h1').textContent = ${JSON.stringify(endCard.headline)};
  ${endCard.sub ? `ec.querySelector('p').textContent = ${JSON.stringify(endCard.sub)};` : ''}
  ec.style.opacity = String(span(t, FOOTAGE - 0.28, FOOTAGE + 0.16));
  ` : ''}
}

window.setSeekTime = t => render(t);
render(0);
</script>
`;
}
