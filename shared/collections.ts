import { z } from 'zod';
import type { InferDocType } from 'ugly-app/shared';
import { defineCollections } from 'ugly-app/shared';

// ─── Schemas & Types ─────────────────────────────────────────────────────────
// Chat schemas are aligned with `ugly-app/conversation` (the conversation engine
// lifted from ugly.bot). They are intentionally permissive (`.catchall`) so the
// engine can persist its full field set without schema drift during the
// migration; tighten as fields stabilize. JSONB storage is schema-light.

export const TodoSchema = z.object({
  userId: z.string(),
  text: z.string(),
  done: z.boolean(),
});
export type Todo = InferDocType<typeof TodoSchema>;

// Conversation — type/title + chat metadata (image, mode, bots, typing, activity).
export const ConversationSchema = z
  .object({
    type: z.string().default('chat'),
    title: z.string().default(''),
    image: z.unknown().nullable().optional(),
    background: z.unknown().nullable().optional(),
    mode: z.enum(['public', 'private', 'restricted']).optional(),
    lastHuman: z.number().optional(),
    lastUser: z.number().optional(),
    chargeUserIds: z.array(z.string()).optional(),
    bots: z.record(z.string(), z.unknown()).optional(),
    typing: z.array(z.unknown()).optional(),
    // The pinned message's full `_id` (`${conversationId}:${shortId}`), or null.
    pinnedMessageId: z.string().nullable().optional(),
    // Cross-app fields: which app owns this conversation + an optional webhook
    // that receives ALL message events in it (HMAC-signed with webhookSecret).
    appId: z.string().optional(),
    webhookUrl: z.string().optional(),
    webhookSecret: z.string().optional(),
  })
  .catchall(z.unknown());
export type Conversation = InferDocType<typeof ConversationSchema>;

// Message — canonical ChatMessage shape (mirrors ugly-app/conversation/shared).
export const MessageSchema = z
  .object({
    conversationId: z.string(),
    userId: z.string(),
    text: z.string().nullable().optional(),
    markdown: z.string().nullable().optional(),
    isBot: z.boolean().optional(),
    files: z.array(z.unknown()).optional(),
    edited: z.boolean().optional(),
    deleted: z.boolean().optional(),
    parentMessageId: z.string().nullable().optional(),
    visibility: z.enum(['normal', 'silent', 'hidden']).optional(),
    onlyUserIds: z.array(z.string()).optional(),
    systemType: z.string().optional(),
    // Target userId for membership system messages (memberAdd/Remove/Leave).
    systemParam: z.string().optional(),
    mood: z.string().optional(),
    color: z.string().optional(),
    buttons: z.array(z.unknown()).optional(),
    anchor: z.unknown().optional(),
    mentionUserIds: z.array(z.string()).optional(),
    reactionCount: z.record(z.string(), z.number()).optional(),
    reactionUsers: z.record(z.string(), z.array(z.string())).optional(),
    // OpenGraph link-preview cards, populated server-side after create (unfurl).
    linkPreviews: z
      .array(
        z.object({
          url: z.string(),
          title: z.string().optional(),
          description: z.string().optional(),
          image: z.string().optional(),
          siteName: z.string().optional(),
        }),
      )
      .optional(),
  })
  .catchall(z.unknown());
export type Message = InferDocType<typeof MessageSchema>;

// Message reaction — one row per (messageId, userId, reaction).
export const MessageReactionSchema = z
  .object({
    messageId: z.string(),
    conversationId: z.string().optional(),
    userId: z.string(),
    reaction: z.string(),
  })
  .catchall(z.unknown());
export type MessageReaction = InferDocType<typeof MessageReactionSchema>;

// Conversation membership (roles, bot params, per-user buttons).
export const ConversationUserSchema = z
  .object({
    conversationId: z.string(),
    userId: z.string(),
    isBot: z.boolean().optional(),
    role: z.string().optional(),
    params: z.record(z.string(), z.unknown()).optional(),
  })
  .catchall(z.unknown());
export type ConversationUser = InferDocType<typeof ConversationUserSchema>;

// A user's view of a conversation (unread, pinned, notifications, visibility).
// The conversation engine keys these by `userPrivateId` (NOT `userId`) and
// denormalizes the sidebar fields onto the doc (title/image/notificationText
// preview/notificationCount unread/visibility). Schema is permissive so the
// engine's writes round-trip without validation errors.
export const UserConversationSchema = z
  .object({
    conversationId: z.string(),
    userPrivateId: z.string().optional(),
    userId: z.string().optional(),
    title: z.string().optional(),
    type: z.string().optional(),
    image: z.unknown().nullable().optional(),
    background: z.unknown().nullable().optional(),
    notificationText: z.string().optional(),
    notificationCount: z.number().optional(),
    viewed: z.number().optional(),
    unread: z.number().optional(),
    pinned: z.boolean().optional(),
    visibility: z.string().optional(),
  })
  .catchall(z.unknown());
export type UserConversation = InferDocType<typeof UserConversationSchema>;

// Lightweight cache of ugly.bot public profiles (name/avatar) so chat can render
// any participant. Populated from ugly.bot's public-profile lookup. See Phase 1.
export const UserPublicSchema = z
  .object({
    name: z.string().nullable().optional(),
    avatar: z.unknown().nullable().optional(),
    isBot: z.boolean().optional(),
    fetchedAt: z.number().optional(),
  })
  .catchall(z.unknown());
export type UserPublic = InferDocType<typeof UserPublicSchema>;

export const CollabDocSchema = z.object({
  yjsState: z.string(),
  serialized: z.string().nullable(),
  lastSyncedAt: z.number(),
});
export type CollabDoc = InferDocType<typeof CollabDocSchema>;

// A custom bot = a config-only persona (no code sandbox). The creator sets a
// name, avatar, conversation background, system instruction, model, an optional
// opening message, and "starter" buttons that send preset prompts on tap.
// Bot _id is `bot-<id>` so server-side `isBot()` recognizes it like the
// built-ins. Public so anyone can open a chat with a shared bot.
export const BotButtonSchema = z.object({
  label: z.string().max(40),
  prompt: z.string().max(2000),
});
export type BotButton = z.infer<typeof BotButtonSchema>;

export const BotSchema = z
  .object({
    ownerId: z.string(),
    name: z.string().default('Bot'),
    avatarUrl: z.string().nullable().optional(),
    backgroundUrl: z.string().nullable().optional(),
    instruction: z.string().default(''),
    model: z.string().default('deepseek_v4_flash'),
    firstMessage: z.string().nullable().optional(),
    buttons: z.array(BotButtonSchema).optional(),
    // App-registered bots: the owning app + a webhook that receives message
    // events for conversations this bot is in (the app generates the reply).
    // When `webhookUrl` is set, Ugly Chat does NOT run textGen for this bot.
    appId: z.string().optional(),
    webhookUrl: z.string().optional(),
    webhookSecret: z.string().optional(),
  })
  .catchall(z.unknown());
export type Bot = InferDocType<typeof BotSchema>;

// --- Collections ---
// meta options:
//   cache        – cache docs in memory LRU (good for small, frequently read collections)
//   trackable    – emit change events so clients can subscribe to real-time updates
//   public       – allow unauthenticated reads (use sparingly)
//   cascadeFrom  – name of a parent collection: when that parent is deleted, cascade here
//   trackKeys    – fields used as NATS routing keys for scoped trackDocs subscriptions
//
// After adding a collection, run: npm run db:schema-gen && npm run db:migrate
export const collections = defineCollections({
  todo: {
    schema: TodoSchema,
    meta: { cache: false, trackable: true, public: false, cascadeFrom: null, trackKeys: ['userId'] },
  },
  conversation: {
    schema: ConversationSchema,
    meta: { cache: false, trackable: true, public: false, cascadeFrom: null },
  },
  message: {
    schema: MessageSchema,
    meta: { cache: false, trackable: true, public: false, cascadeFrom: 'conversation', trackKeys: ['conversationId'] },
  },
  messageReaction: {
    schema: MessageReactionSchema,
    meta: { cache: false, trackable: true, public: false, cascadeFrom: 'conversation', trackKeys: ['conversationId', 'messageId'] },
  },
  conversationUser: {
    schema: ConversationUserSchema,
    meta: { cache: false, trackable: true, public: false, cascadeFrom: 'conversation', trackKeys: ['conversationId', 'userId'] },
  },
  userConversation: {
    schema: UserConversationSchema,
    meta: { cache: false, trackable: true, public: false, cascadeFrom: 'conversation', trackKeys: ['userId'] },
  },
  userPublic: {
    schema: UserPublicSchema,
    meta: { cache: true, trackable: false, public: true, cascadeFrom: null },
  },
  collabDoc: {
    schema: CollabDocSchema,
    meta: { cache: false, trackable: false, public: false, cascadeFrom: null },
  },
  bot: {
    schema: BotSchema,
    meta: { cache: true, trackable: true, public: true, cascadeFrom: null, trackKeys: ['ownerId'] },
  },
});

export type AppCollections = typeof collections;
