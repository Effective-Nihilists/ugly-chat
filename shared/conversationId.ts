// Stable id for a 1:1 conversation between two userIds (order-independent), so
// re-opening a DM finds the existing room rather than creating a duplicate.
const DM_PREFIX = 'dm-';

export function directConversationId(a: string, b: string): string {
  return `${DM_PREFIX}${[a, b].sort().join('+')}`;
}

/**
 * The OTHER participant's userId in a direct conversation, or null if `roomId`
 * isn't one (a group, a bot chat) or doesn't include `meId`.
 *
 * Handles every direct-id shape in the wild: what we mint today (`dm-<a>+<b>`),
 * plus the two legacy/foreign forms — bare `<a>+<b>` and the framework-native
 * `<a>:<b>` (e.g. the Love couple chat).
 *
 * Lives next to `directConversationId` on purpose. Both the client header and
 * the server's sidebar backfill used to re-derive this inline by splitting on
 * '+', which never stripped the `dm-` prefix — so for half of all DMs (whichever
 * id sorts first) they resolved a peer id of `dm-<userId>`, found no profile,
 * and fell back to showing a slice of the raw conversation id: `dm-t4ECy`.
 * Encoding the format in one place is the only thing that keeps a parser and a
 * minter honest with each other.
 */
/** A 1:1 room with a bot: `bc-<botId>-<userId>`. */
const BOT_CHAT_PREFIX = 'bc-';

/**
 * Is this room a one-to-one conversation (with a person OR a bot)?
 *
 * Not the same question as `type === 'direct'`: bot chats are *stored* as
 * groups (`bc-<botId>-<userId>`, type `group`) even though they are plainly a
 * 1:1. The sidebar used to skip the question entirely and label every unpinned
 * row `// DIRECT`, so a three-person group sat under a heading calling it a
 * direct message.
 */
export function isDirectRoom(conversationId: string, type?: string): boolean {
  if (conversationId.startsWith(BOT_CHAT_PREFIX)) return true;
  if (conversationId.startsWith(DM_PREFIX)) return true;
  return type === 'direct';
}

export function directConversationPeer(roomId: string, meId: string): string | null {
  const body = roomId.startsWith(DM_PREFIX) ? roomId.slice(DM_PREFIX.length) : roomId;
  const sep = body.includes('+') ? '+' : body.includes(':') ? ':' : '';
  if (!sep) return null;
  const parts = body.split(sep).filter(Boolean);
  if (parts.length !== 2 || !parts.includes(meId)) return null;
  return parts.find((p) => p !== meId) ?? null;
}
