import { authReq, defineMessages, defineRequests, frameworkMessages, frameworkRequests, z, AvatarSchema } from 'ugly-app/shared';

export const requests = defineRequests({
  // Todo demo — CRUD requests
  createTodo: authReq({
    input: z.object({ text: z.string().min(1).max(500) }),
    output: z.object({ id: z.string() }),
  }),

  toggleTodo: authReq({
    input: z.object({ todoId: z.string() }),
    output: z.object({ done: z.boolean() }),
  }),

  deleteTodo: authReq({
    input: z.object({ todoId: z.string() }),
    output: z.object({ ok: z.boolean() }),
  }),

  // Error test — intentionally throws to test error capture
  triggerTestError: authReq({
    input: z.object({ message: z.string().optional() }),
    output: z.object({ ok: z.boolean() }),
  }),

  // Worker task tests — verify exception, DB mutation, and console.error
  testWorkerThrow: authReq({
    input: z.object({ message: z.string().optional() }),
    output: z.object({ ok: z.boolean() }),
  }),

  testWorkerDbMutation: authReq({
    input: z.object({ text: z.string().min(1).max(500) }),
    output: z.object({ id: z.string(), verified: z.boolean() }),
  }),

  testWorkerConsoleError: authReq({
    input: z.object({ message: z.string().optional() }),
    output: z.object({ logged: z.boolean() }),
  }),

  // ── Chat (ugly-app/conversation engine) ──────────────────────────────────
  // Thin RPC wrappers over the conversation engine functions. Inputs use
  // `.catchall` so the engine's full field set passes through un-stripped;
  // outputs are permissive since the engine returns rich documents.
  conversationCreate: authReq({
    input: z
      .object({
        id: z.string().optional(),
        type: z.string().optional(),
        title: z.string().optional(),
        mode: z.enum(['public', 'private', 'restricted']).optional(),
        ownerIds: z.array(z.string()).optional(),
      })
      .catchall(z.unknown()),
    output: z.any(),
  }),

  conversationLoad: authReq({
    input: z.object({ conversationOrUserId: z.string() }).catchall(z.unknown()),
    output: z.any(),
  }),

  // Sidebar / chat-home conversation list for the current user. Built from the
  // user's `userConversation` rows (engine-denormalized: title/preview/unread).
  conversationListMine: authReq({
    input: z.object({}).catchall(z.unknown()),
    output: z.object({
      conversations: z.array(
        z.object({
          conversationId: z.string(),
          title: z.string(),
          image: z.unknown().nullable(),
          type: z.string(),
          preview: z.string(),
          unread: z.number(),
          pinned: z.boolean(),
          lastActivity: z.number(),
        }),
      ),
    }),
  }),

  // Pin/unpin a conversation in the caller's list (sets their userConversation
  // visibility to 'pinned' or 'visible'; conversationListMine sorts pinned first).
  conversationSetPinned: authReq({
    input: z.object({ conversationId: z.string(), pinned: z.boolean() }).catchall(z.unknown()),
    output: z.object({ ok: z.boolean() }),
  }),

  // Set the bot's per-conversation config (the bot DM's ⋯ menu): chat mode,
  // text model, image model, image size. Persisted on conversation.bots[botId]
  // and read by triggerBotReplies. All fields optional — patch what's provided.
  conversationSetBotModel: authReq({
    input: z
      .object({
        conversationId: z.string(),
        botId: z.string(),
        model: z.string().optional(),
        mode: z.string().optional(),
        imageModel: z.string().optional(),
        imageSize: z.string().optional(),
      })
      .catchall(z.unknown()),
    output: z.object({ ok: z.boolean() }),
  }),

  // The caller's own federated profile (name + avatar), for the settings editor.
  userProfileGet: authReq({
    input: z.object({}).catchall(z.unknown()),
    output: z.object({ name: z.string().nullable(), avatarUrl: z.string().nullable() }).catchall(z.unknown()),
  }),

  // Update the caller's own name/avatar. Writes through to ugly.bot (federated
  // profile) and refreshes the local cache so it shows in-session immediately.
  userProfileUpdate: authReq({
    input: z
      .object({ name: z.string().max(80).optional(), avatarUrl: z.string().nullable().optional() })
      .catchall(z.unknown()),
    output: z.object({ ok: z.boolean(), name: z.string().nullable(), avatarUrl: z.string().nullable() }),
  }),

  // Each other member's single last-read timestamp for a conversation (the
  // `viewed` field). Drives a simple "Seen" indicator — no per-message stamps.
  conversationReadState: authReq({
    input: z.object({ conversationId: z.string() }).catchall(z.unknown()),
    output: z.object({
      readers: z.array(z.object({ userId: z.string(), viewed: z.number() })),
    }),
  }),

  // Mark a conversation read for the caller (zero unread + stamp viewed).
  // Called when the chat view is open / a new message arrives while viewing.
  conversationMarkRead: authReq({
    input: z.object({ conversationId: z.string() }).catchall(z.unknown()),
    output: z.object({ ok: z.boolean() }),
    rateLimit: { max: 120, window: 60 },
  }),

  // Pin/unpin a message in a conversation (one pinned message per conversation;
  // `messageId` null clears it). Shown as a banner above the thread for everyone.
  conversationPinMessage: authReq({
    input: z
      .object({ conversationId: z.string(), messageId: z.string().nullable() })
      .catchall(z.unknown()),
    output: z.object({ ok: z.boolean() }),
  }),

  // Idempotently add the current user to a public group conversation so it
  // appears in their list (used to join the shared Demo Room).
  conversationJoin: authReq({
    input: z.object({ conversationId: z.string() }).catchall(z.unknown()),
    output: z.any(),
  }),

  // People the caller already shares conversations with — the candidate pool
  // for adding members to a group (no global user directory needed).
  userContacts: authReq({
    input: z.object({}).catchall(z.unknown()),
    output: z.object({
      users: z.array(
        z.object({
          userId: z.string(),
          name: z.string(),
          avatar: AvatarSchema,
        }),
      ),
    }),
  }),

  // ── Group membership admin ───────────────────────────────────────────────
  // List a conversation's members with resolved profiles + roles.
  conversationMembers: authReq({
    input: z.object({ conversationId: z.string() }).catchall(z.unknown()),
    output: z.object({
      members: z.array(
        z.object({
          userId: z.string(),
          role: z.string(),
          name: z.string(),
          avatar: AvatarSchema,
          isBot: z.boolean(),
        }),
      ),
    }),
  }),
  // Add a member (engine enforces owner/mode rules). Defaults to 'member'.
  conversationMemberAdd: authReq({
    input: z
      .object({
        conversationId: z.string(),
        userId: z.string(),
        role: z.enum(['owner', 'member', 'viewer']).optional(),
      })
      .catchall(z.unknown()),
    output: z.any(),
  }),
  // Remove a member — or leave (userId === self). Engine enforces owner/self +
  // last-owner protection.
  conversationMemberRemove: authReq({
    input: z.object({ conversationId: z.string(), userId: z.string() }).catchall(z.unknown()),
    output: z.any(),
  }),
  // Change a member's role (owner only, enforced by the engine).
  conversationMemberRole: authReq({
    input: z
      .object({
        conversationId: z.string(),
        userId: z.string(),
        role: z.enum(['owner', 'member', 'viewer']),
      })
      .catchall(z.unknown()),
    output: z.any(),
  }),
  // Owner-only: delete the whole conversation (cascades to messages, reactions,
  // members, and every member's list row). Distinct from conversationClear,
  // which only wipes messages.
  conversationDelete: authReq({
    input: z.object({ conversationId: z.string() }).catchall(z.unknown()),
    output: z.object({ ok: z.boolean() }),
  }),

  // ── Email-keyed flows (start chat / create group / add member) ────────────
  // Resolve an email to an ugly.bot userId, or signal an invite is needed.
  resolveEmail: authReq({
    input: z.object({ email: z.string() }),
    output: z.union([
      z.object({ status: z.literal('found'), userId: z.string(), name: z.string() }),
      z.object({ status: z.literal('invite'), email: z.string() }),
    ]),
    rateLimit: { max: 30, window: 60 },
  }),
  // Start (or reuse) a 1:1 with the person at `email`. Unknown email → invite.
  conversationCreateDirect: authReq({
    input: z.object({ email: z.string() }),
    output: z.object({ conversationId: z.string(), invited: z.boolean() }),
    rateLimit: { max: 20, window: 60 },
  }),
  // Create a group; resolve each email and add known users, invite the rest.
  groupCreate: authReq({
    input: z.object({
      title: z.string().max(80).optional(),
      emails: z.array(z.string()).max(50),
    }),
    output: z.object({ conversationId: z.string(), invited: z.array(z.string()) }),
    rateLimit: { max: 10, window: 60 },
  }),

  // Start a chat from picked contacts (userIds) and/or typed emails. One person
  // total → 1:1; two or more → group. Unknown emails get an invite. This is the
  // userId-aware path the new-message picker uses (vs the email-only helpers).
  conversationStart: authReq({
    input: z.object({
      userIds: z.array(z.string()).max(50).optional(),
      emails: z.array(z.string()).max(50).optional(),
      title: z.string().max(80).optional(),
    }),
    output: z.object({ conversationId: z.string(), invited: z.array(z.string()) }),
    rateLimit: { max: 20, window: 60 },
  }),

  conversationMessageCreate: authReq({
    input: z
      .object({
        conversationId: z.string(),
        message: z
          .object({
            text: z.string().optional(),
            markdown: z.string().optional(),
          })
          .catchall(z.unknown()),
      })
      .catchall(z.unknown()),
    output: z.any(),
    rateLimit: { max: 60, window: 60 },
  }),

  conversationMessageReact: authReq({
    input: z
      .object({
        conversationId: z.string(),
        messageId: z.string(),
        reaction: z.string().nullable(),
      })
      .catchall(z.unknown()),
    output: z.any(),
  }),

  conversationMessageDelete: authReq({
    input: z
      .object({ conversationId: z.string(), messageId: z.string() })
      .catchall(z.unknown()),
    output: z.any(),
  }),

  // Edit an existing message (own messages only — enforced in the handler).
  // `messageId` is the short id; the engine builds the `${conversationId}:${id}`
  // key and re-derives `text` from `markdown`.
  conversationMessageEdit: authReq({
    input: z
      .object({
        conversationId: z.string(),
        messageId: z.string(),
        markdown: z.string(),
      })
      .catchall(z.unknown()),
    output: z.any(),
    rateLimit: { max: 60, window: 60 },
  }),

  // Set/clear the caller's typing indicator on a conversation. `start` is a
  // timestamp (ms) to mark typing, or null to clear. Throttled client-side.
  conversationSetTyping: authReq({
    input: z
      .object({ conversationId: z.string(), start: z.number().nullable() })
      .catchall(z.unknown()),
    output: z.any(),
    rateLimit: { max: 40, window: 60 },
  }),

  // Relay a (possibly partial) live call caption to other participants. Fire-
  // and-forget: writes a transient per-speaker caption onto `conversation.call`
  // so peers receive it via the same trackDoc('conversation') subscription the
  // call roster / typing indicator already use. Not persisted as a message.
  conversationCaption: authReq({
    input: z
      .object({ conversationId: z.string(), text: z.string(), final: z.boolean() })
      .catchall(z.unknown()),
    output: z.object({ ok: z.boolean() }),
    rateLimit: { max: 240, window: 60 },
  }),

  // Full-text message search. Scoped to one conversation when `conversationId`
  // is given, otherwise across all of the caller's conversations.
  conversationMessageSearch: authReq({
    input: z
      .object({
        search: z.string(),
        conversationId: z.string().optional(),
        limit: z.number().optional(),
      })
      .catchall(z.unknown()),
    output: z.object({ items: z.array(z.any()) }),
    rateLimit: { max: 30, window: 60 },
  }),

  // ── Video call lifecycle (roster via trackDoc on conversation.call) ───────
  conversationVideoJoin: authReq({
    input: z.object({ conversationId: z.string() }).catchall(z.unknown()),
    output: z.any(),
  }),
  conversationVideoLeave: authReq({
    input: z.object({ conversationId: z.string() }).catchall(z.unknown()),
    output: z.any(),
  }),
  conversationVideoEnd: authReq({
    input: z.object({ conversationId: z.string() }).catchall(z.unknown()),
    output: z.any(),
  }),
  conversationVideoBotJoin: authReq({
    input: z.object({ conversationId: z.string(), botId: z.string() }).catchall(z.unknown()),
    output: z.any(),
  }),
  // Advertise the caller's SFU session + published track names on the call
  // roster so peers can pull them.
  conversationVideoPublish: authReq({
    input: z
      .object({
        conversationId: z.string(),
        sessionId: z.string(),
        tracks: z.array(z.string()),
      })
      .catchall(z.unknown()),
    output: z.any(),
  }),

  // Publish mic/cam state so peers can show a muted / camera-off badge.
  conversationVideoMedia: authReq({
    input: z
      .object({ conversationId: z.string(), micOn: z.boolean(), camOn: z.boolean() })
      .catchall(z.unknown()),
    output: z.any(),
  }),

  // Fresh server-side call roster (clients poll this to pull peers reliably).
  conversationVideoState: authReq({
    input: z.object({ conversationId: z.string() }).catchall(z.unknown()),
    output: z.any(),
  }),

  // ── Cloudflare Realtime (Calls) SFU/TURN broker (secret stays server-side) ─
  realtimeIceServers: authReq({ input: z.object({}).catchall(z.unknown()), output: z.any() }),
  realtimeNewSession: authReq({ input: z.object({}).catchall(z.unknown()), output: z.any() }),
  // `body` is the WebRTC SDP + track descriptors the client built; relayed as-is.
  realtimeTracks: authReq({
    input: z.object({ sessionId: z.string(), body: z.any() }).catchall(z.unknown()),
    output: z.any(),
  }),
  realtimeRenegotiate: authReq({
    input: z.object({ sessionId: z.string(), body: z.any() }).catchall(z.unknown()),
    output: z.any(),
  }),

  // Resolve participant profiles (name + avatar) for rendering.
  profilesGet: authReq({
    input: z.object({ userIds: z.array(z.string()) }),
    output: z.any(),
  }),

  // ── Custom bots (config-only personas) ────────────────────────────────────
  botCreate: authReq({
    input: z.object({
      name: z.string().min(1).max(60),
      instruction: z.string().max(8000).optional(),
      model: z.string().optional(),
      avatar: AvatarSchema.optional(),
      firstMessage: z.string().max(2000).nullable().optional(),
      buttons: z.array(z.object({ label: z.string().max(40), prompt: z.string().max(2000) })).optional(),
    }),
    output: z.object({ botId: z.string() }),
  }),
  botUpdate: authReq({
    input: z.object({
      botId: z.string(),
      name: z.string().min(1).max(60).optional(),
      instruction: z.string().max(8000).optional(),
      model: z.string().optional(),
      avatar: AvatarSchema.optional(),
      firstMessage: z.string().max(2000).nullable().optional(),
      buttons: z.array(z.object({ label: z.string().max(40), prompt: z.string().max(2000) })).optional(),
    }),
    output: z.object({ ok: z.boolean() }),
  }),
  botGet: authReq({
    input: z.object({ botId: z.string() }),
    output: z.any(),
  }),
  botListMine: authReq({
    input: z.object({}).catchall(z.unknown()),
    output: z.object({ bots: z.array(z.any()) }),
  }),
  // Curated built-in bots (e.g. Ugly Bot) so a brand-new user with no custom
  // bots still has a discoverable entry point to start chatting.
  botListFeatured: authReq({
    input: z.object({}).catchall(z.unknown()),
    output: z.object({ bots: z.array(z.any()) }),
  }),
  botDelete: authReq({
    input: z.object({ botId: z.string() }),
    output: z.object({ ok: z.boolean() }),
  }),
  conversationClear: authReq({
    input: z.object({ conversationId: z.string() }),
    output: z.object({ ok: z.boolean() }),
  }),

  // Example: public request — userId is string | null
  // getPublicData: req({
  //   input: z.object({ id: z.string() }),
  //   output: z.object({ data: z.string() }),
  // }),
});

export const messages = defineMessages({
  // Example fire-and-forget (with Zod):
  // userTyping: msg(z.object({ channelId: z.string() })),
  //
  // Example RPC (with Zod):
  // getOnlineUsers: rpcMsg({
  //   data: z.object({ channelId: z.string() }),
  //   response: z.object({ userIds: z.array(z.string()) }),
  // }),
});

export type { authReq };

export interface AppRegistry {
  requests: typeof frameworkRequests & typeof requests;
  messages: typeof frameworkMessages & typeof messages;
}
