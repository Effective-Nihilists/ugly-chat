/**
 * Resolve userId → display profile (name + avatar) for chat participants.
 *
 * Profiles are NOT cached server-side: humans resolve fresh from ugly.bot's
 * `userPublicBatch` op (whose profile already returns a canonical `Avatar`) —
 * ugly.bot is the single source of truth, and any caching belongs on the
 * client. Bots resolve locally: built-in personas via `botUser`, and custom /
 * migrated-upgraded bots via the local `bot` collection. Anything unresolved
 * falls back to the shared `defaultAvatar`.
 */
import { defaultAvatar, type Avatar } from 'ugly-app/shared';
import type { CollectionDef } from 'ugly-app/shared';
import { botUser } from './bots';
import { toAvatar } from './avatar';
import { uglyBotRequest } from './uglybot';
import { collections } from '../shared/collections';

export interface Profile {
  id: string;
  name: string;
  avatar: Avatar;
  isBot: boolean;
}

interface DbLike {
  getDoc<T>(collection: CollectionDef<T>, id: string): Promise<T | null>;
}

const fallbackName = (id: string): string => id.slice(0, 8);

export async function resolveProfiles(db: DbLike, userIds: string[]): Promise<Profile[]> {
  const ids = [...new Set(userIds)].filter(Boolean).slice(0, 100);
  const out: Profile[] = [];
  const humans: string[] = [];

  for (const id of ids) {
    const bot = botUser(id);
    if (bot) {
      out.push({ id, name: bot.name, avatar: defaultAvatar, isBot: true });
      continue;
    }
    // Custom (`bot-`) and migrated-upgraded bots live in the local `bot`
    // collection (authoritative for their name/avatar).
    const botDoc = await db.getDoc(collections.bot, id);
    if (botDoc) {
      out.push({ id, name: botDoc.name, avatar: toAvatar(botDoc.avatar), isBot: true });
      continue;
    }
    // A `bot-` id with no editable row yet is still a bot (minimal persona).
    if (id.startsWith('bot-')) {
      out.push({ id, name: 'Bot', avatar: defaultAvatar, isBot: true });
      continue;
    }
    humans.push(id);
  }

  if (humans.length > 0) {
    const got = new Set<string>();
    try {
      const res = await uglyBotRequest('userPublicBatch', { userIds: humans });
      for (const p of res.profiles) {
        out.push({ id: p.id, name: p.name ?? fallbackName(p.id), avatar: p.avatar, isBot: false });
        got.add(p.id);
      }
    } catch (err) {
      console.warn('[profiles] userPublicBatch failed:', (err as Error).message);
    }
    for (const id of humans) {
      if (got.has(id)) continue;
      out.push({ id, name: fallbackName(id), avatar: defaultAvatar, isBot: false });
    }
  }

  return out;
}
