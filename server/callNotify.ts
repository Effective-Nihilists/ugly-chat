/**
 * Fire an incoming-call push to the OTHER participant(s) when a call starts, so
 * their device rings even if ugly.chat isn't focused.
 *
 * Native (FCM/APNs) works today: ugly.bot's push fan-out (`pushSend` op →
 * `deliverPushToUserDevices`) looks devices up by userId ALONE (no appId
 * filter), and ugly.chat uses ugly.bot's federated userIds — so a push from
 * ugly-chat reaches the token the ugly-mobile shell registered under ugly.bot.
 * Web push additionally needs ugly.bot's `/push-frame` service-worker + VAPID
 * subscribe, which is still stubbed on the platform (tracked separately).
 *
 * Fires ONLY on call start (the caller is the only human in the call) so a
 * second joiner doesn't re-push the caller. DMs only for now (the conversation
 * id encodes the two members); group fan-out is a follow-up.
 */
import { uglyBotRequest } from './uglybot';
import { isBot } from './bots';
import { collections } from '../shared/collections';
import type { UserPublicDoc } from '../shared/collections';

interface CallParticipantLike {
  userId: string;
  isBot: boolean;
}
interface CallStateLike {
  participants?: Record<string, CallParticipantLike>;
}
interface DbLike {
  getByIds<T>(col: unknown, ids: string[]): Promise<(T | null)[]>;
}

export async function notifyIncomingCall(
  db: DbLike,
  conversationId: string,
  callerId: string,
  call: CallStateLike,
): Promise<void> {
  // Only when the call JUST started — caller is the sole human participant.
  const humans = Object.values(call.participants ?? {}).filter((p) => !p.isBot);
  if (humans.length !== 1 || humans[0]?.userId !== callerId) return;

  // DM recipients: the other '+'-joined member(s) who are humans (not the bot,
  // not the caller). Group rooms (nanoid id, no '+') are a follow-up.
  if (!conversationId.includes('+')) return;
  const recipients = conversationId
    .split('+')
    .filter(Boolean)
    .filter((id) => id !== callerId && !isBot(id));
  if (recipients.length === 0) return;

  let callerName = 'Someone';
  try {
    const [doc] = await db.getByIds<UserPublicDoc>(collections.userPublic, [callerId]);
    if (doc?.name) callerName = doc.name;
  } catch {
    /* name is best-effort */
  }

  await Promise.all(
    recipients.map((targetUserId) =>
      uglyBotRequest('pushSend', {
        targetUserId,
        title: `${callerName} is calling`,
        body: 'Incoming video call',
        path: `/${conversationId}`,
      }).catch((err: unknown) => {
        console.warn('[callNotify] push failed', (err as Error)?.message);
      }),
    ),
  );
}
