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
import { botUser } from './bots';

export interface CallParticipant {
  userId: string;
  isBot: boolean;
  joinedAt: number;
  /** Cloudflare Realtime SFU session id, once the client has created one. */
  sessionId?: string;
  /** Names of the local tracks this participant published to the SFU (the
   *  things peers pull). Empty/absent until they've pushed media. */
  tracks?: string[];
}
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
  getDoc(collection: unknown, id: string): Promise<Record<string, unknown> | null>;
  setDocFields(collection: unknown, id: string, fields: Record<string, unknown>): Promise<void>;
}
type Collections = { conversation: unknown };

function getCall(conv: Record<string, unknown> | null): CallState {
  const c = conv?.['call'] as CallState | undefined;
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
  const participant: CallParticipant = { userId, isBot, joinedAt: Date.now() };
  await db.setDocFields(collections.conversation, conversationId, {
    'call.active': true,
    [`call.participants.${userId}`]: participant,
  });
  const updated = await db.getDoc(collections.conversation, conversationId);
  return getCall(updated);
}

/** Fresh, server-side read of the call roster (clients poll this — `getDoc` on
 *  the client only returns the stale trackDoc-cached copy). */
export async function videoState(
  db: DbLike,
  collections: Collections,
  conversationId: string,
): Promise<CallState> {
  const conv = await db.getDoc(collections.conversation, conversationId);
  return getCall(conv);
}

export async function videoLeave(
  db: DbLike,
  collections: Collections,
  conversationId: string,
  userId: string,
): Promise<CallState> {
  const conv = await db.getDoc(collections.conversation, conversationId);
  const call = getCall(conv);
  const participants = { ...call.participants };
  delete participants[userId];
  // A call is only "active" while a HUMAN is in it. Bots never leave on their
  // own, so once the last human leaves we end the call (and drop the bots) —
  // otherwise a bot DM would show a phantom active call forever.
  const humansLeft = Object.values(participants).some((p) => !p.isBot);
  const next: CallState = humansLeft
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

/** Add a bot to the call as a client-side "fake call" participant. */
export async function videoBotJoin(
  db: DbLike,
  collections: Collections,
  conversationId: string,
  botId: string,
): Promise<CallState> {
  if (!botUser(botId)) throw new Error('not a bot');
  return videoJoin(db, collections, conversationId, botId, true);
}
