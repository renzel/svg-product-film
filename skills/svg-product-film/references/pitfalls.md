# Things that go wrong

Each of these cost real debugging time. They are ordered by how long they take to
diagnose if you do not already know about them.

---

## A cloned `<svg>` paints everything black

**Symptom:** you lift a white card out of a window and the clone renders as a black
rectangle with ghostly light text, while accent colours (badges, avatars, progress
fills) survive intact.

**Cause:** Figma writes `fill="none"` on the root `<svg>` and relies on inheritance.
Every shape that has no explicit `fill` inherits it. A fresh `<svg>` you create for
the clone has no `fill` attribute, so the SVG default — solid black — inherits
instead. Elements with explicit fills are unaffected, which is why the colours look
selectively wrong and sends you hunting for a blend mode or a filter bug.

**Fix:**

```js
svg.setAttribute('fill', 'none');
```

More generally: when you synthesise a container for cloned Figma content, carry
over the presentation attributes from the source root, not just `viewBox`.

---

## Inlining several exports into one document

Three screens in one page means three sets of ids in one document, and `url(#x)`
resolves to the **first** match in document order.

Check before you commit to the approach — collisions among *referenced* ids
(clip paths, filters, masks, gradients) are the dangerous ones. Figma usually
numbers them per export (`clip0_1`, `filter0_d_1`), so collisions are common across
files from different Figma documents and rare across frames in one document.
`scripts/inspect-svg.mjs` reports this.

- **No collisions:** inline freely. Scope every lookup with
  `root.querySelector('[id="…"]')`, never `getElementById`, because *human* layer
  names like `Planloom` or `Container_5` will collide and `getElementById` returns
  whichever came first.
- **Collisions:** prefix the referenced ids and rewrite their `url(#…)`,
  `mask=`, `clip-path=`, `filter=` and `href=` references. Leave human layer names
  alone — those are your animation interface.

---

## A CSS `scale` zoom looks soft

`transform: scale(3)` rasterises the element once and scales the bitmap. Text goes
mushy exactly when you are drawing attention to it. Animate the `viewBox` instead —
see `moves.md`. This is the whole reason a vector pipeline beats a screen capture,
and it is easy to throw away by reflex.

---

## The screen looks broken for the first two seconds

Staggering every element in from nothing is the obvious way to make an entrance,
and it produces several hundred frames of a mostly empty product. Nobody wants
their app to look unfinished in the opening shot.

Let the screen arrive **populated**. Put the content stagger inside the window's
fly-in (roughly 0.3–1.6 s, overlapping) so it is complete by the time the window is
legible, and use later beats to *emphasise* — a pulse, a highlight, a camera move —
rather than to construct. Run counters during the arrival too, so a later close-up
reads correct numbers instead of resetting to zero.

---

## The zoom doesn't read as a zoom

A 16:9 camera fitting a wide, short region is width-limited. A full-width stats row
1240 units across in a 1927-wide artboard yields about 1.3× — which looks like a
rendering glitch, not a move.

Measure the target before committing a beat to it: `zoom ≈ baseW / (box.w × 1.26)`.
If that is under about 2×, pick a smaller target. Two stat cards instead of six
gave 3.6×, which reads immediately.

---

## Close framings expose empty canvas

Real app screens have whitespace. Push into a narrow sidebar at the bottom of a
long page and the 16:9 frame fills with blank area to its left.

In order of preference:

1. Choose a framing that contains content on both sides — anchor the rect to the
   target layer's box but extend it toward the populated part of the screen.
2. Pull back. A legible 1.5× on a full panel beats a dramatic 4× on a void.
3. Strengthen the vignette during close-ups so the emptiness falls off.

And say so in the handover. If the design's empty region ever gets filled, that
shot improves for free — the client should know that is where the ceiling is.

---

## `scaleX` wipes squash their contents

Revealing a progress bar with `transform: scaleX(p)` also squashes the label inside
it and flattens the rounded end cap. Inject a `clipPath` rect and animate its
width. Code in `moves.md`.

---

## A lifted layer keeps showing stale content

A clone is a snapshot. If you stream text into the original after cloning, the
floating copy still shows the old placeholder. Either write to every instance:

```js
for (const el of instances(screen, name)) streamOne(el, text, prog);
```

…or don't lift the thing you are animating content into. The second is usually
better — the lift rarely earns its complexity if the camera already makes the text
legible.

---

## Duplicate carets after cloning

Caching a caret handle on the element (`el.__caret`) breaks once clones enter the
picture, and you end up with two carets, one stuck at the start of the line. Look
the caret up in the DOM by a marker attribute and delete extras:

```js
const carets = el.parentNode.querySelectorAll('rect[data-caret]');
for (let i = 1; i < carets.length; i++) carets[i].remove();
```

The general rule: anything you attach to a node will be duplicated by `cloneNode`.
Prefer DOM queries to cached references in code that clones.

---

## `getBBox()` returns zero

Measuring a layer whose ancestor is `display: none` gives an empty box, and the
camera built from it lands somewhere absurd. Resolve and cache every bbox once,
after `document.fonts.ready`, before hiding anything.

Also measure in the root's user space via `getScreenCTM()` composition rather than
trusting `getBBox()` alone, so nested transforms are accounted for.

---

## Frames aren't reproducible

Anything the page reads that isn't the timestamp breaks it: `requestAnimationFrame`,
`Date.now()`, `new Date()`, unseeded `Math.random()`, CSS animations or transitions,
`IntersectionObserver`, lazy-loaded fonts.

Launch Chrome with rasterisation pinned:

```
--force-color-profile=srgb --disable-lcd-text --font-render-hinting=none
--disable-font-subpixel-positioning --disable-partial-raster
--run-all-compositor-stages-before-draw --disable-new-content-rendering-timeout
```

`--disable-lcd-text` also matters for quality, not just determinism: subpixel
antialiasing produces colour fringing that survives into the H.264 encode.

Then prove it rather than assuming it:

```
node render.mjs --page out/player.html --verify "0.7,4.9,15.9,34.2"
```

Two separate browser launches, SHA-256 per frame. If they differ, something is
reading the clock.

---

## Fonts render as fallbacks

The SVG names a family (`Inter`); Chrome needs it installed or embedded. A
fallback silently changes every line length and the caret measurements with it.

Check `~/Library/Fonts` and `/Library/Fonts` first — the font is often already
there, which avoids an install. Then base64 it into the page so the render is
identical on any machine:

```css
@font-face { font-family: Inter; font-weight: 100 900; font-display: block;
             src: url(data:font/ttf;base64,…) format('truetype'); }
```

A variable font covers every weight in one `@font-face` with `font-weight: 100 900`.

Icon-font glyphs (Font Awesome and friends) are worth checking separately — dump
their codepoints. Often they are ordinary characters like `+` that render fine in
any font, and no icon font is needed at all.

---

## Scene timings scattered through the code

Retiming a beat then means hunting through animation logic, and the sound drifts
out of sync with the picture because they were edited separately.

Keep one module exporting every time, layer name and cue. The browser code and the
audio synth both import it; the build inlines it into the page as JSON. One edit
moves picture and sound together.

---

## Finding out at minute six that a shot is wrong

A full 2520-frame render is around six minutes. Iterating at that granularity
wastes an hour on composition problems.

Render single frames at the moments you care about, and tile a sweep of the whole
film into one contact sheet:

```bash
node render.mjs --page out/player.html --stills "a=0.7,b=4.9,c=11.9" --dir out/stills
printf "file '%s'\n" "$PWD"/out/stills/cs_*.png > /tmp/cs.txt
ffmpeg -y -f concat -safe 0 -i /tmp/cs.txt \
  -vf "scale=620:-1,tile=5x6:padding=6:color=0x0b0d1a" -frames:v 1 sheet.png
```

ffmpeg's concat demuxer needs absolute paths and one `file '…'` per line. Looking
at 26 frames at once catches pacing and framing problems that no single still
reveals.
