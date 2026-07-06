/**
 * Cross-app chat API — lets any ugly.bot app drive conversations in Ugly Chat on
 * behalf of its users. Mounted at `/app/*` via `setRawRoutes`.
 *
 * Auth: the app sends `Authorization: Bearer upp_chat_*` (an ugly.bot chat
 * proxy token). We authenticate it by calling ugly.bot `/v1/chat/verify-app`,
 * which returns the app identity `{appId, appName, projectId, ownerUserId}`.
 * Conversations + bots are namespaced by `appId`; an app may only touch its own.
 *
 * Endpoints:
 *   POST /app/bot/register        { key, name, instruction?, model?, firstMessage?, buttons?, avatarUrl?, backgroundUrl?, webhookUrl?, webhookSecret? } → { botId }
 *   POST /app/conversation/create { type?, title?, background?, memberUserIds[], botIds[], custom?, webhookUrl?, webhookSecret?, id? } → { conversationId }
 *   POST /app/message/create      { conversationId, asUserId, message } → { message }
 *   POST /app/message/list        { conversationId, limit? } → { messages }
 */
import type { Hono } from 'hono';
import {
  conversationCreate as engineConversationCreate,
  conversationMessageCreate as engineConversationMessageCreate,
} from 'ugly-app/conversation/engine';
import { dbDefaults, defaultAvatar } from 'ugly-app/shared';
import { nanoid } from 'nanoid';
import { collections } from '../shared/collections';
import type { DbSurface } from './handlers';
import { fireMessageWebhooks } from './webhooks';
import { unfurlMessageLinks } from './linkPreview';

interface AppIdentity {
  appId: string;
  appName: string;
  projectId: string;
  ownerUserId: string;
}

// In-isolate cache of verify-app results (token → identity), short TTL.
const verifyCache = new Map<string, { identity: AppIdentity; exp: number }>();

async function verifyApp(uglyBotUrl: string, token: string): Promise<AppIdentity | null> {
  const cached = verifyCache.get(token);
  if (cached && cached.exp > Date.now()) return cached.identity;
  try {
    const res = await fetch(`${uglyBotUrl}/v1/chat/verify-app`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<AppIdentity>;
    if (!data.appId || !data.projectId) return null;
    const identity: AppIdentity = {
      appId: data.appId,
      appName: data.appName ?? data.projectId,
      projectId: data.projectId,
      ownerUserId: data.ownerUserId ?? data.appId,
    };
    verifyCache.set(token, { identity, exp: Date.now() + 60_000 });
    return identity;
  } catch {
    return null;
  }
}

function bearer(c: { req: { header(name: string): string | undefined } }): string | null {
  const h = c.req.header('Authorization');
  if (!h?.startsWith('Bearer ')) return null;
  return h.slice(7).trim() || null;
}

/** Deterministic app-bot id from (projectId, key). Starts with `bot-` so the
 *  engine / `isBot` treat it like a built-in. */
function appBotId(projectId: string, key: string): string {
  const safe = `${projectId}-${key}`.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 80);
  return `bot-${safe}`;
}

/**
 * An app may access a conversation if it CREATED it (`conv.appId === appId`) OR
 * one of ITS OWN bots is a member (a bot doc with `appId === appId`). The latter
 * covers cross-app bots — App B's bot added to App A's conversation lets B read
 * + post there to drive its bot.
 */
async function appCanAccess(
  getDb: () => DbSurface,
  conv: Record<string, unknown>,
  appId: string,
): Promise<boolean> {
  if (conv.appId === appId) return true;
  const botIds = Object.keys((conv.bots as Record<string, unknown> | undefined) ?? {});
  for (const botId of botIds) {
    if (!botId.startsWith('bot-')) continue;
    const bot = await getDb().getDoc(collections.bot, botId);
    if (bot?.appId === appId) return true;
  }
  return false;
}

export function registerAppApi(
  app: Hono<{ Bindings: Record<string, unknown> }>,
  getDb: () => DbSurface,
): void {
  const uglyBotUrl = (c: { env: Record<string, unknown> }): string =>
    ((c.env.UGLY_BOT_URL as string | undefined) ?? 'https://ugly.bot').replace(/\/$/, '');

  const auth = async (c: {
    req: { header(n: string): string | undefined };
    env: Record<string, unknown>;
  }): Promise<AppIdentity | null> => {
    const token = bearer(c);
    if (!token) return null;
    return verifyApp(uglyBotUrl(c), token);
  };

  // ── Register / upsert an app-owned bot ────────────────────────────────────
  app.post('/app/bot/register', async (c) => {
    const id = await auth(c);
    if (!id) return c.json({ error: 'Unauthorized' }, 401);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const key = typeof body.key === 'string' ? body.key : '';
    if (!key) return c.json({ error: 'key is required' }, 400);
    const botId = appBotId(id.projectId, key);
    const existing = await getDb().getDoc(collections.bot, botId);
    const bot: Record<string, unknown> = {
      ...dbDefaults(),
      ...(existing ? { created: existing.created } : {}),
      _id: botId,
      ownerId: id.ownerUserId,
      appId: id.appId,
      name: typeof body.name === 'string' ? body.name : 'Bot',
      instruction: typeof body.instruction === 'string' ? body.instruction : '',
      model: typeof body.model === 'string' ? body.model : 'deepseek_v4_flash',
      firstMessage: (body.firstMessage) ?? null,
      buttons: (body.buttons) ?? [],
      avatar: {
        id: botId,
        uri: null,
        image: typeof body.avatarUrl === 'string' ? { uri: body.avatarUrl } : defaultAvatar.image,
        background: typeof body.backgroundUrl === 'string' ? { uri: body.backgroundUrl } : null,
      },
      webhookUrl: (body.webhookUrl) ?? null,
      webhookSecret: (body.webhookSecret) ?? null,
    };
    await getDb().setDoc(collections.bot, bot);
    return c.json({ botId });
  });

  // ── Create a conversation (humans + bots + optional webhook) ──────────────
  app.post('/app/conversation/create', async (c) => {
    const id = await auth(c);
    if (!id) return c.json({ error: 'Unauthorized' }, 401);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const memberUserIds = Array.isArray(body.memberUserIds)
      ? (body.memberUserIds as string[])
      : [];
    const botIds = Array.isArray(body.botIds) ? (body.botIds as string[]) : [];
    if (memberUserIds.length === 0 && botIds.length === 0) {
      return c.json({ error: 'memberUserIds or botIds required' }, 400);
    }
    const convId = typeof body.id === 'string' ? body.id : nanoid();
    const creator = memberUserIds[0] ?? id.ownerUserId;
    const bots = Object.fromEntries(botIds.map((b) => [b, {}]));

    await engineConversationCreate(
      {
        id: convId,
        type: typeof body.type === 'string' ? body.type : 'group',
        title: typeof body.title === 'string' ? body.title : '',
        background: body.background ?? null,
        mode: 'private',
        ownerIds: memberUserIds.length ? memberUserIds : [creator],
        bots,
        custom: body.custom ?? undefined,
        disableJoinMessages: true,
        // Conversations are never created hidden — a hidden conversation never
        // appears in the member's list (conversationListMine filters it out),
        // which silently strands app-created chats the user is actually in.
        hidden: false,
      },
      creator,
    );

    // The engine persists a fixed field set, so patch the cross-app fields onto
    // the conversation doc afterwards.
    const conv = await getDb().getDoc(collections.conversation, convId);
    if (conv) {
      await getDb().setDoc(collections.conversation, {
        ...conv,
        appId: id.appId,
        ...(typeof body.webhookUrl === 'string' ? { webhookUrl: body.webhookUrl } : {}),
        ...(typeof body.webhookSecret === 'string'
          ? { webhookSecret: body.webhookSecret }
          : {}),
        ...dbDefaults(),
      });
    }
    return c.json({ conversationId: convId });
  });

  // ── Post a message as a human or bot ──────────────────────────────────────
  app.post('/app/message/create', async (c) => {
    const id = await auth(c);
    if (!id) return c.json({ error: 'Unauthorized' }, 401);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const conversationId = typeof body.conversationId === 'string' ? body.conversationId : '';
    const asUserId = typeof body.asUserId === 'string' ? body.asUserId : '';
    if (!conversationId || !asUserId) {
      return c.json({ error: 'conversationId and asUserId required' }, 400);
    }
    const conv = await getDb().getDoc(collections.conversation, conversationId);
    if (!conv) return c.json({ error: 'conversation not found' }, 404);
    if (!(await appCanAccess(getDb, conv, id.appId))) return c.json({ error: 'Forbidden' }, 403);

    const message: Record<string, unknown> =
      typeof body.message === 'object' && body.message !== null
        ? (body.message as Record<string, unknown>)
        : {};
    const msg: unknown = await engineConversationMessageCreate(
      { conversationId, message: { onlyUserIds: ['global'], ...message } },
      asUserId,
    );
    // Deliver webhooks AFTER the response — must use waitUntil or the Worker
    // isolate is torn down before the catcher fetch completes.
    const fire = fireMessageWebhooks(
      getDb(),
      'message.created',
      conversationId,
      msg as Record<string, unknown>,
    ).catch((err: unknown) => { console.error('[appApi] webhook fire failed', err); });
    c.executionCtx.waitUntil(fire);
    // Unfurl links (e.g. the Love challenge URL) into a preview card.
    c.executionCtx.waitUntil(
      unfurlMessageLinks(getDb(), msg as Parameters<typeof unfurlMessageLinks>[1]).catch(
        (err: unknown) => { console.error('[appApi] unfurl failed', err); },
      ),
    );
    return c.json({ message: msg });
  });

  // ── List messages (appId-scoped) ──────────────────────────────────────────
  app.post('/app/message/list', async (c) => {
    const id = await auth(c);
    if (!id) return c.json({ error: 'Unauthorized' }, 401);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const conversationId = typeof body.conversationId === 'string' ? body.conversationId : '';
    if (!conversationId) return c.json({ error: 'conversationId required' }, 400);
    const conv = await getDb().getDoc(collections.conversation, conversationId);
    if (!conv) return c.json({ error: 'conversation not found' }, 404);
    if (!(await appCanAccess(getDb, conv, id.appId))) return c.json({ error: 'Forbidden' }, 403);

    const limit = Math.min(Number(body.limit ?? 50), 200);
    const messages = await getDb().getDocs(
      collections.message,
      { conversationId },
      { sort: { created: -1 }, limit },
    );
    return c.json({ messages });
  });
}
