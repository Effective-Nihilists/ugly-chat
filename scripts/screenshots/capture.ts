/**
 * Capture every core screen of the DEPLOYED app (https://ugly.chat) for the
 * synthetic screenshot user, on desktop + mobile, into screenshots/actual/.
 * Pairs 1:1 with the mock captures (capture-mocks.ts) for side-by-side compare.
 *
 * Auth mirrors scripts/seed-screenshots.ts: an HS256 JWT minted with ugly.bot's
 * AUTH_SECRET (sibling ../ugly-bot publish-state), injected as the auth cookie.
 *
 * Each target is independently try/caught so one failure doesn't kill the run.
 * The two call screens are BEST EFFORT (fake media devices) and may fail/skip.
 *
 * Run seed-screenshots.ts first. Then: npx tsx scripts/screenshots/capture.ts
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { UGLY_BOT_ID } from '../../shared/bots';
import { directConversationId } from '../../shared/conversationId';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT_DIR = path.join(REPO, 'screenshots', 'actual');
const BASE = 'https://ugly.chat';

const SCREENSHOT_USER_ID =
  process.env['SCREENSHOT_USER_ID'] ?? '5c0e5c0e-0000-4000-8000-5c0e5c0e5c0e';
const SCREENSHOT_PARTNER_USER_ID =
  process.env['SCREENSHOT_PARTNER_USER_ID'] ?? '5c0e5c0e-0000-4000-8000-5c0e5c0e5c0f';
const GROUP_ID = 'grp-screenshot-demo';

const BOT_DM_ID = `${UGLY_BOT_ID}+${SCREENSHOT_USER_ID}`;
const HUMAN_DM_ID = directConversationId(SCREENSHOT_USER_ID, SCREENSHOT_PARTNER_USER_ID);

interface UglyApp {
  projectId?: string;
}
function publishAnonKey(repoDir: string): string {
  const { projectId } = JSON.parse(
    fs.readFileSync(path.join(repoDir, '.uglyapp'), 'utf8'),
  ) as UglyApp;
  if (!projectId) throw new Error(`.uglyapp in ${repoDir} has no projectId`);
  const f = path.join(os.homedir(), '.ugly-studio', 'projects', projectId, 'publish-state.json');
  const s = JSON.parse(fs.readFileSync(f, 'utf8')) as { neon?: { anonKey?: string } };
  if (!s.neon?.anonKey) throw new Error(`No neon.anonKey in ${f}`);
  return s.neon.anonKey;
}
function mintToken(userId: string, secret: string): string {
  const enc = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const data = `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc({ sub: userId, iat: now, exp: now + 3600 })}`;
  const sig = crypto.createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${sig}`;
}

const HIDE_CSS = '[data-id="feedback-button"]{display:none!important}';

// ugly-app's injectAuthCookie() hardcodes domain=localhost; we shoot prod, so
// inject the auth_token cookie for the ugly.chat host directly.
async function injectProdAuthCookie(context: BrowserContext, token: string): Promise<void> {
  await context.addCookies([
    {
      name: 'auth_token',
      value: token,
      domain: new URL(BASE).hostname,
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    },
  ]);
}

type Device = 'desktop' | 'mobile';
const DEVICES: Device[] = ['desktop', 'mobile'];

interface Target {
  key: string;
  route: string;
  /** best-effort call screens get extra setup + flaky tolerance */
  call?: boolean;
}

const TARGETS: Target[] = [
  { key: 'list', route: '/chat' },
  { key: 'chat-bot', route: `/chat/${BOT_DM_ID}` },
  { key: 'chat-human', route: `/chat/${HUMAN_DM_ID}` },
  { key: 'new-chat', route: '/new' },
  { key: 'new-group', route: '/new-group' },
  { key: 'settings-group', route: `/settings/${GROUP_ID}` },
  { key: 'settings', route: '/settings' },
  { key: 'call-bot', route: `/chat/${BOT_DM_ID}`, call: true },
  { key: 'call-2p', route: `/chat/${HUMAN_DM_ID}`, call: true },
];

interface Result {
  key: string;
  device: Device;
  ok: boolean;
  error?: string;
}

async function shoot(
  browser: Browser,
  token: string,
  t: Target,
  device: Device,
): Promise<Result> {
  const res: Result = { key: t.key, device, ok: false };
  // Desktop: 1280x832. Mobile: iPhone-ish viewport + the app's own `?app=ios`
  // device hint (the same param ugly-app's setDevice sets) — we set it via the
  // URL instead of setDevice() to avoid its broken visible-[data-id] wait.
  const context = await browser.newContext(
    device === 'desktop'
      ? { viewport: { width: 1280, height: 832 } }
      : { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  );
  let page: Page | null = null;
  try {
    await injectProdAuthCookie(context, token);
    page = await context.newPage();
    const deviceParam = device === 'mobile' ? '&app=ios' : '';
    await page.goto(`${BASE}${t.route}?screenshot=1${deviceParam}`, { waitUntil: 'domcontentloaded' });
    // NOTE: ugly-app's waitForApp() waits for a *visible* [data-id], but
    // ugly.chat's only top-level [data-id] isn't reported visible by Playwright
    // even when the page is fully rendered → it always times out. Wait for the
    // React root to have real content + the network to go idle instead.
    await page.waitForFunction(
      () => (document.querySelector('#root, #app, body > div')?.textContent?.trim().length ?? 0) > 20,
      undefined,
      { timeout: 25000 },
    );
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await page.addStyleTag({ content: HIDE_CSS });

    if (t.call) {
      // Start the call: header button is aria-label="Start video call".
      const btn = page.getByRole('button', { name: 'Start video call' });
      await btn.click({ timeout: 8000 });
      // Wait for the call panel to mount.
      await page.locator('[data-id="video-call"]').first().waitFor({ state: 'visible', timeout: 12000 });
      await page.waitForTimeout(3000);
      await page.screenshot({ path: path.join(OUT_DIR, `${t.key}-${device}.png`) });
      res.ok = true;
      // Tear the call down so the conversation's server-side `call` roster is
      // cleared — otherwise the next visit to this DM shows a stale call overlay.
      await page.getByRole('button', { name: 'Leave call' }).click({ timeout: 4000 }).catch(() => undefined);
      await page.waitForTimeout(800);
    } else {
      // A previous run may have left a stale call overlay on this conversation;
      // dismiss it so the plain chat screen isn't polluted.
      const leave = page.getByRole('button', { name: 'Leave call' });
      if (await leave.count()) {
        await leave.first().click({ timeout: 3000 }).catch(() => undefined);
        await page.waitForTimeout(1200);
      }
      await page.waitForTimeout(2500);
      await page.screenshot({ path: path.join(OUT_DIR, `${t.key}-${device}.png`) });
      res.ok = true;
    }
  } catch (err) {
    res.error = err instanceof Error ? err.message.split('\n')[0] : String(err);
    // best-effort: still try to grab whatever is on screen for call targets
    if (t.call && page) {
      try {
        await page.screenshot({ path: path.join(OUT_DIR, `${t.key}-${device}.png`) });
      } catch {
        /* ignore */
      }
    }
  } finally {
    await context.close();
  }
  return res;
}

async function main(): Promise<void> {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const secret = publishAnonKey(path.join(REPO, '..', 'ugly-bot'));
  const token = mintToken(SCREENSHOT_USER_ID, secret);

  // Fake media so getUserMedia resolves for the call screens.
  const browser = await chromium.launch({
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });

  const results: Result[] = [];
  for (const t of TARGETS) {
    for (const device of DEVICES) {
      const r = await shoot(browser, token, t, device);
      results.push(r);
      console.log(`[shot] ${r.key}-${r.device}: ${r.ok ? 'PASS' : 'FAIL ' + (r.error ?? '')}`);
    }
  }

  await browser.close();

  // Persist the results so build-compare.ts can show a success/fail header.
  fs.writeFileSync(path.join(OUT_DIR, 'results.json'), JSON.stringify(results, null, 2));

  console.log('\n=== SUMMARY ===');
  for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.key}-${r.device}${r.error ? '  ' + r.error : ''}`);
  }
  console.log('\n[capture] done ->', OUT_DIR);
}

main().catch((err) => {
  console.error('[capture] FAILED:', err);
  process.exit(1);
});
