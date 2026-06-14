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
import { dbDefaults } from 'ugly-app/shared';
import { collections } from '../shared/collections';
import type { DbSurface } from './handlers';
import { fireMessageWebhooks } from './webhooks';

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
  if (!h || !h.startsWith('Bearer ')) return null;
  return h.slice(7).trim() || null;
}

/** Deterministic app-bot id from (projectId, key). Starts with `bot-` so the
 *  engine / `isBot` treat it like a built-in. */
function appBotId(projectId: string, key: string): string {
  const safe = `${projectId}-${key}`.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 80);
  return `bot-${safe}`;
}

export function registerAppApi(
  app: Hono<{ Bindings: Record<string, unknown> }>,
  getDb: () => DbSurface,
): void {
  const uglyBotUrl = (c: { env: Record<string, unknown> }): string =>
    ((c.env['UGLY_BOT_URL'] as string | undefined) ?? 'https://ugly.bot').replace(/\/$/, '');

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
    const key = typeof body['key'] === 'string' ? body['key'] : '';
    if (!key) return c.json({ error: 'key is required' }, 400);
    const botId = appBotId(id.projectId, key);
    const existing = await getDb().getDoc(collections.bot, botId);
    const bot: Record<string, unknown> = {
      ...dbDefaults(),
      ...(existing ? { created: existing['created'] } : {}),
      _id: botId,
      ownerId: id.ownerUserId,
      appId: id.appId,
      name: String(body['name'] ?? 'Bot'),
      instruction: String(body['instruction'] ?? ''),
      model: String(body['model'] ?? 'deepseek_v4_flash'),
      firstMessage: (body['firstMessage'] as string | null | undefined) ?? null,
      buttons: (body['buttons'] as unknown[] | undefined) ?? [],
      avatarUrl: (body['avatarUrl'] as string | null | undefined) ?? null,
      backgroundUrl: (body['backgroundUrl'] as string | null | undefined) ?? null,
      webhookUrl: (body['webhookUrl'] as string | undefined) ?? null,
      webhookSecret: (body['webhookSecret'] as string | undefined) ?? null,
    };
    await getDb().setDoc(collections.bot, bot);
    return c.json({ botId });
  });

  // ── Create a conversation (humans + bots + optional webhook) ──────────────
  app.post('/app/conversation/create', async (c) => {
    const id = await auth(c);
    if (!id) return c.json({ error: 'Unauthorized' }, 401);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const memberUserIds = Array.isArray(body['memberUserIds'])
      ? (body['memberUserIds'] as string[])
      : [];
    const botIds = Array.isArray(body['botIds']) ? (body['botIds'] as string[]) : [];
    if (memberUserIds.length === 0 && botIds.length === 0) {
      return c.json({ error: 'memberUserIds or botIds required' }, 400);
    }
    const convId = typeof body['id'] === 'string' ? body['id'] : crypto.randomUUID();
    const creator = memberUserIds[0] ?? id.ownerUserId;
    const bots = Object.fromEntries(botIds.map((b) => [b, {}]));

    await engineConversationCreate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {
        id: convId,
        type: (body['type'] as string) ?? 'group',
        title: (body['title'] as string) ?? '',
        background: body['background'] ?? null,
        mode: 'private',
        ownerIds: memberUserIds.length ? memberUserIds : [creator],
        bots,
        custom: body['custom'] ?? undefined,
        disableJoinMessages: true,
        hidden: true,
      } as any,
      creator,
    );

    // The engine persists a fixed field set, so patch the cross-app fields onto
    // the conversation doc afterwards.
    const conv = await getDb().getDoc(collections.conversation, convId);
    if (conv) {
      await getDb().setDoc(collections.conversation, {
        ...conv,
        appId: id.appId,
        ...(typeof body['webhookUrl'] === 'string' ? { webhookUrl: body['webhookUrl'] } : {}),
        ...(typeof body['webhookSecret'] === 'string'
          ? { webhookSecret: body['webhookSecret'] }
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
    const conversationId = String(body['conversationId'] ?? '');
    const asUserId = String(body['asUserId'] ?? '');
    if (!conversationId || !asUserId) {
      return c.json({ error: 'conversationId and asUserId required' }, 400);
    }
    const conv = await getDb().getDoc(collections.conversation, conversationId);
    if (!conv) return c.json({ error: 'conversation not found' }, 404);
    if (conv['appId'] !== id.appId) return c.json({ error: 'Forbidden' }, 403);

    const message = (body['message'] as Record<string, unknown>) ?? {};
    const msg = await engineConversationMessageCreate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { conversationId, message: { onlyUserIds: ['global'], ...message } } as any,
      asUserId,
    );
    // Deliver webhooks AFTER the response — must use waitUntil or the Worker
    // isolate is torn down before the catcher fetch completes.
    const fire = fireMessageWebhooks(
      getDb(),
      'message.created',
      conversationId,
      msg as unknown as Record<string, unknown>,
    ).catch((err: unknown) => console.error('[appApi] webhook fire failed', err));
    c.executionCtx.waitUntil(fire);
    return c.json({ message: msg });
  });

  // ── List messages (appId-scoped) ──────────────────────────────────────────
  app.post('/app/message/list', async (c) => {
    const id = await auth(c);
    if (!id) return c.json({ error: 'Unauthorized' }, 401);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const conversationId = String(body['conversationId'] ?? '');
    if (!conversationId) return c.json({ error: 'conversationId required' }, 400);
    const conv = await getDb().getDoc(collections.conversation, conversationId);
    if (!conv) return c.json({ error: 'conversation not found' }, 404);
    if (conv['appId'] !== id.appId) return c.json({ error: 'Forbidden' }, 403);

    const limit = Math.min(Number(body['limit'] ?? 50), 200);
    const messages = await getDb().getDocs(
      collections.message,
      { conversationId },
      { sort: { created: -1 }, limit },
    );
    return c.json({ messages });
  });
}
