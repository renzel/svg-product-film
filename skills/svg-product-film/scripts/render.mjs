#!/usr/bin/env node
// render.mjs — draw every frame from its timestamp, encode with ffmpeg.
//
// The page contract is one function:
//     window.__renderAt(t)   paints the frame for time t (seconds) and returns
//
// Everything the page draws must be a pure function of t — no requestAnimationFrame,
// no Date, no unseeded Math.random — or frames will not be reproducible.
// The page may also expose window.__missing (array of unresolved layer names),
// which is reported here so a rename after a redesign is loud rather than silent.
//
//   node render.mjs --page out/player.html --audio out/film.wav --out out/film.mp4 --dur 42
//   node render.mjs --page out/player.html --stills "tilt=0.7,lift=34.2" --dir out/stills
//   node render.mjs --page out/player.html --verify "0.7,4.9,34.2"
//
// Flags: --fps 60  --w 1920  --h 1080  --crf 17  --scale 1  --port 9333

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { launch, openPage, evaluate, shot } from './cdp.mjs';

const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt;
};
const PAGE  = flag('page');
const FPS   = Number(flag('fps', 60));
const W     = Number(flag('w', 1920));
const H     = Number(flag('h', 1080));
const SCALE = Number(flag('scale', 1));
const CRF   = flag('crf', '17');
const PORT  = Number(flag('port', 9333));
const DUR   = Number(flag('dur', 0));
const OUT   = flag('out', 'out/film.mp4');
const AUDIO = flag('audio');
const DIR   = flag('dir', 'out/stills');
const STILLS = flag('stills');
const VERIFY = flag('verify');

if (!PAGE) { console.error('need --page <html file>'); process.exit(1); }
if (!STILLS && !VERIFY && !DUR) { console.error('need --dur <seconds> (or --stills / --verify)'); process.exit(1); }

const url = pathToFileURL(resolve(PAGE)).href;

async function session(port = PORT) {
  const browser = await launch({ width: W, height: H, port });
  const { S } = await openPage(browser, { url, width: W, height: H, scale: SCALE });
  await evaluate(S, 'document.fonts.ready.then(()=>true)');
  await evaluate(S, 'window.__renderAt(0)');          // let the page resolve layout
  return { browser, S };
}

function reportMissing(list) {
  const miss = [...new Set(list || [])];
  if (!miss.length) { console.log('  every named layer resolved'); return; }
  console.log('\n  ! these layer names are not in the current export:');
  miss.forEach(m => console.log('      ' + m));
  console.log('    Those beats are skipped; the rest still renders.');
  console.log('    Either restore the names in the design, or update the name map.\n');
}

const bar = (done, total, extra) => {
  const f = done / total, w = 32, n = Math.round(f * w);
  process.stdout.write('\r  [' + '#'.repeat(n) + '.'.repeat(w - n) + '] ' +
    String(Math.round(f * 100)).padStart(3) + '%  ' + done + '/' + total + '  ' + extra + '    ');
};

/* --------------------------------- stills ------------------------------ */
if (STILLS) {
  const { browser, S } = await session();
  reportMissing(await evaluate(S, 'window.__missing || []'));
  mkdirSync(DIR, { recursive: true });
  for (const part of STILLS.split(',').filter(Boolean)) {
    const [name, t] = part.split('=');
    await evaluate(S, `window.__renderAt(${Number(t)})`);
    const file = join(DIR, name + '.png');
    writeFileSync(file, await shot(S, { width: W, height: H }));
    console.log(`  ${String(t).padStart(7)}s -> ${file}`);
  }
  await browser.close();
}

/* ------------------------------- verify -------------------------------- */
// Two separate browser launches must produce byte-identical frames. If they do
// not, something in the page is reading the clock or an unseeded random.
else if (VERIFY) {
  const ts = VERIFY.split(',').map(Number);
  const runs = [];
  for (let r = 0; r < 2; r++) {
    const { browser, S } = await session(PORT + r);
    const h = [];
    for (const t of ts) {
      await evaluate(S, `window.__renderAt(${t})`);
      h.push(createHash('sha256').update(await shot(S, { width: W, height: H })).digest('hex').slice(0, 16));
    }
    runs.push(h);
    await browser.close();
  }
  let ok = true;
  ts.forEach((t, i) => {
    const same = runs[0][i] === runs[1][i];
    if (!same) ok = false;
    console.log(`  t=${String(t).padStart(7)}  ${runs[0][i]}  ${same ? 'identical' : 'DIFFERS -> ' + runs[1][i]}`);
  });
  console.log(ok
    ? '\n  deterministic: identical across two separate browser launches'
    : '\n  NOT deterministic — look for rAF, Date, or unseeded random in the page');
  process.exit(ok ? 0 : 1);
}

/* -------------------------------- film --------------------------------- */
else {
  const { browser, S } = await session();
  reportMissing(await evaluate(S, 'window.__missing || []'));
  const total = Math.round(DUR * FPS);
  mkdirSync(resolve(OUT, '..'), { recursive: true });
  if (AUDIO && !existsSync(AUDIO)) { console.error(`audio not found: ${AUDIO}`); process.exit(1); }

  // PNG frames go straight down a pipe — no intermediate frame files on disk
  const ff = spawn('ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
    ...(AUDIO ? ['-i', AUDIO] : []),
    ...(AUDIO ? ['-map', '0:v:0', '-map', '1:a:0'] : ['-map', '0:v:0']),
    '-c:v', 'libx264', '-preset', 'slow', '-crf', CRF,
    '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-level', '4.2',
    '-x264-params', `keyint=${FPS * 2}:min-keyint=${FPS}:scenecut=0`,
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    ...(AUDIO ? ['-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-shortest'] : []),
    '-movflags', '+faststart', OUT,
  ], { stdio: ['pipe', 'inherit', 'inherit'] });

  const write = buf => new Promise(res => {
    if (ff.stdin.write(buf)) res(); else ff.stdin.once('drain', res);
  });

  const t0 = Date.now();
  for (let i = 0; i < total; i++) {
    await evaluate(S, `window.__renderAt(${(i / FPS).toFixed(6)})`);
    await write(await shot(S, { width: W, height: H }));
    if (i % 15 === 0 || i === total - 1) {
      const el = (Date.now() - t0) / 1000;
      bar(i + 1, total, `${(i / Math.max(el, 0.001)).toFixed(1)} fps  eta ${i ? Math.round(el / i * (total - i)) : 0}s`);
    }
  }
  ff.stdin.end();
  await new Promise((res, rej) => ff.on('close', c => c === 0 ? res() : rej(new Error('ffmpeg exit ' + c))));
  process.stdout.write(`\n  wrote ${OUT}\n`);
  await browser.close();
}
