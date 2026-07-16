import type { query as pgQuery } from 'ugly-app/server';

// Schema migration: create collection "bot"

export async function up(query: typeof pgQuery): Promise<void> {
  await query(`CREATE TABLE IF NOT EXISTS "bot" (
    _id      TEXT PRIMARY KEY,
    data     JSONB NOT NULL,
    created  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated  TIMESTAMPTZ NOT NULL DEFAULT now(),
    version  INTEGER NOT NULL DEFAULT 1
  )`);
  await query(`CREATE INDEX IF NOT EXISTS "idx_bot_data" ON "bot" USING GIN (data)`);
  await query(`CREATE INDEX IF NOT EXISTS "idx_bot_ownerId" ON "bot" ((data->>'ownerId'))`);
}
