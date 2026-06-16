import { defaultAvatar, type Avatar } from 'ugly-app/shared';

/** Coerce a stored value into a valid Avatar object, else the shared default. */
export function toAvatar(raw: unknown): Avatar {
  if (raw && typeof raw === 'object' && (raw as { image?: { uri?: string } }).image?.uri) {
    return raw as Avatar;
  }
  return defaultAvatar;
}
