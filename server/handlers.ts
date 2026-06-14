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
  conversationUserAdd as engineConversationUserAdd,
} from 'ugly-app/conversation/engine';
import type { WorkerHandlers } from 'ugly-app/shared';
import { dbDefaults } from 'ugly-app/shared';
import { nanoid } from 'nanoid';
import { triggerBotReplies, getBotConfig, isBot } from './bots';
import { fireMessageWebhooks } from './webhooks';
import { UGLY_BOT_USER_ID } from '../shared/bots';
import { resolveProfiles, type Profile } from './profiles';
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
      const _id = nanoid();
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
      const _id = `worker-test-${nanoid()}`;
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
    conversationCreate: async (userId, input) => {
      const id = input.id ?? nanoid();
      const conv = await engineConversationCreate(
        {
          ...input,
          id,
          type: input.type ?? 'group',
          title: input.title ?? '',
          mode: input.mode ?? 'public',
          ownerIds: input.ownerIds ?? [userId],
          disableJoinMessages: input.disableJoinMessages ?? true,
        },
        userId,
      );
      // Seed a bot member's opening message + starter buttons into the brand-new
      // conversation. The client only calls conversationCreate when the room
      // doesn't exist yet, so this runs once. A button-only bot (no first
      // message) still posts so its starters render.
      // Bot members to greet: ids in the `bots` field PLUS a DM's bot
      // participant (e.g. the canonical Ugly Bot in `<botId>+<userId>`).
      const greetIds = new Set<string>(Object.keys((input.bots ?? {}) as Record<string, unknown>).filter(isBot));
      if (id.includes('+')) {
        for (const p of id.split('+').filter(Boolean)) {
          if (p !== userId && isBot(p)) greetIds.add(p);
        }
      }
      for (const botId of greetIds) {
        const bot = await getBotConfig(getDb(), botId).catch(() => null);
        if (!bot?.firstMessage) continue;
        // Greeting only — starter buttons render persistently above the composer
        // (from the live bot config), so they're always visible, not just on the
        // first (scroll-away) message.
        await engineConversationMessageCreate(
          {
            conversationId: id,
            message: { text: bot.firstMessage, markdown: bot.firstMessage, onlyUserIds: ['global'] },
          },
          botId,
        ).catch((err: unknown) => console.error('[bots] first message failed', err));
      }
      return conv;
    },

    conversationLoad: async (userId, input) => {
      const loaded = await engineConversationLoad(input, userId);
      // App-created conversations (e.g. Ugly Love) are seeded with
      // `hidden: true`, so the member's userConversation starts `visibility:
      // 'hidden'` and never appears in conversationListMine. Opening it is
      // explicit engagement — un-hide it so "if I can see it, it's in my list".
      void unhideMembers(getDb(), input.conversationId, userId).catch((err: unknown) =>
        console.error('[conv] unhide on load failed', err),
      );
      return loaded;
    },

    conversationMessageCreate: async (userId, input) => {
      const msg = await engineConversationMessageCreate(
        { ...input, message: { onlyUserIds: ['global'], ...input.message } },
        userId,
      );
      // A real message surfaces the conversation in every human member's list
      // (the other Love partner sees it appear), not just the sender's.
      void unhideMembers(getDb(), input.conversationId).catch((err: unknown) =>
        console.error('[conv] unhide on message failed', err),
      );
      // Built-in/custom bots WITHOUT a webhook reply via textGen here. App bots
      // (with a webhookUrl) are driven by their owning app instead — see
      // fireMessageWebhooks, which notifies the conversation + bot webhooks.
      void triggerBotReplies(
        getDb(),
        { conversation: collections.conversation, message: collections.message },
        input.conversationId,
        userId,
      ).catch((err: unknown) => console.error('[bots] reply failed', err));
      void fireMessageWebhooks(
        getDb(),
        'message.created',
        input.conversationId,
        msg as unknown as Record<string, unknown>,
      ).catch((err: unknown) => console.error('[webhook] fire failed', err));
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

    profilesGet: async (_userId, input): Promise<{ profiles: Profile[] }> => ({
      profiles: await resolveProfiles(getDb(), input.userIds),
    }),

    // ── Conversation list (sidebar / chat home) ────────────────────────────
    conversationListMine: async (userId): Promise<{ conversations: ConversationListRow[] }> => {
      // The engine keys userConversation by `userPrivateId` and denormalizes
      // the sidebar fields onto it (title/image/notificationText/count).
      const db = getDb();
      const ucs = (await db.getDocs(collections.userConversation, {
        userPrivateId: userId,
      })) as Record<string, unknown>[];
      const rows: ConversationListRow[] = ucs
        .filter((u) => ((u['visibility'] as string) ?? 'visible') !== 'hidden')
        .map((u) => ({
          conversationId: String(u['conversationId'] ?? ''),
          title: (u['title'] as string) || '',
          image: (u['image'] as unknown) ?? null,
          type: (u['type'] as string) || 'group',
          preview: (u['notificationText'] as string) || '',
          unread: (u['notificationCount'] as number) ?? 0,
          pinned: (u['visibility'] as string) === 'pinned',
          lastActivity: toMillis(u['updated'] ?? u['viewed'] ?? u['created']),
        }))
        .filter((r) => r.conversationId !== '');

      rows.sort(
        (a, b) => Number(b.pinned) - Number(a.pinned) || b.lastActivity - a.lastActivity,
      );

      // DM/1:1 conversations carry no title — ugly.bot shows the *other*
      // participant's name + avatar. DM ids are `{otherId}+{myUserId}`. Resolve
      // the most-recent ones in one batch (names from migrated data, avatars
      // from ugly.bot — its avatars aren't in our migration; resolveProfiles
      // caps at 100 ids and caches). Rows are pre-sorted so the visible top
      // conversations get resolved first.
      // The Ugly Bot DM is auto-created with title 'Ugly Bot' (so it'd skip the
      // `!r.title` filter) but still needs its avatar resolved — include any DM
      // whose other participant is the canonical bot regardless of title.
      const dmRows = rows
        .filter((r) => {
          const other = deriveOtherUserId(r.conversationId, userId);
          return !!other && (!r.title || other === UGLY_BOT_USER_ID);
        })
        .slice(0, 90);
      const otherIds = [...new Set(dmRows.map((r) => deriveOtherUserId(r.conversationId, userId)!))];
      if (otherIds.length > 0) {
        const profiles = await resolveProfiles(getDb(), otherIds);
        const byId = new Map(profiles.map((p) => [p.id, p]));
        for (const r of dmRows) {
          const other = deriveOtherUserId(r.conversationId, userId)!;
          const p = byId.get(other);
          if (p) {
            if (!r.title) r.title = p.name;
            // Canonical bot: pin its avatar even over a stale/blank image.
            if (other === UGLY_BOT_USER_ID ? !!p.avatarUrl : !r.image && !!p.avatarUrl) {
              r.image = p.avatarUrl;
            }
          }
        }
      }

      return { conversations: rows };
    },

    conversationJoin: async (userId, input) =>
      engineConversationUserAdd(
        { conversationId: input.conversationId, userId, role: 'member', visibility: 'visible' },
        userId,
      ),

    // ── Custom bots (config-only personas) ──────────────────────────────────
    botCreate: async (userId, input): Promise<{ botId: string }> => {
      const botId = `bot-${nanoid()}`;
      await getDb().setDoc(collections.bot, {
        _id: botId,
        ownerId: userId,
        name: input.name,
        instruction: input.instruction ?? '',
        model: input.model ?? 'deepseek_v4_flash',
        avatarUrl: input.avatarUrl ?? null,
        backgroundUrl: input.backgroundUrl ?? null,
        firstMessage: input.firstMessage ?? null,
        buttons: input.buttons ?? [],
        ...dbDefaults(),
      });
      return { botId };
    },

    botUpdate: async (userId, input): Promise<{ ok: boolean }> => {
      const existing = await getDb().getDoc(collections.bot, input.botId);
      if (!existing || existing['ownerId'] !== userId) throw new Error('Bot not found');
      const patch: Record<string, unknown> = {};
      for (const k of ['name', 'instruction', 'model', 'avatarUrl', 'backgroundUrl', 'firstMessage', 'buttons'] as const) {
        if (input[k] !== undefined) patch[k] = input[k];
      }
      await getDb().setDoc(collections.bot, { ...existing, ...patch, ...dbDefaults() });
      return { ok: true };
    },

    botGet: async (_userId, input) => getDb().getDoc(collections.bot, input.botId),

    botListMine: async (userId): Promise<{ bots: Record<string, unknown>[] }> => {
      const bots = await getDb().getDocs(collections.bot, { ownerId: userId });
      bots.sort((a, b) => toMillis(b['updated'] ?? b['created']) - toMillis(a['updated'] ?? a['created']));
      return { bots };
    },

    botDelete: async (userId, input): Promise<{ ok: boolean }> => {
      const existing = await getDb().getDoc(collections.bot, input.botId);
      if (!existing || existing['ownerId'] !== userId) throw new Error('Bot not found');
      await getDb().deleteDoc(collections.bot, input.botId);
      return { ok: true };
    },

    // Wipe a conversation's messages (used by the bot-chat "Clear chat" menu).
    // Allowed only for a participant/owner; re-seeds the bot's greeting after.
    conversationClear: async (userId, input): Promise<{ ok: boolean }> => {
      const db = getDb();
      const conv = await db.getDoc(collections.conversation, input.conversationId);
      if (!conv) throw new Error('Conversation not found');
      const owners = (conv['ownerIds'] as string[] | undefined) ?? [];
      if (!owners.includes(userId) && !input.conversationId.endsWith(userId)) {
        throw new Error('Not allowed');
      }
      // Delete in batches until none remain — getDocs pages, so a single pass
      // only wipes the first page (why a long migrated DM looked like it did
      // nothing). Bounded guard so a bug can't loop forever.
      for (let guard = 0; guard < 200; guard++) {
        const msgs = await db.getDocs(
          collections.message,
          { conversationId: input.conversationId },
          { limit: 500 },
        );
        if (msgs.length === 0) break;
        for (const m of msgs) await db.deleteDoc(collections.message, String(m['_id']));
        if (msgs.length < 500) break;
      }
      // Re-seed the bot's greeting so a cleared bot chat starts fresh.
      const botsField = (conv['bots'] as Record<string, unknown> | undefined) ?? {};
      for (const botId of Object.keys(botsField)) {
        if (!isBot(botId)) continue;
        const bot = await getBotConfig(db, botId).catch(() => null);
        if (!bot?.firstMessage) continue;
        await engineConversationMessageCreate(
          { conversationId: input.conversationId, message: { text: bot.firstMessage, markdown: bot.firstMessage, onlyUserIds: ['global'] } },
          botId,
        ).catch(() => undefined);
      }
      return { ok: true };
    },
  } satisfies RequestHandlers<typeof requests>;
}

interface ConversationListRow {
  conversationId: string;
  title: string;
  image: unknown;
  type: string;
  preview: string;
  unread: number;
  pinned: boolean;
  lastActivity: number;
}

// DM/1:1 conversation ids are `{otherId}+{myUserId}` (either order). Return the
// participant that isn't the current user, or null for group ids (no '+').
function deriveOtherUserId(conversationId: string, userId: string): string | null {
  if (!conversationId.includes('+')) return null;
  const parts = conversationId.split('+').filter(Boolean);
  return parts.find((p) => p !== userId) ?? null;
}

// Flip a member's userConversation from `visibility: 'hidden'` to 'visible' so
// it appears in conversationListMine. Passing `onlyUserId` un-hides just that
// member (engagement on open); omitting it un-hides every human member of the
// conversation (a new message surfaces it for all). Pinned rows are left alone,
// and bot members never get a visible sidebar row.
async function unhideMembers(
  db: DbSurface,
  conversationId: string,
  onlyUserId?: string,
): Promise<void> {
  const rows = onlyUserId
    ? ([await db.getDoc(collections.userConversation, `${onlyUserId}:${conversationId}`)].filter(
        Boolean,
      ) as Record<string, unknown>[])
    : await db.getDocs(collections.userConversation, { conversationId });
  await Promise.all(
    rows.map(async (uc) => {
      if ((uc['visibility'] as string) !== 'hidden') return;
      if (isBot(String(uc['userPrivateId'] ?? ''))) return;
      await db.setDoc(collections.userConversation, {
        ...uc,
        visibility: 'visible',
        updated: new Date(),
      });
    }),
  );
}

function toMillis(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const t = new Date(v).getTime();
    return Number.isNaN(t) ? 0 : t;
  }
  if (v instanceof Date) return v.getTime();
  return 0;
}

export const cronHandlers: WorkerHandlers<typeof cronTasks> = {
  dailyCleanup: async () => {
    // Runtime-agnostic no-op cleanup placeholder (Node previously used pgQuery,
    // which isn't available on Workers). Real cleanup can use the db surface.
    await Promise.resolve();
    console.log('[Cron] dailyCleanup ran');
  },
};
