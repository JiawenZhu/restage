/*
 * Text contrast measurement, run in the page.
 *
 * Three iterations to become trustworthy, and each failure mode produced
 * confident wrong answers rather than obvious errors:
 *
 *   1. String-parsing colours broke on oklab() and color-mix().  → canvas
 *   2. `transition-colors` meant getComputedStyle during a theme flip returned
 *      the INTERPOLATED colour, so transitioning elements read as the previous
 *      theme.                                                     → disable them
 *   3. Walking up for a background missed scrims that are SIBLINGS, and then
 *      only looking behind missed an element's OWN fill.          → both, in order
 *
 * Text over an image is reported separately rather than scored: its legibility
 * depends on pixels, and guessing produces exactly the false alarms above.
 */
(async () => {
  const kill = document.createElement('style');
  kill.textContent = '*,*::before,*::after{transition:none!important;animation:none!important}';
  document.head.appendChild(kill);

  const cvs = document.createElement('canvas'); cvs.width = cvs.height = 1;
  const ctx = cvs.getContext('2d', { willReadFrequently: true });
  const toRGB = (c) => { ctx.clearRect(0,0,1,1); ctx.fillStyle='#000'; ctx.fillStyle=c; ctx.fillRect(0,0,1,1); const d=ctx.getImageData(0,0,1,1).data; return [d[0],d[1],d[2],d[3]/255]; };
  const lum = (c) => { const [r,g,b]=toRGB(c).slice(0,3).map(v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)}); return 0.2126*r+0.7152*g+0.0722*b; };
  const R = (a,b) => { const L1=lum(a),L2=lum(b); return Math.round(((Math.max(L1,L2)+0.05)/(Math.min(L1,L2)+0.05))*100)/100; };

  const groundOf = (el) => {
    const own = getComputedStyle(el).backgroundColor;
    if (toRGB(own)[3] > 0.5) return own;                       // its own fill wins
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    const x = Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2));
    const y = Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2));
    /*
     * Walk the actual paint stack behind this text. The first thing that paints
     * an opaque colour is the ground; the first thing that paints an IMAGE is a
     * refusal to guess. An earlier version skipped anything whose ancestors
     * merely CONTAINED an <img>, which on a page with a gallery meant skipping
     * almost everything — and then reporting zero failures, which is worse than
     * reporting wrong ones.
     */
    const stack = document.elementsFromPoint(x, y);
    const i = stack.indexOf(el);
    /*
     * If the element is not in the stack at its own centre, something is over
     * it — a decorative overlay, or the point fell in a gap. Earlier this fell
     * back to scanning from the TOP of the stack, which handed back whatever
     * happened to be in front and produced 1.03:1 readings on perfectly legible
     * headings. There is no answer here, so it says so.
     */
    if (i < 0) return null;
    for (const n of stack.slice(i + 1)) {
      if (n.tagName === 'IMG' || n.tagName === 'VIDEO' || n.tagName === 'CANVAS') return null;
      const cs = getComputedStyle(n);
      if (cs.backgroundImage !== 'none') return null;
      if (toRGB(cs.backgroundColor)[3] > 0.5) return cs.backgroundColor;
    }
    return null;
  };

  const scan = () => {
    const fails = [];
    let skippedOverMedia = 0;
    for (const e of document.querySelectorAll('p,h1,h2,h3,h4,li,span,dd,dt,label,a,button')) {
      if (e.children.length || e.textContent.trim().length < 6 || !e.offsetHeight) continue;
      const g = groundOf(e);
      if (!g) { skippedOverMedia++; continue; }   // over media, or nothing opaque behind it
      const cs = getComputedStyle(e); const px = parseFloat(cs.fontSize);
      const need = (px >= 24 || (px >= 18.66 && parseInt(cs.fontWeight) >= 700)) ? 3 : 4.5;
      const r = R(g, cs.color);
      if (r < need) fails.push({ t: e.textContent.trim().slice(0, 30), r, px: Math.round(px), need });
    }
    return { fails, skippedOverMedia };
  };

  const out = {};
  for (const th of ['light', 'dark']) {
    document.documentElement.setAttribute('data-theme', th);
    void document.documentElement.offsetHeight;
    await new Promise((r) => setTimeout(r, 80));
    out[th] = scan();
  }
  document.documentElement.setAttribute('data-theme', 'light');
  kill.remove();
  return out;
})()
