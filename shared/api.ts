import { authReq, defineMessages, defineRequests, frameworkMessages, frameworkRequests, z } from 'ugly-app/shared';

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

  // Idempotently add the current user to a public group conversation so it
  // appears in their list (used to join the shared Demo Room).
  conversationJoin: authReq({
    input: z.object({ conversationId: z.string() }).catchall(z.unknown()),
    output: z.any(),
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
      avatarUrl: z.string().nullable().optional(),
      backgroundUrl: z.string().nullable().optional(),
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
      avatarUrl: z.string().nullable().optional(),
      backgroundUrl: z.string().nullable().optional(),
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
