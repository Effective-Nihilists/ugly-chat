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
import { runBotSearch, SEARCH_BOT_ID } from './searchBot';
import { getUserToken, getAppContext } from 'ugly-app/server/adapter/workers';
import { nanoid } from 'nanoid';
import { defaultAvatar, type Avatar } from 'ugly-app/shared';
import type { CollectionDef, GetDocsOptions } from 'ugly-app/shared';
import { botAvatar } from './avatar';
import { collections } from '../shared/collections';
import type { Conversation, Message } from '../shared/collections';
import { bumpListForMessage } from './listDenorm';
import type { MsgTelemetry } from '../shared/telemetry';

/**
 * Pure parser for ugly.bot `/request` responses. Exported for unit-testing.
 * Extracts the reply text and any usage metadata, defaulting to zeros when
 * the provider envelope does not include usage fields.
 */
export function parseTextGenResponse(data: unknown): { text: string; usage: MsgTelemetry } {
  const d = data as Record<string, unknown> | null | undefined;
  const msg = (d?.message ?? (d?.result as Record<string, unknown> | undefined)?.message) as Record<string, unknown> | undefined;
  const content = msg?.content;
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
  const u = (d?.usage ?? (d?.result as Record<string, unknown> | undefined)?.usage ?? {}) as Record<string, unknown>;
  const usage: MsgTelemetry = {
    model: typeof u.model === 'string' ? u.model : typeof d?.model === 'string' ? d.model : '',
    inputTokens: Number(u.inputTokens ?? u.promptTokens ?? 0),
    outputTokens: Number(u.outputTokens ?? u.completionTokens ?? 0),
    costUsd: Number(u.costUsd ?? u.cost ?? 0),
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
  const base = env.UGLY_BOT_LOCAL === '1' ? 'http://localhost:3000' : env.UGLY_BOT_URL ?? 'https://ugly.bot';
  const userToken = getUserToken();
  const endpoint = userToken ? `${base}/v1/ai/user-billed/text` : `${base}/v1/ai/text`;
  const bearer = userToken ?? env.UGLY_BOT_TOKEN;
  if (!bearer) throw new Error('no end-user token and UGLY_BOT_TOKEN not set');
  const t0 = Date.now();
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
    body: JSON.stringify({ model, messages, options: { maxTokens } }),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  // Carry the HTTP status on the thrown error so callers can distinguish a
  // payment failure (402 — payer out of credits) from a model/other error and
  // surface the right message. ugly.bot returns `{ error }` on both non-2xx and
  // some 200 envelopes, so check both.
  if (!res.ok || data.error) {
    const detail = typeof data.error === 'string' ? data.error : `HTTP ${res.status}`;
    const err = new Error(`textGen ${detail}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  const parsed = parseTextGenResponse(data);
  parsed.usage.latencyMs = Date.now() - t0;
  if (!parsed.usage.model) parsed.usage.model = model;
  return parsed;
}

/**
 * Pure parser for ugly.bot image-endpoint responses. Exported for unit-testing.
 * The user-billed image endpoint returns the generated image inline as
 * `{ type:'base64', base64, mime }` (NOT a hosted url) — the earlier code only
 * looked for a `url` field, so every generation fell through to '' and surfaced
 * the "couldn't generate an image" fallback even though the proxy succeeded.
 * Mirror the framework's AiImage contract: prefer a url, else a data: URL from
 * the base64 payload (which renders directly in the message markdown).
 */
export function parseImageGenResponse(data: unknown): string {
  const d = (data ?? {}) as Record<string, unknown>;
  const result = d.result as Record<string, unknown> | undefined;
  const url = d.url ?? d.imageUrl ?? result?.url ?? result?.imageUrl;
  if (typeof url === 'string' && url) return url;
  const b64 = (typeof d.base64 === 'string' ? d.base64 : undefined) ??
    (typeof result?.base64 === 'string' ? result.base64 : undefined);
  if (b64) {
    const mime = (typeof d.mime === 'string' && d.mime) || (typeof result?.mime === 'string' && result.mime) || 'image/png';
    return `data:${mime};base64,${b64}`;
  }
  return '';
}

/**
 * Strip heavy, useless-to-a-text-model content from a history message before it
 * becomes prompt context. Exported for unit-testing.
 *
 * The trigger: a bot image reply is stored as `![alt](<src>)`, and before the R2
 * change `<src>` was a ~572KB base64 data: URI. Fed back as text context every
 * turn, that tokenizes to ~400k INPUT tokens — which both made the telemetry
 * strip read "807k tokens" for a two-line chat AND quietly inflated the real
 * cost billed to the user (every turn re-processed the blob). A text model can't
 * use an image URL either way, so collapse image markdown to a short placeholder
 * and nuke any lingering base64 data: URI.
 */
export function sanitizeHistoryContent(content: string): string {
  let out = content.replace(/!\[([^\]]*)\]\([^)]*\)/g, (_m, alt: string) =>
    alt.trim() ? `[image: ${alt.trim()}]` : '[image]',
  );
  out = out.replace(/data:[^;,\s]+;base64,[A-Za-z0-9+/=]+/g, '[image]');
  return out;
}

/** `data:image/jpeg;base64,…` → the bytes + mime, or null if it isn't one. */
export function parseDataUrl(src: string): { bytes: Uint8Array; mime: string } | null {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(src);
  if (!m) return null;
  const mime = m[1] ?? 'image/png';
  const b64 = m[2] ?? '';
  try {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { bytes, mime };
  } catch {
    return null;
  }
}

const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/**
 * Storage key for a generated image: `user/<userId>/<imageId>.<ext>`.
 *
 * Keyed by the USER who asked for it (not the bot that drew it) — it's their
 * image and their storage, and it means everything one person generated can be
 * listed or deleted under one prefix. Exported for tests.
 */
export function imageKey(userId: string, mime: string, id = nanoid()): string {
  const ext = MIME_EXT[mime] ?? 'png';
  return `user/${userId}/${id}.${ext}`;
}

/**
 * Persist a generated image to R2 and return its public URL.
 *
 * The image endpoint hands back the picture inline as base64, and we used to
 * embed that data: URL straight into the message markdown — so a ~570KB blob
 * lived in the message ROW, was re-sent on every conversation load, and rode
 * along in every trackDocs update for the thread. Blob storage was already
 * right there (avatars serve from it with 46-char URLs).
 *
 * Best-effort: if R2 isn't wired, fall back to the data URL rather than lose the
 * image the user already paid for.
 *
 * NOT re-encoded to WEBP. The Workers runtime has no canvas/sharp, and the WASM
 * route (@jsquash) needs the framework's `build:workers` esbuild to carry a
 * `.wasm` loader + a wrangler module rule — without them the codec's wasm never
 * ships, `init()` throws, and we'd silently store the JPEG while claiming WEBP.
 * That's a deliberate framework change, not a per-app hack. See MEMORY.
 */
async function persistGeneratedImage(src: string, userId: string): Promise<string> {
  const parsed = parseDataUrl(src);
  if (!parsed) return src; // already a hosted url
  try {
    const storage = getAppContext().adapter?.storage;
    if (!storage) return src;
    return await storage.put('public', imageKey(userId, parsed.mime), parsed.bytes, parsed.mime);
  } catch (err) {
    console.error('[bots] image upload to R2 failed; keeping inline data url', err);
    return src;
  }
}

// Image generation via ugly.bot's user-billed image endpoint (same auth model as
// uglyBotTextGen). Returns the generated image URL (or an inline data: URL) plus
// usage, so an image turn moves the SPENT/MESSAGES meter like a text turn does
// (it previously reported nothing and the meter looked frozen). `url` is '' on
// failure.
async function uglyBotImageGen(
  model: string,
  prompt: string,
  size: string,
): Promise<{ url: string; usage: MsgTelemetry }> {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
  const base = env.UGLY_BOT_LOCAL === '1' ? 'http://localhost:3000' : env.UGLY_BOT_URL ?? 'https://ugly.bot';
  const userToken = getUserToken();
  const endpoint = userToken ? `${base}/v1/ai/user-billed/image` : `${base}/v1/ai/image`;
  const bearer = userToken ?? env.UGLY_BOT_TOKEN;
  if (!bearer) throw new Error('no end-user token and UGLY_BOT_TOKEN not set');
  const t0 = Date.now();
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
    body: JSON.stringify({ model, prompt, options: { aspectRatio: size } }),
  });
  if (!res.ok) throw new Error(`imageGen HTTP ${res.status}`);
  const data = (await res.json()) as Record<string, unknown>;
  if (data.error) throw new Error(typeof data.error === 'string' ? data.error : JSON.stringify(data.error));
  const cost = Number(data.realCostUsd ?? data.costUsd ?? 0);
  return {
    url: parseImageGenResponse(data),
    usage: {
      model,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: Number.isFinite(cost) ? cost : 0,
      latencyMs: Date.now() - t0,
    },
  };
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

// ugly.bot's metered AI bills the chatting user; a 402 means their balance is
// empty. Surface a clear, actionable message (with a fix link) instead of a
// confusing echo of the user's own text, which read as "the bot is repeating me".
const BILLING_URL = 'https://ugly.bot/billing';
const PAYMENT_REPLY =
  `**AI is paused — out of credits.** Bot replies run on ugly.bot's metered AI ` +
  `and the balance on this account is empty. ` +
  `[Add credits or subscribe](${BILLING_URL}) to keep chatting.`;
const isPaymentError = (err: unknown): boolean =>
  (err as { status?: number } | null)?.status === 402;

/**
 * Turn an image-gen failure into a reason-bearing reply with a retry path.
 * Exported for unit-testing. The old fallback was a single generic "Couldn't
 * generate an image for that — try again", which told the user nothing about
 * WHY and offered no way forward. Classify the common cases and always say how
 * to retry (re-send the prompt) — that IS the retry affordance in a chat.
 */
export function imageFailureReply(err: unknown): { reply: string; color?: string } {
  if (isPaymentError(err)) return { reply: PAYMENT_REPLY, color: 'error' };
  const msg = (err as { message?: string } | null)?.message ?? '';
  if (/\b(400|safety|policy|nsfw|blocked|rejected|content)\b/i.test(msg)) {
    return { reply: 'The image model rejected that prompt. Try rephrasing it and send again.' };
  }
  if (/\b(429|rate|busy|overloaded)\b/i.test(msg)) {
    return { reply: 'The image service is busy right now — wait a moment, then send your prompt again.' };
  }
  return { reply: "The image service hiccuped and couldn't finish that one — send your prompt again to retry." };
}

// A conversation can still list a bot member whose config row is gone — e.g. a
// migrated bot that never got an editable `bot` row, or one that was deleted.
// Such a bot can't generate a reply, but it must NOT go silent (the user just
// sees an unresponsive chat and reports "the bot isn't responding"). Post a
// clear, actionable message so they can rebuild it.
const ORPHAN_REPLY =
  `**This bot needs to be re-created.** Its configuration was lost, so it can't ` +
  `reply here anymore. Open **My Bots** to set it up again (name, instructions, ` +
  `model) and it'll start responding in this chat.`;

// Web search runs through ugly.bot's search proxy; when that's unavailable the
// retriever throws and the engine has nothing to ground on. Surface a clear
// message rather than dead air (or a confusing "no sources" refusal).
const SEARCH_UNAVAILABLE_REPLY =
  `**Search is unavailable right now.** I couldn't reach the web to answer that. ` +
  `Please try again in a bit, or switch this chat to Chat mode from the ⋯ menu.`;

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
  // Perplexity-style web search bot — answers with cited sources via the shared
  // ugly-app/search AnswerEngine (handled specially in triggerBotReplies).
  'bot-search': {
    id: 'bot-search',
    name: 'Search',
    systemPrompt:
      'You search the web and answer with cited sources.',
    model: 'deepseek_v4_flash',
  },
};

/** Any bot — built-in/custom, all keyed with a `bot-` id (incl. `bot-ugly`). */
export const isBot = (id: string): boolean => id.startsWith('bot-');
/** @deprecated kept as alias; use isBot. */
export const isBotId = isBot;

/** Synchronous resolver for built-in bots only (custom bots need a db read). */
export const botUser = (id: string): { _id: string; name: string; isBot: true } | null =>
  BOTS[id] ? { _id: id, name: BOTS[id].name, isBot: true } : null;

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
  getDoc<T>(collection: CollectionDef<T>, id: string): Promise<T | null>;
  getDocs<T>(
    collection: CollectionDef<T>,
    filter?: Record<string, unknown>,
    options?: GetDocsOptions,
  ): Promise<T[]>;
  // Used transitively via `bumpListForMessage` (sidebar denorm) after a bot reply.
  setDoc<T>(collection: CollectionDef<T>, doc: T, options?: { skipIfExists?: boolean }): Promise<boolean>;
}

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
      name: doc.name,
      systemPrompt: doc.instruction,
      model: doc.model,
      firstMessage: (doc.firstMessage) ?? null,
      buttons: (doc.buttons as { label: string; prompt: string }[] | undefined) ?? [],
      avatar: botAvatar(doc),
    };
  }
  // A migrated bot with no editable `bot` row is no longer resolvable as a bot
  // persona (the old `userProfileCache.isBot` signal was dropped) — treat as a
  // plain user. Upgrading it in "My Bots" (which writes a `bot` row) restores it.
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
  conv: Conversation | null,
  conversationId: string,
  exclude: string,
): Promise<string[]> {
  const ids = new Set<string>();
  // The `bots` map is the authoritative list of bot members. Every key is a bot,
  // regardless of id shape — migrated bots are keyed by a plain (non-`bot-`)
  // userId, so filtering by the `bot-` prefix here silently dropped them and they
  // never replied. Include all keys; unresolvable ones surface a clear message
  // downstream instead of dying in silence.
  const bots = (conv?.bots) ?? {};
  for (const k of Object.keys(bots)) if (k !== exclude) ids.add(k);
  const convUsers = (conv?.users as Record<string, { isBot?: boolean }> | undefined) ?? {};
  if (conversationId.includes('+')) {
    for (const p of conversationId.split('+').filter(Boolean)) {
      if (p === exclude || ids.has(p)) continue;
      if (isBot(p)) { ids.add(p); continue; }
      // A DM participant the conversation flags as a bot (migrated bots carry
      // `isBot: true` in the participant map even when their config row is gone),
      // or a migrated-upgraded bot with an editable `bot` row.
      if (convUsers[p]?.isBot === true) { ids.add(p); continue; }
      const botDoc = await db.getDoc(collections.bot, p);
      if (botDoc) ids.add(p);
    }
  }
  // App-registered bots that declare a `webhookUrl` are driven by their owning
  // app (which posts the reply via the cross-app API) — Ugly Chat must NOT also
  // generate a textGen reply for them. Check every id (app bots may be keyed by a
  // plain id too), not only `bot-` prefixed ones.
  const out: string[] = [];
  for (const id of ids) {
    const doc = await db.getDoc(collections.bot, id);
    if (doc && typeof doc.webhookUrl === 'string' && doc.webhookUrl) continue;
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
  collectionsArg: { conversation: CollectionDef<Conversation>; message: CollectionDef<Message> },
  conversationId: string,
  senderUserId: string,
): Promise<void> {
  if (isBot(senderUserId)) return; // built-in/custom bot sender — never reply

  const conv = await db.getDoc(collectionsArg.conversation, conversationId);
  const botIds = await botParticipants(db, conv, conversationId, senderUserId);
  if (botIds.length === 0) return;
  const botSet = new Set(botIds);

  // Fetch the NEWEST 20 (created: -1), then re-sort ascending for the model.
  // With created: 1 the window was the OLDEST 20 messages, so in any conversation
  // with >20 messages the bot never saw recent turns (incl. the user's latest
  // question) and replied to stale context. Same fix as the client's trackDocs.
  const recent = (await db.getDocs(
    collectionsArg.message,
    { conversationId },
    { sort: { created: -1 }, limit: 20 },
  )).reverse();
  const history = recent
    .filter((m) => m.deleted !== true)
    .map((m) => ({
      role: botSet.has(m.userId) ? ('assistant' as const) : ('user' as const),
      // Collapse image markdown / base64 blobs — see sanitizeHistoryContent.
      content: sanitizeHistoryContent(m.text ?? m.markdown ?? ''),
    }))
    .filter((m) => m.content.length > 0);

  interface BotCfg { model?: string; mode?: string; imageModel?: string; imageSize?: string }
  const convBots = (conv?.bots as Record<string, BotCfg> | undefined) ?? {};
  for (const botId of botIds) {
    const bot = await getBotConfig(db, botId);
    if (!bot) {
      // Declared bot member with no resolvable config (lost/migrated). Don't die
      // silently — tell the user how to restore it.
      await conversationMessageCreate(
        { conversationId, message: { text: ORPHAN_REPLY, markdown: ORPHAN_REPLY, color: 'error' } },
        botId,
      );
      await bumpListForMessage(db, conversationId, ORPHAN_REPLY, botId).catch((err: unknown) => {
        console.error('[bots] list denorm failed', err);
      });
      continue;
    }
    // Per-conversation bot config (the bot DM's ⋯ menu): mode + models + size.
    const cfg = convBots[botId] ?? {};
    const mode = cfg.mode ?? 'chat';
    const model = cfg.model ?? bot.model;

    // Search bot (or any conversation in 'search' mode): run the shared
    // AnswerEngine and stream a cited reply via the conversation hub. It
    // persists its own message on commit, so skip the normal reply path.
    if (botId === SEARCH_BOT_ID || mode === 'search') {
      const searchUserToken = getUserToken();
      try {
        await runBotSearch({
          conversationId,
          botId,
          history,
          model,
          textGen: uglyBotTextGen,
          mode: cfg.mode === 'deep' ? 'deep' : 'quick',
          // Bill web retrieval to the chatting user, same as textGen.
          ...(searchUserToken ? { userToken: searchUserToken } : {}),
          userId: senderUserId,
        });
      } catch (err) {
        // Don't leave the user staring at dead air when search fails (proxy down,
        // op unavailable, timeout). Post a clear, actionable message like the
        // text path does — a missing reply reads as "the bot is broken".
        console.warn(`[bots] search failed for ${botId}:`, (err as Error).message);
        await conversationMessageCreate(
          { conversationId, message: { text: SEARCH_UNAVAILABLE_REPLY, markdown: SEARCH_UNAVAILABLE_REPLY, color: 'error' } },
          botId,
        ).catch((e: unknown) => { console.error('[bots] search fallback post failed', e); });
        await bumpListForMessage(db, conversationId, SEARCH_UNAVAILABLE_REPLY, botId).catch((e: unknown) => { console.error('[bots] list denorm failed', e); });
      }
      continue;
    }

    let reply = '';
    let replyColor: string | undefined;
    let usage: MsgTelemetry | undefined;

    if (mode === 'image') {
      // Image mode: generate an image from the user's latest prompt.
      const prompt = history[history.length - 1]?.content ?? '';
      if (!prompt) {
        reply = 'Tell me what to draw — send a description and I\'ll generate an image.';
      } else {
        try {
          const out = await uglyBotImageGen(cfg.imageModel ?? 'flux_1_dev', prompt, cfg.imageSize ?? 'square');
          if (out.url) {
            // Store the bytes in R2 and reference the URL. Embedding the raw
            // data: URL put ~570KB of base64 in the message row itself.
            // Keyed by the person who asked for it, not the bot: it's their
            // image, their storage, and it makes per-user cleanup possible.
            const src = await persistGeneratedImage(out.url, senderUserId);
            reply = `![${prompt.slice(0, 80).replace(/[\[\]]/g, '')}](${src})`;
            // Report the image turn on the meter (model + real cost), like text.
            usage = out.usage;
          }
        } catch (err) {
          console.warn(`[bots] imageGen failed for ${botId}:`, (err as Error).message);
          const f = imageFailureReply(err);
          reply = f.reply;
          replyColor = f.color;
        }
        // A reason-bearing fallback beats the old dead-end "couldn't generate…
        // try again" — it names what went wrong and how to retry (re-send the
        // prompt), instead of leaving the user staring at a generic failure.
        if (!reply) reply = imageFailureReply(null).reply;
      }
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
          // Reasoning models (DeepSeek, Gemini 2.5, …) burn output tokens on a
          // hidden "thinking" block before the visible answer. 1200 was too low
          // for Gemini — it spent the whole budget thinking and returned an empty
          // MAX_TOKENS response, which fell through to the echo fallback. Give the
          // reasoning + a real reply ample room.
          4096,
        );
        reply = out.text;
        usage = out.usage;
      } catch (err) {
        const status = (err as { status?: number }).status;
        console.warn(`[bots] textGen failed for ${botId} (status ${status ?? '?'}):`, (err as Error).message);
        if (isPaymentError(err)) { reply = PAYMENT_REPLY; replyColor = 'error'; }
      }
      // No echo fallback: repeating the user's message read as "the bot is just
      // repeating me". A genuine failure gets a clear, actionable message.
      if (!reply) {
        reply = `I couldn't generate a reply just now. Please try again in a moment, or pick a different model from the ⋯ menu.`;
        replyColor = 'error';
      }
    }
    await conversationMessageCreate(
      {
        conversationId,
        message: {
          text: reply,
          markdown: reply,
          ...(replyColor ? { color: replyColor } : {}),
          ...(usage ? { telemetry: usage } : {}),
          // Stamp the mode on satirical (Lie) replies so the transcript can flag
          // them — otherwise a fabricated answer is indistinguishable from a real
          // one on scrollback, long after the header badge has moved on.
          ...(mode === 'lie' ? { custom: { botMode: 'lie' } } : {}),
        },
      },
      botId,
    );
    // Surface the bot's reply in the sidebar (preview + unread for recipients).
    await bumpListForMessage(
      db,
      conversationId,
      reply,
      botId,
    ).catch((err: unknown) => { console.error('[bots] list denorm failed', err); });
  }
}
