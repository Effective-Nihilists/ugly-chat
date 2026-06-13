import {
  createApp,
  pgQuery,
  emailSend,
  flushPerf,
  pushSend,
  recordFeedback,
  recordPerf,
  uglyBotRequest,
  type AppConfigurator,
  type InboundEmail,
  type RequestHandlers,
} from 'ugly-app';
import {
  enableConversations,
  type ConversationDeps,
  conversationCreate as engineConversationCreate,
  conversationLoad as engineConversationLoad,
  conversationMessageCreate as engineConversationMessageCreate,
  conversationMessageReact as engineConversationMessageReact,
  conversationMessageDelete as engineConversationMessageDelete,
} from 'ugly-app/conversation/server';
import { enableCollab } from 'ugly-app/collab/server';
import { botUser, triggerBotReplies } from './bots';
import type { WorkerHandlers } from 'ugly-app/shared';
import { dbDefaults } from 'ugly-app/shared';
import { messages, requests } from '../shared/api';
import type { Todo } from '../shared/collections';
import { collections } from '../shared/collections';
import { cronTasks } from '../shared/cron';
import { experiments } from '../shared/experiments';
import en from '../shared/lang/en';
import es from '../shared/lang/es';
import { pages } from '../shared/pages';
import { stringsDef } from '../shared/strings';

const cronHandlers: WorkerHandlers<typeof cronTasks> = {
  dailyCleanup: async () => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const result = await pgQuery(
      `DELETE FROM docs_todo WHERE (data->>'done')::boolean = true AND (data->'updated')::bigint < $1`,
      [thirtyDaysAgo.getTime()],
    );
    console.log(`[Cron] dailyCleanup: deleted ${result.rowCount} old completed todos`);
  },
};

const app = createApp(
  { requests, messages },
  {
    createTodo: async (userId, { text }) => {
      const _id = crypto.randomUUID();
      const todo: Todo = { _id, userId, text, done: false, ...dbDefaults() };
      await app.db.setDoc(collections.todo, todo);
      return { id: _id };
    },

    toggleTodo: async (userId, { todoId }) => {
      const todo = await app.db.getDoc(collections.todo, todoId);
      if (!todo?.userId || todo.userId !== userId) throw new Error('Todo not found');
      const updated: Todo = { ...todo, done: !todo.done, ...dbDefaults() };
      await app.db.setDoc(collections.todo, updated);
      return { done: updated.done };
    },

    deleteTodo: async (userId, { todoId }) => {
      const todo = await app.db.getDoc(collections.todo, todoId);
      if (!todo?.userId || todo.userId !== userId) throw new Error('Todo not found');
      await app.db.deleteDoc(collections.todo, todoId);
      return { ok: true };
    },

    sendPush: async (_userId, { targetUserId, title, body, path, query, imageUrl }) => {
      try {
        const result = await pushSend({ targetUserId, title, body, path, ...(query ? { query } : {}), ...(imageUrl ? { imageUrl } : {}) });
        return { sent: result.sent };
      } catch (e) {
        console.error(e);
        return { sent: false };
      }
    },

    triggerTestError: (_userId, { message }) => {
      const msg = message ?? 'Test server error triggered intentionally';
      throw new Error(msg);
    },

    testWorkerThrow: (_userId, { message }) => {
      const msg = message ?? 'Worker task exception test';
      throw new Error(msg);
    },

    testWorkerDbMutation: async (userId, { text }): Promise<{ id: string; verified: boolean }> => {
      const _id = `worker-test-${crypto.randomUUID()}`;
      const todo: Todo = { _id, userId, text, done: false, ...dbDefaults() };
      await app.db.setDoc(collections.todo, todo);
      const readBack = await app.db.getDoc(collections.todo, _id);
      const verified = readBack?._id === _id && readBack.text === text;
      await app.db.deleteDoc(collections.todo, _id);
      return { id: _id, verified };
    },

    // eslint-disable-next-line @typescript-eslint/require-await
    testWorkerConsoleError: async (_userId, { message }) => {
      const msg = message ?? `[WorkerTest] console.error test ${Date.now()}`;
      console.error(msg);
      return { logged: true };
    },

    triggerTestPerf: async (userId, { operation, durationMs }) => {
      recordPerf(operation, durationMs, userId);
      await flushPerf();
      return { ok: true };
    },

    triggerTestFeedback: async (userId, { type, description }) => {
      await recordFeedback({ type, description, userId });
      return { ok: true };
    },

    sendTestEmail: async (_userId, { userId, subject, html, id }) => {
      await emailSend({ userId, subject, html, id });
      return { ok: true };
    },

    // ── Chat (conversation engine) ─────────────────────────────────────────
    conversationCreate: async (userId, input) =>
      engineConversationCreate(
        {
          ...input,
          id: input.id ?? crypto.randomUUID(),
          type: input.type ?? 'group',
          title: input.title ?? '',
          mode: input.mode ?? 'public',
          ownerIds: input.ownerIds ?? [userId],
          // Suppress engine "X joined" system messages — they're built without
          // onlyUserIds and crash conversationMessageCreateInternal. Members are
          // still added; we just skip the noisy join notice.
          disableJoinMessages: input.disableJoinMessages ?? true,
        },
        userId,
      ),

    conversationLoad: async (userId, input) => engineConversationLoad(input, userId),

    conversationMessageCreate: async (userId, input) => {
      // Default onlyUserIds to ['global'] (visible to everyone) — the engine
      // requires it on every message; callers may override for private msgs.
      const msg = await engineConversationMessageCreate(
        { ...input, message: { onlyUserIds: ['global'], ...input.message } },
        userId,
      );
      // Fire bot replies (delivered via trackDocs); don't block the sender.
      void triggerBotReplies(
        app.db,
        { conversation: collections.conversation, message: collections.message },
        input.conversationId,
        userId,
      ).catch((err: unknown) => console.error('[bots] reply failed', err));
      return msg;
    },

    conversationMessageReact: async (userId, input) =>
      engineConversationMessageReact(input, userId),

    conversationMessageDelete: async (userId, input) =>
      // Engine deletes by raw doc _id, but message docs are keyed
      // "<conversationId>:<messageId>". Reconstruct if the caller passed the
      // short id (react, by contrast, prepends conversationId itself).
      engineConversationMessageDelete(
        {
          ...input,
          messageId: input.messageId.includes(':')
            ? input.messageId
            : `${input.conversationId}:${input.messageId}`,
        },
        userId,
      ),
  } satisfies RequestHandlers<typeof requests>,
  collections,
  (configurator: AppConfigurator) => {
    configurator.setPages({ pages });
    configurator.setExperiments(experiments);
    const tables: Record<string, Record<string, string>> = {
      en: en as unknown as Record<string, string>,
      es: es as unknown as Record<string, string>,
    };
    configurator.setStrings({
      defaultLang: stringsDef.defaultLang,
      langs: stringsDef.langs,
      criticalKeys: stringsDef.criticalKeys,
      getTable: (lang) => tables[lang] ?? tables[stringsDef.defaultLang]!,
    });
    configurator.setWorkers(cronTasks, cronHandlers);
    configurator.setOnEmail(async (inbound: InboundEmail) => {
      await Promise.resolve();
      console.log('[Email] Received:', { from: inbound.from, id: inbound.id, subject: inbound.subject });
    });

    // ── Conversations (chat + bots) ────────────────────────────────────────
    // Wire the full conversation engine (lifted from ugly.bot) via ConversationDeps.
    // `db` is set lazily in setOnAfterStart since `app` isn't assigned yet here.
    // userGet resolves from the local `userPublic` cache (populated from ugly.bot's
    // public-profile lookup — Phase 1); falls back to a minimal record.
    const convDeps: ConversationDeps = {
      db: null,
      collections: {
        conversation: collections.conversation,
        message: collections.message,
        messageReaction: collections.messageReaction,
        conversationUser: collections.conversationUser,
        userConversation: collections.userConversation,
      },
      async userGet(userId: string) {
        const bot = botUser(userId);
        if (bot) return bot;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
        const u = convDeps.db ? await convDeps.db.getDoc(collections.userPublic, userId) : null;
        return u ?? { _id: userId, name: userId.slice(0, 8), isBot: false };
      },
      // eslint-disable-next-line @typescript-eslint/require-await
      async userPrivateGet(userId: string) {
        return { _id: userId };
      },
    };
    const convServer = enableConversations(configurator, {
      conversationCollection: 'conversation',
      messageCollection: 'message',
      reactionCollection: 'messageReaction',
      aiChat: {
        async *onMessage(session, userMessage) {
          const data = await uglyBotRequest<{ message: { content: string } }>('textGen', {
            model: 'gemini_2_5_flash',
            messages: [
              ...session.messages.map((m) => ({ role: m.role, content: m.text })),
              { role: 'user', content: userMessage },
            ],
            options: { maxTokens: 512 },
          });
          yield data.message.content;
        },
      },
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    }, convDeps);

    // ── Collaborative editing ──────────────────────────────────────────────
    enableCollab(configurator, {
      async loadState(docId) {
        try {
          const doc = await app.db.getDoc(collections.collabDoc, docId);
          return doc?.yjsState ?? null;
        } catch { return null; }
      },
      async saveState(docId, state, serialized) {
        await app.db.setDoc(collections.collabDoc, {
          _id: docId,
          yjsState: state.yjsState,
          serialized,
          lastSyncedAt: state.lastSyncedAt,
          ...dbDefaults(),
        });
      },
    });

    // Set db after app is initialized (app isn't available during createApp)
    // eslint-disable-next-line @typescript-eslint/require-await
    configurator.setOnAfterStart(async (db) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      convDeps.db = db;
      convServer.setDb(db);
    });
  },
);

// eslint-disable-next-line @typescript-eslint/dot-notation
const port = parseInt(process.env['PORT'] ?? '4321');
await app.start(port);
