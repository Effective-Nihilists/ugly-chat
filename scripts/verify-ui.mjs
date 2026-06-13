// Browser smoke test — verifies the chat UI renders, receives a realtime
// message, and the video call UI works (local camera via fake media + bot tile).
//   AUTH_SECRET=... node scripts/verify-ui.mjs
import { chromium } from '@playwright/test';
import { createHmac, randomUUID } from 'node:crypto';

const BASE = process.env.BASE_URL ?? 'http://localhost:4321';
const SECRET = process.env.AUTH_SECRET ?? 'ugly-chat-dev-secret-local-only';
const ROOM = 'demo-room'; // what ChatPage subscribes to

const b64url = (s) => Buffer.from(s).toString('base64url');
function mintToken(userId) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(JSON.stringify({ sub: userId, iat: now, exp: now + 3600 }));
  const data = `${header}.${payload}`;
  return `${data}.${createHmac('sha256', SECRET).update(data).digest('base64url')}`;
}
async function rpc(token, name, input) {
  const res = await fetch(`${BASE}/api/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ input }),
  });
  if (!res.ok) throw new Error(`${name} → HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

let failures = 0;
const assert = (ok, msg) => { console.log(`${ok ? '✓' : '✗'} ${msg}`); if (!ok) failures++; };

const viewer = `viewer-${randomUUID().slice(0, 8)}`;
const alice = `alice-${randomUUID().slice(0, 8)}`;
const token = mintToken(viewer);
const marker = `ping-${randomUUID().slice(0, 6)}`;

const browser = await chromium.launch({
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
});
try {
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') console.log('  [browser-error]', m.text().slice(0, 160)); });

  // 1. Load authed (?token → cookie) and wait for the chat UI
  await page.goto(`${BASE}/chat?token=${token}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('text=Start video', { timeout: 15000 });
  assert(true, 'chat page loaded authenticated (VideoCall mounted)');

  // 2. A realtime message from another user appears in the list
  await rpc(mintToken(alice), 'conversationMessageCreate', {
    conversationId: ROOM,
    message: { text: marker, markdown: marker },
  });
  await page.waitForSelector(`text=${marker}`, { timeout: 10000 });
  assert(true, `realtime incoming message rendered ("${marker}")`);

  // 3. Start video → local camera tile + "in call"
  await page.click('text=Start video');
  await page.waitForSelector('text=/in call/', { timeout: 10000 });
  await page.waitForSelector('video', { timeout: 10000 });
  assert(true, 'video started — local camera tile + roster shown');

  // 4. Add bot → bot fake-call avatar tile (🤖) appears
  await page.click('text=+ Bot');
  await page.waitForSelector('text=🤖', { timeout: 10000 });
  assert(true, 'bot joined the call as a fake-call avatar tile');
} catch (err) {
  failures++;
  console.error('\n✗ ERROR:', err.message);
} finally {
  await browser.close();
}

console.log(`\n${failures === 0 ? '✅ UI VERIFIED' : `❌ ${failures} failure(s)`}\n`);
process.exit(failures === 0 ? 0 : 1);
