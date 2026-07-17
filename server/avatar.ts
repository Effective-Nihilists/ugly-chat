import { defaultAvatar, type Avatar } from 'ugly-app/shared';

/** Coerce a stored value into a valid Avatar object, else the shared default. */
export function toAvatar(raw: unknown): Avatar {
  if (raw && typeof raw === 'object' && (raw as { image?: { uri?: string } }).image?.uri) {
    return raw as Avatar;
  }
  return defaultAvatar;
}

/**
 * Resolve a bot's Avatar from its stored doc. Built-in and migrated bots keep
 * their picture in a plain `avatarUrl` string (Ugly Bot's logo, a custom
 * upload's URL) rather than an `avatar` object — reading only `avatar` handed
 * back `defaultAvatar` (a generic human face on a snarky robot). Prefer the
 * `avatar` object, then synthesize one from `avatarUrl`, then the default.
 */
export function botAvatar(doc: { avatar?: unknown; avatarUrl?: unknown }): Avatar {
  const a = toAvatar(doc.avatar);
  if (a !== defaultAvatar) return a;
  if (typeof doc.avatarUrl === 'string' && doc.avatarUrl) {
    return { ...defaultAvatar, image: { ...defaultAvatar.image, uri: doc.avatarUrl } };
  }
  return defaultAvatar;
}
