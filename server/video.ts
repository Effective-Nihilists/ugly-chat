/**
 * Video call lifecycle (Workers-native — db + trackDocs only).
 *
 * Call state lives on `conversation.call` (the conversation collection is
 * trackable, so clients receive roster updates live via trackDoc). This is the
 * signaling/orchestration layer; the actual media plane (camera/mic streams)
 * is provided by Cloudflare Realtime in production — see REALTIME_* env. Bots
 * join as participants with `isBot: true` and are rendered client-side as a
 * "fake call" (avatar + local TTS), needing no media track.
 */
import { isBot } from './bots';
import type { CollectionDef, DBObject, DocFields } from 'ugly-app/shared';
import type { Conversation } from '../shared/collections';

export interface CallParticipant {
  userId: string;
  isBot: boolean;
  joinedAt: number;
  /** Last heartbeat. A tab that's closed/crashed never calls videoLeave, so
   *  without this its participant lived on the roster forever — the call stayed
   *  `active` and re-rang the conversation on a fresh page load, with no way to
   *  dismiss it. Stale entries are pruned on read. */
  seenAt?: number;
  /** Mic/camera state, published so PEERS can render a muted / camera-off badge.
   *  Toggling only flipped the local track's `enabled`, so the other side saw a
   *  silent participant or a black rectangle with no explanation. Absent = on. */
  micOn?: boolean;
  camOn?: boolean;
  /** Cloudflare Realtime SFU session id, once the client has created one. */
  sessionId?: string;
  /** Names of the local tracks this participant published to the SFU (the
   *  things peers pull). Empty/absent until they've pushed media. */
  tracks?: string[];
}

/** A participant older than this with no heartbeat is treated as gone. */
const STALE_MS = 45_000;
/** A transient live caption (most recent partial/final per speaker). Overwritten
 *  in place on the call subtree so peers receive it via trackDoc without growing
 *  the doc — it is signaling, not history. */
export interface CallCaption {
  userId: string;
  text: string;
  final: boolean;
  at: number;
  /** True when this came from a TYPED message (peers should speak it via TTS).
   *  STT captions (live mic) are false — peers already hear that audio over the
   *  SFU, so TTS-ing it would double. */
  typed?: boolean;
}
export interface CallState {
  active: boolean;
  startedAt?: number;
  participants: Record<string, CallParticipant>;
  /** Last caption per speaker; clients merge these into the local transcript. */
  captions?: Record<string, CallCaption>;
}

export interface DbLike {
  getDoc<T>(collection: CollectionDef<T>, id: string): Promise<T | null>;
  setDocFields<T extends DBObject>(
    collection: CollectionDef<T>,
    id: string,
    fields: DocFields<T>,
  ): Promise<T>;
}
interface Collections { conversation: CollectionDef<Conversation> }

function getCall(conv: Conversation | null): CallState {
  const c = conv?.call as CallState | undefined;
  return c ?? { active: false, participants: {} };
}

export async function videoJoin(
  db: DbLike,
  collections: Collections,
  conversationId: string,
  userId: string,
  isBot = false,
): Promise<CallState> {
  const conv = await db.getDoc(collections.conversation, conversationId);
  if (!conv) throw new Error('conversation not found');
  // Dot-path writes touch ONLY this participant's subtree — no read-modify-write
  // of the whole `call`, so concurrent joiners don't clobber each other. The
  // `$set` operator creates the missing `call`/`call.participants` parents.
  const participant: CallParticipant = { userId, isBot, joinedAt: Date.now(), seenAt: Date.now() };
  // Stamp startedAt on the first join of a call. It was never written — only
  // ever preserved — so every call instance looked identical (`undefined`) and
  // clients had no id to say "I declined THIS call": declining one ring would
  // have suppressed every future one.
  const existing = getCall(conv);
  const startedAt = existing.active && existing.startedAt ? existing.startedAt : Date.now();
  await db.setDocFields(collections.conversation, conversationId, {
    'call.active': true,
    'call.startedAt': startedAt,
    [`call.participants.${userId}`]: participant,
  });
  const updated = await db.getDoc(collections.conversation, conversationId);
  return getCall(updated);
}

/**
 * Drop participants whose heartbeat has gone silent (closed tab / crash / lost
 * network) and end the call if no live human is left. Returns the pruned state
 * plus whether anything changed, so callers only write when needed.
 */
function pruneStale(call: CallState, now = Date.now()): { call: CallState; changed: boolean } {
  if (!call.active) return { call, changed: false };
  const live: Record<string, CallParticipant> = {};
  let dropped = false;
  for (const [id, p] of Object.entries(call.participants)) {
    // Bots have no heartbeat; they're kept while a human is present and dropped
    // with the call below.
    if (p.isBot || now - (p.seenAt ?? p.joinedAt) < STALE_MS) live[id] = p;
    else dropped = true;
  }
  const humans = Object.values(live).filter((p) => !p.isBot);
  if (humans.length === 0) {
    return { call: { active: false, participants: {} }, changed: true };
  }
  if (!dropped) return { call, changed: false };
  return {
    call: { active: true, ...(call.startedAt ? { startedAt: call.startedAt } : {}), participants: live },
    changed: true,
  };
}

/**
 * Fresh, server-side read of the call roster (clients poll this — `getDoc` on
 * the client only returns the stale trackDoc-cached copy). Prunes dead
 * participants so an abandoned call can't ring forever.
 *
 * Doubles as the heartbeat: only a JOINED client polls this (every ~1.5s), so
 * when the caller is already on the roster we refresh their `seenAt` here. No
 * extra endpoint, and a closed tab simply stops polling and ages out.
 */
export async function videoState(
  db: DbLike,
  collections: Collections,
  conversationId: string,
  userId?: string,
): Promise<CallState> {
  const conv = await db.getDoc(collections.conversation, conversationId);
  const { call, changed } = pruneStale(getCall(conv));
  if (changed) {
    await db.setDocFields(collections.conversation, conversationId, { call });
  }
  if (userId && call.active && call.participants[userId]) {
    const now = Date.now();
    await db.setDocFields(collections.conversation, conversationId, {
      [`call.participants.${userId}.seenAt`]: now,
    });
    call.participants[userId] = { ...call.participants[userId], seenAt: now };
  }
  return call;
}

export async function videoLeave(
  db: DbLike,
  collections: Collections,
  conversationId: string,
  userId: string,
): Promise<CallState> {
  const conv = await db.getDoc(collections.conversation, conversationId);
  const call = getCall(conv);
  const { [userId]: _removed, ...participants } = call.participants;
  // A call needs TWO humans to still be a call. Keeping it alive while a single
  // human remained left the other side of a 1:1 staring at "connected" for as
  // long as they cared to wait after the peer hung up — hangup never reached
  // them. Bots don't count (they never leave on their own) and a lone human has
  // nobody to talk to, so drop to <2 humans and the call is over for everyone.
  // A 3-way losing one participant still has 2 humans and correctly continues.
  const humans = Object.values(participants).filter((p) => !p.isBot);
  const next: CallState = humans.length >= 2
    ? {
        active: true,
        ...(call.startedAt ? { startedAt: call.startedAt } : {}),
        participants,
      }
    : { active: false, participants: {} };
  await db.setDocFields(collections.conversation, conversationId, { call: next });
  return next;
}

export async function videoEnd(
  db: DbLike,
  collections: Collections,
  conversationId: string,
): Promise<CallState> {
  const next: CallState = { active: false, participants: {} };
  await db.setDocFields(collections.conversation, conversationId, { call: next });
  return next;
}

/**
 * Advertise the caller's SFU session + published track names on the roster so
 * other participants (watching `conversation.call` via trackDocs) can pull them.
 * Merges into the existing participant entry (must already have joined).
 */
export async function videoPublish(
  db: DbLike,
  collections: Collections,
  conversationId: string,
  userId: string,
  sessionId: string,
  tracks: string[],
): Promise<CallState> {
  // Merge onto this participant's subtree (join already created it). Dot-path
  // writes avoid the read-modify-write clobber race with concurrent joiners.
  await db.setDocFields(collections.conversation, conversationId, {
    [`call.participants.${userId}.sessionId`]: sessionId,
    [`call.participants.${userId}.tracks`]: tracks,
  });
  const updated = await db.getDoc(collections.conversation, conversationId);
  return getCall(updated);
}

/**
 * Relay a live caption from one speaker. Writes ONLY this speaker's subtree on
 * `call.captions.{userId}` (dot-path, like videoPublish) so concurrent speakers
 * don't clobber each other and peers watching `conversation.call` via trackDoc
 * receive it. Transient — overwritten on every partial, never appended.
 */
export async function videoCaption(
  db: DbLike,
  collections: Collections,
  conversationId: string,
  userId: string,
  text: string,
  final: boolean,
  typed = false,
): Promise<void> {
  const caption: CallCaption = { userId, text, final, at: Date.now(), ...(typed ? { typed: true } : {}) };
  await db.setDocFields(collections.conversation, conversationId, {
    [`call.captions.${userId}`]: caption,
  });
}

/**
 * Publish this participant's mic/camera state to the roster so peers can render
 * a muted / camera-off indicator. Dot-path write on their own subtree.
 */
export async function videoMedia(
  db: DbLike,
  collections: Collections,
  conversationId: string,
  userId: string,
  micOn: boolean,
  camOn: boolean,
): Promise<void> {
  await db.setDocFields(collections.conversation, conversationId, {
    [`call.participants.${userId}.micOn`]: micOn,
    [`call.participants.${userId}.camOn`]: camOn,
  });
}

/**
 * Add a bot to the call as a client-side "fake call" participant.
 *
 * Gated on `isBot` (any `bot-` id), NOT `botUser` — that only resolves the
 * static built-in BOTS map, which the canonical Ugly Bot left when it moved to
 * the `bot` collection. Every attempt to call `bot-ugly` (or any custom bot)
 * therefore died here with "not a bot": the avatar never joined, and the stage
 * sat on "nobody has joined yet" for the app's flagship feature.
 */
export async function videoBotJoin(
  db: DbLike,
  collections: Collections,
  conversationId: string,
  botId: string,
): Promise<CallState> {
  if (!isBot(botId)) throw new Error('not a bot');
  return videoJoin(db, collections, conversationId, botId, true);
}
