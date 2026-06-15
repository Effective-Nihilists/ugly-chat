/**
 * Screenshot each design mockup (mockups/<name>.html) into screenshots/mock/.
 * Each mockup contains a `.desktop` frame and a `.phone` frame side by side; we
 * shoot each element separately so it lines up with the live desktop/mobile
 * captures produced by capture.ts. No network/auth needed (file:// load).
 *
 * Run: npx tsx scripts/screenshots/capture-mocks.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MOCK_DIR = path.join(REPO, 'mockups');
const OUT_DIR = path.join(REPO, 'screenshots', 'mock');

// mock html file (no ext) -> screenshot key
const MAP: Record<string, string> = {
  'conversation-list': 'list',
  'chat': 'chat-bot',
  'chat-human': 'chat-human',
  'new-chat': 'new-chat',
  'new-group': 'new-group',
  'chat-settings': 'settings-group',
  'call-bot': 'call-bot',
  'call-2p': 'call-2p',
};

async function main(): Promise<void> {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const results: Array<{ key: string; desktop: boolean; phone: boolean; error?: string }> = [];

  for (const [file, key] of Object.entries(MAP)) {
    const htmlPath = path.join(MOCK_DIR, `${file}.html`);
    const row = { key, desktop: false, phone: false } as {
      key: string;
      desktop: boolean;
      phone: boolean;
      error?: string;
    };
    if (!fs.existsSync(htmlPath)) {
      row.error = 'mock html missing';
      results.push(row);
      continue;
    }
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    try {
      await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle' });
      await page.waitForTimeout(400);
      const desktop = page.locator('.desktop').first();
      if (await desktop.count()) {
        await desktop.screenshot({ path: path.join(OUT_DIR, `${key}-desktop.png`) });
        row.desktop = true;
      }
      const phone = page.locator('.phone').first();
      if (await phone.count()) {
        await phone.screenshot({ path: path.join(OUT_DIR, `${key}-mobile.png`) });
        row.phone = true;
      }
    } catch (err) {
      row.error = err instanceof Error ? err.message : String(err);
    } finally {
      await page.close();
    }
    results.push(row);
    console.log(`[mock] ${key}: desktop=${row.desktop} mobile=${row.phone}${row.error ? ' ERR=' + row.error : ''}`);
  }

  await browser.close();
  console.log('[mock] done ->', OUT_DIR);
}

main().catch((err) => {
  console.error('[mock] FAILED:', err);
  process.exit(1);
});
