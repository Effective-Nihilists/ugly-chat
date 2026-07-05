/**
 * Resolve userId → display profile (name + avatar) for chat participants, with
 * bot resolution (built-in / custom `bot-` / migrated-bot personas).
 *
 * The avatar is the canonical `Avatar` object everywhere (never split into
 * separate url fields). Humans resolve via ugly.bot's `userPublicBatch` op
 * (whose profile already returns an `Avatar`) and are cached in the local
 * `userProfileCache` collection; bots resolve locally. Anything unresolved
 * falls back to the shared `defaultAvatar`.
 */
import { dbDefaults, defaultAvatar, type Avatar } from 'ugly-app/shared';
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
  setDoc<T>(collection: CollectionDef<T>, doc: T, options?: { skipIfExists?: boolean }): Promise<boolean>;
}

const fallbackName = (id: string): string => id.slice(0, 8);
const asBool = (v: unknown): boolean => v === true || v === 'true';

// How long a resolved ugly.bot profile is trusted before re-fetching, so avatar
// changes in ugly.bot propagate into chat.
const AVATAR_CACHE_TTL_MS = 60 * 60 * 1000;

export async function resolveProfiles(db: DbLike, userIds: string[]): Promise<Profile[]> {
  const ids = [...new Set(userIds)].filter(Boolean).slice(0, 100);
  const out: Profile[] = [];
  const toFetch: string[] = [];
  const cacheById = new Map<string, Record<string, unknown>>();

  for (const id of ids) {
    const bot = botUser(id);
    if (bot) {
      out.push({ id, name: bot.name, avatar: defaultAvatar, isBot: true });
      continue;
    }
    // Custom (`bot-`) bots resolve from the local `bot` collection.
    if (id.startsWith('bot-')) {
      const botDoc = await db.getDoc(collections.bot, id);
      out.push({
        id,
        name: (botDoc?.name) ?? 'Bot',
        avatar: toAvatar(botDoc?.avatar),
        isBot: true,
      });
      continue;
    }
    const cached = await db.getDoc(collections.userProfileCache, id);
    // A migrated bot upgraded to an editable config bot has a `bot` row keyed by
    // its plain userId — authoritative for its name/avatar.
    if (cached && asBool(cached.isBot)) {
      const botDoc = await db.getDoc(collections.bot, id);
      if (botDoc) {
        out.push({
          id,
          name: (botDoc.name) ?? fallbackName(id),
          avatar: toAvatar(botDoc.avatar),
          isBot: true,
        });
        continue;
      }
    }
    if (
      cached &&
      typeof cached.avatarFetchedAt === 'number' &&
      Date.now() - (cached.avatarFetchedAt) < AVATAR_CACHE_TTL_MS
    ) {
      out.push({
        id,
        name: (cached.name as string | undefined) ?? fallbackName(id),
        avatar: toAvatar(cached.avatar),
        isBot: asBool(cached.isBot),
      });
    } else {
      toFetch.push(id);
      if (cached) cacheById.set(id, cached);
    }
  }

  if (toFetch.length > 0) {
    const got = new Set<string>();
    try {
      const res = await uglyBotRequest('userPublicBatch', { userIds: toFetch });
      for (const p of res.profiles ?? []) {
        const local = cacheById.get(p.id);
        const name = (local?.name as string | undefined) ?? p.name ?? fallbackName(p.id);
        const isBot = asBool(local?.isBot);
        out.push({ id: p.id, name, avatar: p.avatar, isBot });
        got.add(p.id);
        await db.setDoc(collections.userProfileCache, {
          ...(local ?? {}),
          _id: p.id,
          name,
          isBot,
          avatar: p.avatar,
          avatarFetchedAt: Date.now(),
          ...dbDefaults(),
        });
      }
    } catch (err) {
      console.warn('[profiles] userPublicBatch failed:', (err as Error).message);
    }
    for (const id of toFetch) {
      if (got.has(id)) continue;
      const local = cacheById.get(id);
      out.push({
        id,
        name: (local?.name as string | undefined) ?? fallbackName(id),
        avatar: toAvatar(local?.avatar),
        isBot: asBool(local?.isBot),
      });
    }
  }

  return out;
}
