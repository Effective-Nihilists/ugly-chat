/**
 * Bots for ugly.chat.
 *
 * A bot is a userId starting with `bot-` and `isBot: true`. Two kinds:
 *   - built-in: defined in the static BOTS map below.
 *   - custom: a config-only persona the user creates, stored in the `bot`
 *     collection (name, avatar, background, instruction, model, first message,
 *     starter buttons). No code sandbox — replies are plain proxied textGen.
 *
 * When a human posts in a conversation that has a bot member, the bot replies
 * via ugly.bot's proxied textGen (falling back to a canned reply if the proxy
 * is unavailable). Replies are delivered to clients via trackDocs.
 */
import { conversationMessageCreate } from 'ugly-app/conversation/engine';
import { collections } from '../shared/collections';
import { UGLY_BOT, UGLY_BOT_USER_ID } from '../shared/bots';

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
  const data = (await res.json()) as {
    error?: string;
    detail?: string;
    message?: { content?: unknown };
    result?: { message?: { content?: unknown } };
  };
  if (data.error) throw new Error(`textGen ${data.error}: ${data.detail ?? ''}`);
  // ugly.bot returns content as a string OR an array of blocks
  // ([{type:'thinking',…}, {type:'text', text:'…'}]). Extract the text blocks.
  const content = data.message?.content ?? data.result?.message?.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .filter(
        (b): b is { type: string; text: string } =>
          !!b && typeof b === 'object' && (b as { type?: string }).type === 'text' &&
          typeof (b as { text?: unknown }).text === 'string',
      )
      .map((b) => b.text)
      .join('')
      .trim();
  }
  return '';
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
    model: 'deepseek_v4_flash',
  },
  'bot-sage': {
    id: 'bot-sage',
    name: 'Sage',
    systemPrompt:
      'You are Sage — a calm, thoughtful advisor. Answer briefly and kindly.',
    model: 'deepseek_v4_flash',
  },
};

/** Any bot — built-in/custom (`bot-` id) or the canonical migrated Ugly Bot. */
export const isBot = (id: string): boolean =>
  id.startsWith('bot-') || id === UGLY_BOT_USER_ID;
/** @deprecated kept as alias; use isBot. */
export const isBotId = isBot;

/** Synchronous resolver for built-in bots only (custom bots need a db read). */
export const botUser = (id: string): { _id: string; name: string; isBot: true } | null =>
  BOTS[id] ? { _id: id, name: BOTS[id]!.name, isBot: true } : null;

export interface BotConfig {
  id: string;
  name: string;
  systemPrompt: string;
  model: string;
  firstMessage: string | null;
  buttons: { label: string; prompt: string }[];
  avatarUrl: string | null;
  backgroundUrl: string | null;
}

interface MinimalDb {
  getDoc(collection: unknown, id: string): Promise<Record<string, unknown> | null>;
  getDocs(
    collection: unknown,
    filter?: Record<string, unknown>,
    options?: { sort?: Record<string, 1 | -1>; limit?: number },
  ): Promise<Record<string, unknown>[]>;
}

const asBool = (v: unknown): boolean => v === true || v === 'true';

/**
 * Resolve a bot's full config from any of the three kinds:
 *   - built-in (static BOTS map),
 *   - custom (`bot-` id → `bot` collection),
 *   - migrated (a plain userId flagged `isBot` in `userPublic`, e.g. the
 *     ugly.bot bots carried over by the chat migration — their `bio` is the
 *     persona). This is what makes the migrated "Ugly Bot" DM actually reply.
 */
export async function getBotConfig(db: MinimalDb, botId: string): Promise<BotConfig | null> {
  const builtin = BOTS[botId];
  if (builtin) {
    return { ...builtin, firstMessage: null, buttons: [], avatarUrl: null, backgroundUrl: null };
  }
  // Canonical Ugly Bot — hardcoded so it works even before its ugly.bot profile
  // is cached (e.g. a brand-new user's first reply).
  if (botId === UGLY_BOT_USER_ID) {
    return {
      id: botId,
      name: UGLY_BOT.name,
      systemPrompt: UGLY_BOT.systemPrompt,
      model: UGLY_BOT.model,
      firstMessage: UGLY_BOT.firstMessage,
      buttons: [],
      avatarUrl: UGLY_BOT.avatarUrl,
      backgroundUrl: UGLY_BOT.backgroundUrl,
    };
  }
  if (botId.startsWith('bot-')) {
    const doc = await db.getDoc(collections.bot, botId);
    if (!doc) return null;
    return {
      id: botId,
      name: String(doc['name'] ?? 'Bot'),
      systemPrompt: String(doc['instruction'] ?? ''),
      model: String(doc['model'] ?? 'deepseek_v4_flash'),
      firstMessage: (doc['firstMessage'] as string | null | undefined) ?? null,
      buttons: (doc['buttons'] as { label: string; prompt: string }[] | undefined) ?? [],
      avatarUrl: (doc['avatarUrl'] as string | null | undefined) ?? null,
      backgroundUrl: (doc['backgroundUrl'] as string | null | undefined) ?? null,
    };
  }
  // Migrated bot — plain userId flagged isBot in userPublic.
  const up = await db.getDoc(collections.userPublic, botId);
  if (up && asBool(up['isBot'])) {
    const name = String(up['name'] ?? 'Bot');
    const bio = String(up['bio'] ?? '').trim();
    return {
      id: botId,
      name,
      systemPrompt: bio
        ? `You are ${name}. Stay fully in character. ${bio}`
        : `You are ${name}, a chat bot. Keep replies fairly short and in character.`,
      model: 'deepseek_v4_flash',
      firstMessage: null,
      buttons: [],
      avatarUrl: (up['avatarResolved'] as string | null | undefined) ?? null,
      backgroundUrl: (up['backgroundResolved'] as string | null | undefined) ?? null,
    };
  }
  return null;
}

/**
 * Bot members of a conversation that should reply: `bot-`/built-in ids in the
 * `bots` field, PLUS — for a DM (`<a>+<b>`) — the other participant if it's a
 * migrated bot (userPublic.isBot). Excludes `exclude` (the message sender) so a
 * bot never replies to its own message (which would loop).
 */
async function botParticipants(
  db: MinimalDb,
  conv: Record<string, unknown> | null,
  conversationId: string,
  exclude: string,
): Promise<string[]> {
  const ids = new Set<string>();
  const bots = (conv?.['bots'] as Record<string, unknown> | undefined) ?? {};
  for (const k of Object.keys(bots)) if (isBot(k) && k !== exclude) ids.add(k);
  if (conversationId.includes('+')) {
    for (const p of conversationId.split('+').filter(Boolean)) {
      if (p === exclude || ids.has(p)) continue;
      if (isBot(p)) { ids.add(p); continue; }
      const up = await db.getDoc(collections.userPublic, p);
      if (up && asBool(up['isBot'])) ids.add(p);
    }
  }
  // App-registered bots that declare a `webhookUrl` are driven by their owning
  // app (which posts the reply via the cross-app API) — Ugly Chat must NOT also
  // generate a textGen reply for them.
  const out: string[] = [];
  for (const id of ids) {
    if (id.startsWith('bot-')) {
      const doc = await db.getDoc(collections.bot, id);
      if (doc && typeof doc['webhookUrl'] === 'string' && doc['webhookUrl']) continue;
    }
    out.push(id);
  }
  return out;
}

/**
 * After a human message, have each bot member of the conversation reply.
 * Fire-and-forget from the caller — replies are delivered via trackDocs.
 */
export async function triggerBotReplies(
  db: MinimalDb,
  collectionsArg: { conversation: unknown; message: unknown },
  conversationId: string,
  senderUserId: string,
): Promise<void> {
  if (isBot(senderUserId)) return; // built-in/custom bot sender — never reply

  const conv = await db.getDoc(collectionsArg.conversation, conversationId);
  const botIds = await botParticipants(db, conv, conversationId, senderUserId);
  if (botIds.length === 0) return;
  const botSet = new Set(botIds);

  const recent = await db.getDocs(
    collectionsArg.message,
    { conversationId },
    { sort: { created: 1 }, limit: 20 },
  );
  const history = recent
    .filter((m) => m['deleted'] !== true)
    .map((m) => ({
      role: botSet.has(String(m['userId'])) ? ('assistant' as const) : ('user' as const),
      content: String(m['text'] ?? m['markdown'] ?? ''),
    }))
    .filter((m) => m.content.length > 0);

  for (const botId of botIds) {
    const bot = await getBotConfig(db, botId);
    if (!bot) continue;
    let reply = '';
    try {
      reply = await uglyBotTextGen(
        bot.model,
        [
          ...(bot.systemPrompt ? [{ role: 'system', content: bot.systemPrompt }] : []),
          ...history,
        ],
        // DeepSeek is a reasoning model — it burns tokens on a hidden "thinking"
        // block before the visible answer, so a small cap leaves no text. Give
        // it room for the reasoning plus a real reply.
        1200,
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
