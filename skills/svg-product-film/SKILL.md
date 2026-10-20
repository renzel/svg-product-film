---
name: svg-product-film
description: Build a product film from Figma or Sketch SVG exports with live text and named layers — drawn frame by frame from timestamps in a headless browser, encoded with ffmpeg, with a score and interface sounds synthesised in code. By default it makes a quick, upbeat demo of the kind launched on X (Twitter). Use when someone wants a product video, launch film, demo reel, X or Twitter demo, feature tour, or animated walkthrough built from app screens rather than a screen recording; when the render must be reproducible so a design re-export plus one command rebuilds the film; or when they want motion a screen capture cannot produce — lifting a layer out of its window, tilting a window in 3D, zooming into detail that stays sharp, text that types itself. Also covers checking whether an SVG export is animatable at all.
---

# Product films from SVG design exports

A design export is not a video, but a good one is better raw material than a screen
recording: the text is real text, the layers have names, and the whole thing is
vector, so you can push the camera in as far as you like without it going soft.

This builds a film where every frame is a pure function of its timestamp. That one
property is what makes the result reproducible, gives you single-frame previews
without rendering anything else, and lets the picture and the sound come from the
same timeline.

The commands below run this skill's own scripts as `<skill-dir>/scripts/…`, where
`<skill-dir>` is the folder this SKILL.md is in, wherever your agent installed it.

## The shape of it

```
project/
├── screens/*.svg          the exports, read-only — never edit them
├── film/
│   ├── timeline.mjs       every time, layer name and audio cue (the only place to retime)
│   ├── build.mjs          inlines the SVGs + font + timeline into out/player.html
│   ├── scene.js           the choreography; defines window.__renderAt(t)
│   ├── audio.mjs          synthesises out/film.wav from timeline.mjs
│   └── frames.mjs         drives Chrome, pipes PNGs to ffmpeg
├── out/                   player.html, film.wav, film.mp4, stills/
└── render.sh              build → audio → frames → stills
```

`timeline.mjs` is imported by Node (for audio) and inlined as JSON into the page
(for picture). Keep it free of DOM references so both can read it. Retiming a beat
there moves the picture and its sound together, which is the main reason the file
exists.

## 1. Check the export before promising anything

```bash
node <skill-dir>/scripts/inspect-svg.mjs screens/
```

It reports live text vs outlined paths, how many layers carry usable names,
rasterised content, external references, duplicate ids, the fonts in use, and
whether the files can share one document. It exits non-zero when the export cannot
be animated.

Two failures are worth stopping for, because no amount of code fixes them:

- **Outlined text** (`<text>` count near zero, high path count) — every string is
  now a shape. No typing, no counters, no text streaming.
- **Unnamed layers** (`Rectangle 47`, `Group 12`, or nothing) — there is nothing
  stable to target, so the film cannot survive a re-export.

Tell the user plainly, name the Figma setting to change, and wait. Starting anyway
produces work that has to be thrown away.

Bitmaps and duplicate ids are warnings, not blockers: bitmaps will blur under a
zoom, so plan the camera around them.

## 2. Look before installing

The zero-dependency path usually exists, and the user may not want new software on
their machine. Check first, and ask before installing anything:

```bash
ls -d "/Applications/Google Chrome.app" 2>/dev/null; which ffmpeg node
node -e "console.log(typeof WebSocket)"          # 'function' on Node 22+
ls ~/Library/Fonts /Library/Fonts | grep -i <font-from-step-1>
```

On a typical designer's Mac all four are already there, which means no npm install
at all: Node 22+ ships a WebSocket client, so `scripts/cdp.mjs` drives Chrome over
the DevTools Protocol directly — no Puppeteer, no Chromium download. Embed the
system font as base64 rather than relying on it being installed, so the render is
identical anywhere.

## 3. Build the page

`build.mjs` reads each SVG, rewrites **only the root `<svg>` tag in memory** (drop
`width`/`height` so CSS sizes it, add a stable id, keep the `viewBox` and any
presentation attributes), and writes `out/player.html`. The files on disk stay
exactly as exported.

The page is one HTML file with the SVGs, the base64 font, the timeline JSON and
the scene code inlined — no fetches, so `file://` works and nothing can load late
and change a frame.

Frame each screen in a window, which gives the 3D moves something to be about and
makes "out of the window" legible:

```html
<div id="stage">                                  <!-- perspective lives here -->
  <div class="win" id="win-board">
    <div class="bar">● ● ●  <span>PLANLOOM · BOARD</span></div>
    <div class="vp"><svg id="svg-board" viewBox="0 0 1927 1087">…</svg></div>
    <div class="lifts"></div>                     <!-- unclipped, same 3D space -->
  </div>
  <div id="hlscrim"></div><div class="hl">…</div> <!-- headlines -->
  <div id="fade"></div>
</div>
```

```css
#stage { perspective: 2200px; perspective-origin: 50% 46%; transform-style: preserve-3d; }
.win   { transform-style: preserve-3d; backface-visibility: hidden; }
.vp    { overflow: hidden; }                      /* the window's inside */
.lifts { position: absolute; transform-style: preserve-3d; overflow: visible; }
```

Pick a viewport with a clean aspect (1632×918 is 16:9) and generate camera
viewBoxes at that same aspect, so nothing letterboxes.

## 4. Choreograph

The page exposes exactly one function:

```js
window.__renderAt(t)   // paint the frame for time t; no rAF, no Date, no random
window.__missing       // array of layer names that did not resolve
```

Read **`references/moves.md`** for working code on: scoped layer lookup, measuring
a layer in its root's user space, the viewBox camera, 3D window tilts, lifting a
clone out of a clipped viewport, a pointer that clicks and drags, streaming text
with a measured caret, clipPath reveal wipes, counters that read their target from
the SVG, and easing.

### Write the story before the code

A product film shows someone using the product, not a tour of its screens.
Zooming in on one region after another and highlighting things nobody is using
reads as random, however smooth the moves are. So before any choreography, write
the film as one person doing one job:

1. **Who and what.** One user and one goal the product helps with: "Ada gets the
   launch back on track".
2. **The steps.** Four to seven things they do in the app, each an action with a
   visible result. They add a task and it appears in its column, drag it to In
   Progress, ask the assistant what's blocking the launch and the answer streams
   in, press Auto Schedule and the bars move.
3. **One thread.** The same task, project or person runs through every screen:
   created on the board, scheduled on the timeline, sitting on the calendar. That
   is what makes three exports read as one product.

Find the verbs in the export itself. Layers named like controls (`+ Add task`,
`New Task`, `Auto Schedule`, a search or chat input, a Send button) are what the
user can do, and items that appear on more than one screen are the thread. If the
screens have nothing to press, tell the user the film will be a tour, and why.

Give each step one act of two to four seconds, with a short headline that names
what the user gets rather than the feature: "See what's blocking the launch", not
"AI Assistant".

### Quick and upbeat, like a launch demo on X

Unless the user asks for something else, make the kind of product demo people post
on X (Twitter): quick, upbeat, and over before anyone scrolls past.

- **Hook in the first second.** Open on the product already in use, mid-action, not
  on an empty window flying in.
- **Twenty to thirty seconds in all:** two to four seconds per step, and an end
  card of two to three. Past forty-five, a product film stops being watched.
- **Snappy motion.** Arrivals and camera moves of 0.4–0.8 s, settling quickly
  rather than gliding, with cuts and big moves on the beat of the score.
- **Upbeat sound:** a major-key groove from the first bar at about 128 BPM, with
  no slow intro (`references/audio.md`).
- **It reads with the sound off.** X plays videos muted until someone taps them,
  so headlines of two to five words have to carry the story on their own.

Three judgements that decide whether it looks professional:

- **Every beat is an action or the answer to one.** Show the pointer reach the
  control and press it, or the field take focus before the typing, then the app's
  response. If you cannot say what the user just did, cut the beat.
- **The camera follows the user.** Push in to where they are acting, or to the
  result they are waiting for, and pull back when the result spans the screen.
  Never zoom in just to point at something.
- **Let each screen arrive already populated.** Building the UI from nothing
  reads as a broken app for the first seconds. Stagger content in during the
  window's fly-in, then let the user's actions change it.

And one check before committing to a zoom: `baseW / (box.w × 1.26)` under about 2×
is not a move anyone will notice. Pick a smaller target.

## 5. Sound

Read **`references/audio.md`**. `audio.mjs` imports the same `timeline.mjs` and
writes a 48 kHz 16-bit stereo WAV: a short, upbeat score (a major key, about
128 BPM, the groove in from the first bar), plus interface sounds dispatched from
the cue array for
what the user does — a tick per keystroke, a click on every press, a soft pick-up
and put-down when a card is dragged — and a bell on the logo.

Camera moves and scene changes get no sound of their own: no whooshes, risers or
sweeps. Between scenes they sound like effects laid over a demo. Let the score
mark the change instead, with the arrangement changing at the nearest bar line.

You cannot hear what you wrote, so measure it:

```bash
node <skill-dir>/scripts/check-audio.mjs out/film.wav
```

Synthesised kicks and sine basses carry enormous low-frequency energy and hats
carry almost none, so the first mix is nearly always mud. Target about −14 LUFS
integrated, true peak under −1 dBFS, low band 3–6 dB below overall RMS, and more
than 4 dB of movement across the film.

## 6. Render and prove it

```bash
# single frames, for looking at a beat without rendering the film
node <skill-dir>/scripts/render.mjs \
  --page out/player.html --stills "tilt=0.7,lift=34.2" --dir out/stills

# the film
node <skill-dir>/scripts/render.mjs \
  --page out/player.html --audio out/film.wav --out out/film.mp4 --dur 42 --fps 60

# two separate browser launches must give byte-identical frames
node <skill-dir>/scripts/render.mjs \
  --page out/player.html --verify "0.7,4.9,15.9,34.2"
```

Frames go straight down a pipe into ffmpeg, so no intermediate PNGs hit disk.
Expect roughly 7–8 fps of throughput for three full app screens at 1080p — about
six minutes for 2520 frames.

Run `--verify` before the full render. It is the difference between believing the
output is reproducible and knowing it.

## Working rhythm

Iterating at six minutes a look will waste an hour. Instead:

1. Probe 6–10 single stills at the beats you are unsure about.
2. Sweep the whole film into one contact sheet and read the pacing at a glance:

```bash
node <skill-dir>/scripts/render.mjs \
  --page out/player.html --dir out/stills \
  --stills "cs_01=0.8,cs_02=2.6,cs_03=4.6,…"
printf "file '%s'\n" "$PWD"/out/stills/cs_*.png > /tmp/cs.txt
ffmpeg -y -f concat -safe 0 -i /tmp/cs.txt \
  -vf "scale=620:-1,tile=5x6:padding=6:color=0x0b0d1a" -frames:v 1 sheet.png
```

Looking at 26 frames together catches dead air, repeated framings and empty
screens that no single still reveals. Read it as a story too: in every frame you
should be able to say what the user is doing. Only then render in full.

## Surviving a redesign

The point of targeting layers by name is that a re-export re-renders. Protect it:

- Keep every layer name in one map in `timeline.mjs`, never inline in the logic.
- Collect unresolved names into `window.__missing`; the renderer prints them and
  carries on rather than failing silently, so a rename is visible but not fatal.
- Read values out of the SVG (counter targets, text content) instead of hard-coding
  them, so copy changes flow through.

## Handing it over

Give them the film, the stills that show the signature moves, and the one command
that rebuilds everything. Say plainly what is reproducible and what you verified,
and flag any shot that is at the mercy of the design — a close framing sitting over
a region of whitespace will improve on its own if that area ever gets filled, and
they should know that is where the ceiling is.

**`references/pitfalls.md`** collects the failures worth knowing in advance —
black clones from a missing `fill="none"`, cross-file id collisions, soft CSS-scale
zooms, stale content in lifted clones, zero bounding boxes, and the Chrome flags
that pin rasterisation. Read it before debugging anything odd; it is probably there.
