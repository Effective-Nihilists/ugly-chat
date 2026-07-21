// Prove a genuine 3-way call: all three publishing tracks on the server roster,
// then capture what the stage actually renders.
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
mkdirSync('.shots', { recursive: true });

const BASE = 'https://ugly.chat';
const CONV = process.argv[2];
const P = [
  ['Dmitri', process.env.T_DMITRI],
  ['Ana', process.env.T_ANA],
  ['Ben', process.env.T_BEN],
];

const api = async (name, token, input) => {
  const r = await fetch(`${BASE}/api/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ input }),
  });
  return (await r.json()).result;
};

await api('conversationVideoEnd', P[0][1], { conversationId: CONV });

const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});

const open = async (token, viewport) => {
  const ctx = await browser.newContext({ viewport, permissions: ['camera', 'microphone'] });
  await ctx.addCookies([{ name: 'auth_token', value: token, domain: 'ugly.chat', path: '/', secure: true }]);
  const p = await ctx.newPage();
  p.on('console', (m) => { const t = m.text(); if (/VideoCall|realtime|Realtime|error|failed|denied/i.test(t)) console.log('    [pg]', t.slice(0,150)); });
  p.on('pageerror', (e) => console.log('    [pageerror]', String(e).slice(0,150)));
  await p.goto(`${BASE}/${CONV}`, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#root > *', { timeout: 25000 });
  await p.waitForTimeout(2500);
  return { ctx, p };
};

const D = { width: 1280, height: 800 };
const M = { width: 390, height: 844 };
const viewport = process.argv[3] === 'mobile' ? M : D;

const a = await open(P[0][1], viewport); // host
const b = await open(P[1][1], D);
const c = await open(P[2][1], D);

// Host starts
await a.p.locator('button[title*="ideo call"], button[title*="Voice call"]').first().click();
await a.p.waitForTimeout(1500);
await a.p.locator('[data-id="call-lobby-join"]').click().catch(() => {});
await a.p.waitForTimeout(2500);

// Both others accept
for (const x of [b, c]) {
  await x.p.waitForSelector('[data-id="incoming-call"]', { timeout: 30000 });
  await x.p.locator('[data-id="incoming-call-accept"]').click();
  await x.p.waitForTimeout(1500);
  await x.p.locator('[data-id="call-lobby-join"]').click().catch(() => {});
  await x.p.waitForTimeout(2000);
}

// Let SFU publish/pull settle
await a.p.waitForTimeout(12000);

// SERVER TRUTH: who is on the roster and is each publishing tracks?
const state = await api('conversationVideoState', P[0][1], { conversationId: CONV });
console.log('— server roster —');
for (const [id, p] of Object.entries(state.participants ?? {})) {
  console.log(`  ${id.slice(0, 10)} isBot=${p.isBot} session=${p.sessionId ? 'yes' : 'NO'} tracks=${(p.tracks ?? []).length}`);
}
console.log('  active:', state.active, '| participants:', Object.keys(state.participants ?? {}).length);

// CLIENT TRUTH: what does each page render?
for (const [name, x] of [['Dmitri(host)', a], ['Ana', b], ['Ben', c]]) {
  const v = await x.p.evaluate(() => {
    const vids = [...document.querySelectorAll('video')];
    return {
      videoEls: vids.length,
      liveFeeds: vids.filter((e) => e.videoWidth > 0).length,
      peerTiles: document.querySelectorAll('[data-id="call-tile-peer"]').length,
    };
  });
  console.log(`  ${name}:`, JSON.stringify(v));
}

await a.p.screenshot({ path: `.shots/group3-${process.argv[3] === 'mobile' ? 'mobile' : 'desktop'}.png` });
console.log('shot saved');
await browser.close();
