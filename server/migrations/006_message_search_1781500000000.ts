import type { query as pgQuery } from 'ugly-app/server';

// Full-text search for messages.
//
// The Postgres adapter's pipeline translator throws on Mongo-style `$search`,
// and `setDoc` does NOT maintain a tsvector — so the engine's
// `conversationMessageSearch` can't run on Neon as-is. Instead we add a real
// Postgres FTS column (`search` TSVECTOR + GIN index) and a BEFORE INSERT/UPDATE
// trigger that keeps it in sync from `data->>'text'`/`data->>'markdown'`. The
// trigger covers EVERY write path (engine, bot replies, app API, edits) with no
// app-code changes. `conversationMessageSearch` then queries via `db.searchDocs`
// (→ `pgSearchDocs`, `search @@ plainto_tsquery`).
export async function up(query: typeof pgQuery): Promise<void> {
  await query(`ALTER TABLE "message" ADD COLUMN IF NOT EXISTS search TSVECTOR`);
  await query(
    `CREATE INDEX IF NOT EXISTS "idx_message_search" ON "message" USING GIN (search)`,
  );

  await query(`CREATE OR REPLACE FUNCTION message_search_update() RETURNS trigger AS $$
    BEGIN
      NEW.search := to_tsvector(
        'english',
        coalesce(NEW.data->>'text', '') || ' ' || coalesce(NEW.data->>'markdown', '')
      );
      RETURN NEW;
    END;
  $$ LANGUAGE plpgsql`);

  await query(`DROP TRIGGER IF EXISTS trg_message_search ON "message"`);
  await query(`CREATE TRIGGER trg_message_search
    BEFORE INSERT OR UPDATE ON "message"
    FOR EACH ROW EXECUTE FUNCTION message_search_update()`);

  // Backfill existing rows in batches so no single statement scans the whole
  // (potentially 500k-row) table at once. The trigger handles all new writes.
  for (;;) {
    const res = await query(
      `UPDATE "message" SET search = to_tsvector(
         'english',
         coalesce(data->>'text', '') || ' ' || coalesce(data->>'markdown', '')
       )
       WHERE _id IN (SELECT _id FROM "message" WHERE search IS NULL LIMIT 5000)`,
    );
    if (!res.rowCount) break;
  }
}
