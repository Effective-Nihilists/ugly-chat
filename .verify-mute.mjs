// Tom's second blocker: mute off→on permanently killed the self-view.
import { chromium } from 'playwright';
const CONV = 'bc-bot-ugly-t4ECys2fReAPKnIImDZsS';
const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream'] });
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['camera','microphone'] });
await ctx.addCookies([{ name: 'auth_token', value: process.env.T_TOM, domain: 'ugly.chat', path: '/', secure: true }]);
const p = await ctx.newPage();
await p.goto(`https://ugly.chat/${CONV}`, { waitUntil: 'domcontentloaded' });
await p.waitForSelector('#root > *', { timeout: 25000 });
await p.waitForTimeout(4000);
await p.waitForSelector('button[title*="ideo call"]', { timeout: 30000 });
await p.locator('button[title*="ideo call"]').first().click();
await p.waitForTimeout(1500);
await p.locator('[data-id="call-lobby-join"]').click().catch(() => {});
await p.waitForTimeout(8000);

const self = () => p.evaluate(() => {
  const v = document.querySelector('[data-id="call-tile-self"] video');
  const s = v?.srcObject;
  return { paused: v?.paused, vw: v?.videoWidth, display: v ? getComputedStyle(v).display : null,
           tracks: s?.getTracks?.().map(t => `${t.kind}:${t.enabled ? 'on' : 'off'}`) };
});
console.log('baseline        ', JSON.stringify(await self()));
await p.locator('[data-id="call-mic"]').click();   // mute
await p.waitForTimeout(2500);
console.log('after mute      ', JSON.stringify(await self()));
await p.locator('[data-id="call-mic"]').click();   // unmute — this used to kill it
await p.waitForTimeout(5000);
console.log('after unmute    ', JSON.stringify(await self()));
await p.screenshot({ path: '.shots/verify-mute.png' });
await b.close();
