// Tom's critical scenario: end a bot call → does a phantom ring survive?
import { chromium } from 'playwright';
const CONV = 'bc-bot-ugly-t4ECys2fReAPKnIImDZsS';
const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const open = async () => {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['camera', 'microphone'] });
  await ctx.addCookies([{ name: 'auth_token', value: process.env.T_TOM, domain: 'ugly.chat', path: '/', secure: true }]);
  const p = await ctx.newPage();
  await p.goto(`https://ugly.chat/${CONV}`, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#root > *', { timeout: 25000 });
  await p.waitForTimeout(4000);
  return { ctx, p };
};
const rings = (p) => p.evaluate(() => document.body.innerText.includes('INCOMING VIDEO CALL'));

const a = await open();
await a.p.waitForSelector('button[title*="ideo call"]', { timeout: 30000 });
await a.p.locator('button[title*="ideo call"]').first().click();
await a.p.waitForTimeout(1500);
await a.p.locator('[data-id="call-lobby-join"]').click().catch(() => {});
await a.p.waitForTimeout(8000);
console.log('in call; bot on stage:', await a.p.locator('[data-id="call-tile-peer"]').count());

await a.p.locator('[data-id="call-end"]').click();
await a.p.waitForTimeout(4000);
console.log('after hang up — ringing?', await rings(a.p));
await a.p.reload({ waitUntil: 'domcontentloaded' });
await a.p.waitForSelector('#root > *');
await a.p.waitForTimeout(4000);
console.log('after reload    — ringing?', await rings(a.p));
await a.ctx.close();

const c = await open(); // fresh context, like Tom's
console.log('fresh session   — ringing?', await rings(c.p));
await c.p.screenshot({ path: '.shots/verify-hangup.png' });
await b.close();
