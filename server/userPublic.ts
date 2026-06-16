/**
 * Getter-backed `userPublic` collection (the framework's cached profile cache).
 *
 * Runtime-neutral, Workers-safe equivalent of `ugly-app/server`'s
 * `userPublicCollections` — it builds the same getter-backed def, but resolves
 * profiles via the app's Workers-safe `uglyBotRequest` re-export (see
 * `server/uglybot.ts`) instead of importing the Node server barrel, which would
 * drag pg/vite/http into the Workers bundle.
 *
 * The collection has NO Postgres table: every read routes through `profilesGetter`
 * (one batched `userPublicBatch` op to ugly.bot) and is absorbed by a short
 * server-side hot-cache (90s). `db.getByIds('userPublic', ids)` therefore does
 * cache-hit-per-id + ONE batched op for misses — which is the conversation-list
 * perf fix (replacing the old sequential `resolveProfiles` loop).
 *
 * Both `server/index.ts` (Node) and `server/workers.ts` (Workers) spread the
 * result of `withUserPublic(collections)` into what they hand the framework, so
 * the framework's internal def registry carries the getter for the `userPublic`
 * name. Handler code keeps referencing `collections.userPublic` from
 * `shared/collections.ts` — `getByIds`/`getDoc` resolve the getter by name.
 */
import { z } from 'zod';
import { dbDefaults, defineCollections } from 'ugly-app/shared';
import { uglyBotRequest } from './uglybot';
import type { UserPublicDoc } from '../shared/collections';

const TTL_MS = 90_000;

/** Permissive user-profile shape. Catchall keeps app-specific fields. */
const UserPublicGetterSchema = z
  .object({
    name: z.string().nullish(),
    avatarUrl: z.string().nullish(),
    backgroundUrl: z.string().nullish(),
    avatarGlbUrl: z.string().nullish(),
  })
  .catchall(z.unknown());

/**
 * Batch profile resolver — resolves user ids to public profiles via ugly.bot's
 * `userPublicBatch` op. Returns a map keyed by id; ids ugly.bot didn't return
 * map to null. Each resolved profile is shaped as a full DBObject so it can be
 * cached and consumed like any other doc.
 */
export async function profilesGetter(
  ids: string[],
): Promise<Record<string, UserPublicDoc | null>> {
  const out: Record<string, UserPublicDoc | null> = {};
  for (const id of ids) out[id] = null; // default — unresolved ids stay null
  if (ids.length === 0) return out;
  const { profiles } = await uglyBotRequest('userPublicBatch', { userIds: ids });
  const base = dbDefaults();
  for (const p of profiles) {
    // ugly.bot's schema is passthrough, so avatarGlbUrl (when present) survives.
    const extra = p as { avatarGlbUrl?: string | null };
    out[p.id] = {
      ...base,
      _id: p.id,
      name: p.name ?? null,
      avatarUrl: p.avatarUrl ?? null,
      backgroundUrl: p.backgroundUrl ?? null,
      avatarGlbUrl: extra.avatarGlbUrl ?? null,
    };
  }
  return out;
}

/** The getter-backed `userPublic` collection set (spreadable into `collections`). */
export const userPublicCollections = defineCollections({
  userPublic: {
    schema: UserPublicGetterSchema,
    meta: {
      public: true,
      trackable: false,
      cache: { ttlMs: TTL_MS },
      getter: profilesGetter,
      cascadeFrom: null,
    },
  },
});

/**
 * Merge the getter-backed `userPublic` def into an app collection set, replacing
 * the getter-less placeholder from `shared/collections.ts`. Server entries pass
 * the result to `createApp` / `createWorkersApp` so the framework's def registry
 * carries the getter.
 */
export function withUserPublic<T extends Record<string, unknown>>(
  collections: T,
): T & typeof userPublicCollections {
  return { ...collections, ...userPublicCollections };
}
