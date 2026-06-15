/**
 * Build screenshots/compare.html: for each screen key, the design MOCK
 * (desktop + mobile) on the left and the live ACTUAL capture on the right, so
 * divergence is visible at a glance. Reads screenshots/actual/results.json (if
 * present) for the PASS/FAIL header.
 *
 * Run after capture-mocks.ts + capture.ts: npx tsx scripts/screenshots/build-compare.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHOTS = path.join(REPO, 'screenshots');
const OUT = path.join(SHOTS, 'compare.html');

// Ordered keys -> human label.
const KEYS: Array<{ key: string; label: string }> = [
  { key: 'list', label: 'Conversation list' },
  { key: 'chat-bot', label: 'Chat — bot DM' },
  { key: 'chat-human', label: 'Chat — human DM' },
  { key: 'new-chat', label: 'New chat' },
  { key: 'new-group', label: 'New group' },
  { key: 'settings-group', label: 'Group settings' },
  { key: 'settings', label: 'Settings' },
  { key: 'call-bot', label: 'Call — bot (best effort)' },
  { key: 'call-2p', label: 'Call — 2-person (best effort)' },
];

interface Result {
  key: string;
  device: string;
  ok: boolean;
  error?: string;
}

function exists(rel: string): boolean {
  return fs.existsSync(path.join(SHOTS, rel));
}

function imgCell(rel: string, alt: string): string {
  return exists(rel)
    ? `<img src="${rel}" alt="${alt}" loading="lazy">`
    : `<div class="missing">no capture<br><small>${alt}</small></div>`;
}

function main(): void {
  let results: Result[] = [];
  const rp = path.join(SHOTS, 'actual', 'results.json');
  if (fs.existsSync(rp)) {
    results = JSON.parse(fs.readFileSync(rp, 'utf8')) as Result[];
  }
  const statusFor = (key: string): { pass: number; fail: number; errs: string[] } => {
    const rows = results.filter((r) => r.key === key);
    return {
      pass: rows.filter((r) => r.ok).length,
      fail: rows.filter((r) => !r.ok).length,
      errs: rows.filter((r) => !r.ok && r.error).map((r) => `${r.device}: ${r.error}`),
    };
  };

  const headerRows = KEYS.map(({ key, label }) => {
    const s = statusFor(key);
    const badge = s.fail === 0 && s.pass > 0 ? 'ok' : s.pass > 0 ? 'partial' : 'fail';
    return `<tr><td>${label}</td><td class="b ${badge}">${s.pass} pass / ${s.fail} fail</td><td class="errs">${s.errs.join('<br>') || '—'}</td></tr>`;
  }).join('\n');

  const sections = KEYS.map(({ key, label }) => {
    return `
  <section>
    <h2>${label} <span class="key">${key}</span></h2>
    <div class="grid">
      <div class="col">
        <div class="coltitle mock">MOCK</div>
        <div class="pair">
          <figure><figcaption>desktop</figcaption>${imgCell(`mock/${key}-desktop.png`, `${key} mock desktop`)}</figure>
          <figure class="phone"><figcaption>mobile</figcaption>${imgCell(`mock/${key}-mobile.png`, `${key} mock mobile`)}</figure>
        </div>
      </div>
      <div class="col">
        <div class="coltitle actual">ACTUAL (ugly.chat)</div>
        <div class="pair">
          <figure><figcaption>desktop</figcaption>${imgCell(`actual/${key}-desktop.png`, `${key} actual desktop`)}</figure>
          <figure class="phone"><figcaption>mobile</figcaption>${imgCell(`actual/${key}-mobile.png`, `${key} actual mobile`)}</figure>
        </div>
      </div>
    </div>
  </section>`;
  }).join('\n');

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ugly Chat — mock vs actual</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 24px; background: #0c0d11; color: #e6e8ee; font: 14px/1.5 -apple-system, system-ui, sans-serif; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .sub { color: #8b90a0; margin: 0 0 20px; }
  table.summary { border-collapse: collapse; margin: 0 0 32px; width: 100%; max-width: 900px; }
  table.summary td, table.summary th { border: 1px solid #23262f; padding: 6px 10px; text-align: left; }
  table.summary th { background: #15171e; }
  .b.ok { color: #57d977; } .b.partial { color: #e8c14a; } .b.fail { color: #ec5b67; }
  .errs { color: #b07a7f; font-size: 12px; }
  section { margin: 0 0 40px; border-top: 1px solid #1c1f28; padding-top: 20px; }
  h2 { font-size: 17px; margin: 0 0 14px; }
  h2 .key { color: #6b7080; font-weight: 400; font-size: 13px; margin-left: 8px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
  .coltitle { font-weight: 700; font-size: 12px; letter-spacing: .08em; margin: 0 0 10px; padding: 4px 8px; border-radius: 4px; display: inline-block; }
  .coltitle.mock { background: #1d2440; color: #8aa6ff; }
  .coltitle.actual { background: #1d3a2a; color: #6fe0a0; }
  .pair { display: flex; gap: 16px; align-items: flex-start; flex-wrap: wrap; }
  figure { margin: 0; }
  figcaption { font-size: 11px; color: #7b8090; margin: 0 0 6px; }
  img { max-width: 100%; width: 620px; border: 1px solid #23262f; border-radius: 6px; background: #fff; display: block; }
  figure.phone img { width: 300px; }
  .missing { width: 300px; height: 200px; border: 1px dashed #3a3030; border-radius: 6px; color: #b07a7f; display: flex; align-items: center; justify-content: center; text-align: center; background: #16121280; }
</style>
</head>
<body>
  <h1>Ugly Chat — design mock vs deployed (https://ugly.chat)</h1>
  <p class="sub">Left = mockups/*.html · Right = live capture · generated ${new Date().toISOString()}</p>
  <table class="summary">
    <thead><tr><th>Screen</th><th>Actual capture</th><th>Errors</th></tr></thead>
    <tbody>${headerRows}</tbody>
  </table>
  ${sections}
</body>
</html>`;

  fs.writeFileSync(OUT, html);
  console.log('[compare] wrote', OUT);
}

main();
