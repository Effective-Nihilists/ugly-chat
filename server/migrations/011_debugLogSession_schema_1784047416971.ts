import type { query as pgQuery } from 'ugly-app/server';

// Schema migration: create collection "debugLogSession"

export async function up(query: typeof pgQuery): Promise<void> {
  await query(`CREATE TABLE IF NOT EXISTS "debugLogSession" (
    _id      TEXT PRIMARY KEY,
    data     JSONB NOT NULL,
    created  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated  TIMESTAMPTZ NOT NULL DEFAULT now(),
    version  INTEGER NOT NULL DEFAULT 1
  )`);
  await query(`CREATE INDEX IF NOT EXISTS "idx_debugLogSession_data" ON "debugLogSession" USING GIN (data)`);
  await query(`CREATE INDEX IF NOT EXISTS "idx_debugLogSession_userId" ON "debugLogSession" ((data->>'userId'))`);
  await query(`CREATE INDEX IF NOT EXISTS "idx_debugLogSession_expiresAt" ON "debugLogSession" ((data->>'expiresAt'))`);
}
