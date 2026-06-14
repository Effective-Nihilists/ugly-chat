/**
 * E2E: cross-app conversation access control.
 *
 * An app may read/post in a conversation only if it CREATED it (matching appId)
 * OR one of ITS OWN bots is a member. Verifies isolation between apps + the
 * cross-app-bot exception.
 *
 * Run: node tests/e2e/app-access.e2e.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SignJWT } from 'jose';

const AUTH_SECRET = JSON.parse(
  fs.readFileSync(path.join(os.homedir(), '.ugly-studio', 'projects', 'RpK_ri0bJB', 'publish-state.json'), 'utf8'),
).neon.anonKey;
const OWNER = '1AOVA8bnlsNzzHElpC8Fc8GbNca2';

let pass = true;
const ok = (c, m) => { if (!c) pass = false; console.log(`${c ? '✓' : '✗ FAIL'}  ${m}`); };

async function main() {
  const dev = await new SignJWT({ sub: OWNER }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime(Math.floor(Date.now() / 1000) + 3600).sign(new TextEncoder().encode(AUTH_SECRET));
  const mint = async (projectId) =>
    (await (await fetch('https://ugly.bot/v1/chat/issue-token', { method: 'POST', headers: { Authorization: `Bearer ${dev}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ appName: projectId, projectId }) })).json()).token;
  const A = await mint('objz2yji6m');
  const B = await mint('testapp2xyz');
  const call = async (tok, p, b) => {
    const r = await fetch(`https://ugly.chat${p}`, { method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
    return { status: r.status, j: await r.json().catch(() => ({})) };
  };

  const c1 = (await call(A, '/app/conversation/create', { title: 'A only', memberUserIds: ['userA1'] })).j.conversationId;
  ok((await call(A, '/app/message/list', { conversationId: c1 })).status === 200, 'App A reads its own conversation');
  ok((await call(B, '/app/message/list', { conversationId: c1 })).status === 403, 'App B is forbidden from App A conversation');

  const bBot = (await call(B, '/app/bot/register', { key: 'helper', name: 'B Helper' })).j.botId;
  const c2 = (await call(A, '/app/conversation/create', { title: 'shared', memberUserIds: ['userA1'], botIds: [bBot] })).j.conversationId;
  ok((await call(A, '/app/message/list', { conversationId: c2 })).status === 200, 'App A reads conv it created (with B bot)');
  ok((await call(B, '/app/message/list', { conversationId: c2 })).status === 200, 'App B reads conv where its bot is a member');
  ok((await call(B, '/app/message/create', { conversationId: c2, asUserId: bBot, message: { text: 'hi' } })).status === 200, 'App B posts as its bot in the shared conv');

  console.log(`\n${pass ? '✅ PASS — app access rule enforced' : '❌ FAIL'}\n`);
  process.exit(pass ? 0 : 1);
}
main().catch((e) => { console.error('crashed:', e); process.exit(1); });
