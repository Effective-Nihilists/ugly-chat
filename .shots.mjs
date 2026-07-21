// Capture real video-call screenshots across scenarios × viewports.
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';

const OUT = '.shots';
mkdirSync(OUT, { recursive: true });
const BASE = 'https://ugly.chat';
const DESKTOP = { width: 1280, height: 800 };
const MOBILE = { width: 390, height: 844 };

const T = {
  vera: process.env.T_VERA,
  tom: process.env.T_TOM,
  dmitri: process.env.T_DMITRI,
  ana: process.env.T_ANA,
  ben: process.env.T_BEN,
};

const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});

async function open(token, viewport, conv) {
  const ctx = await browser.newContext({ viewport, permissions: ['camera', 'microphone'] });
  await ctx.addCookies([{ name: 'auth_token', value: token, domain: 'ugly.chat', path: '/', secure: true }]);
  const p = await ctx.newPage();
  await p.goto(`${BASE}/${conv}`, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#root > *', { timeout: 25000 });
  await p.waitForTimeout(2500);
  return { ctx, p };
}

// Start a call from the header, through the lobby.
async function startCall(p) {
  await p.locator('button[title*="ideo call"], button[title*="Voice call"]').first().click();
  await p.waitForSelector('[data-id="call-lobby"]', { timeout: 15000 }).catch(() => {});
  await p.waitForTimeout(1200);
  await p.locator('[data-id="call-lobby-join"]').click().catch(() => {});
  await p.waitForTimeout(1000);
}

// Accept an incoming ring (accept -> lobby -> join).
async function accept(p) {
  await p.waitForSelector('[data-id="incoming-call"]', { timeout: 25000 });
  await p.locator('[data-id="incoming-call-accept"]').click();
  await p.waitForTimeout(1200);
  await p.locator('[data-id="call-lobby-join"]').click().catch(() => {});
  await p.waitForTimeout(1000);
}

const shot = async (p, name) => {
  await p.screenshot({ path: `${OUT}/${name}.png` });
  console.log('shot:', name);
};
const probe = async (p) => p.evaluate(() => {
  const v = [...document.querySelectorAll('video')];
  return { videos: v.length, live: v.filter((x) => x.videoWidth > 0).length };
});

const scenario = process.argv[2];
const conv = process.argv[3];

// Clear any call left active by a previous run — otherwise the "peer" is already
// a participant and never gets an incoming ring.
async function endCall(token) {
  await fetch(`${BASE}/api/conversationVideoEnd`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ input: { conversationId: conv } }),
  }).catch(() => {});
}

if (scenario === 'bot') {
  for (const [vp, tag] of [[DESKTOP, 'desktop'], [MOBILE, 'mobile']]) {
    await endCall(T.vera);
    const { ctx, p } = await open(T.vera, vp, conv);
    await startCall(p);
    await p.waitForTimeout(9000); // let the bot avatar tile mount + speak
    console.log(tag, await probe(p));
    await shot(p, `bot-${tag}`);
    // MUST close before the next viewport: the fake camera is a single shared
    // device, so a leaked context keeps hold of it and the next run's self-view
    // is starved to black — which reads exactly like an app bug in a screenshot.
    await ctx.close();
  }
}

if (scenario === '1to1') {
  for (const [vp, tag] of [[DESKTOP, 'desktop'], [MOBILE, 'mobile']]) {
    await endCall(T.vera);
    const a = await open(T.vera, vp, conv);
    const b = await open(T.tom, DESKTOP, conv);
    await startCall(a.p);
    await accept(b.p);
    await a.p.waitForTimeout(8000);
    console.log(tag, 'caller', await probe(a.p), 'peer', await probe(b.p));
    await shot(a.p, `1to1-${tag}`);
    if (tag === 'desktop') await shot(b.p, `1to1-peer-desktop`);
    await a.ctx.close(); await b.ctx.close();
  }
}

if (scenario === 'group') {
  for (const [vp, tag] of [[DESKTOP, 'desktop'], [MOBILE, 'mobile']]) {
    await endCall(T.dmitri);
    const a = await open(T.dmitri, vp, conv);
    const b = await open(T.ana, DESKTOP, conv);
    const c = await open(T.ben, DESKTOP, conv);
    await startCall(a.p);
    await Promise.all([accept(b.p), accept(c.p)]);
    await a.p.waitForTimeout(9000);
    console.log(tag, 'host', await probe(a.p));
    await shot(a.p, `group-${tag}`);
    await a.ctx.close(); await b.ctx.close(); await c.ctx.close();
  }
}

await browser.close();
