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
  conversationMessageEdit as engineConversationMessageEdit,
  conversationSetTyping as engineConversationSetTyping,
  conversationUserAdd as engineConversationUserAdd,
  conversationUserRemove as engineConversationUserRemove,
  conversationUserUpdateRole as engineConversationUserUpdateRole,
} from 'ugly-app/conversation/engine';
import type { WorkerHandlers } from 'ugly-app/shared';
import { dbDefaults } from 'ugly-app/shared';
import { nanoid } from 'nanoid';
import { triggerBotReplies, getBotConfig, isBot } from './bots';
import { fireMessageWebhooks } from './webhooks';
import { unfurlMessageLinks } from './linkPreview';
import { bumpListForMessage, markRead } from './listDenorm';
import { UGLY_BOT_ID } from '../shared/bots';
import { resolveProfiles, type Profile } from './profiles';
import { videoJoin, videoLeave, videoEnd, videoBotJoin, videoPublish, videoState, videoCaption, type CallState, type DbLike } from './video';
import {
  realtimeIceServers,
  realtimeNewSession,
  realtimeTracks,
  realtimeRenegotiate,
} from './realtime';
import { requests } from '../shared/api';
import type { Todo } from '../shared/collections';
import { collections } from '../shared/collections';
import { cronTasks } from '../shared/cron';
import { resolveEmailToUser, type ResolveEnv } from './resolveEmail';
import { directConversationId } from '../shared/conversationId';
import { sendInviteEmail } from './invite';

// Server env access mirrors server/bots.ts (`globalThis.process.env`) — both
// adapters expose ugly.bot creds there.
function getEnv(): ResolveEnv {
  const env =
    (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
  return { UGLY_BOT_URL: env['UGLY_BOT_URL'], UGLY_BOT_TOKEN: env['UGLY_BOT_TOKEN'] };
}

/** Minimal db surface the handlers need; both adapters' TypedDB satisfy it. */
export interface DbSurface {
  setDoc(col: unknown, doc: unknown): Promise<void>;
  getDoc(col: unknown, id: string): Promise<Record<string, unknown> | null>;
  getDocs(col: unknown, filter?: unknown, opts?: unknown): Promise<Record<string, unknown>[]>;
  deleteDoc(col: unknown, id: string): Promise<void>;
  // Postgres full-text search (→ pgSearchDocs, `search @@ plainto_tsquery`).
  // Present on the Pg adapter; optional so the interface stays minimal.
  searchDocs?(
    col: unknown,
    searchQuery: string,
    opts?: { filter?: unknown; limit?: number },
  ): Promise<Record<string, unknown>[]>;
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
          // Hidden conversations are disallowed — they never show in the list
          // (conversationListMine filters them), stranding the user. Override
          // any `hidden` that slipped through the input `.catchall`.
          hidden: false,
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
      // Opening a conversation marks it read (zero unread + stamp viewed) and
      // un-hides it — app-created chats (e.g. Ugly Love) start `hidden`, so
      // engagement is what surfaces them ("if I can see it, it's in my list").
      const loadedId = (loaded as { conversation?: { _id?: string } } | null)?.conversation?._id;
      if (loadedId) {
        void markRead(getDb(), loadedId, userId).catch((err: unknown) =>
          console.error('[conv] markRead on load failed', err),
        );
      }
      return loaded;
    },

    conversationMessageCreate: async (userId, input) => {
      const msg = await engineConversationMessageCreate(
        { ...input, message: { onlyUserIds: ['global'], ...input.message } },
        userId,
      );
      // Denormalize the sidebar: refresh every member's last-message preview,
      // +1 unread for recipients (sender marked read), bump recency, un-hide.
      void bumpListForMessage(
        getDb(),
        input.conversationId,
        String(input.message?.text ?? input.message?.markdown ?? ''),
        userId,
      ).catch((err: unknown) => console.error('[conv] list denorm failed', err));
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
      // Unfurl any links into a `linkPreviews` card (best-effort, async).
      void unfurlMessageLinks(getDb(), msg as unknown as Parameters<typeof unfurlMessageLinks>[1]).catch(
        (err: unknown) => console.error('[unfurl] failed', err),
      );
      return msg;
    },

    conversationSetTyping: async (userId, input) =>
      engineConversationSetTyping(
        { conversationId: input.conversationId, start: input.start ?? undefined },
        userId,
      ),

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

    conversationMessageEdit: async (userId, input) => {
      // The engine's edit ignores userId, so enforce "own messages only" here.
      const shortId = input.messageId.includes(':')
        ? input.messageId.split(':').slice(1).join(':')
        : input.messageId;
      const stored = await getDb().getDoc(
        collections.message,
        `${input.conversationId}:${shortId}`,
      );
      if (!stored) throw new Error('Message not found');
      if (stored['userId'] !== userId) throw new Error('Can only edit your own messages');
      const updated = await engineConversationMessageEdit(
        {
          conversationId: input.conversationId,
          messageId: shortId,
          message: { markdown: input.markdown, edited: Date.now() },
        },
        userId,
      );
      // Re-unfurl links on the edited body (best-effort).
      void unfurlMessageLinks(
        getDb(),
        updated as unknown as Parameters<typeof unfurlMessageLinks>[1],
      ).catch((err: unknown) => console.error('[unfurl] edit failed', err));
      return updated;
    },

    conversationMessageSearch: async (userId, input) => {
      const db = getDb();
      if (!db.searchDocs || !input.search.trim()) return { items: [] };
      // Scope to conversations the user belongs to (access control). A specific
      // conversationId is honoured only after confirming membership.
      let convIds: string[];
      if (input.conversationId) {
        const member = await db.getDoc(
          collections.userConversation,
          `${userId}:${input.conversationId}`,
        );
        if (!member) return { items: [] };
        convIds = [input.conversationId];
      } else {
        const ucs = await db.getDocs(collections.userConversation, { userPrivateId: userId });
        convIds = ucs.map((u) => String(u['conversationId'] ?? '')).filter(Boolean);
      }
      if (convIds.length === 0) return { items: [] };
      const items = await db.searchDocs(collections.message, input.search, {
        filter: {
          conversationId: { $in: convIds },
          onlyUserIds: { $in: ['global', userId] },
          deleted: { $ne: true },
        },
        limit: input.limit ?? 50,
      });
      return { items };
    },

    // ── Video call lifecycle ───────────────────────────────────────────────
    conversationVideoJoin: async (userId, input): Promise<CallState> =>
      videoJoin(getDb() as unknown as DbLike, { conversation: collections.conversation }, input.conversationId, userId),
    conversationVideoLeave: async (userId, input): Promise<CallState> =>
      videoLeave(getDb() as unknown as DbLike, { conversation: collections.conversation }, input.conversationId, userId),
    conversationVideoEnd: async (_userId, input): Promise<CallState> =>
      videoEnd(getDb() as unknown as DbLike, { conversation: collections.conversation }, input.conversationId),
    conversationVideoBotJoin: async (_userId, input): Promise<CallState> =>
      videoBotJoin(getDb() as unknown as DbLike, { conversation: collections.conversation }, input.conversationId, input.botId),
    conversationVideoState: async (_userId, input): Promise<CallState> =>
      videoState(getDb() as unknown as DbLike, { conversation: collections.conversation }, input.conversationId),
    conversationVideoPublish: async (userId, input): Promise<CallState> =>
      videoPublish(
        getDb() as unknown as DbLike,
        { conversation: collections.conversation },
        input.conversationId,
        userId,
        input.sessionId,
        input.tracks,
      ),

    conversationCaption: async (userId, input): Promise<{ ok: boolean }> => {
      await videoCaption(
        getDb() as unknown as DbLike,
        { conversation: collections.conversation },
        input.conversationId,
        userId,
        input.text,
        input.final,
      );
      return { ok: true };
    },

    // ── Cloudflare Realtime broker ─────────────────────────────────────────
    realtimeIceServers: async () => realtimeIceServers(),
    realtimeNewSession: async () => realtimeNewSession(),
    realtimeTracks: async (_userId, input) => realtimeTracks(input.sessionId, input.body),
    realtimeRenegotiate: async (_userId, input) => realtimeRenegotiate(input.sessionId, input.body),

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
          return !!other && (!r.title || other === UGLY_BOT_ID);
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
            if (other === UGLY_BOT_ID ? !!p.avatarUrl : !r.image && !!p.avatarUrl) {
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

    conversationMarkRead: async (userId, input): Promise<{ ok: boolean }> => {
      await markRead(getDb(), input.conversationId, userId);
      return { ok: true };
    },

    conversationReadState: async (userId, input) => {
      const db = getDb();
      const self = await db.getDoc(
        collections.conversationUser,
        `${input.conversationId}:${userId}`,
      );
      if (!self) return { readers: [] };
      const rows = await db.getDocs(collections.userConversation, {
        conversationId: input.conversationId,
      });
      const readers = rows
        .map((uc) => ({
          userId: String(uc['userPrivateId'] ?? ''),
          viewed: typeof uc['viewed'] === 'number' ? uc['viewed'] : 0,
        }))
        .filter((r) => r.userId && r.userId !== userId && !isBot(r.userId) && r.viewed > 0);
      return { readers };
    },

    conversationPinMessage: async (userId, input): Promise<{ ok: boolean }> => {
      const db = getDb();
      // Members only (the pin is shared by the whole conversation).
      const member = await db.getDoc(
        collections.conversationUser,
        `${input.conversationId}:${userId}`,
      );
      if (!member) throw new Error('Not a member of this conversation');
      const conv = await db.getDoc(collections.conversation, input.conversationId);
      if (!conv) throw new Error('Conversation not found');
      await db.setDoc(collections.conversation, {
        ...conv,
        pinnedMessageId: input.messageId,
        updated: new Date(),
      });
      return { ok: true };
    },

    conversationSetPinned: async (userId, input): Promise<{ ok: boolean }> => {
      const db = getDb();
      const uc = await db.getDoc(
        collections.userConversation,
        `${userId}:${input.conversationId}`,
      );
      if (!uc) throw new Error('Not a member of this conversation');
      // Toggle between pinned and visible — don't resurrect a hidden row.
      if ((uc['visibility'] as string) === 'hidden') return { ok: false };
      await db.setDoc(collections.userConversation, {
        ...uc,
        visibility: input.pinned ? 'pinned' : 'visible',
        updated: new Date(),
      });
      return { ok: true };
    },

    conversationSetBotModel: async (userId, input): Promise<{ ok: boolean }> => {
      const db = getDb();
      // Membership check (same shape as conversationSetPinned).
      const uc = await db.getDoc(
        collections.userConversation,
        `${userId}:${input.conversationId}`,
      );
      if (!uc) throw new Error('Not a member of this conversation');
      const conv = await db.getDoc(collections.conversation, input.conversationId);
      if (!conv) throw new Error('Conversation not found');
      const bots = { ...((conv['bots'] as Record<string, Record<string, unknown>> | undefined) ?? {}) };
      if (!bots[input.botId]) throw new Error('Bot is not a member of this conversation');
      bots[input.botId] = { ...bots[input.botId], model: input.model };
      await db.setDoc(collections.conversation, { ...conv, bots, updated: new Date() });
      return { ok: true };
    },

    // Distinct humans the caller shares conversations with (their "contacts") —
    // the candidate pool for adding members, no global directory required.
    userContacts: async (userId) => {
      const db = getDb();
      const ucs = await db.getDocs(collections.userConversation, { userPrivateId: userId });
      const convIds = ucs
        .map((u) => String(u['conversationId'] ?? ''))
        .filter(Boolean)
        .slice(0, 200);
      if (convIds.length === 0) return { users: [] };
      const cus = await db.getDocs(collections.conversationUser, {
        conversationId: { $in: convIds },
      });
      const ids = [
        ...new Set(
          cus
            .map((r) => String(r['userId'] ?? ''))
            .filter((id) => id && id !== userId && !isBot(id)),
        ),
      ].slice(0, 100);
      if (ids.length === 0) return { users: [] };
      const profiles = await resolveProfiles(db, ids);
      return {
        users: profiles
          .filter((p) => !p.isBot)
          .map((p) => ({ userId: p.id, name: p.name, avatarUrl: p.avatarUrl })),
      };
    },

    // ── Group membership admin ──────────────────────────────────────────────
    conversationMembers: async (userId, input) => {
      const db = getDb();
      // Only members may view the roster.
      const self = await db.getDoc(
        collections.conversationUser,
        `${input.conversationId}:${userId}`,
      );
      if (!self) return { members: [] };
      const rows = await db.getDocs(collections.conversationUser, {
        conversationId: input.conversationId,
      });
      const profiles = await resolveProfiles(
        db,
        rows.map((r) => String(r['userId'] ?? '')).filter(Boolean),
      );
      const byId = new Map(profiles.map((p) => [p.id, p]));
      const members = rows
        .map((r) => {
          const id = String(r['userId'] ?? '');
          const p = byId.get(id);
          return {
            userId: id,
            role: String(r['role'] ?? 'member'),
            name: p?.name ?? id.slice(0, 8),
            avatarUrl: p?.avatarUrl ?? null,
            isBot: p?.isBot ?? isBot(id),
          };
        })
        .filter((m) => m.userId);
      return { members };
    },

    conversationMemberAdd: async (userId, input) => {
      const res = await engineConversationUserAdd(
        {
          conversationId: input.conversationId,
          userId: input.userId,
          role: input.role ?? 'member',
          visibility: 'visible',
        },
        userId,
      );
      await postSystemMessage(input.conversationId, 'memberAdd', input.userId);
      return res;
    },

    conversationMemberRemove: async (userId, input) => {
      const res = await engineConversationUserRemove(
        { conversationId: input.conversationId, userId: input.userId },
        userId,
      );
      // A self-removal reads as "left"; removing someone else reads as "removed".
      await postSystemMessage(
        input.conversationId,
        input.userId === userId ? 'memberLeave' : 'memberRemove',
        input.userId,
      );
      return res;
    },

    conversationMemberRole: async (userId, input) =>
      engineConversationUserUpdateRole(
        { conversationId: input.conversationId, userId: input.userId, role: input.role },
        userId,
      ),

    conversationDelete: async (userId, input): Promise<{ ok: boolean }> => {
      const db = getDb();
      const self = await db.getDoc(
        collections.conversationUser,
        `${input.conversationId}:${userId}`,
      );
      if (self?.['role'] !== 'owner') {
        throw new Error('Only an owner can delete this conversation');
      }
      // The typed DB cascades to children (message, messageReaction,
      // conversationUser, userConversation — all `cascadeFrom: 'conversation'`),
      // so this single delete removes the conversation from everyone's list and
      // wipes its messages. trackDocs delete-notifications update clients live.
      await db.deleteDoc(collections.conversation, input.conversationId);
      return { ok: true };
    },

    // ── Email-keyed flows ────────────────────────────────────────────────────
    resolveEmail: async (_userId, input) => resolveEmailToUser(input.email, getEnv()),

    conversationCreateDirect: async (userId, input) => {
      const r = await resolveEmailToUser(input.email, getEnv());
      if (r.status === 'invite') {
        await sendInviteEmail(r.email, userId).catch((err: unknown) =>
          console.error('[invite] direct invite failed', err),
        );
        return { conversationId: '', invited: true };
      }
      const id = directConversationId(userId, r.userId);
      const existing = await getDb().getDoc(collections.conversation, id);
      if (!existing) {
        await engineConversationCreate(
          { id, type: 'direct', title: '', mode: 'private', ownerIds: [userId, r.userId] },
          userId,
        );
        await engineConversationUserAdd(
          { conversationId: id, userId: r.userId, role: 'member', visibility: 'visible' },
          userId,
        );
      }
      return { conversationId: id, invited: false };
    },

    groupCreate: async (userId, input) => {
      const id = `grp-${userId}-${Date.now().toString(36)}`;
      await engineConversationCreate(
        { id, type: 'group', title: input.title ?? 'New group', mode: 'private', ownerIds: [userId] },
        userId,
      );
      const invited: string[] = [];
      for (const raw of input.emails) {
        const r = await resolveEmailToUser(raw, getEnv()).catch((err: unknown) => {
          console.error('[group] resolve failed', err);
          return null;
        });
        if (!r) continue;
        if (r.status === 'found') {
          await engineConversationUserAdd(
            { conversationId: id, userId: r.userId, role: 'member', visibility: 'visible' },
            userId,
          );
        } else {
          await sendInviteEmail(r.email, userId, id).catch((err: unknown) =>
            console.error('[invite] group invite failed', err),
          );
          invited.push(r.email);
        }
      }
      return { conversationId: id, invited };
    },

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
      for (const k of ['name', 'instruction', 'model', 'avatarUrl', 'firstMessage', 'buttons'] as const) {
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
  // Direct conversations are keyed by the two user ids joined with ':' (framework
  // native, e.g. the Love couple chat) or legacy '+'. A 2-part id that includes
  // our own userId is a DM; the other part is the partner.
  const sep = conversationId.includes(':') ? ':' : conversationId.includes('+') ? '+' : '';
  if (!sep) return null;
  const parts = conversationId.split(sep).filter(Boolean);
  if (parts.length !== 2 || !parts.includes(userId)) return null;
  return parts.find((p) => p !== userId) ?? null;
}

// Post a membership system message (memberAdd/memberRemove/memberLeave) as the
// global user. `systemType` messages skip notifications in the engine, and the
// client renders them as a centered system line (resolving `systemParam` → a
// display name). Best-effort — a failure here must not fail the membership op.
async function postSystemMessage(
  conversationId: string,
  systemType: string,
  systemParam: string,
): Promise<void> {
  await engineConversationMessageCreate(
    {
      conversationId,
      message: { systemType, systemParam, text: '', markdown: '', onlyUserIds: ['global'] },
    },
    'global',
  ).catch((err: unknown) => console.error('[system-message] failed', err));
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
