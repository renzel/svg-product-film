#!/usr/bin/env node
// check-audio.mjs — does the generated soundtrack actually sit right?
//
//   node check-audio.mjs out/film.wav
//
// You cannot listen to what you synthesise, so measure it. Two things go wrong
// with code-written music far more often than anything else:
//
//   1. It is all bass. Synth kicks and sine basses carry enormous energy below
//      200 Hz; hats and plucks carry almost none. A mix that looks fine by peak
//      level can be 20 dB lopsided and will sound like mud on good speakers and
//      like nothing at all on a laptop.
//   2. It is flat. If every second measures the same, the arrangement is not
//      supporting the picture — nothing builds, nothing makes room.
//
// Reads 16-bit PCM WAV. Shells out to ffmpeg for EBU R128 if it is on PATH.

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const file = process.argv[2];
if (!file) { console.error('usage: node check-audio.mjs <file.wav>'); process.exit(1); }

const buf = readFileSync(file);
if (buf.toString('latin1', 0, 4) !== 'RIFF') { console.error('not a RIFF/WAV file'); process.exit(1); }

// walk the chunk list rather than assuming a 44-byte header
let pos = 12, fmt = null, dataAt = 0, dataLen = 0;
while (pos + 8 <= buf.length) {
  const id = buf.toString('latin1', pos, pos + 4), len = buf.readUInt32LE(pos + 4);
  if (id === 'fmt ') {
    fmt = { format: buf.readUInt16LE(pos + 8), channels: buf.readUInt16LE(pos + 10),
            rate: buf.readUInt32LE(pos + 12), bits: buf.readUInt16LE(pos + 22) };
  } else if (id === 'data') { dataAt = pos + 8; dataLen = len; }
  pos += 8 + len + (len % 2);
}
if (!fmt || !dataAt) { console.error('no fmt/data chunk'); process.exit(1); }
if (fmt.bits !== 16) { console.error(`only 16-bit PCM supported (got ${fmt.bits})`); process.exit(1); }

const { rate: SR, channels: CH } = fmt;
const frames = Math.floor(dataLen / (2 * CH));
console.log(`${file}\n  ${(frames / SR).toFixed(2)}s  ${SR} Hz  ${CH} ch  ${fmt.bits}-bit`);

const db = x => 20 * Math.log10(Math.sqrt(x) + 1e-12);
const secs = Math.floor(frames / SR);
const rows = [];
let gLo = 0, gMid = 0, gHi = 0, gSum = 0, gPeak = 0;

for (let s = 0; s < secs; s++) {
  let lo = 0, mid = 0, hi = 0, sum = 0, pk = 0, lp1 = 0, lp2 = 0;
  for (let i = 0; i < SR; i++) {
    const base = dataAt + ((s * SR + i) * CH) * 2;
    let v = 0;
    for (let c = 0; c < CH; c++) v += buf.readInt16LE(base + c * 2) / 32768;
    v /= CH;
    sum += v * v; pk = Math.max(pk, Math.abs(v));
    lp1 += 0.026 * (v - lp1);          // ~200 Hz
    lp2 += 0.260 * (v - lp2);          // ~2 kHz
    lo += lp1 * lp1; mid += (lp2 - lp1) ** 2; hi += (v - lp2) ** 2;
  }
  gLo += lo; gMid += mid; gHi += hi; gSum += sum; gPeak = Math.max(gPeak, pk);
  rows.push([s, db(sum / SR), db(lo / SR), db(mid / SR), db(hi / SR)]);
}

/* ---- shape over time: is the arrangement doing anything? --------------- */
const vals = rows.map(r => r[1]);
const lo_ = Math.min(...vals), hi_ = Math.max(...vals);
const glyph = ' .:-=+*#%@';
console.log('\n  level over time (each column is one second)');
console.log('  ' + vals.map(v => glyph[Math.max(0, Math.min(9,
  Math.round((v - lo_) / Math.max(hi_ - lo_, 1e-6) * 9)))]).join(''));
console.log(`  quietest ${lo_.toFixed(1)} dB at ${vals.indexOf(lo_)}s` +
            `   loudest ${hi_.toFixed(1)} dB at ${vals.indexOf(hi_)}s` +
            `   range ${(hi_ - lo_).toFixed(1)} dB`);
if (hi_ - lo_ < 4) console.log('  ! under 4 dB of movement — the score is not reacting to the picture');

/* ---- band balance ------------------------------------------------------ */
const T = db(gSum / (secs * SR));
const B = { low: db(gLo / (secs * SR)) - T, mid: db(gMid / (secs * SR)) - T, high: db(gHi / (secs * SR)) - T };
console.log('\n  band balance, relative to overall RMS');
console.log(`    below 200 Hz   ${B.low.toFixed(1).padStart(6)} dB`);
console.log(`    200 Hz - 2 kHz ${B.mid.toFixed(1).padStart(6)} dB`);
console.log(`    above 2 kHz    ${B.high.toFixed(1).padStart(6)} dB`);
console.log(`    true peak      ${(20 * Math.log10(gPeak + 1e-12)).toFixed(1).padStart(6)} dBFS`);

const notes = [];
// A balanced mix lands low around -3 to -6 and mid within a few dB of it. Low
// sitting within ~2 dB of total RMS means the bottom end is swamping everything.
if (B.low > -2.5)            notes.push('bass-heavy: cut the kick and sub, and add a master low shelf around 175 Hz');
if (B.mid < B.low - 6)       notes.push('hollow midrange: raise pads, plucks and anything carrying the tune');
if (B.high < -18)            notes.push('dull: raise hats and transients, or open their highpass');
if (gPeak > 0.995)           notes.push('clipping: lower the master or add soft clipping before normalising');
console.log(notes.length ? '\n  ' + notes.map(n => '! ' + n).join('\n  ')
                         : '\n  balance looks sane');

/* ---- loudness ---------------------------------------------------------- */
try {
  // ebur128 prints its summary on stderr, so read both streams
  const r = spawnSync('ffmpeg',
    ['-hide_banner', '-nostats', '-i', file, '-filter_complex', 'ebur128=peak=true', '-f', 'null', '-'],
    { encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  const grab = re => (out.match(re) || [])[1];
  const I = grab(/Integrated loudness:[\s\S]*?I:\s*(-?[\d.]+) LUFS/);
  const P = grab(/True peak:[\s\S]*?Peak:\s*(-?[\d.]+) dBFS/);
  const LRA = grab(/Loudness range:[\s\S]*?LRA:\s*([\d.]+) LU/);
  if (I) {
    console.log(`\n  integrated ${I} LUFS   true peak ${P} dBFS   range ${LRA} LU`);
    const i = Number(I);
    if (i > -11)      console.log('  ! louder than web platforms want — they will turn it down. Aim for about -14 LUFS.');
    else if (i < -20) console.log('  ! quiet — people will reach for the volume. Aim for about -14 LUFS.');
    else              console.log('  level is in the right place for web playback');
  }
} catch {
  console.log('\n  (ffmpeg not available — skipped EBU R128 loudness)');
}
