import type { query as pgQuery } from 'ugly-app/server';

// Message full-text search is now DECLARATIVE: the `message` collection declares
// `meta.search: { fields: ['text', 'markdown'] }`, so the framework maintains a
// generated `search` tsvector column (+ GIN) automatically — no trigger needed.
//
// This migration (which previously added a non-generated column + BEFORE
// INSERT/UPDATE trigger) is now a no-op: fresh databases get the generated
// column from the framework's lazy-ensure, and the existing prod database was
// converted in place (trigger dropped, column → generated). Kept as a no-op to
// preserve migration numbering/tracking.
export async function up(_query: typeof pgQuery): Promise<void> {
  // intentionally empty — see meta.search on the `message` collection.
}
