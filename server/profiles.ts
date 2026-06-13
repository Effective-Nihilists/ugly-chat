/**
 * Resolve userId → display profile (name + avatar) for chat participants.
 * Bots resolve locally; humans resolve via ugly.bot's `userPublicBatch` op and
 * are cached in the local `userPublic` collection (24h TTL). Degrades to a
 * userId-derived name if ugly.bot is unreachable.
 */
import { dbDefaults } from 'ugly-app/shared';
import { botUser } from './bots';
import { uglyBotRequest } from './uglybot';
import { collections } from '../shared/collections';

export interface Profile {
  id: string;
  name: string;
  avatarUrl: string | null;
  isBot: boolean;
}

interface DbLike {
  getDoc(c: unknown, id: string): Promise<Record<string, unknown> | null>;
  setDoc(c: unknown, doc: unknown): Promise<void>;
}

const TTL_MS = 24 * 60 * 60 * 1000;
const fallbackName = (id: string): string => id.slice(0, 8);

export async function resolveProfiles(db: DbLike, userIds: string[]): Promise<Profile[]> {
  const ids = [...new Set(userIds)].filter(Boolean).slice(0, 100);
  const out: Profile[] = [];
  const toFetch: string[] = [];

  for (const id of ids) {
    const bot = botUser(id);
    if (bot) {
      out.push({ id, name: bot.name, avatarUrl: null, isBot: true });
      continue;
    }
    const cached = await db.getDoc(collections.userPublic, id);
    if (cached && typeof cached['fetchedAt'] === 'number' && cached['fetchedAt'] > Date.now() - TTL_MS) {
      out.push({
        id,
        name: (cached['name'] as string | undefined) ?? fallbackName(id),
        avatarUrl: (cached['avatar'] as string | null | undefined) ?? null,
        isBot: false,
      });
    } else {
      toFetch.push(id);
    }
  }

  if (toFetch.length > 0) {
    const got = new Set<string>();
    try {
      const res = await uglyBotRequest<{ profiles: { id: string; name: string | null; avatarUrl: string | null }[] }>(
        'userPublicBatch',
        { userIds: toFetch },
      );
      for (const p of res.profiles ?? []) {
        const name = p.name ?? fallbackName(p.id);
        out.push({ id: p.id, name, avatarUrl: p.avatarUrl, isBot: false });
        got.add(p.id);
        await db.setDoc(collections.userPublic, {
          _id: p.id,
          name,
          avatar: p.avatarUrl,
          fetchedAt: Date.now(),
          ...dbDefaults(),
        });
      }
    } catch (err) {
      console.warn('[profiles] userPublicBatch failed:', (err as Error).message);
    }
    for (const id of toFetch) {
      if (!got.has(id)) out.push({ id, name: fallbackName(id), avatarUrl: null, isBot: false });
    }
  }

  return out;
}
