import type { query as pgQuery } from 'ugly-app/server';

// The local `userPublic` table held migrated ugly.bot profiles + bot personas
// (`isBot`/`bio`/resolved avatars). The `userPublic` collection name is now owned
// by the framework's getter-backed (table-less) profile collection, so the local
// cache moves to `userProfileCache`. Rename in place to preserve the migrated
// rows (bot personas drive migrated-bot replies). Idempotent + index/snapshot
// cleanup so a fresh DB (no old table) is a no-op.
export async function up(query: typeof pgQuery): Promise<void> {
  await query(`ALTER TABLE IF EXISTS "userPublic" RENAME TO "userProfileCache"`);
  await query(`ALTER INDEX IF EXISTS "idx_userPublic_data" RENAME TO "idx_userProfileCache_data"`);
  // Belt-and-suspenders for a fresh DB where the rename was a no-op.
  await query(`CREATE TABLE IF NOT EXISTS "userProfileCache" (
    _id      TEXT PRIMARY KEY,
    data     JSONB NOT NULL,
    created  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated  TIMESTAMPTZ NOT NULL DEFAULT now(),
    version  INTEGER NOT NULL DEFAULT 1
  )`);
  await query(
    `CREATE INDEX IF NOT EXISTS "idx_userProfileCache_data" ON "userProfileCache" USING GIN (data)`,
  );
  // The getter-backed `userPublic` has no table; drop a leftover schema snapshot
  // so checkSchemas doesn't try to recreate it.
  await query(`DELETE FROM _schema_snapshots WHERE collection = 'userPublic'`).catch(() => undefined);
}
