#!/usr/bin/env node
// inspect-svg.mjs — is this export animatable?
//
//   node inspect-svg.mjs [dir-or-files...]      (defaults to *.svg in cwd)
//
// Answers the three questions you must settle before promising a film:
//   1. Is the text live, or outlined into paths?
//   2. Do the layers carry names you can target?
//   3. Can these files be inlined into one document without id collisions?
//
// Exits 1 if any file is unusable, so it can gate a build.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';

const args = process.argv.slice(2);
const files = (args.length ? args : ['.']).flatMap(p => {
  const s = statSync(p);
  return s.isDirectory()
    ? readdirSync(p).filter(f => f.toLowerCase().endsWith('.svg')).map(f => join(p, f))
    : [p];
}).sort();

if (!files.length) { console.error('no .svg files found'); process.exit(1); }

const count = (s, re) => (s.match(re) || []).length;
const pad = (s, n) => String(s).padEnd(n);
const refsOf = s => new Set([
  ...[...s.matchAll(/url\(#([^)]*)\)/g)].map(m => m[1]),
  ...[...s.matchAll(/(?:xlink:)?href="#([^"]*)"/g)].map(m => m[1]),
]);

const report = [];
let fatal = false, warn = false;

for (const f of files) {
  const s = readFileSync(f, 'utf8');
  const root = s.match(/<svg\b([^>]*)>/)?.[1] ?? '';
  const vb = root.match(/viewBox="([^"]+)"/)?.[1];
  const [, , w, h] = (vb ?? '0 0 0 0').trim().split(/[\s,]+/).map(Number);

  const texts  = count(s, /<text\b/g);
  const tspans = count(s, /<tspan\b/g);
  const paths  = count(s, /<path\b/g);
  const ids    = [...s.matchAll(/\bid="([^"]*)"/g)].map(m => m[1]);
  const groups = count(s, /<g[\s>]/g);
  const images = count(s, /<image\b/g);
  const b64    = count(s, /base64/g);
  // an href that is not a local #fragment is an external dependency
  const ext    = [...s.matchAll(/(?:xlink:)?href="([^"]*)"/g)]
                   .map(m => m[1]).filter(v => v && !v.startsWith('#'));

  const fonts = {};
  for (const m of s.matchAll(/font-family="([^"]+)"/g)) fonts[m[1]] = (fonts[m[1]] || 0) + 1;

  const dupes = ids.filter((v, i) => ids.indexOf(v) !== i);
  const named = ids.filter(v => !/^(clip|filter|mask|paint|path|bgblur|pattern|image)[-_0-9]/i.test(v));

  const outlined = texts === 0 && paths > 40;
  const unnamed  = named.length < 10;

  if (outlined || unnamed || !vb) fatal = true;
  if (images || b64 || ext.length || dupes.length) warn = true;

  report.push({
    f: basename(f), w, h, vb, texts, tspans, paths, ids: ids.length, named: named.length,
    groups, images, b64, ext, fonts, dupes: [...new Set(dupes)], outlined, unnamed,
    refs: refsOf(s),
  });
}

/* --------------------------- per file ---------------------------------- */
for (const r of report) {
  console.log(`\n${r.f}${r.vb ? `   ${r.w}x${r.h}` : '   (no viewBox!)'}`);
  const line = (label, value, ok, note = '') =>
    console.log(`  ${pad(label, 16)} ${pad(value, 34)} ${ok ? 'ok' : '<-- PROBLEM'} ${note}`);

  line('live text', `${r.texts} <text>, ${r.tspans} <tspan>`, !r.outlined,
       r.outlined ? 'text looks outlined into paths' : '');
  line('named layers', `${r.named} usable of ${r.ids} ids, ${r.groups} groups`, !r.unnamed,
       r.unnamed ? 'nothing to target by name' : '');
  line('rasterised', `${r.images} <image>, ${r.b64} base64 blobs`, !r.images && !r.b64,
       r.images || r.b64 ? 'bitmaps will not survive a zoom' : '');
  line('external refs', String(r.ext.length), !r.ext.length,
       r.ext.length ? r.ext.slice(0, 2).join(' ') : '');
  line('duplicate ids', String(r.dupes.length), !r.dupes.length,
       r.dupes.length ? r.dupes.slice(0, 3).join(' ') : '');
  console.log(`  ${pad('fonts', 16)} ` +
    Object.entries(r.fonts).map(([k, v]) => `${k} (${v})`).join(', '));
}

/* ------------------- can they share one document? ---------------------- */
const seen = new Map();
const collide = new Map();
for (const r of report) {
  for (const id of r.refs) {
    if (seen.has(id) && seen.get(id) !== r.f) {
      collide.set(id, [...new Set([...(collide.get(id) || []), seen.get(id), r.f])]);
    }
    seen.set(id, r.f);
  }
}
console.log(`\ncross-file: ${collide.size} collision(s) among ids targeted by url(#...)`);
if (collide.size) {
  for (const [id, fs] of [...collide].slice(0, 6)) console.log(`   ${id}  <-  ${fs.join(', ')}`);
  console.log('   -> prefix these ids (and their url(#...) references) when inlining,');
  console.log('      or give each screen its own document.');
} else {
  console.log('   -> safe to inline all of these into one page.');
}

/* ----------------------------- verdict --------------------------------- */
console.log('');
if (fatal) {
  console.log('VERDICT: not animatable as-is. Tell the user before starting:');
  for (const r of report) {
    if (r.outlined) console.log(`  ${r.f}: text is outlined — re-export with "Include text" / without "Outline text".`);
    if (r.unnamed)  console.log(`  ${r.f}: layers have no usable names — name the frames/groups in Figma and re-export.`);
    if (!r.vb)      console.log(`  ${r.f}: no viewBox — the camera has nothing to drive.`);
  }
  process.exit(1);
}
console.log(warn
  ? 'VERDICT: animatable, with caveats noted above (bitmaps or duplicate ids).'
  : 'VERDICT: ready — live text, named layers, pure vector, no external deps.');
console.log('Remember to confirm the listed fonts are installed, and embed them in the page.');
