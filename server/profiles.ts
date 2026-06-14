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
import { UGLY_BOT, UGLY_BOT_USER_ID } from '../shared/bots';

export interface Profile {
  id: string;
  name: string;
  avatarUrl: string | null;
  isBot: boolean;
  /** 2D conversation background image (the bot's avatar background), if any. */
  backgroundUrl: string | null;
}

interface DbLike {
  getDoc(c: unknown, id: string): Promise<Record<string, unknown> | null>;
  setDoc(c: unknown, doc: unknown): Promise<void>;
}

const fallbackName = (id: string): string => id.slice(0, 8);

const asBool = (v: unknown): boolean => v === true || v === 'true';

// Best-effort avatar URL from a userPublic doc. Many migrated rows store the
// avatar as an id/object rather than a URL — those degrade to a colored initial
// (avatarUrl null). Only return a value when it's clearly an absolute URL.
function avatarUrlOf(doc: Record<string, unknown>): string | null {
  for (const key of ['imageUri', 'image', 'avatar']) {
    const v = doc[key];
    if (typeof v === 'string' && /^https?:\/\//.test(v)) return v;
    if (v && typeof v === 'object') {
      const uri = (v as Record<string, unknown>)['uri'] ?? (v as Record<string, unknown>)['url'];
      if (typeof uri === 'string' && /^https?:\/\//.test(uri)) return uri;
    }
  }
  return null;
}

export async function resolveProfiles(db: DbLike, userIds: string[]): Promise<Profile[]> {
  const ids = [...new Set(userIds)].filter(Boolean).slice(0, 100);
  const out: Profile[] = [];
  const toFetch: string[] = [];
  const localById = new Map<string, Record<string, unknown>>();

  for (const id of ids) {
    // Canonical Ugly Bot — ugly.bot serves its avatar from a hardcoded mascot
    // (not a userPublic row), so the userPublicBatch path returns nothing and it
    // degrades to a short-id/initial. Pin its real name + avatar + background.
    if (id === UGLY_BOT_USER_ID) {
      out.push({
        id,
        name: UGLY_BOT.name,
        avatarUrl: UGLY_BOT.avatarUrl,
        isBot: true,
        backgroundUrl: UGLY_BOT.backgroundUrl,
      });
      continue;
    }
    const bot = botUser(id);
    if (bot) {
      out.push({ id, name: bot.name, avatarUrl: null, isBot: true, backgroundUrl: null });
      continue;
    }
    // Custom (`bot-`) bots resolve from the local `bot` collection. Migrated
    // bots (plain userIds like the canonical Ugly Bot) are NOT here — they fall
    // through to the userPublic/ugly.bot path below, which has their real
    // name + avatar and sets isBot from the cached doc.
    if (id.startsWith('bot-')) {
      const botDoc = await db.getDoc(collections.bot, id);
      out.push({
        id,
        name: (botDoc?.['name'] as string | undefined) ?? 'Bot',
        avatarUrl: (botDoc?.['avatarUrl'] as string | null | undefined) ?? null,
        isBot: true,
        backgroundUrl: (botDoc?.['backgroundUrl'] as string | null | undefined) ?? null,
      });
      continue;
    }
    const cached = await db.getDoc(collections.userPublic, id);
    if (cached) localById.set(id, cached);
    // The migration carried names but almost no avatars (ugly.bot's avatars are
    // 3D models with a separate 2D thumbnail that wasn't migrated). So a row is
    // only "done" once we've resolved its avatar from ugly.bot at least once
    // (marked by `avatarFetchedAt`). Otherwise fetch — names come along too.
    // "Done" requires a prior ugly.bot resolution that also captured the
    // background field (`backgroundResolved` present — added later). Entries
    // cached before that re-fetch so the conversation background fills in.
    if (cached && typeof cached['avatarFetchedAt'] === 'number' && 'backgroundResolved' in cached) {
      out.push({
        id,
        name: (cached['name'] as string | undefined) ?? fallbackName(id),
        avatarUrl: (cached['avatarResolved'] as string | null | undefined) ?? avatarUrlOf(cached),
        isBot: asBool(cached['isBot']),
        backgroundUrl: (cached['backgroundResolved'] as string | null | undefined) ?? null,
      });
    } else {
      toFetch.push(id);
    }
  }

  if (toFetch.length > 0) {
    const got = new Set<string>();
    try {
      const res = await uglyBotRequest<{ profiles: { id: string; name: string | null; avatarUrl: string | null; backgroundUrl?: string | null }[] }>(
        'userPublicBatch',
        { userIds: toFetch },
      );
      for (const p of res.profiles ?? []) {
        const local = localById.get(p.id);
        // Prefer the (richer) migrated name; fall back to ugly.bot's, then id.
        const name = (local?.['name'] as string | undefined) ?? p.name ?? fallbackName(p.id);
        const avatarUrl = p.avatarUrl ?? (local ? avatarUrlOf(local) : null);
        const backgroundUrl = p.backgroundUrl ?? null;
        const isBot = asBool(local?.['isBot']);
        out.push({ id: p.id, name, avatarUrl, isBot, backgroundUrl });
        got.add(p.id);
        await db.setDoc(collections.userPublic, {
          ...(local ?? {}),
          _id: p.id,
          name,
          isBot,
          avatarResolved: avatarUrl,
          backgroundResolved: backgroundUrl,
          avatarFetchedAt: Date.now(),
          ...dbDefaults(),
        });
      }
    } catch (err) {
      console.warn('[profiles] userPublicBatch failed:', (err as Error).message);
    }
    for (const id of toFetch) {
      if (got.has(id)) continue;
      const local = localById.get(id);
      out.push({
        id,
        name: (local?.['name'] as string | undefined) ?? fallbackName(id),
        avatarUrl: local ? avatarUrlOf(local) : null,
        isBot: asBool(local?.['isBot']),
        backgroundUrl: null,
      });
    }
  }

  return out;
}
