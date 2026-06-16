import type { query as pgQuery } from 'ugly-app/server';

// Perf: conversationListMine filters userConversation by `data->>'userPrivateId'`,
// but the only indexes were the _id pkey and a GIN-on-data (which does NOT serve
// `->>` text equality). On a 94k-row table that meant a full sequential scan on
// every sidebar load (~10s cold). Add a btree expression index on userPrivateId
// so the lookup is an index scan over just the user's rows.

export async function up(query: typeof pgQuery): Promise<void> {
  await query(
    `CREATE INDEX IF NOT EXISTS "idx_userConversation_userPrivateId" ON "userConversation" ((data->>'userPrivateId'))`,
  );
}
