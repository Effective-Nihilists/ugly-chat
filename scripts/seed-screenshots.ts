/**
 * Seed THREE conversations for the synthetic "screenshot" user against the
 * DEPLOYED app (https://ugly.chat) so every core screen has real content to
 * render in the screenshot-verification harness (scripts/screenshots/*).
 *
 *   1. bot DM    — `${UGLY_BOT_USER_ID}+${SCREENSHOT_USER_ID}` (roast thread).
 *   2. human DM  — no-bot 1:1 between the screenshot user + partner; ~5
 *                  alternating messages (real delays) so the human response-time
 *                  telemetry renders.
 *   3. group     — `grp-screenshot-demo` "ship-crew"; owner=user, members=partner
 *                  + Ugly Bot; a few messages.
 *
 * Idempotent: each conversation is deleted (raw SQL) then recreated through the
 * deployed app's own API — the same calls the UI makes (chat messages render via
 * the conversation ENGINE + CollectionDO live query, so raw SQL inserts aren't
 * picked up). The prod Neon connection is resolved the way `ugly-app` publish
 * does (.uglyapp → publish-state.json); session tokens are HS256-minted with
 * ugly.bot's AUTH_SECRET (sibling ../ugly-bot publish-state), because ugly.chat
 * verifies sessions via ugly.bot /verify (Mode A).
 *
 * Run: npx tsx scripts/seed-screenshots.ts
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAdapter, query } from 'ugly-app/server';
import { UGLY_BOT, UGLY_BOT_AVATAR_URL, UGLY_BOT_USER_ID } from '../shared/bots';
import { directConversationId } from '../shared/conversationId';

const SCREENSHOT_USER_ID =
  process.env['SCREENSHOT_USER_ID'] ?? '5c0e5c0e-0000-4000-8000-5c0e5c0e5c0e';
const SCREENSHOT_PARTNER_USER_ID =
  process.env['SCREENSHOT_PARTNER_USER_ID'] ?? '5c0e5c0e-0000-4000-8000-5c0e5c0e5c0f';
const SCREENSHOT_NAME = 'Alex Rivera';
const SCREENSHOT_AVATAR = 'https://api.dicebear.com/9.x/thumbs/png?seed=alex-rivera&size=256';
const PARTNER_NAME = 'Sam Rivera';
const PARTNER_AVATAR = 'https://api.dicebear.com/9.x/thumbs/png?seed=sam-rivera&size=256';

const GROUP_ID = 'grp-screenshot-demo';

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
  const s = JSON.parse(fs.readFileSync(f, 'utf8')) as {
    neon?: { connectionString?: string; anonKey?: string };
  };
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

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const repo = process.cwd();
  process.env['DATABASE_URL'] =
    process.env['DATABASE_URL'] ?? publishState(repo).connectionString;
  createAdapter();

  const base = readUglyApp(repo).deployTarget?.customDomainUrl ?? 'https://ugly.chat';
  const uglyBotRepo = path.join(repo, '..', 'ugly-bot');
  const secret = publishState(uglyBotRepo).anonKey;

  const userToken = mintToken(SCREENSHOT_USER_ID, secret);
  const partnerToken = mintToken(SCREENSHOT_PARTNER_USER_ID, secret);
  const botToken = mintToken(UGLY_BOT_USER_ID, secret);

  const api = async (name: string, input: unknown, tok = userToken): Promise<unknown> => {
    const res = await fetch(`${base}/api/${name}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `auth_token=${tok}` },
      body: JSON.stringify({ input }),
    });
    const json = (await res.json()) as { result?: unknown; error?: string };
    if (!res.ok || json.error) throw new Error(`${name} failed: ${res.status} ${json.error ?? ''}`);
    return json.result;
  };

  // ── 0. Local userPublic rows so chat resolves display names + avatars ───────
  const upsertPublic = async (id: string, data: Record<string, unknown>): Promise<void> => {
    await query(
      `INSERT INTO "userPublic" (_id, data, created, updated, version)
       VALUES ($1, $2::jsonb, now(), now(), 1)
       ON CONFLICT (_id) DO UPDATE SET data = EXCLUDED.data, updated = now()`,
      [id, JSON.stringify(data)],
    );
  };
  await upsertPublic(UGLY_BOT_USER_ID, { name: UGLY_BOT.name, isBot: true, avatar: UGLY_BOT_AVATAR_URL });
  await upsertPublic(SCREENSHOT_USER_ID, { name: SCREENSHOT_NAME, avatar: SCREENSHOT_AVATAR });
  await upsertPublic(SCREENSHOT_PARTNER_USER_ID, { name: PARTNER_NAME, avatar: PARTNER_AVATAR });

  const wipe = async (conversationId: string): Promise<void> => {
    for (const [t, col] of [
      ['conversation', '_id'],
      ['message', "data->>'conversationId'"],
      ['conversationUser', "data->>'conversationId'"],
      ['userConversation', "data->>'conversationId'"],
    ] as const) {
      await query(`DELETE FROM "${t}" WHERE ${col} = $1`, [conversationId]);
    }
  };

  // ── 1. Bot DM ───────────────────────────────────────────────────────────────
  const botDmId = `${UGLY_BOT_USER_ID}+${SCREENSHOT_USER_ID}`;
  await wipe(botDmId);
  await api('conversationCreate', {
    id: botDmId,
    type: 'group',
    title: 'Ugly Bot',
    mode: 'public',
    ownerIds: [SCREENSHOT_USER_ID],
    bots: { [UGLY_BOT_USER_ID]: { type: 'primary' } },
  });
  await api('conversationMessageCreate', {
    conversationId: botDmId,
    message: { text: 'Roast my New Year resolutions: gym 5x a week and read 50 books.' },
  });
  await api(
    'conversationMessageCreate',
    {
      conversationId: botDmId,
      message: {
        text:
          'Gym 5x a week AND 50 books? Bold strategy from someone whose running shoes ' +
          "are still in the box. Counter-offer: 2 real gym days, 6 books you'll actually " +
          'finish, and we call it a win. Now hydrate, champ — I believe in you. Mostly.',
      },
    },
    botToken,
  );

  // ── 2. Human DM (no bots) ─────────────────────────────────────────────────────
  const humanDmId = directConversationId(SCREENSHOT_USER_ID, SCREENSHOT_PARTNER_USER_ID);
  await wipe(humanDmId);
  await api('conversationCreate', {
    id: humanDmId,
    type: 'direct',
    title: PARTNER_NAME,
    mode: 'private',
    ownerIds: [SCREENSHOT_USER_ID, SCREENSHOT_PARTNER_USER_ID],
  });
  // Alternating user/partner messages with small real delays so reply-latency
  // telemetry (computeHumanStats) renders non-zero gaps.
  const humanThread: Array<{ text: string; tok: string }> = [
    { text: 'hey, you still want to grab dinner before the launch tonight?', tok: userToken },
    { text: 'yes please, I am starving. 7pm at the ramen place?', tok: partnerToken },
    { text: 'perfect. I will book a table for two', tok: userToken },
    { text: 'you are the best 🙌 see you there', tok: partnerToken },
    { text: 'bring the deploy laptop just in case 😅', tok: userToken },
  ];
  for (const m of humanThread) {
    await api('conversationMessageCreate', { conversationId: humanDmId, message: { text: m.text } }, m.tok);
    await sleep(1500);
  }

  // ── 3. Group ────────────────────────────────────────────────────────────────
  await wipe(GROUP_ID);
  await api('conversationCreate', {
    id: GROUP_ID,
    type: 'group',
    title: 'ship-crew',
    mode: 'public',
    ownerIds: [SCREENSHOT_USER_ID],
  });
  await api('conversationMemberAdd', {
    conversationId: GROUP_ID,
    userId: SCREENSHOT_PARTNER_USER_ID,
    role: 'member',
  });
  await api('conversationMemberAdd', {
    conversationId: GROUP_ID,
    userId: UGLY_BOT_USER_ID,
    role: 'member',
  });
  await api('conversationMessageCreate', {
    conversationId: GROUP_ID,
    message: { text: 'ok team, prod deploy goes out at 9. who is on call?' },
  });
  await api(
    'conversationMessageCreate',
    { conversationId: GROUP_ID, message: { text: 'I got it. logs dashboard is up on my second monitor.' } },
    partnerToken,
  );
  await api(
    'conversationMessageCreate',
    {
      conversationId: GROUP_ID,
      message: { text: 'Cute. A deploy with a plan. I give it eleven minutes before someone says "works on my machine."' },
    },
    botToken,
  );

  const count = async (id: string): Promise<number> => {
    const r = await query<{ n: string }>(
      `SELECT count(*)::text n FROM "message" WHERE data->>'conversationId' = $1`,
      [id],
    );
    return parseInt(r.rows[0]?.n ?? '0', 10);
  };

  console.log('[seed] bot DM   :', botDmId, `(${await count(botDmId)} msgs)`);
  console.log('[seed] human DM :', humanDmId, `(${await count(humanDmId)} msgs)`);
  console.log('[seed] group    :', GROUP_ID, `(${await count(GROUP_ID)} msgs)`);
  console.log('[seed] done');
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error('[seed] FAILED:', err);
    process.exit(1);
  },
);
