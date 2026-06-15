/**
 * Sidebar denormalization for the conversation list.
 *
 * The framework conversation engine does NOT maintain `userConversation`'s
 * `notificationText` (last-message preview) or `notificationCount` (unread) —
 * it only zeroes them on create/clear. So `conversationListMine` always read 0
 * unread and an empty preview. These helpers fill that gap:
 *   - `bumpListForMessage` — call after any human/bot message: refresh every
 *     member's preview, +1 unread for everyone except the sender (who is marked
 *     read), and un-hide the row on activity.
 *   - `markRead` — call when a member opens a conversation: zero their unread +
 *     stamp `viewed` + un-hide.
 *
 * Lives in its own module so both `handlers.ts` and `bots.ts` can import it
 * without a circular dependency.
 */
import { collections } from '../shared/collections';
import { UGLY_BOT_USER_ID } from '../shared/bots';

interface DbLike {
  getDoc(col: unknown, id: string): Promise<Record<string, unknown> | null>;
  getDocs(col: unknown, filter?: unknown, opts?: unknown): Promise<Record<string, unknown>[]>;
  setDoc(col: unknown, doc: unknown): Promise<void>;
}

const isBotId = (id: string): boolean => id.startsWith('bot-') || id === UGLY_BOT_USER_ID;

function preview(text: string): string {
  const t = text.replace(/[#*_`>~]/g, '').replace(/\s+/g, ' ').trim();
  return t.length > 100 ? `${t.slice(0, 100)}…` : t;
}

const num = (v: unknown): number => (typeof v === 'number' ? v : 0);

/** After a message: update every human member's preview + unread + recency. */
export async function bumpListForMessage(
  db: DbLike,
  conversationId: string,
  text: string,
  senderId: string,
): Promise<void> {
  const rows = await db.getDocs(collections.userConversation, { conversationId });
  const p = preview(text);
  await Promise.all(
    rows.map(async (uc) => {
      const memberId = String(uc['userPrivateId'] ?? '');
      if (!memberId || isBotId(memberId)) return;
      const isSender = memberId === senderId;
      const visibility = (uc['visibility'] as string) === 'hidden' ? 'visible' : uc['visibility'];
      await db.setDoc(collections.userConversation, {
        ...uc,
        notificationText: p,
        notificationCount: isSender ? 0 : num(uc['notificationCount']) + 1,
        ...(isSender ? { viewed: Date.now() } : {}),
        visibility,
        updated: new Date(),
      });
    }),
  );
}

/** When a member opens a conversation: clear their unread + mark viewed. */
export async function markRead(
  db: DbLike,
  conversationId: string,
  userId: string,
): Promise<void> {
  const uc = await db.getDoc(collections.userConversation, `${userId}:${conversationId}`);
  if (!uc) return;
  const hidden = (uc['visibility'] as string) === 'hidden';
  if (num(uc['notificationCount']) === 0 && !hidden) return; // nothing to do
  await db.setDoc(collections.userConversation, {
    ...uc,
    notificationCount: 0,
    viewed: Date.now(),
    visibility: hidden ? 'visible' : uc['visibility'],
    updated: new Date(),
  });
}
