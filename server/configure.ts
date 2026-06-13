/**
 * Adapter-neutral wiring shared by the Node (`server/index.ts`) and Workers
 * (`server/workers.ts`) entries.
 *
 * Only the conversation-engine deps live here, because they're set via
 * module-global `setConversationDeps` (independent of the per-adapter
 * configurator). `db` is a getter so each engine access resolves the current
 * request's db — Node: `app.db`; Workers: `getAppContext().typedDb` — which is
 * what makes the engine safe under the Workers per-request model.
 *
 * ugly.chat drives chat via RPC + trackDocs (not the Layer-1 `conv:*` socket),
 * so setting deps directly is enough; we don't stand up the AI-chat socket.
 *
 * Pages / strings / cron / collab stay in the per-adapter entry (the Node and
 * Workers configurators differ — the Workers entry only wires cron).
 */
import {
  setConversationDeps,
  setConversationUserDeps,
  type ConversationDeps,
} from 'ugly-app/conversation/server';
import { botUser } from './bots';
import type { DbSurface } from './handlers';
import { collections } from '../shared/collections';

export function wireEngineDeps(getDb: () => DbSurface): void {
  const convDeps: ConversationDeps = {
    get db() {
      return getDb();
    },
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
      const u = await getDb().getDoc(collections.userPublic, userId);
      return u ?? { _id: userId, name: userId.slice(0, 8), isBot: false };
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async userPrivateGet(userId: string) {
      return { _id: userId };
    },
  };
  setConversationDeps(convDeps);
  setConversationUserDeps(convDeps);
}
