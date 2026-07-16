import type { query as pgQuery } from 'ugly-app/server';

// Schema migration: create collection "message"

export async function up(query: typeof pgQuery): Promise<void> {
  await query(`CREATE TABLE IF NOT EXISTS "message" (
    _id      TEXT PRIMARY KEY,
    data     JSONB NOT NULL,
    created  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated  TIMESTAMPTZ NOT NULL DEFAULT now(),
    version  INTEGER NOT NULL DEFAULT 1
  )`);
  await query(`CREATE INDEX IF NOT EXISTS "idx_message_data" ON "message" USING GIN (data)`);
  await query(`CREATE INDEX IF NOT EXISTS "idx_message_conversationId_created" ON "message" ((data->>'conversationId'), (data->>'created') DESC)`);
  await query(`CREATE INDEX IF NOT EXISTS "idx_message_onlyUserIds_visibility_parentMessageId_threadId" ON "message" ((data->>'onlyUserIds'), (data->>'visibility'), (data->>'parentMessageId'), (data->>'threadId'))`);
}
