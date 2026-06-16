/**
 * Resolve userId → display profile (name + avatar) for chat participants, WITH
 * bot resolution (built-in / custom `bot-` / migrated-bot personas). The fast,
 * getter-backed `userPublic` path (`db.getByIds`) is used directly by
 * `conversationListMine`; this resolver remains for the callers that also need
 * bot handling (`profilesGet`, `conversationMembers`, `userContacts`,
 * `userProfileGet`).
 *
 * Bots resolve locally; humans resolve via ugly.bot's `userPublicBatch` op and
 * are cached in the local `userProfileCache` collection. Degrades to a
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
  /** 2D conversation background image (the bot's avatar background), if any. */
  backgroundUrl: string | null;
  /** 3D avatar (GLB) for the call/TalkingAvatar, if any. */
  avatarGlbUrl: string | null;
}

interface DbLike {
  getDoc(c: unknown, id: string): Promise<Record<string, unknown> | null>;
  setDoc(c: unknown, doc: unknown): Promise<void>;
}

const fallbackName = (id: string): string => id.slice(0, 8);

// How long a resolved ugly.bot profile (name/avatar/background) is trusted before
// re-fetching, so post-migration avatar changes propagate. 1h balances freshness
// against load on ugly.bot's userPublicBatch.
const AVATAR_CACHE_TTL_MS = 60 * 60 * 1000;

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
    const bot = botUser(id);
    if (bot) {
      out.push({ id, name: bot.name, avatarUrl: null, isBot: true, backgroundUrl: null, avatarGlbUrl: null });
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
        avatarGlbUrl: (botDoc?.['avatarGlbUrl'] as string | null | undefined) ?? null,
      });
      continue;
    }
    const cached = await db.getDoc(collections.userProfileCache, id);
    if (cached) localById.set(id, cached);
    // A migrated bot upgraded to an editable config bot has a `bot` collection
    // row keyed by its plain userId — that row is authoritative for its
    // name/avatar (so edits + a valid image win over the stale federated one).
    if (cached && asBool(cached['isBot'])) {
      const botDoc = await db.getDoc(collections.bot, id);
      if (botDoc) {
        out.push({
          id,
          name: (botDoc['name'] as string | undefined) ?? (cached['name'] as string | undefined) ?? fallbackName(id),
          avatarUrl: (botDoc['avatarUrl'] as string | null | undefined) ?? null,
          isBot: true,
          backgroundUrl: (botDoc['backgroundUrl'] as string | null | undefined) ?? null,
          avatarGlbUrl: (botDoc['avatarGlbUrl'] as string | null | undefined) ?? null,
        });
        continue;
      }
    }
    // The migration carried names but almost no avatars (ugly.bot's avatars are
    // 3D models with a separate 2D thumbnail that wasn't migrated). So a row is
    // only "done" once we've resolved its avatar from ugly.bot at least once
    // (marked by `avatarFetchedAt`). Otherwise fetch — names come along too.
    // "Done" requires a prior ugly.bot resolution that also captured the
    // background field (`backgroundResolved` present — added later). Entries
    // cached before that re-fetch so the conversation background fills in.
    if (
      cached &&
      typeof cached['avatarFetchedAt'] === 'number' &&
      'backgroundResolved' in cached &&
      // Real TTL: re-fetch once the cached resolution is older than the window so
      // a profile/avatar the user changes in ugly.bot AFTER being cached actually
      // propagates into chat (previously this never re-fetched → stale forever).
      Date.now() - (cached['avatarFetchedAt'] as number) < AVATAR_CACHE_TTL_MS
    ) {
      out.push({
        id,
        name: (cached['name'] as string | undefined) ?? fallbackName(id),
        avatarUrl: (cached['avatarResolved'] as string | null | undefined) ?? avatarUrlOf(cached),
        isBot: asBool(cached['isBot']),
        backgroundUrl: (cached['backgroundResolved'] as string | null | undefined) ?? null,
        avatarGlbUrl: (cached['avatarGlbResolved'] as string | null | undefined) ?? null,
      });
    } else {
      toFetch.push(id);
    }
  }

  if (toFetch.length > 0) {
    const got = new Set<string>();
    try {
      const res = await uglyBotRequest('userPublicBatch', { userIds: toFetch });
      for (const p of res.profiles ?? []) {
        const local = localById.get(p.id);
        // Prefer the (richer) migrated name; fall back to ugly.bot's, then id.
        const name = (local?.['name'] as string | undefined) ?? p.name ?? fallbackName(p.id);
        const avatarUrl = p.avatarUrl ?? (local ? avatarUrlOf(local) : null);
        const backgroundUrl = p.backgroundUrl ?? null;
        const avatarGlbUrl = (p as { avatarGlbUrl?: string | null }).avatarGlbUrl ?? null;
        const isBot = asBool(local?.['isBot']);
        out.push({ id: p.id, name, avatarUrl, isBot, backgroundUrl, avatarGlbUrl });
        got.add(p.id);
        await db.setDoc(collections.userProfileCache, {
          ...(local ?? {}),
          _id: p.id,
          name,
          isBot,
          avatarResolved: avatarUrl,
          backgroundResolved: backgroundUrl,
          avatarGlbResolved: avatarGlbUrl,
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
        avatarGlbUrl: null,
      });
    }
  }

  return out;
}
