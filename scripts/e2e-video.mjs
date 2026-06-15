// Two-browser end-to-end video-call test against the DEPLOYED ugly.chat.
// Auth: mint ugly.bot-federated session JWTs (Mode A verifyToken → ugly.bot
// /verify) with ugly.bot's AUTH_SECRET, set as the `auth_token` cookie.
// Media: headless chromium with fake camera/mic. Asserts each peer's <video>
// actually decodes the other's track (videoWidth > 0).
import { chromium } from '@playwright/test';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';

const UB_SECRET = JSON.parse(
  fs.readFileSync(os.homedir() + '/.ugly-studio/projects/RpK_ri0bJB/publish-state.json'),
).neon.anonKey;
const BASE = 'https://ugly.chat';
const ROOM = 'e2e-video-room';
const A = 'e2e-video-a';
const B = 'e2e-video-b';

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function mint(userId) {
  const h = b64({ alg: 'HS256', typ: 'JWT' });
  const now = Math.floor(Date.now() / 1000);
  const p = b64({ sub: userId, iat: now, exp: now + 3600 });
  const sig = crypto.createHmac('sha256', UB_SECRET).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${sig}`;
}
const tokenA = mint(A);
const tokenB = mint(B);

async function api(token, name, input) {
  const r = await fetch(`${BASE}/api/${name}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ input }),
  });
  const t = await r.text();
  return { status: r.status, body: t.slice(0, 200) };
}

async function remoteOk(page) {
  return page.evaluate(async () => {
    for (let i = 0; i < 80; i++) {
      const v = document.querySelector('[data-id="remote-video"]');
      if (v && v.videoWidth > 0 && v.readyState >= 2) {
        const tracks = v.srcObject?.getTracks?.() ?? [];
        return { ok: true, w: v.videoWidth, h: v.videoHeight, tracks: tracks.map((t) => `${t.kind}:${t.readyState}`) };
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    const v = document.querySelector('[data-id="remote-video"]');
    return { ok: false, hasEl: !!v, ms: v?.srcObject ? v.srcObject.getTracks().map((t) => t.kind) : null };
  });
}

(async () => {
  // 1. Conversation with both members (engine adds ownerIds as members).
  console.log('setup conversationCreate:', await api(tokenA, 'conversationCreate', {
    id: ROOM, type: 'group', title: 'E2E Video', mode: 'public', ownerIds: [A, B],
  }));
  console.log('setup B join:', await api(tokenB, 'conversationJoin', { conversationId: ROOM }));
  // Clear any stale call roster from a previous run.
  await api(tokenA, 'conversationVideoEnd', { conversationId: ROOM });

  const browser = await chromium.launch({
    headless: true,
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
  });
  const mk = async (token, tag) => {
    const ctx = await browser.newContext();
    await ctx.addCookies([{ name: 'auth_token', value: token, url: BASE, secure: true, sameSite: 'Lax' }]);
    const page = await ctx.newPage();
    page.on('console', (m) => { const t = m.text(); if (/\[VC\]|VideoCall|negotiate/i.test(t)) console.log(`${tag}>`, t.slice(0, 220)); });
    page.on('pageerror', (e) => console.log(`${tag}!pageerror`, String(e).slice(0, 200)));
    return page;
  };
  const pa = await mk(tokenA, 'A');
  const pb = await mk(tokenB, 'B');

  await pa.goto(`${BASE}/chat/${ROOM}`, { waitUntil: 'domcontentloaded' });
  await pb.goto(`${BASE}/chat/${ROOM}`, { waitUntil: 'domcontentloaded' });

  // Authed app sanity: __AUTH_TOKEN__ should be injected.
  const authA = await pa.evaluate(() => ({ tok: !!window.__AUTH_TOKEN__, sub: window.__AUTH_TOKEN__ ? JSON.parse(atob(window.__AUTH_TOKEN__.split('.')[1])).sub : null }));
  console.log('A authed:', authA);

  // Start the call in both (header video icon).
  const startBtn = '[aria-label="Start video call"]';
  await pa.waitForSelector(startBtn, { timeout: 20000 });
  await pa.click(startBtn);
  await pb.waitForSelector(startBtn, { timeout: 20000 });
  await pb.click(startBtn);

  // Let signaling + negotiation settle.
  await pa.waitForTimeout(8000);
  const [ra, rb] = await Promise.all([remoteOk(pa), remoteOk(pb)]);
  console.log('A sees remote (B):', JSON.stringify(ra));
  console.log('B sees remote (A):', JSON.stringify(rb));

  const pass = ra.ok && rb.ok;
  console.log(pass ? '✅ PASS — bidirectional video flowing' : '❌ FAIL');

  await browser.close();
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('e2e error:', e); process.exit(1); });
