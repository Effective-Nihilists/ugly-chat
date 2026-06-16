/**
 * Seed a lively Ugly Bot conversation for the synthetic "screenshot" user so the
 * chat screen shows real personality. See
 * ugly-mobile/scripts/screenshots/SCREENSHOT.md.
 *
 * Chat messages render via a live query backed by the conversation ENGINE +
 * CollectionDO — raw SQL inserts aren't picked up. So this seeds through the
 * deployed app's own API (the same calls the UI makes): conversationCreate
 * (which seeds Ugly Bot's greeting) then conversationMessageCreate (which
 * triggers a real bot reply). Idempotent: it deletes the conversation first so
 * each run rebuilds a clean thread.
 *
 * The prod Neon connection is resolved the same way `ugly-app` publish does
 * (.uglyapp → publish-state.json); the user session token is minted with
 * ugly.bot's AUTH_SECRET (resolved from the sibling ../ugly-bot publish-state).
 *
 * Run: SCREENSHOT_USER_ID="<id>" node_modules/.bin/tsx scripts/seed-screenshot-data.ts
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAdapter, query } from 'ugly-app/server';
import { UGLY_BOT, UGLY_BOT_AVATAR_URL, UGLY_BOT_USER_ID } from '../shared/bots';

const SCREENSHOT_NAME = 'Alex Rivera';
const SCREENSHOT_AVATAR = 'https://api.dicebear.com/9.x/thumbs/png?seed=alex-rivera&size=256';

interface UglyApp {
  projectId?: string;
  deployTarget?: { customDomainUrl?: string; workerUrl?: string };
}

function readUglyApp(repoDir: string): UglyApp {
  return JSON.parse(fs.readFileSync(path.join(repoDir, '.uglyapp'), 'utf8')) as UglyApp;
}

/** publish-state.json for a repo: { connectionString, anonKey(=AUTH_SECRET) }. */
function publishState(repoDir: string): { connectionString: string; anonKey: string } {
  const { projectId } = readUglyApp(repoDir);
  if (!projectId) throw new Error(`.uglyapp in ${repoDir} has no projectId`);
  const f = path.join(os.homedir(), '.ugly-studio', 'projects', projectId, 'publish-state.json');
  const s = JSON.parse(fs.readFileSync(f, 'utf8')) as { neon?: { connectionString?: string; anonKey?: string } };
  if (!s.neon?.connectionString || !s.neon.anonKey) throw new Error(`Incomplete neon state in ${f}`);
  return { connectionString: s.neon.connectionString, anonKey: s.neon.anonKey };
}

function mintToken(userId: string, secret: string): string {
  const enc = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const data = `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc({ sub: userId, iat: now, exp: now + 3600 })}`;
  const sig = crypto.createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${sig}`;
}

async function main(): Promise<void> {
  const userId = process.env['SCREENSHOT_USER_ID'];
  if (!userId) throw new Error('SCREENSHOT_USER_ID not set');

  const repo = process.cwd();
  process.env['DATABASE_URL'] = process.env['DATABASE_URL'] ?? publishState(repo).connectionString;
  createAdapter();

  const base = readUglyApp(repo).deployTarget?.customDomainUrl ?? 'https://ugly.chat';
  // ugly.chat verifies via ugly.bot /verify (Mode A) → sign with ugly.bot's secret.
  const uglyBotRepo = path.join(repo, '..', 'ugly-bot');
  const token = mintToken(userId, publishState(uglyBotRepo).anonKey);
  const conversationId = `${UGLY_BOT_USER_ID}+${userId}`;

  // The bot is a valid session subject too, so we can author its reply directly
  // (deterministic + on-brand) instead of waiting on a live AI generation.
  const botToken = mintToken(UGLY_BOT_USER_ID, publishState(uglyBotRepo).anonKey);
  const api = async (name: string, input: unknown, tok = token): Promise<unknown> => {
    const res = await fetch(`${base}/api/${name}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `auth_token=${tok}` },
      body: JSON.stringify({ input }),
    });
    const json = (await res.json()) as { result?: unknown; error?: string };
    if (!res.ok || json.error) throw new Error(`${name} failed: ${res.status} ${json.error ?? ''}`);
    return json.result;
  };
  const messageCount = async (): Promise<number> => {
    const r = await query<{ n: string }>(
      `SELECT count(*)::text n FROM "message" WHERE data->>'conversationId' = $1`,
      [conversationId],
    );
    return parseInt(r.rows[0]?.n ?? '0', 10);
  };

  // 0. Local userPublic rows so the chat resolves display names instead of raw
  //    ids: the bot (flagged isBot) → "Ugly Bot", and the human → "Alex Rivera".
  const upsertPublic = async (id: string, data: Record<string, unknown>): Promise<void> => {
    await query(
      `INSERT INTO "userPublic" (_id, data, created, updated, version)
       VALUES ($1, $2::jsonb, now(), now(), 1)
       ON CONFLICT (_id) DO UPDATE SET data = EXCLUDED.data, updated = now()`,
      [id, JSON.stringify(data)],
    );
  };
  await upsertPublic(UGLY_BOT_USER_ID, {
    name: UGLY_BOT.name,
    isBot: true,
    avatar: UGLY_BOT_AVATAR_URL,
  });
  await upsertPublic(userId, { name: SCREENSHOT_NAME, avatar: SCREENSHOT_AVATAR });

  // 1. Clean slate so each run rebuilds a fresh thread (engine ignores stale state).
  for (const [t, col] of [
    ['conversation', '_id'],
    ['message', "data->>'conversationId'"],
    ['conversationUser', "data->>'conversationId'"],
    ['userConversation', "data->>'conversationId'"],
  ] as const) {
    await query(`DELETE FROM "${t}" WHERE ${col} = $1`, [conversationId]);
  }

  // 2. Create the Ugly Bot DM the way the UI does — the server seeds the greeting.
  //    Wiring the bot via `bots` makes it a participant so it also replies.
  await api('conversationCreate', {
    id: conversationId,
    type: 'group',
    title: 'Ugly Bot',
    mode: 'public',
    ownerIds: [userId],
    bots: { [UGLY_BOT_USER_ID]: { type: 'primary' } },
  });

  // 3. Post the user question, then the bot's roast reply (authored as the bot).
  await api('conversationMessageCreate', {
    conversationId,
    message: { text: 'Roast my New Year resolutions: gym 5x a week and read 50 books.' },
  });
  await api(
    'conversationMessageCreate',
    {
      conversationId,
      message: {
        text:
          "Gym 5x a week AND 50 books? Bold strategy from someone whose running shoes " +
          "are still in the box. Counter-offer: 2 real gym days, 6 books you'll actually " +
          "finish, and we call it a win. Now hydrate, champ — I believe in you. Mostly.",
      },
    },
    botToken,
  );

  const count = await messageCount();
  console.log(`[seed:chat] Ugly Bot thread ready with ${count} messages`);
  console.log('[seed:chat] done');
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error('[seed:chat] FAILED:', err);
    process.exit(1);
  },
);
