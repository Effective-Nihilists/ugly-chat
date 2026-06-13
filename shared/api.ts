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

  // Push notification test — send a push via ugly.bot
  sendPush: authReq({
    input: z.object({
      targetUserId: z.string(),
      title: z.string().min(1).max(200),
      body: z.string().max(500),
      path: z.string(),
      query: z.record(z.string(), z.string()).optional(),
      imageUrl: z.string().optional(),
    }),
    output: z.object({ sent: z.boolean() }),
    rateLimit: { max: 10, window: 60 },
  }),

  // Email test — send an email via the app's email sender
  sendTestEmail: authReq({
    input: z.object({
      userId: z.string().min(1),
      subject: z.string().min(1).max(200),
      html: z.string().min(1),
      id: z.string().max(100).optional(),
    }),
    output: z.object({ ok: z.boolean() }),
    rateLimit: { max: 5, window: 60 },
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

  // Perf test — records a perf entry through the framework's perf API
  triggerTestPerf: authReq({
    input: z.object({
      operation: z.string().min(1).max(200),
      durationMs: z.number().int().min(0).max(60_000),
    }),
    output: z.object({ ok: z.boolean() }),
  }),

  // Feedback test — records a feedback entry through the data-proxy capture
  // path so devTunnelId is stamped from the project's JWT (matches what
  // `ugly-app feedback:dev` filters on).
  triggerTestFeedback: authReq({
    input: z.object({
      type: z.enum(['bug', 'design', 'feature']),
      description: z.string().min(1).max(2000),
    }),
    output: z.object({ ok: z.boolean() }),
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
