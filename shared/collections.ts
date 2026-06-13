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
    mood: z.string().optional(),
    color: z.string().optional(),
    buttons: z.array(z.unknown()).optional(),
    anchor: z.unknown().optional(),
    mentionUserIds: z.array(z.string()).optional(),
    reactionCount: z.record(z.string(), z.number()).optional(),
    reactionUsers: z.record(z.string(), z.array(z.string())).optional(),
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
export const UserConversationSchema = z
  .object({
    conversationId: z.string(),
    userId: z.string(),
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
});

export type AppCollections = typeof collections;
