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
import type { WorkerHandlers, CollectionDef, DBObject, DocFields, GetDocsOptions } from 'ugly-app/shared';
import { dbDefaults, defaultAvatar } from 'ugly-app/shared';
import { nanoid } from 'nanoid';
import { getUserToken } from 'ugly-app/server/adapter/workers';
import { triggerBotReplies, getBotConfig, isBot } from './bots';
import { fireMessageWebhooks } from './webhooks';
import { unfurlMessageLinks } from './linkPreview';
import { bumpListForMessage, markRead } from './listDenorm';
import { UGLY_BOT_ID, FEATURED_BOT_IDS } from '../shared/bots';
import { resolveProfiles, type Profile } from './profiles';
import { videoJoin, videoLeave, videoEnd, videoBotJoin, videoPublish, videoState, videoCaption, type CallState } from './video';
import { notifyIncomingCall, notifyNewMessage } from './callNotify';
import {
  realtimeIceServers,
  realtimeNewSession,
  realtimeTracks,
  realtimeRenegotiate,
} from './realtime';
import { requests } from '../shared/api';
import type { Todo, UserPublicDoc } from '../shared/collections';
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
  return { UGLY_BOT_URL: env.UGLY_BOT_URL, UGLY_BOT_TOKEN: env.UGLY_BOT_TOKEN };
}

/**
 * Minimal db surface the handlers need; both adapters' TypedDB satisfy it.
 * Typed generically over `CollectionDef<T>` (mirroring the framework `TypedDB`)
 * so db reads/writes are type-checked at the call site instead of returning
 * `Record<string, unknown>` and forcing a cast on every field access.
 */
export interface DbSurface {
  setDoc<T>(collection: CollectionDef<T>, doc: T, options?: { skipIfExists?: boolean }): Promise<boolean>;
  setDocFields<T extends DBObject>(collection: CollectionDef<T>, id: string, fields: DocFields<T>): Promise<T>;
  getDoc<T>(collection: CollectionDef<T>, id: string): Promise<T | null>;
  getDocs<T>(collection: CollectionDef<T>, filter?: Record<string, unknown>, options?: GetDocsOptions): Promise<T[]>;
  // Batch-fetch by id, order-preserving (null for misses). For getter-backed
  // collections (e.g. `userPublic`) this is a cache-hit-per-id + ONE batched
  // resolver call — the conversation-list profile fast path.
  getByIds<T>(collection: CollectionDef<T>, ids: string[]): Promise<(T | null)[]>;
  deleteDoc(collection: CollectionDef, id: string): Promise<void>;
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
      if (!todo?.userId || todo.userId !== userId) throw new Error('Todo not found');
      const updated = { ...todo, done: !todo.done, ...dbDefaults() };
      await getDb().setDoc(collections.todo, updated);
      return { done: updated.done };
    },

    deleteTodo: async (userId, { todoId }) => {
      const todo = await getDb().getDoc(collections.todo, todoId);
      if (!todo?.userId || todo.userId !== userId) throw new Error('Todo not found');
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
      const verified = readBack?._id === _id && readBack.text === text;
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
        ).catch((err: unknown) => { console.error('[bots] first message failed', err); });
      }
      return conv;
    },

    conversationLoad: async (userId, input) => {
      const loaded: unknown = await engineConversationLoad(input, userId);
      // Opening a conversation marks it read (zero unread + stamp viewed) and
      // un-hides it — app-created chats (e.g. Ugly Love) start `hidden`, so
      // engagement is what surfaces them ("if I can see it, it's in my list").
      const loadedId = (loaded as { conversation?: { _id?: string } } | null)?.conversation?._id;
      if (loadedId) {
        void markRead(getDb(), loadedId, userId).catch((err: unknown) =>
          { console.error('[conv] markRead on load failed', err); },
        );
      }
      return loaded;
    },

    conversationMessageCreate: async (userId, input) => {
      const msg: unknown = await engineConversationMessageCreate(
        { ...input, message: { onlyUserIds: ['global'], ...input.message } },
        userId,
      );
      // Denormalize the sidebar: refresh every member's last-message preview,
      // +1 unread for recipients (sender marked read), bump recency, un-hide.
      const previewText = input.message.text ?? input.message.markdown ?? '';
      void bumpListForMessage(
        getDb(),
        input.conversationId,
        previewText,
        userId,
      ).catch((err: unknown) => { console.error('[conv] list denorm failed', err); });
      // Push the other member(s) so they're notified when ugly.chat isn't focused.
      void notifyNewMessage(getDb(), input.conversationId, userId, previewText).catch(
        (err: unknown) => { console.error('[conv] message push failed', err); },
      );
      // Built-in/custom bots WITHOUT a webhook reply via textGen here. App bots
      // (with a webhookUrl) are driven by their owning app instead — see
      // fireMessageWebhooks, which notifies the conversation + bot webhooks.
      void triggerBotReplies(
        getDb(),
        { conversation: collections.conversation, message: collections.message },
        input.conversationId,
        userId,
      ).catch((err: unknown) => { console.error('[bots] reply failed', err); });
      void fireMessageWebhooks(
        getDb(),
        'message.created',
        input.conversationId,
        msg as Record<string, unknown>,
      ).catch((err: unknown) => { console.error('[webhook] fire failed', err); });
      // Unfurl any links into a `linkPreviews` card (best-effort, async).
      void unfurlMessageLinks(getDb(), msg as Parameters<typeof unfurlMessageLinks>[1]).catch(
        (err: unknown) => { console.error('[unfurl] failed', err); },
      );
      return msg;
    },

    conversationSetTyping: async (userId, input) =>
      engineConversationSetTyping(
        { conversationId: input.conversationId, start: input.start ?? undefined },
        userId,
      ),

    conversationMessageReact: async (userId, input): Promise<unknown> =>
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
      if (stored.userId !== userId) throw new Error('Can only edit your own messages');
      const updated: unknown = await engineConversationMessageEdit(
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
        updated as Parameters<typeof unfurlMessageLinks>[1],
      ).catch((err: unknown) => { console.error('[unfurl] edit failed', err); });
      return updated;
    },

    conversationMessageSearch: async (userId, input) => {
      const db = getDb();
      const query = input.search.trim().toLowerCase();
      if (!query) return { items: [] };
      // Non-FTS search (Postgres full-text dropped in the D1 migration): resolve
      // the access-controlled set of conversations, fetch a bounded, INDEXED
      // page of recent messages per conversation (getDocs by conversationId,
      // sort created), then substring-filter in JS.
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
        // Bound the fan-out: search the user's most-recent conversations only.
        convIds = ucs.map((u) => u.conversationId).filter(Boolean).slice(0, 20);
      }
      if (convIds.length === 0) return { items: [] };
      const limit = input.limit ?? 50;
      const items: unknown[] = [];
      for (const conversationId of convIds) {
        const msgs = await db.getDocs(
          collections.message,
          { conversationId },
          { sort: { created: -1 }, limit: 200 },
        );
        for (const m of msgs) {
          if (m.deleted === true) continue;
          // Respect per-message visibility scoping (global or addressed to me).
          const only = m.onlyUserIds;
          if (Array.isArray(only) && !only.includes('global') && !only.includes(userId)) continue;
          const hay = `${m.text ?? ''}\n${m.markdown ?? ''}`.toLowerCase();
          if (hay.includes(query)) items.push(m);
          if (items.length >= limit) break;
        }
        if (items.length >= limit) break;
      }
      return { items };
    },

    // ── Video call lifecycle ───────────────────────────────────────────────
    conversationVideoJoin: async (userId, input): Promise<CallState> => {
      const call = await videoJoin(
        getDb(),
        { conversation: collections.conversation },
        input.conversationId,
        userId,
      );
      // Ring the other participant(s) via push (best-effort; only on call start).
      void notifyIncomingCall(getDb(), input.conversationId, userId, call);
      return call;
    },
    conversationVideoLeave: async (userId, input): Promise<CallState> =>
      videoLeave(getDb(), { conversation: collections.conversation }, input.conversationId, userId),
    conversationVideoEnd: async (_userId, input): Promise<CallState> =>
      videoEnd(getDb(), { conversation: collections.conversation }, input.conversationId),
    conversationVideoBotJoin: async (_userId, input): Promise<CallState> =>
      videoBotJoin(getDb(), { conversation: collections.conversation }, input.conversationId, input.botId),
    conversationVideoState: async (_userId, input): Promise<CallState> =>
      videoState(getDb(), { conversation: collections.conversation }, input.conversationId),
    conversationVideoPublish: async (userId, input): Promise<CallState> =>
      videoPublish(
        getDb(),
        { conversation: collections.conversation },
        input.conversationId,
        userId,
        input.sessionId,
        input.tracks,
      ),

    conversationCaption: async (userId, input): Promise<{ ok: boolean }> => {
      await videoCaption(
        getDb(),
        { conversation: collections.conversation },
        input.conversationId,
        userId,
        input.text,
        input.final,
        (input as { typed?: boolean }).typed === true,
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
      // Filter hidden conversations in SQL, not JS. A power user can accumulate
      // thousands of userConversation rows (mostly hidden); fetching them all
      // and discarding in JS transferred ~1MB+ and was the sidebar bottleneck.
      // `$ne` is null-inclusive (Mongo semantics), so rows with no `visibility`
      // set are still returned (they default to visible).
      const ucs = await db.getDocs(collections.userConversation, {
        userPrivateId: userId,
        visibility: { $ne: 'hidden' },
      });
      const rows: ConversationListRow[] = ucs
        .map((u) => ({
          conversationId: u.conversationId,
          title: (u.title!) || '',
          image: (u.image) ?? null,
          type: (u.type!) || 'group',
          preview: (u.notificationText!) || '',
          unread: u.notificationCount ?? 0,
          pinned: (u.visibility!) === 'pinned',
          lastActivity: toMillis(u.updated),
        }))
        .filter((r) => r.conversationId !== '');

      rows.sort(
        (a, b) => Number(b.pinned) - Number(a.pinned) || b.lastActivity - a.lastActivity,
      );

      // DM/1:1 conversations carry no title — ugly.bot shows the *other*
      // participant's name + avatar. DM ids are `{otherId}+{myUserId}`. Resolve
      // the most-recent ones in one batch via the getter-backed `userPublic`
      // collection (cache hits per-id + ONE batched ugly.bot call for misses).
      // Rows are pre-sorted so the visible top conversations get resolved first.
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
        // Resolve names/avatars for the DM peers. Human peers go through the
        // getter-backed `userPublic` collection: `getByIds` serves cache hits
        // per-id and resolves all misses in ONE batched ugly.bot call (replacing
        // the old sequential `resolveProfiles` loop — the sidebar bottleneck).
        // `bot-` peers (the canonical Ugly Bot DM) aren't in ugly.bot's profile
        // graph — their name/avatar live in the local `bot` collection — so they
        // resolve via `getBotConfig` instead.
        const byId = new Map<string, { name: string; avatarUrl: string | null }>();
        const botIds = otherIds.filter((id) => isBot(id));
        const humanIds = otherIds.filter((id) => !isBot(id));

        if (humanIds.length > 0) {
          const docs = await getDb().getByIds<UserPublicDoc>(collections.userPublic, humanIds);
          humanIds.forEach((id, i) => {
            const doc = docs[i];
            if (doc) byId.set(id, { name: doc.name ?? id.slice(0, 8), avatarUrl: doc.avatarUrl ?? null });
          });
        }
        await Promise.all(
          botIds.map(async (id) => {
            const cfg = await getBotConfig(getDb(), id);
            byId.set(id, { name: cfg?.name ?? id.slice(0, 8), avatarUrl: cfg?.avatar.image.uri ?? null });
          }),
        );

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

    conversationJoin: async (userId, input): Promise<unknown> =>
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
          userId: uc.userPrivateId ?? '',
          viewed: typeof uc.viewed === 'number' ? uc.viewed : 0,
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
      if ((uc.visibility!) === 'hidden') return { ok: false };
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
      const bots = { ...((conv.bots as Record<string, Record<string, unknown>> | undefined) ?? {}) };
      if (!bots[input.botId]) throw new Error('Bot is not a member of this conversation');
      // Patch only the provided fields (mode / text model / image model / size).
      const patch: Record<string, unknown> = { ...bots[input.botId] };
      if (input.model !== undefined) patch.model = input.model;
      if (input.mode !== undefined) patch.mode = input.mode;
      if (input.imageModel !== undefined) patch.imageModel = input.imageModel;
      if (input.imageSize !== undefined) patch.imageSize = input.imageSize;
      bots[input.botId] = patch;
      await db.setDoc(collections.conversation, { ...conv, bots, updated: new Date() });
      return { ok: true };
    },

    // The caller's own profile (name + avatar), resolved like any participant.
    userProfileGet: async (userId): Promise<{ name: string | null; avatarUrl: string | null }> => {
      const [p] = await resolveProfiles(getDb(), [userId]);
      return { name: p?.name ?? null, avatarUrl: p?.avatar.image.uri ?? null };
    },

    // Update the caller's name/avatar: write through to ugly.bot's federated
    // profile (userUpdate, authed as the end user). ugly.bot is the source of
    // truth — no local cache; the client re-reads the profile after updating.
    userProfileUpdate: async (
      userId,
      input,
    ): Promise<{ ok: boolean; name: string | null; avatarUrl: string | null }> => {
      const base = getEnv().UGLY_BOT_URL ?? 'https://ugly.bot';
      const token = getUserToken();
      if (token) {
        const fields: Record<string, unknown> = {};
        if (input.name !== undefined) fields.name = input.name;
        if (input.avatarUrl !== undefined) fields.avatar = input.avatarUrl;
        if (Object.keys(fields).length > 0) {
          const res = await fetch(`${base}/api/userUpdate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ input: fields }),
          });
          if (!res.ok) throw new Error(`userUpdate HTTP ${res.status}`);
        }
      }
      return {
        ok: true,
        name: input.name ?? null,
        avatarUrl: input.avatarUrl ?? null,
      };
    },

    // Distinct humans the caller shares conversations with (their "contacts") —
    // the candidate pool for adding members, no global directory required.
    userContacts: async (userId) => {
      const db = getDb();
      const ucs = await db.getDocs(collections.userConversation, { userPrivateId: userId });
      const convIds = ucs
        .map((u) => u.conversationId)
        .filter(Boolean)
        .slice(0, 200);
      if (convIds.length === 0) return { users: [] };
      const cus = await db.getDocs(collections.conversationUser, {
        conversationId: { $in: convIds },
      });
      const ids = [
        ...new Set(
          cus
            .map((r) => r.userId)
            .filter((id) => id && id !== userId && !isBot(id)),
        ),
      ].slice(0, 100);
      if (ids.length === 0) return { users: [] };
      const profiles = await resolveProfiles(db, ids);
      return {
        users: profiles
          .filter((p) => !p.isBot)
          .map((p) => ({ userId: p.id, name: p.name, avatar: p.avatar })),
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
        rows.map((r) => r.userId).filter(Boolean),
      );
      const byId = new Map(profiles.map((p) => [p.id, p]));
      const members = rows
        .map((r) => {
          const id = r.userId;
          const p = byId.get(id);
          return {
            userId: id,
            role: r.role ?? 'member',
            name: p?.name ?? id.slice(0, 8),
            avatar: p?.avatar ?? defaultAvatar,
            isBot: p?.isBot ?? isBot(id),
          };
        })
        .filter((m) => m.userId);
      return { members };
    },

    conversationMemberAdd: async (userId, input) => {
      const res: unknown = await engineConversationUserAdd(
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
      const res: unknown = await engineConversationUserRemove(
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

    conversationMemberRole: async (userId, input): Promise<unknown> =>
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
      if (self?.role !== 'owner') {
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
          { console.error('[invite] direct invite failed', err); },
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
            { console.error('[invite] group invite failed', err); },
          );
          invited.push(r.email);
        }
      }
      return { conversationId: id, invited };
    },

    // userId-aware start: picked contacts (userIds) + typed emails. One person
    // total → 1:1 (reuses the deterministic direct id); 2+ → a new group.
    conversationStart: async (userId, input): Promise<{ conversationId: string; invited: string[] }> => {
      const picked = [...new Set((input.userIds ?? []).filter((id) => id && id !== userId))];
      const invited: string[] = [];
      const fromEmail: string[] = [];
      for (const raw of input.emails ?? []) {
        const r = await resolveEmailToUser(raw, getEnv()).catch((err: unknown) => {
          console.error('[start] resolve failed', err);
          return null;
        });
        if (!r) continue;
        if (r.status === 'found') fromEmail.push(r.userId);
        else invited.push(r.email);
      }
      const members = [...new Set([...picked, ...fromEmail])];
      if (members.length === 0 && invited.length === 0) throw new Error('No recipients');

      // 1:1 — exactly one known person and nobody to invite.
      if (members.length === 1 && invited.length === 0) {
        const other = members[0]!;
        const id = directConversationId(userId, other);
        const existing = await getDb().getDoc(collections.conversation, id);
        if (!existing) {
          await engineConversationCreate(
            { id, type: 'direct', title: '', mode: 'private', ownerIds: [userId, other] },
            userId,
          );
          await engineConversationUserAdd(
            { conversationId: id, userId: other, role: 'member', visibility: 'visible' },
            userId,
          );
        }
        return { conversationId: id, invited: [] };
      }

      // Only an invite (no known members) — mirror conversationCreateDirect's invite path.
      if (members.length === 0 && invited.length === 1) {
        await sendInviteEmail(invited[0]!, userId).catch((err: unknown) =>
          { console.error('[invite] direct invite failed', err); },
        );
        return { conversationId: '', invited };
      }

      // Group.
      const id = `grp-${userId}-${Date.now().toString(36)}`;
      await engineConversationCreate(
        { id, type: 'group', title: input.title ?? 'New group', mode: 'private', ownerIds: [userId] },
        userId,
      );
      for (const m of members) {
        await engineConversationUserAdd(
          { conversationId: id, userId: m, role: 'member', visibility: 'visible' },
          userId,
        );
      }
      for (const email of invited) {
        await sendInviteEmail(email, userId, id).catch((err: unknown) =>
          { console.error('[invite] group invite failed', err); },
        );
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
        avatar: input.avatar ?? defaultAvatar,
        firstMessage: input.firstMessage ?? null,
        buttons: input.buttons ?? [],
        ...dbDefaults(),
      });
      return { botId };
    },

    botUpdate: async (userId, input): Promise<{ ok: boolean }> => {
      const existing = await getDb().getDoc(collections.bot, input.botId);
      if (existing?.ownerId !== userId) throw new Error('Bot not found');
      const patch: Record<string, unknown> = {};
      for (const k of ['name', 'instruction', 'model', 'avatar', 'firstMessage', 'buttons'] as const) {
        if (input[k] !== undefined) patch[k] = input[k];
      }
      await getDb().setDoc(collections.bot, { ...existing, ...patch, ...dbDefaults() });
      return { ok: true };
    },

    botGet: async (_userId, input) => getDb().getDoc(collections.bot, input.botId),

    botListMine: async (userId): Promise<{ bots: Record<string, unknown>[] }> => {
      const bots = await getDb().getDocs(collections.bot, { ownerId: userId });
      bots.sort((a, b) => toMillis(b.updated) - toMillis(a.updated));
      return { bots };
    },

    // Curated built-in bots surfaced to every user (fresh accounts own no custom
    // bots, so `botListMine` is empty and the flagship Ugly Bot was unreachable
    // from the UI). Returns only the featured bots whose config rows actually
    // exist, so a missing/renamed built-in silently drops out instead of erroring.
    botListFeatured: async (): Promise<{ bots: Record<string, unknown>[] }> => {
      const docs = await Promise.all(
        FEATURED_BOT_IDS.map((id) => getDb().getDoc(collections.bot, id).catch(() => null)),
      );
      return { bots: docs.filter((d) => d != null) };
    },

    botDelete: async (userId, input): Promise<{ ok: boolean }> => {
      const existing = await getDb().getDoc(collections.bot, input.botId);
      if (existing?.ownerId !== userId) throw new Error('Bot not found');
      await getDb().deleteDoc(collections.bot, input.botId);
      return { ok: true };
    },

    // Wipe a conversation's messages (used by the bot-chat "Clear chat" menu).
    // Allowed only for a participant/owner; re-seeds the bot's greeting after.
    conversationClear: async (userId, input): Promise<{ ok: boolean }> => {
      const db = getDb();
      const conv = await db.getDoc(collections.conversation, input.conversationId);
      if (!conv) throw new Error('Conversation not found');
      const owners = (conv.ownerIds as string[] | undefined) ?? [];
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
        for (const m of msgs) await db.deleteDoc(collections.message, m._id);
        if (msgs.length < 500) break;
      }
      // Re-seed the bot's greeting so a cleared bot chat starts fresh.
      const botsField = (conv.bots) ?? {};
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
  ).catch((err: unknown) => { console.error('[system-message] failed', err); });
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
