/**
 * Request + cron handlers, runtime-agnostic.
 *
 * `createChatHandlers(getDb)` is called by both `server/index.ts` (Node Express
 * adapter, `() => app.db`) and `server/workers.ts` (Cloudflare Workers adapter,
 * `() => getAppContext().typedDb`). Keeping handlers free of a Node `app`
 * closure is what lets the same code run under both adapters.
 */
// Type-only import — value imports from the 'ugly-app' main entry pull the
// whole Node server (vite/pg/http agents) into the Workers bundle.
import type { RequestHandlers } from 'ugly-app';
import {
  conversationCreate as engineConversationCreate,
  conversationLoad as engineConversationLoad,
  conversationMessageCreate as engineConversationMessageCreate,
  conversationMessageReact as engineConversationMessageReact,
  conversationMessageDelete as engineConversationMessageDelete,
} from 'ugly-app/conversation/engine';
import type { WorkerHandlers } from 'ugly-app/shared';
import { dbDefaults } from 'ugly-app/shared';
import { triggerBotReplies } from './bots';
import { videoJoin, videoLeave, videoEnd, videoBotJoin, type CallState, type DbLike } from './video';
import { requests } from '../shared/api';
import type { Todo } from '../shared/collections';
import { collections } from '../shared/collections';
import { cronTasks } from '../shared/cron';

/** Minimal db surface the handlers need; both adapters' TypedDB satisfy it. */
export interface DbSurface {
  setDoc(col: unknown, doc: unknown): Promise<void>;
  getDoc(col: unknown, id: string): Promise<Record<string, unknown> | null>;
  getDocs(col: unknown, filter?: unknown, opts?: unknown): Promise<Record<string, unknown>[]>;
  deleteDoc(col: unknown, id: string): Promise<void>;
}

export function createChatHandlers(getDb: () => DbSurface): RequestHandlers<typeof requests> {
  return {
    createTodo: async (userId, { text }) => {
      const _id = crypto.randomUUID();
      const todo: Todo = { _id, userId, text, done: false, ...dbDefaults() };
      await getDb().setDoc(collections.todo, todo);
      return { id: _id };
    },

    toggleTodo: async (userId, { todoId }) => {
      const todo = await getDb().getDoc(collections.todo, todoId);
      if (!todo?.['userId'] || todo['userId'] !== userId) throw new Error('Todo not found');
      const updated = { ...todo, done: !todo['done'], ...dbDefaults() };
      await getDb().setDoc(collections.todo, updated);
      return { done: updated.done as boolean };
    },

    deleteTodo: async (userId, { todoId }) => {
      const todo = await getDb().getDoc(collections.todo, todoId);
      if (!todo?.['userId'] || todo['userId'] !== userId) throw new Error('Todo not found');
      await getDb().deleteDoc(collections.todo, todoId);
      return { ok: true };
    },

    triggerTestError: (_userId, { message }) => {
      throw new Error(message ?? 'Test server error triggered intentionally');
    },
    testWorkerThrow: (_userId, { message }) => {
      throw new Error(message ?? 'Worker task exception test');
    },
    testWorkerDbMutation: async (userId, { text }): Promise<{ id: string; verified: boolean }> => {
      const _id = `worker-test-${crypto.randomUUID()}`;
      const todo: Todo = { _id, userId, text, done: false, ...dbDefaults() };
      await getDb().setDoc(collections.todo, todo);
      const readBack = await getDb().getDoc(collections.todo, _id);
      const verified = readBack?.['_id'] === _id && readBack['text'] === text;
      await getDb().deleteDoc(collections.todo, _id);
      return { id: _id, verified };
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    testWorkerConsoleError: async (_userId, { message }) => {
      console.error(message ?? `[WorkerTest] console.error test ${Date.now()}`);
      return { logged: true };
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
          disableJoinMessages: input.disableJoinMessages ?? true,
        },
        userId,
      ),

    conversationLoad: async (userId, input) => engineConversationLoad(input, userId),

    conversationMessageCreate: async (userId, input) => {
      const msg = await engineConversationMessageCreate(
        { ...input, message: { onlyUserIds: ['global'], ...input.message } },
        userId,
      );
      void triggerBotReplies(
        getDb(),
        { conversation: collections.conversation, message: collections.message },
        input.conversationId,
        userId,
      ).catch((err: unknown) => console.error('[bots] reply failed', err));
      return msg;
    },

    conversationMessageReact: async (userId, input) =>
      engineConversationMessageReact(input, userId),

    conversationMessageDelete: async (userId, input) =>
      engineConversationMessageDelete(
        {
          ...input,
          messageId: input.messageId.includes(':')
            ? input.messageId
            : `${input.conversationId}:${input.messageId}`,
        },
        userId,
      ),

    // ── Video call lifecycle ───────────────────────────────────────────────
    conversationVideoJoin: async (userId, input): Promise<CallState> =>
      videoJoin(getDb() as unknown as DbLike, { conversation: collections.conversation }, input.conversationId, userId),
    conversationVideoLeave: async (userId, input): Promise<CallState> =>
      videoLeave(getDb() as unknown as DbLike, { conversation: collections.conversation }, input.conversationId, userId),
    conversationVideoEnd: async (_userId, input): Promise<CallState> =>
      videoEnd(getDb() as unknown as DbLike, { conversation: collections.conversation }, input.conversationId),
    conversationVideoBotJoin: async (_userId, input): Promise<CallState> =>
      videoBotJoin(getDb() as unknown as DbLike, { conversation: collections.conversation }, input.conversationId, input.botId),
  } satisfies RequestHandlers<typeof requests>;
}

export const cronHandlers: WorkerHandlers<typeof cronTasks> = {
  dailyCleanup: async () => {
    // Runtime-agnostic no-op cleanup placeholder (Node previously used pgQuery,
    // which isn't available on Workers). Real cleanup can use the db surface.
    await Promise.resolve();
    console.log('[Cron] dailyCleanup ran');
  },
};
