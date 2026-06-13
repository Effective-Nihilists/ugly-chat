// Rasterize client/public/favicon.svg → icon.png (512) + apple-touch-icon (180)
// using the installed Playwright Chromium. Run: node scripts/render-icon.mjs
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';

const svg = readFileSync(new URL('../client/public/favicon.svg', import.meta.url), 'utf8');
const browser = await chromium.launch();
try {
  for (const size of [512, 180]) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(
      `<!doctype html><html><body style="margin:0">
         <div style="width:${size}px;height:${size}px">${svg.replace('width="512" height="512"', `width="${size}" height="${size}"`)}</div>
       </body></html>`,
      { waitUntil: 'networkidle' },
    );
    const buf = await page.locator('svg').screenshot({ omitBackground: true });
    const out = size === 512 ? 'icon.png' : 'apple-touch-icon.png';
    writeFileSync(new URL(`../client/public/${out}`, import.meta.url), buf);
    console.log(`wrote client/public/${out} (${size}x${size}, ${buf.length}b)`);
    await page.close();
  }
} finally {
  await browser.close();
}
