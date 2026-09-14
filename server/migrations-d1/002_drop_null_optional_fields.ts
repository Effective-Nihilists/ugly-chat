import type { D1Migration, SqliteExec } from "ugly-app/server";

/**
 * Drop JSON `null`s from `conversationUser`'s optional fields.
 *
 * # The defect
 *
 * Prod logged, once per build:
 *
 *   ERROR [server] [schema-drift] db.read:conversationUser:
 *     isBot: Invalid input: expected boolean, received null
 *
 * `ConversationUserSchema` declares `isBot`/`role`/`params` as `.optional()`,
 * which in zod accepts `undefined` and rejects `null`. The rows written by the
 * monolith import store an explicit `null` for fields the monolith had no value
 * for — the same blobs that carry `image: null` (see
 * `001_repair_id_only_fields`). So `db.getDoc(conversationUser, …)` THROWS on
 * those rows, and it throws on the read every membership path starts with:
 * `conversationDelete`'s ownership check, `conversationMembers`, the readers
 * list, `conversationPinMessage`. For a member whose row carries the null, the
 * conversation is not "slow" — it errors.
 *
 * # The fix, in two halves
 *
 *   1. The schema now tolerates `null` (a value that re-appears must not take
 *      the request down again). Readers already treat null and undefined alike.
 *   2. This migration removes the nulls that are in the table, so the rows
 *      round-trip as the shape the schema always described.
 *
 * `json_remove` is a no-op when the path is absent, and the guard only matches a
 * JSON null (`json_type` returns NULL for a missing path and `'null'` for a null
 * value), so re-running changes nothing — which `D1Migration.up` requires, as D1
 * has no interactive transactions to roll a partial run back with.
 *
 * `created`/`updated` are deliberately untouched: deleting a null that was never
 * a value is a shape repair, not a semantic edit, and bumping `updated` would
 * churn every client's sync cursor.
 */
const NULLABLE_OPTIONAL_FIELDS = ["isBot", "role", "params"] as const;

export const dropNullOptionalFields: D1Migration = {
  name: "002_drop_null_optional_fields",
  async up(exec: SqliteExec): Promise<void> {
    for (const field of NULLABLE_OPTIONAL_FIELDS) {
      await exec.run(
        `UPDATE "conversationUser"
            SET data = json_remove(data, '$.${field}')
          WHERE json_type(data, '$.${field}') = 'null'`,
      );
    }
  },
};
