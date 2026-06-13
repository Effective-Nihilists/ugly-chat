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
}
export interface CallState {
  active: boolean;
  startedAt?: number;
  participants: Record<string, CallParticipant>;
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
  const call = getCall(conv);
  if (!call.active) {
    call.active = true;
    call.startedAt = Date.now();
  }
  call.participants = {
    ...call.participants,
    [userId]: { userId, isBot, joinedAt: Date.now() },
  };
  await db.setDocFields(collections.conversation, conversationId, { call });
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
  const participants = { ...call.participants };
  delete participants[userId];
  const next: CallState = {
    active: Object.keys(participants).length > 0,
    ...(call.startedAt ? { startedAt: call.startedAt } : {}),
    participants,
  };
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
