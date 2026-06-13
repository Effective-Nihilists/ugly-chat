// Automated chat verification — drives the chat RPC over HTTP as two users.
// Self auth mode: mint HS256 tokens with AUTH_SECRET (no deps, no ugly.bot).
//   AUTH_SECRET=... node scripts/verify-chat.mjs
import { createHmac, randomUUID } from 'node:crypto';
import { execSync } from 'node:child_process';

// Ground-truth message count for a room, read straight from Postgres (the same
// rows trackDocs serves to the client).
function dbMessageCount(conversationId) {
  const out = execSync(
    `docker exec ugly-app-postgres psql -U app -d ugly_chat -tA -c ` +
      `"SELECT count(*) FROM message WHERE data->>'conversationId'='${conversationId}' AND (data->>'deleted') IS DISTINCT FROM 'true'"`,
    { encoding: 'utf8' },
  ).trim();
  return parseInt(out, 10);
}

const BASE = process.env.BASE_URL ?? 'http://localhost:4321';
const SECRET = process.env.AUTH_SECRET ?? 'ugly-chat-dev-secret-local-only';

const b64url = (s) => Buffer.from(s).toString('base64url');
function mintToken(userId) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(JSON.stringify({ sub: userId, iat: now, exp: now + 3600 }));
  const data = `${header}.${payload}`;
  const sig = createHmac('sha256', SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

async function rpc(token, name, input) {
  const res = await fetch(`${BASE}/api/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ input }),
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!res.ok) throw new Error(`${name} → HTTP ${res.status}: ${text.slice(0, 300)}`);
  // Framework wraps the handler output as { result: ... }.
  return body && typeof body === 'object' && 'result' in body ? body.result : body;
}

const log = (ok, msg) => console.log(`${ok ? '✓' : '✗'} ${msg}`);
let failures = 0;
function assert(cond, msg) { log(!!cond, msg); if (!cond) failures++; }

const userA = `userA-${randomUUID().slice(0, 8)}`;
const userB = `userB-${randomUUID().slice(0, 8)}`;
const tokenA = mintToken(userA);
const tokenB = mintToken(userB);
const roomId = `verify-${randomUUID().slice(0, 8)}`;

console.log(`\n— Chat verification —\n  room=${roomId}\n  A=${userA}\n  B=${userB}\n`);

try {
  // 1. A creates a group conversation
  const conv = await rpc(tokenA, 'conversationCreate', {
    id: roomId, type: 'group', title: 'Verify Room', mode: 'public', ownerIds: [userA],
  });
  assert(conv, 'conversationCreate returned a conversation');

  // 2. A sends a message
  const mA = await rpc(tokenA, 'conversationMessageCreate', {
    conversationId: roomId, message: { text: 'hello from A', markdown: 'hello from A' },
  });
  assert(mA && (mA._id || mA.id), 'A message created (has id)');

  // 3. B (a different human) joins implicitly + sends a message
  const mB = await rpc(tokenB, 'conversationMessageCreate', {
    conversationId: roomId, message: { text: 'hi from B' },
  });
  assert(mB && (mB._id || mB.id), 'B message created (auto-joined public room)');

  // 4. Both messages persisted (ground truth — same rows trackDocs serves)
  assert(dbMessageCount(roomId) === 2, `2 messages persisted (got ${dbMessageCount(roomId)})`);

  // helper: extract short messageId from a doc _id ("<conv>:<msg>")
  const shortId = (id) => (id.includes(':') ? id.slice(id.indexOf(':') + 1) : id);

  // 5. A reacts to B's message
  await rpc(tokenA, 'conversationMessageReact', {
    conversationId: roomId, messageId: shortId(mB._id || mB.id), reaction: 'heart',
  });
  const reactCount = execSync(
    `docker exec ugly-app-postgres psql -U app -d ugly_chat -tA -c "SELECT count(*) FROM \\"messageReaction\\" WHERE data->>'messageId'='${shortId(mB._id || mB.id)}'"`,
    { encoding: 'utf8' },
  ).trim();
  assert(parseInt(reactCount, 10) >= 1, `reaction persisted (rows=${reactCount})`);

  // 6. A deletes its own message → count drops to 1
  await rpc(tokenA, 'conversationMessageDelete', {
    conversationId: roomId, messageId: shortId(mA._id || mA.id),
  });
  assert(dbMessageCount(roomId) === 1, `after delete, 1 visible message (got ${dbMessageCount(roomId)})`);

  // 7. BOT chat: create a room with a bot, human posts → bot replies
  const botRoom = `verifybot-${randomUUID().slice(0, 8)}`;
  await rpc(tokenA, 'conversationCreate', {
    id: botRoom, type: 'group', title: 'Bot Room', mode: 'public', ownerIds: [userA],
    bots: { 'bot-ugly': { botParams: {}, type: 'assistant' } },
  });
  await rpc(tokenA, 'conversationMessageCreate', {
    conversationId: botRoom, message: { text: 'hello bot', markdown: 'hello bot' },
  });
  const botMsgCount = () => parseInt(execSync(
    `docker exec ugly-app-postgres psql -U app -d ugly_chat -tA -c ` +
      `"SELECT count(*) FROM message WHERE data->>'conversationId'='${botRoom}' AND data->>'userId'='bot-ugly'"`,
    { encoding: 'utf8' },
  ).trim(), 10);
  let botReplied = false;
  for (let i = 0; i < 30 && !botReplied; i++) {
    if (botMsgCount() >= 1) { botReplied = true; break; }
    await new Promise((r) => setTimeout(r, 500));
  }
  assert(botReplied, 'bot replied to a human message');

  // 8. Video call lifecycle: humans + bot join roster, leave, end
  const vroom = `verifyvid-${randomUUID().slice(0, 8)}`;
  await rpc(tokenA, 'conversationCreate', {
    id: vroom, type: 'group', title: 'Video Room', mode: 'public', ownerIds: [userA],
    bots: { 'bot-ugly': { botParams: {}, type: 'assistant' } },
  });
  await rpc(tokenA, 'conversationVideoJoin', { conversationId: vroom });
  await rpc(tokenB, 'conversationVideoJoin', { conversationId: vroom });
  let call = await rpc(tokenA, 'conversationVideoBotJoin', { conversationId: vroom, botId: 'bot-ugly' });
  const n = (c) => Object.keys(c?.participants ?? {}).length;
  assert(call.active && n(call) === 3, `call roster has A + B + bot (got ${n(call)})`);
  assert(call.participants['bot-ugly']?.isBot === true, 'bot is a fake-call participant');
  call = await rpc(tokenA, 'conversationVideoLeave', { conversationId: vroom });
  assert(n(call) === 2, `after A leaves, 2 participants (got ${n(call)})`);
  call = await rpc(tokenB, 'conversationVideoEnd', { conversationId: vroom });
  assert(call.active === false && n(call) === 0, 'video end clears the call');
} catch (err) {
  failures++;
  console.error('\n✗ ERROR:', err.message);
}

console.log(`\n${failures === 0 ? '✅ ALL PASSED' : `❌ ${failures} failure(s)`}\n`);
process.exit(failures === 0 ? 0 : 1);
