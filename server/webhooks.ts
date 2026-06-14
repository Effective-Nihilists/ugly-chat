/**
 * Outbound webhook delivery for the cross-app chat API.
 *
 * On every message event in a conversation we notify:
 *   - the conversation's own `webhookUrl` (observes ALL message events), and
 *   - the `webhookUrl` of each BOT member (so the owning app generates the reply).
 *
 * Each POST body is HMAC-SHA256 signed with the respective `webhookSecret` and
 * sent in the `X-Ugly-Chat-Signature` header (`sha256=<hex>`). Delivery is
 * fire-and-forget — failures are logged, never block message creation. To avoid
 * loops, a bot's webhook is NOT fired for a message that bot itself authored.
 */
import { collections } from '../shared/collections';
import { isBot } from './bots';

interface WebhookDb {
  getDoc(col: unknown, id: string): Promise<Record<string, unknown> | null>;
}

export type WebhookEventType = 'message.created' | 'message.updated' | 'message.reacted';

async function signHmac(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function post(
  url: string,
  secret: string | undefined,
  payload: unknown,
): Promise<void> {
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (secret) headers['X-Ugly-Chat-Signature'] = `sha256=${await signHmac(secret, body)}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) console.error(`[webhook] ${url} → ${res.status}`);
  } catch (err) {
    console.error(`[webhook] ${url} failed`, err);
  }
}

/**
 * Fire webhooks for a message event. Loads the conversation + its bot members
 * and posts the signed event to the conversation webhook and each bot webhook
 * (except the author bot). Safe to call fire-and-forget.
 */
export async function fireMessageWebhooks(
  db: WebhookDb,
  event: WebhookEventType,
  conversationId: string,
  message: Record<string, unknown>,
): Promise<void> {
  const conv = await db.getDoc(collections.conversation, conversationId);
  if (!conv) return;
  const appId = conv['appId'] as string | undefined;
  const authorId = String(message['userId'] ?? '');
  // Include the conversation's `custom` so the receiving app can route the event
  // (e.g. love distinguishes coach vs couple conversations) without storing
  // conversations itself.
  const base = { event, appId, conversationId, custom: conv['custom'] ?? null, message };
  const targets: Promise<void>[] = [];

  // 1. Conversation-level webhook (observes everything).
  if (typeof conv['webhookUrl'] === 'string' && conv['webhookUrl']) {
    targets.push(
      post(conv['webhookUrl'], conv['webhookSecret'] as string | undefined, {
        ...base,
        target: 'conversation',
      }),
    );
  }

  // 2. Each bot member's webhook (so the app can reply) — skip the author bot.
  const botIds = Object.keys((conv['bots'] as Record<string, unknown> | undefined) ?? {}).filter(
    (id) => isBot(id) && id !== authorId,
  );
  for (const botId of botIds) {
    const bot = await db.getDoc(collections.bot, botId);
    const url = bot?.['webhookUrl'];
    if (typeof url === 'string' && url) {
      targets.push(
        post(url, bot['webhookSecret'] as string | undefined, {
          ...base,
          target: 'bot',
          botId,
        }),
      );
    }
  }

  await Promise.all(targets);
}
