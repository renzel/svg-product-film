# Camera and layer moves

Working code for the moves that make a film look authored rather than recorded.
All of it assumes the page layout in SKILL.md: a `.win` element with
`transform-style: preserve-3d`, containing a clipped `.vp` with the `<svg>` in it
and an unclipped `.lifts` sibling.

## Contents

- [Finding and measuring a layer](#finding-and-measuring-a-layer)
- [The camera (zoom that stays sharp)](#the-camera)
- [Tilting a window in 3D](#tilting-a-window-in-3d)
- [Lifting a layer out of its window](#lifting-a-layer-out-of-its-window)
- [Streaming text in](#streaming-text-in)
- [Reveal wipes](#reveal-wipes)
- [Counters](#counters)
- [Easing and windows](#easing-and-windows)

---

## Finding and measuring a layer

Scope every lookup to its screen root. Figma reuses names across files — three
exports will all contain a layer called `Planloom` — and `getElementById` returns
the first match in the whole document, which may belong to another screen.

```js
function L(screen, name) {
  const root = document.getElementById('svg-' + screen);
  const sel = '[id="' + String(name).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"]';
  return root ? root.querySelector(sel) : null;
}
```

Names containing `(`, `)`, `:`, `+`, `&` are fine inside a quoted attribute
selector. Record misses in an array the renderer can read, so a rename after a
redesign is reported rather than silently dropping a beat.

Measure in the SVG's own user space, not screen pixels. `getBBox()` is local to
the element, so compose it with the matrix from the element up to the root —
that survives any transforms Figma nested in between:

```js
function bbox(screen, name) {
  const el = L(screen, name), svg = document.getElementById('svg-' + screen);
  const b = el.getBBox();
  const m = svg.getScreenCTM().inverse().multiply(el.getScreenCTM());
  const pt = (x, y) => { const p = svg.createSVGPoint(); p.x = x; p.y = y; return p.matrixTransform(m); };
  const cs = [pt(b.x, b.y), pt(b.x + b.width, b.y), pt(b.x, b.y + b.height), pt(b.x + b.width, b.y + b.height)];
  const xs = cs.map(c => c.x), ys = cs.map(c => c.y);
  const x0 = Math.min(...xs), y0 = Math.min(...ys);
  return { x: x0, y: y0, w: Math.max(...xs) - x0, h: Math.max(...ys) - y0 };
}
```

Cache these once, after fonts load and before anything is hidden. An element with
`display: none` measures as zero.

---

## The camera

**Drive the `viewBox`, never a CSS `scale`.** A CSS transform rasterises the
element once and then scales the bitmap, so a 3× push-in gives you 3× soft text.
Rewriting `viewBox` makes Chrome re-run the vector rasteriser at the new scale, so
8-point type stays as crisp at 4× as it was at 1×. This is the single thing a
screen recording cannot do, and it is one line of code.

```js
// visible rect is baseW/zoom wide, centred on (cx, cy), at the viewport's aspect
function applyCam(screen, cam) {
  const st = S[screen];                       // { svg, baseW, baseH }
  const vw = st.baseW / cam.z, vh = vw / ASPECT;
  st.curVB = `${cam.cx - vw / 2} ${cam.cy - vh / 2} ${vw} ${vh}`;
  st.svg.setAttribute('viewBox', st.curVB);
}
```

Keep the `<svg>` element's aspect equal to the viewBox aspect you generate, or
`preserveAspectRatio` letterboxes and the framing drifts.

**Interpolate zoom geometrically.** Linear interpolation of a zoom factor races at
the start and crawls at the end:

```js
const camMix = (a, b, x) => ({
  cx: a.cx + (b.cx - a.cx) * x,
  cy: a.cy + (b.cy - a.cy) * x,
  z: Math.exp(Math.log(a.z) + (Math.log(b.z) - Math.log(a.z)) * x),
});
```

Chain them so each beat layers onto the last; each `win()` is 0 before its beat
and 1 after, so only the active one is moving:

```js
let cam = HOME;
cam = camMix(cam, STATS,  win(t, T.statsZoom));
cam = camMix(cam, HOME,   win(t, T.statsOut));
cam = camMix(cam, DETAIL, win(t, T.detailZoom));
```

**Build cameras from layer boxes, and clamp to the artboard** so a push-in near an
edge never reveals blank canvas:

```js
function camFor(screen, box, pad = 0.14) {
  const st = S[screen];
  const w = box.w * (1 + pad * 2), h = box.h * (1 + pad * 2);
  const z = Math.max(Math.min(st.baseW / w, (st.baseW / ASPECT) / h), 0.4);
  const vw = st.baseW / z, vh = vw / ASPECT;
  let cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  if (vw < st.baseW) cx = clamp(cx, vw / 2, st.baseW - vw / 2);
  if (vh < st.baseH) cy = clamp(cy, vh / 2, st.baseH - vh / 2);
  return { cx, cy, z };
}
```

**Pick targets that are actually tight.** A 16:9 camera fitting a wide, short
region is limited by width, so a full-width stats row yields about 1.3× — a zoom
nobody notices. Frame two cards instead of six and you get 3.6×, which reads as a
move. If the natural target is tall and narrow (a sidebar), the frame will pull in
horizontal context; choose an explicit rect anchored to the layer's box rather
than fighting it:

```js
const sb = bbox('kanban', 'Aside - AI Assistant Sidebar');
CAM.panel = camFor('kanban', { x: sb.x - 930, y: sb.y + 380, w: sb.w + 950, h: 707 }, 0);
```

---

## Tilting a window in 3D

```css
#stage { perspective: 2200px; perspective-origin: 50% 46%; transform-style: preserve-3d; }
.win   { transform-style: preserve-3d; backface-visibility: hidden; will-change: transform, opacity; }
```

```js
el.style.transform =
  `translate3d(${x}px,${y}px,${z}px) rotateX(${rx}deg) rotateY(${ry}deg) scale(${s})`;
```

Three things that make it look intentional rather than like a slide transition:

- **Settle, don't hold.** Arrive at `rotateY 42°, rotateX 16°, translateZ -1150` and
  ease to flat over ~2.5 s with a quintic. A tilt held flat for seconds reads as a
  static mockup.
- **Keep a drift.** After settling, add `Math.sin((t - t0) * 0.42) * 0.7` degrees.
  A perfectly still plate looks like a dead frame; under a degree of motion reads
  as alive without being noticed.
- **React to events.** When something lifts off the surface, lean the window back a
  few degrees (`ry -8, rx +4, z -110`) as if making room. This is what sells the
  lift more than the lift itself.

Set `display: none` when a window's opacity reaches zero. Three full app SVGs is a
lot of DOM, and hiding the off-screen ones roughly doubles render throughput.

---

## Lifting a layer out of its window

The illusion needs the clone to live *in the window's 3D space* but *outside the
clipped viewport*. Then `translateZ` genuinely carries it off the surface, through
the window's edge, with correct perspective — not a sprite sliding over a picture.

```html
<div class="win" id="win-board">
  <div class="vp"><svg id="svg-board" viewBox="...">…</svg></div>   <!-- overflow: hidden -->
  <div class="lifts"></div>                                          <!-- overflow: visible -->
</div>
```

```css
.vp      { overflow: hidden; }
.lifts   { position: absolute; inset-block-start: 40px; width: 1632px; height: 918px;
           transform-style: preserve-3d; overflow: visible; pointer-events: none; }
.liftsvg { position: absolute; top: 0; left: 0; width: 1632px; height: 918px;
           overflow: visible; will-change: transform, filter; }
```

```js
function liftNode(screen, name) {
  const src = L(screen, name);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'liftsvg');
  svg.setAttribute('fill', 'none');     // see pitfalls.md — without this it paints black
  svg.appendChild(src.cloneNode(true));
  document.querySelector('#win-' + screen + ' .lifts').appendChild(svg);
  return { svg, src };
}

function lift(screen, name, a, opt = {}) {          // a: 0 flat … 1 fully lifted
  const rec = liftNode(screen, name);
  rec.svg.style.display = a > 0.0005 ? '' : 'none';
  rec.src.style.opacity = a > 0.0005 ? String(1 + (0.10 - 1) * Math.min(a * 2.2, 1)) : '';
  if (a <= 0.0005) return;
  rec.svg.setAttribute('viewBox', S[screen].curVB);  // track the live camera
  const sh = 26 * a;
  rec.svg.style.transform =
    `translate3d(${mix(0, opt.dx || 0, a)}px,${mix(0, opt.dy || 0, a)}px,${mix(0, opt.z ?? 170, a)}px) ` +
    `rotateY(${mix(0, opt.ry || 0, a)}deg) scale(${mix(1, opt.s ?? 1.05, a)})`;
  rec.svg.style.filter =
    `drop-shadow(0 ${sh * 0.9}px ${sh * 1.6}px rgba(8,12,34,${0.34 * a})) ` +
    `drop-shadow(0 ${sh * 0.22}px ${sh * 0.5}px rgba(8,12,34,${0.24 * a}))`;
}
```

Notes that matter:

- **Re-sync the clone's `viewBox` every frame** to the live camera, or the clone
  drifts out of register with the original beneath it the moment the camera moves.
- **Don't clone `<defs>`.** `url(#grad1)` inside the clone resolves to the original
  definition already in the document. Copying defs duplicates a hundred nodes per
  lift for no benefit.
- **Ghost the original** to ~10% rather than hiding it. The empty socket is what
  tells the eye the thing came from somewhere.
- **Two stacked drop-shadows** — one wide and soft, one tight and dark — read as
  real elevation; a single shadow reads as a sticker.
- A tall panel lifting near the frame edge will crop. Pull the camera back *before*
  the lift rather than fighting it with offsets.

---

## Streaming text in

Write into the real `<text>`/`<tspan>` node and measure the caret off the live
glyph run, so it tracks the actual font:

```js
function streamOne(el, text, prog, opt = {}) {
  const sp = el.querySelector('tspan') || el;
  sp.textContent = text.slice(0, Math.round(clamp(prog, 0, 1) * text.length));
  if (opt.fill) el.setAttribute('fill', opt.fill);

  // find the caret in the DOM rather than caching a handle — a clone may carry one
  const carets = el.parentNode.querySelectorAll('rect[data-caret]');
  for (let i = 1; i < carets.length; i++) carets[i].remove();
  let caret = carets[0];
  if (!caret) {
    caret = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    caret.setAttribute('data-caret', '1');
    caret.setAttribute('fill', opt.caretFill || '#4F46E5');
    el.parentNode.insertBefore(caret, el.nextSibling);
  }
  const show = prog > 0 && prog < 1.1;
  caret.style.display = show ? '' : 'none';
  if (!show) return;
  const x0 = +sp.getAttribute('x'), y0 = +sp.getAttribute('y');
  const fs = parseFloat(el.getAttribute('font-size') || getComputedStyle(el).fontSize) || 14;
  caret.setAttribute('x', x0 + el.getComputedTextLength() + 1.5);
  caret.setAttribute('y', y0 - fs * 0.80);
  caret.setAttribute('width', 1.8);
  caret.setAttribute('height', fs * 1.05);
}
```

If the layer being typed into is also lifted, it exists twice and both copies need
the text, or the floating one keeps showing the stale placeholder:

```js
function instances(screen, name) {
  const el = L(screen, name), out = [el];
  for (const rec of Object.values(lifts)) {
    const c = rec?.svg?.querySelector(`[id="${name}"]`);
    if (c && c !== el) out.push(c);
  }
  return out;
}
```

Simpler still: don't lift the thing you are typing into. If the camera framing
already makes the text legible, the lift adds a synchronisation problem and buys
little. Legibility floor is about 18 px of cap height in a 1080p frame.

For HTML headlines, stream characters the same way and keep a block caret that
disappears on the last character. Pair them with a scrim whose opacity follows the
strongest active headline, so type stays readable over a bright UI:

```css
#hlscrim { position: absolute; inset-inline: 0; bottom: 0; height: 420px;
           background: linear-gradient(to top, rgba(4,6,20,.94), rgba(4,6,20,0)); }
```

---

## Reveal wipes

For progress bars, Gantt bars, anything that should draw on: inject a `clipPath`
rect and animate its width. Don't use `scaleX` — it squashes the label and the
rounded end cap inside the group.

```js
function reveal(screen, name, prog) {
  let r = revs[screen + name];
  if (!r) {
    const b = bbox(screen, name), svg = S[screen].svg;
    const NS = 'http://www.w3.org/2000/svg';
    let defs = svg.querySelector('defs') ||
               svg.insertBefore(document.createElementNS(NS, 'defs'), svg.firstChild);
    const cp = document.createElementNS(NS, 'clipPath');
    const id = '__reveal_' + (revN++);
    cp.setAttribute('id', id);
    cp.setAttribute('clipPathUnits', 'userSpaceOnUse');
    const rect = document.createElementNS(NS, 'rect');
    rect.setAttribute('x', b.x - 4); rect.setAttribute('y', b.y - 10);
    rect.setAttribute('height', b.h + 20); rect.setAttribute('width', 0);
    cp.appendChild(rect); defs.appendChild(cp);
    L(screen, name).setAttribute('clip-path', `url(#${id})`);
    r = revs[screen + name] = { rect, w: b.w + 10 };
  }
  r.rect.setAttribute('width', (r.w * clamp(prog, 0, 1)).toFixed(2));
}
```

---

## Counters

Read the target out of the SVG rather than hard-coding it, so a design change to
"128" carries through on the next render:

```js
function countTo(screen, name, prog) {
  const el = L(screen, name), sp = el.querySelector('tspan') || el;
  el.__target ??= parseFloat(String(sp.textContent).replace(/[^0-9.]/g, '')) || 0;
  sp.textContent = String(Math.round(el.__target * easeOutExpo(clamp(prog, 0, 1))));
}
```

Run the count during the arrival, not during the later close-up. If the numbers
are already correct when the camera pushes in, the close-up can simply read them;
resetting to zero at second four looks like a bug.

---

## Easing and windows

```js
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const p01 = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
const mix = (a, b, x) => a + (b - a) * x;
const E = {
  quint: x => 1 - Math.pow(1 - x, 5),                      // arrivals
  expo:  x => x >= 1 ? 1 : 1 - Math.pow(2, -10 * x),       // counters
  cubic: x => x < .5 ? 4*x*x*x : 1 - Math.pow(-2*x + 2, 3)/2,  // camera
  back:  x => { const c = 1.70158, d = c + 1;              // cards settling
                return 1 + d*Math.pow(x-1,3) + c*Math.pow(x-1,2); },
};
const win = (t, w, e = 'cubic') => E[e](p01(t, w[0], w[1]));
```

Stagger with a per-index offset rather than separate timeline entries:

```js
COLUMNS.forEach((n, i) => {
  const q = p01(t, 0.30 + i * 0.11, 1.05 + i * 0.11);
  tf(screen, n, { y: mix(46, 0, E.back(q)), o: q });
});
```
