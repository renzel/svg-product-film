// cdp.mjs — a ~100 line Chrome DevTools Protocol client.
// Node 22+ ships a WebSocket client, so this needs no npm packages at all.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const CHROME = process.env.CHROME_PATH
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function launch({ port = 9333, width, height } = {}) {
  const profile = mkdtempSync(join(tmpdir(), 'planloom-chrome-'));
  const args = [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`,
    // Determinism: same pixels on every run.
    '--force-color-profile=srgb',
    '--disable-lcd-text',
    '--font-render-hinting=none',
    '--disable-font-subpixel-positioning',
    '--disable-partial-raster',
    '--disable-skia-runtime-opts',
    '--run-all-compositor-stages-before-draw',
    '--disable-new-content-rendering-timeout',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-ipc-flooding-protection',
    '--hide-scrollbars', '--mute-audio', '--no-first-run',
    '--no-default-browser-check', '--disable-extensions',
    '--disable-dev-shm-usage', '--allow-file-access-from-files',
    'about:blank',
  ];
  const proc = spawn(CHROME, args, { stdio: ['ignore', 'ignore', 'ignore'] });

  let wsUrl = null;
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      wsUrl = (await r.json()).webSocketDebuggerUrl;
      if (wsUrl) break;
    } catch { /* not up yet */ }
    await sleep(100);
  }
  if (!wsUrl) { proc.kill('SIGKILL'); throw new Error('Chrome did not expose a debugger socket'); }

  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let nextId = 1;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id); pending.delete(msg.id);
      msg.error ? rej(new Error(`${msg.error.message} ${msg.error.data ?? ''}`)) : res(msg.result);
    } else if (msg.method) {
      for (const fn of listeners) fn(msg);
    }
  };

  const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
    const id = nextId++;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });

  const once = (method, sessionId) => new Promise(res => {
    const fn = msg => {
      if (msg.method === method && (!sessionId || msg.sessionId === sessionId)) {
        listeners.splice(listeners.indexOf(fn), 1); res(msg.params);
      }
    };
    listeners.push(fn);
  });

  const close = async () => {
    try { ws.close(); } catch {}
    proc.kill('SIGKILL');
    await sleep(150);
    try { rmSync(profile, { recursive: true, force: true }); } catch {}
  };

  return { send, once, close };
}

export async function openPage(browser, { url, width, height, scale = 1 }) {
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
  const S = (m, p) => browser.send(m, p, sessionId);

  await S('Page.enable');
  await S('Runtime.enable');
  await S('Emulation.setDeviceMetricsOverride',
    { width, height, deviceScaleFactor: scale, mobile: false });
  // No clock freeze needed: the page has no timers, no rAF and no Date use.
  // Every pixel is a pure function of the timestamp we pass to __renderAt().

  const loaded = browser.once('Page.loadEventFired', sessionId);
  await S('Page.navigate', { url });
  await loaded;
  return { sessionId, S };
}

export async function evaluate(S, expression, awaitPromise = true) {
  const r = await S('Runtime.evaluate', {
    expression, awaitPromise, returnByValue: true, userGesture: true,
  });
  if (r.exceptionDetails) {
    const e = r.exceptionDetails;
    throw new Error(e.exception?.description || e.text || 'page threw');
  }
  return r.result?.value;
}

export async function shot(S, { width, height }) {
  const r = await S('Page.captureScreenshot', {
    format: 'png',
    clip: { x: 0, y: 0, width, height, scale: 1 },
    captureBeyondViewport: false,
    fromSurface: true,
    optimizeForSpeed: true,
  });
  return Buffer.from(r.data, 'base64');
}
