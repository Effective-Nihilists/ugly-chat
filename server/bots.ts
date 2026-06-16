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
import { getUserToken } from 'ugly-app/server/adapter/workers';
import { defaultAvatar, type Avatar } from 'ugly-app/shared';
import { toAvatar } from './avatar';
import { collections } from '../shared/collections';
import { bumpListForMessage } from './listDenorm';
import type { MsgTelemetry } from '../shared/telemetry';

/**
 * Pure parser for ugly.bot `/request` responses. Exported for unit-testing.
 * Extracts the reply text and any usage metadata, defaulting to zeros when
 * the provider envelope does not include usage fields.
 */
export function parseTextGenResponse(data: unknown): { text: string; usage: MsgTelemetry } {
  const d = data as Record<string, unknown> | null | undefined;
  const msg = (d?.['message'] ?? (d?.['result'] as Record<string, unknown> | undefined)?.['message']) as Record<string, unknown> | undefined;
  const content = msg?.['content'];
  let text = '';
  if (typeof content === 'string') {
    text = content.trim();
  } else if (Array.isArray(content)) {
    text = content
      .filter(
        (b): b is { type: string; text: string } =>
          !!b && typeof b === 'object' &&
          (b as { type?: string }).type === 'text' &&
          typeof (b as { text?: unknown }).text === 'string',
      )
      .map((b) => b.text)
      .join('')
      .trim();
  }
  const u = (d?.['usage'] ?? (d?.['result'] as Record<string, unknown> | undefined)?.['usage'] ?? {}) as Record<string, unknown>;
  const usage: MsgTelemetry = {
    model: String(u['model'] ?? d?.['model'] ?? ''),
    inputTokens: Number(u['inputTokens'] ?? u['promptTokens'] ?? 0),
    outputTokens: Number(u['outputTokens'] ?? u['completionTokens'] ?? 0),
    costUsd: Number(u['costUsd'] ?? u['cost'] ?? 0),
    latencyMs: 0,
  };
  return { text, usage };
}

// Direct (non-proxied-op) textGen via ugly.bot's unified AI endpoint.
//
//   • With the chatting user's session JWT (read off the AsyncLocalStorage the
//     framework populates per request) we hit `/v1/ai/user-billed/text`, which
//     resolves the payer from the JWT and bills THAT user — full model access
//     (any provider keyed on ugly.bot), not the DeepSeek-only generic proxy op.
//   • Without an end-user context (system-triggered replies) we fall back to the
//     app token + owner-billed `/v1/ai/text`.
//
// `getUserToken` comes from the Workers-safe adapter barrel (no Node deps), and
// it's the SAME AsyncLocalStorage singleton `createWorkersApp` writes during
// `/api/:name` dispatch — so a bot reply triggered inside a user's message
// handler sees that user's token.
async function uglyBotTextGen(
  model: string,
  messages: { role: string; content: string }[],
  maxTokens: number,
): Promise<{ text: string; usage: MsgTelemetry }> {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
  const base = env['UGLY_BOT_LOCAL'] === '1' ? 'http://localhost:3000' : env['UGLY_BOT_URL'] ?? 'https://ugly.bot';
  const userToken = getUserToken();
  const endpoint = userToken ? `${base}/v1/ai/user-billed/text` : `${base}/v1/ai/text`;
  const bearer = userToken ?? env['UGLY_BOT_TOKEN'];
  if (!bearer) throw new Error('no end-user token and UGLY_BOT_TOKEN not set');
  const t0 = Date.now();
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
    body: JSON.stringify({ model, messages, options: { maxTokens } }),
  });
  if (!res.ok) throw new Error(`textGen HTTP ${res.status}`);
  const data = await res.json() as Record<string, unknown>;
  if (data['error']) throw new Error(`textGen ${String(data['error'])}: ${String(data['detail'] ?? '')}`);
  const parsed = parseTextGenResponse(data);
  parsed.usage.latencyMs = Date.now() - t0;
  if (!parsed.usage.model) parsed.usage.model = model;
  return parsed;
}

// Image generation via ugly.bot's user-billed image endpoint (same auth model as
// uglyBotTextGen). Returns the generated image URL, or '' on failure.
async function uglyBotImageGen(model: string, prompt: string, size: string): Promise<string> {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
  const base = env['UGLY_BOT_LOCAL'] === '1' ? 'http://localhost:3000' : env['UGLY_BOT_URL'] ?? 'https://ugly.bot';
  const userToken = getUserToken();
  const endpoint = userToken ? `${base}/v1/ai/user-billed/image` : `${base}/v1/ai/image`;
  const bearer = userToken ?? env['UGLY_BOT_TOKEN'];
  if (!bearer) throw new Error('no end-user token and UGLY_BOT_TOKEN not set');
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
    body: JSON.stringify({ model, prompt, options: { aspectRatio: size } }),
  });
  if (!res.ok) throw new Error(`imageGen HTTP ${res.status}`);
  const data = (await res.json()) as Record<string, unknown>;
  if (data['error']) throw new Error(String(data['error']));
  const url = data['url'] ?? data['imageUrl'] ?? (data['result'] as Record<string, unknown> | undefined)?.['url'];
  return typeof url === 'string' ? url : '';
}

// Ugly Bot persona overrides for the non-default text modes (mirrors the old
// uglyBot `mean`/`lies` modes). `chat` and custom bots use their own prompt.
const MODE_PROMPTS: Record<string, string> = {
  honest:
    'You are Ugly Bot, but in Honest mode: drop the roasting and snark and be ' +
    'genuinely helpful, clear, and direct. Just give a straight, useful answer.',
  lie:
    'You are Ugly Bot roleplaying as a satirical liar. Always answer with a ' +
    'confidently WRONG but funny, plausible-sounding answer. Keep it light and ' +
    'satirical; never lie harmfully about real people, products, or companies. ' +
    'Do not add disclaimers or notes.',
};

export interface BotDef {
  id: string;
  name: string;
  systemPrompt: string;
  model: string;
}

// NOTE: the canonical Ugly Bot is no longer a static built-in — it lives in the
// `bot` collection as `bot-ugly` (carries its 3D avatar + 2D image + background)
// and resolves through the `bot-` path in getBotConfig.
export const BOTS: Record<string, BotDef> = {
  'bot-sage': {
    id: 'bot-sage',
    name: 'Sage',
    systemPrompt:
      'You are Sage — a calm, thoughtful advisor. Answer briefly and kindly.',
    model: 'deepseek_v4_flash',
  },
};

/** Any bot — built-in/custom, all keyed with a `bot-` id (incl. `bot-ugly`). */
export const isBot = (id: string): boolean => id.startsWith('bot-');
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
  avatar: Avatar;
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
    return { ...builtin, firstMessage: null, buttons: [], avatar: defaultAvatar };
  }
  // Any id with a `bot` collection row is an editable config bot. This covers
  // `bot-` custom bots AND migrated plain-userId bots we've upgraded to editable
  // config (so the user can edit name/avatar/instruction/model in "My Bots"
  // without re-keying the bot's existing conversations).
  const doc = await db.getDoc(collections.bot, botId);
  if (doc) {
    return {
      id: botId,
      name: String(doc['name'] ?? 'Bot'),
      systemPrompt: String(doc['instruction'] ?? ''),
      model: String(doc['model'] ?? 'deepseek_v4_flash'),
      firstMessage: (doc['firstMessage'] as string | null | undefined) ?? null,
      buttons: (doc['buttons'] as { label: string; prompt: string }[] | undefined) ?? [],
      avatar: toAvatar(doc['avatar']),
    };
  }
  if (botId.startsWith('bot-')) return null;
  // Migrated bot with no editable row yet — plain userId flagged isBot in userPublic.
  const up = await db.getDoc(collections.userProfileCache, botId);
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
      avatar: toAvatar(up['avatar']),
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
      const up = await db.getDoc(collections.userProfileCache, p);
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

  type BotCfg = { model?: string; mode?: string; imageModel?: string; imageSize?: string };
  const convBots = (conv?.['bots'] as Record<string, BotCfg> | undefined) ?? {};
  for (const botId of botIds) {
    const bot = await getBotConfig(db, botId);
    if (!bot) continue;
    // Per-conversation bot config (the bot DM's ⋯ menu): mode + models + size.
    const cfg = convBots[botId] ?? {};
    const mode = cfg.mode ?? 'chat';
    const model = cfg.model ?? bot.model;
    let reply = '';
    let usage: MsgTelemetry | undefined;

    if (mode === 'image') {
      // Image mode: generate an image from the user's latest prompt.
      const prompt = history[history.length - 1]?.content ?? '';
      try {
        if (prompt) {
          const url = await uglyBotImageGen(cfg.imageModel ?? 'flux_1_dev', prompt, cfg.imageSize ?? 'square');
          if (url) reply = `![${prompt.slice(0, 80).replace(/[\[\]]/g, '')}](${url})`;
        }
      } catch (err) {
        console.warn(`[bots] imageGen failed for ${botId}:`, (err as Error).message);
      }
      if (!reply) reply = "Couldn't generate an image for that — try again, or switch back to Chat mode.";
    } else {
      // Text modes. The Ugly Bot's `honest`/`lie` personas override its system
      // prompt; every other bot just uses its own instruction.
      const systemPrompt = MODE_PROMPTS[mode] ?? bot.systemPrompt;
      try {
        const out = await uglyBotTextGen(
          model,
          [
            ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
            ...history,
          ],
          // DeepSeek is a reasoning model — it burns tokens on a hidden "thinking"
          // block before the visible answer, so a small cap leaves no text. Give
          // it room for the reasoning plus a real reply.
          1200,
        );
        reply = out.text;
        usage = out.usage;
      } catch (err) {
        console.warn(`[bots] textGen unavailable for ${botId}; using fallback:`, (err as Error).message);
      }
      if (!reply) {
        const last = history[history.length - 1]?.content ?? '';
        reply = `Hi, I'm ${bot.name}. You said: "${last.slice(0, 120)}"`;
      }
    }
    await conversationMessageCreate(
      { conversationId, message: { text: reply, markdown: reply, onlyUserIds: ['global'], ...(usage ? { telemetry: usage } : {}) } },
      botId,
    );
    // Surface the bot's reply in the sidebar (preview + unread for recipients).
    await bumpListForMessage(
      db as unknown as Parameters<typeof bumpListForMessage>[0],
      conversationId,
      reply,
      botId,
    ).catch((err: unknown) => console.error('[bots] list denorm failed', err));
  }
}
