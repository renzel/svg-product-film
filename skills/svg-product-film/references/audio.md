# Sound from code

A score and interface sounds written sample by sample in Node, driven by the same
timeline the picture reads. No sample libraries, no instrument packs, no voice.
Output is a 48 kHz 16-bit stereo WAV that ffmpeg muxes with the frames.

## Contents

- [Shape of the file](#shape-of-the-file)
- [Instruments](#instruments)
- [Arranging to the picture](#arranging-to-the-picture)
- [Interface sounds](#interface-sounds)
- [The master chain](#the-master-chain)
- [Writing the WAV](#writing-the-wav)
- [Targets to hit](#targets-to-hit)

---

## Shape of the file

```js
import { DUR, BAR, BEAT, CUES } from './timeline.mjs';

const SR = 48000, TAIL = 0.6;
const N = Math.ceil((DUR + TAIL) * SR);
const L = new Float32Array(N), R = new Float32Array(N);

// write gen(localSeconds, sampleIndex) -> [l, r] into the buffers
function place(t0, dur, gen) {
  const s0 = Math.round(t0 * SR), n = Math.round(dur * SR);
  for (let i = 0; i < n; i++) {
    const k = s0 + i;
    if (k < 0) continue;
    if (k >= N) break;
    const v = gen(i / SR, i);
    L[k] += v[0]; R[k] += v[1];
  }
}
const mono = (t0, dur, g, pan = 0) => {
  const pl = Math.cos((pan + 1) * Math.PI / 4), pr = Math.sin((pan + 1) * Math.PI / 4);
  place(t0, dur, (tt, i) => { const v = g(tt, i); return [v * pl * 1.414, v * pr * 1.414]; });
};
```

Everything else is a function that calls `mono`/`place`. The tail past `DUR` lets
reverb-ish decays ring out past the last frame instead of being chopped.

Deterministic noise — a seeded xorshift, never `Math.random`, so two renders of
the same film are bit-identical:

```js
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
                 return (s / 4294967296) * 2 - 1; };
}
```

Pick a tempo whose bar is a round number of seconds. 120 BPM gives a 0.5 s beat
and a 2 s bar, so scene boundaries and bar lines can be reasoned about in your
head. 42 s is exactly 21 bars.

---

## Instruments

**Kick** — a sine whose pitch collapses, plus a noise transient. The pitch floor
and decay rate are the two knobs that decide whether the mix drowns:

```js
function kick(t0, gain = 1) {
  const nz = rng(0x9e37 + Math.round(t0 * 1000));
  let ph = 0;
  mono(t0, 0.46, tt => {
    const f = 52 + 98 * Math.exp(-tt * 38);
    ph += 2 * Math.PI * f / SR;
    const body  = Math.sin(ph) * Math.exp(-tt * 11.5);
    const click = nz() * Math.exp(-tt * 260) * 0.30;
    return Math.tanh((body + click) * 1.7) * 0.40 * gain;
  });
}
```

**Bass** — fundamental plus a strong octave. The octave is what survives laptop
speakers that reproduce nothing below 150 Hz:

```js
const v = Math.sin(ph) + Math.sin(ph2) * 0.42;   // ph2 at 2f
return Math.tanh(v * 1.25) * env * 0.17 * gain;
```

**Hat** — noise minus its own lowpass, which is a cheap highpass:

```js
let lp = 0;
const x = nz();
lp += 0.55 * (x - lp);
return (x - lp) * Math.exp(-tt / 0.035) * 0.30 * gain;
```

**Pad** — additive with odd harmonics only, two detuned copies per note. Additive
avoids the aliasing you get from a naive saw and stays soft:

```js
v += (Math.sin(p) + Math.sin(p * 3) * 0.111 + Math.sin(p * 5) * 0.040) * 0.5;
```

Detune by ±0.35% and add a slow amplitude breathe (`1 + 0.05 * sin(2π·0.14·t)`).

**Pluck** — three partials with different decay rates under a lowpass that closes
as the note dies. That closing filter is what makes it read as plucked rather
than as a beep:

```js
lp += (0.26 + 0.5 * Math.exp(-tt * 14)) * (raw - lp);
return lp * Math.exp(-tt * 11) * 0.34 * gain;
```

**Bell** — inharmonic partials at 1, 2.01, 2.99, 4.18, 5.43 with decays that get
faster for higher partials. Good for logo stings.

---

## Arranging to the picture

Loop over bars and ask a `section(bar)` function for per-instrument gains. Edit
the arrangement in one place instead of scattering note calls:

```js
function section(b) {
  if (b < 2)  return { pad: .50, bass: .55, kick: 0,   hat: 0,   arp: 0   };
  if (b < 4)  return { pad: .70, bass: .90, kick: 1,   hat: .70, arp: 0   };
  if (b < 7)  return { pad: .80, bass: 1,   kick: 1,   hat: 1,   arp: .90 };
  if (b < 9)  return { pad: .62, bass: .62, kick: .30, hat: .40, arp: .30 };  // make room
  ...
}
```

Two arrangement decisions do most of the work:

- **Duck under the detail beats.** When the film is typing, or when a close-up
  wants attention, drop the groove 5–6 dB for those bars. The UI sounds then read
  as the subject rather than fighting the kick.
- **Resolve at the end card.** If the body is in a minor key, move to the relative
  major for the last two bars and let a bell ring over a sustained pad with no
  drums. Am–F–C–G through the body, C major under the logo.

The big visual beats rarely land on bar lines, and forcing the choreography onto
the grid usually hurts the picture. Keep the groove on the grid and place the
interface sounds and the end-card bell at the exact visual times from `CUES`. The
ear accepts that as intentional.

Scene changes get no accent of their own. A whoosh, riser or sweep between scenes
sounds like an effect laid over a demo, and it is the first thing a viewer
notices as cheap. Mark the change in the score instead: let the arrangement
change at the nearest bar line, such as the hats dropping out or the bass moving.

---

## Interface sounds

Sound only what the user would hear: keys, presses, a card picked up and put down,
a notification arriving. The camera is silent, and so are the scene changes.

Derive these from the same cue array the animation reads, so retiming a beat moves
the picture and its sound together:

```js
export const CUES = [
  { t: T.addTask,          type: 'click' },
  { t: T.cardDrag[0],      type: 'pick' },
  { t: T.cardDrag[1],      type: 'place' },
  ...typeTicks(T.aiType, AI_QUERY),
  { t: T.aiSend, type: 'click', hard: true },
];

function typeTicks(win, text) {
  const [a, b] = win, out = [];
  for (let i = 0; i < text.length; i++)
    if (text[i] !== ' ') out.push({ t: a + (b - a) * (i / text.length), type: 'key', i });
  return out;
}
```

A sound per type, dispatched by name:

| Cue | Recipe | Length |
|---|---|---|
| `key` | short noise + 2.5 kHz blip, pitch jittered by `rng(seed + i)` | 35 ms |
| `click` | 1950 Hz + 2840 Hz sines, exp decay, small noise transient | 90 ms |
| `pop` | sine falling 760→320 Hz | 130 ms |
| `tick` | noise + 3.4 kHz, very short | 50 ms |
| `pick` | soft 1.2 kHz click with a breath of noise, quieter than `click` | 60 ms |
| `place` | 150→92 Hz thud + click | 400 ms |
| `bell` | inharmonic partials | 2 s |

There is deliberately no `whoosh`, `riser` or `swell`: nothing in a real app makes
those sounds.

Seed the per-keystroke jitter from the character index. Each keystroke sounds
slightly different from its neighbours, which is what real typing does — and it is
identical on every render, which is what reproducibility needs.

---

## The master chain

This is where generated music usually fails. Synthesised kicks and sine basses put
enormous energy below 200 Hz while hats and plucks put almost none, so a mix that
looks fine by peak level can be hopelessly bottom-heavy. Fix it on the bus:

```js
const A_HP = 2 * Math.PI * 38  / SR;     // rumble out
const A_LS = 2 * Math.PI * 175 / SR;     // low shelf
let hpL = 0, lsL = 0, peak = 0;
for (let i = 0; i < N; i++) {
  hpL += A_HP * (L[i] - hpL); let l = L[i] - hpL;   // highpass
  lsL += A_LS * (l - lsL);    l -= lsL * 0.44;      // shelve the bottom down ~5 dB
  L[i] = Math.tanh(l * 1.18);                       // soft clip, no hard edges
  peak = Math.max(peak, Math.abs(L[i]));
}
const norm = 0.89 / peak;
```

Then run `scripts/check-audio.mjs`. Aim for the low band 3–6 dB under overall RMS
and the mid within a few dB of the low. In one real case the first mix measured
low at −1 dB relative to total — effectively all bass — and the fix was exactly
the above plus halving the kick and raising hats, plucks and pad.

---

## Writing the WAV

```js
const buf = Buffer.alloc(44 + N * 4);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write('WAVE', 8);
buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28);
buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
buf.write('data', 36); buf.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) {
  let g = norm;
  if (i < fadeIn) g *= i / fadeIn;
  if (i > fadeOutAt) g *= Math.max(0, 1 - (i - fadeOutAt) / (N - fadeOutAt));
  buf.writeInt16LE(Math.round(clamp(L[i] * g, -1, 1) * 32767), 44 + i * 4);
  buf.writeInt16LE(Math.round(clamp(R[i] * g, -1, 1) * 32767), 46 + i * 4);
}
```

A 40 ms fade in and a fade out starting ~0.75 s before the end stops both clicks.

---

## Targets to hit

| Measure | Target | Why |
|---|---|---|
| Integrated loudness | −14 LUFS | what web platforms normalise to; louder just gets turned down |
| True peak | ≤ −1 dBFS | headroom for lossy encoding |
| Low band vs RMS | −3 to −6 dB | below −2.5 dB it is mud |
| Level range across the film | > 4 dB | less means the score is ignoring the picture |
| Sample rate | 48 kHz | matches AAC in the mux; no resampling |

AAC frame granularity means the audio stream lands a few milliseconds short of the
video (41.984 s against 42.000 s). That is normal; `-shortest` handles it.
