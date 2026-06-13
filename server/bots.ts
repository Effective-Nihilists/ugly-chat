/**
 * Built-in JS bots for ugly.chat.
 *
 * A bot is just a userId with `isBot: true`. When a human posts a message in a
 * conversation that has a bot member, the bot replies via ugly.bot's proxied
 * textGen (falling back to a canned reply if the proxy is unavailable). This
 * deliberately avoids the dropped custom-bot (`BotCode`) sandbox — these are
 * static, code-defined bots only; users cannot create new ones.
 */
import { conversationMessageCreate } from 'ugly-app/conversation/server';

// Workers-safe call to ugly.bot's proxied textGen (importing uglyBotRequest from
// the 'ugly-app' main entry would drag the Node server into the Workers bundle).
async function uglyBotTextGen(
  model: string,
  messages: { role: string; content: string }[],
  maxTokens: number,
): Promise<string> {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
  const base = env['UGLY_BOT_LOCAL'] === '1' ? 'http://localhost:3000' : env['UGLY_BOT_URL'] ?? 'https://ugly.bot';
  const token = env['UGLY_BOT_TOKEN'];
  if (!token) throw new Error('UGLY_BOT_TOKEN not set');
  const res = await fetch(`${base}/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ op: 'textGen', input: { model, messages, options: { maxTokens } }, sessionId: 'server' }),
  });
  if (!res.ok) throw new Error(`textGen HTTP ${res.status}`);
  const data = (await res.json()) as { message?: { content?: string }; result?: { message?: { content?: string } } };
  return data.message?.content ?? data.result?.message?.content ?? '';
}

export interface BotDef {
  id: string;
  name: string;
  systemPrompt: string;
  model: string;
}

export const BOTS: Record<string, BotDef> = {
  'bot-ugly': {
    id: 'bot-ugly',
    name: 'Ugly Bot',
    systemPrompt:
      'You are Ugly Bot — a witty, concise, helpful chat assistant. Keep replies short.',
    model: 'gemini_2_5_flash',
  },
  'bot-sage': {
    id: 'bot-sage',
    name: 'Sage',
    systemPrompt:
      'You are Sage — a calm, thoughtful advisor. Answer briefly and kindly.',
    model: 'gemini_2_5_flash',
  },
};

export const isBotId = (id: string): boolean => id in BOTS;

export const botUser = (id: string): { _id: string; name: string; isBot: true } | null =>
  isBotId(id) ? { _id: id, name: BOTS[id]!.name, isBot: true } : null;

interface MinimalDb {
  getDoc(collection: unknown, id: string): Promise<Record<string, unknown> | null>;
  getDocs(
    collection: unknown,
    filter?: Record<string, unknown>,
    options?: { sort?: Record<string, 1 | -1>; limit?: number },
  ): Promise<Record<string, unknown>[]>;
}

/**
 * After a human message, have each bot member of the conversation reply.
 * Fire-and-forget from the caller — replies are delivered via trackDocs.
 */
export async function triggerBotReplies(
  db: MinimalDb,
  collections: { conversation: unknown; message: unknown },
  conversationId: string,
  senderUserId: string,
): Promise<void> {
  if (isBotId(senderUserId)) return; // bots don't reply to bots

  const conv = await db.getDoc(collections.conversation, conversationId);
  const bots = (conv?.['bots'] as Record<string, unknown> | undefined) ?? {};
  const botIds = Object.keys(bots).filter(isBotId);
  if (botIds.length === 0) return;

  const recent = await db.getDocs(
    collections.message,
    { conversationId },
    { sort: { created: 1 }, limit: 20 },
  );
  const history = recent
    .filter((m) => m['deleted'] !== true)
    .map((m) => ({
      role: isBotId(String(m['userId'])) ? ('assistant' as const) : ('user' as const),
      content: String(m['text'] ?? m['markdown'] ?? ''),
    }))
    .filter((m) => m.content.length > 0);

  for (const botId of botIds) {
    const bot = BOTS[botId]!;
    let reply = '';
    try {
      reply = await uglyBotTextGen(
        bot.model,
        [{ role: 'system', content: bot.systemPrompt }, ...history],
        300,
      );
    } catch (err) {
      console.warn(`[bots] textGen unavailable for ${botId}; using fallback:`, (err as Error).message);
    }
    if (!reply) {
      const last = history[history.length - 1]?.content ?? '';
      reply = `Hi, I'm ${bot.name}. You said: "${last.slice(0, 120)}"`;
    }
    await conversationMessageCreate(
      { conversationId, message: { text: reply, markdown: reply, onlyUserIds: ['global'] } },
      botId,
    );
  }
}
