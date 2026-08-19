import type { D1Migration, SqliteExec } from "ugly-app/server";

/**
 * Restore filter keys that were only ever stored inside `_id`.
 *
 * # The defect
 *
 * A row's `_id` is a primary key, nothing more. Every read path except
 * `getDoc(id)` — `getDocs(filter)`, `trackDocs`, cascades — compiles down to
 * `json_extract(data,'$.field')` (ugly-app `src/server/sqlite/SqliteFilter.ts`),
 * so a field that lives only in the key is invisible to all of them. A row like
 *
 *   _id  = "<conversationId>:<userId>"
 *   data = {"role":"owner", ...}          ← no conversationId, no userId
 *
 * still resolves by key, so membership CHECKS pass — while
 * `getDocs({conversationId})` returns nothing, so the member ROSTER reads empty.
 * `conversationUserGetOwners` and `conversationUserGetChargeUserIds` are both
 * built on that query.
 *
 * Measured in prod before this migration was written:
 *   conversationUser  1,120 / 2,882 rows missing both ids  (39%)
 *   userConversation    985 / 2,846 rows missing both      (35%)
 *   messageReaction         7 / 7 rows missing userId     (100%)
 *   → 839 of 1,719 conversations (49%) had an empty roster.
 *
 * Two causes, one symptom:
 *
 *   1. The monolith import copied each `data` blob across verbatim. The monolith
 *      derived these ids from the key and never stored them in the body, so the
 *      imported blobs have neither. Every affected row is dated 2024-06-29 →
 *      2024-11-15; nothing written since has the defect.
 *   2. `conversationMessageReact` set `_id: `${messageId}:${userId}`` and never
 *      wrote `userId` into the body — so every messageReaction row ever written
 *      was invalid against `MessageReactionSchema`, which requires it. The writer
 *      is fixed in ugly-app; this repairs the rows it already wrote.
 *
 * # Safety
 *
 * Idempotent, as `D1Migration.up` requires: every statement is guarded on the
 * field still being NULL, so a re-run (or a retry after a partial failure — D1
 * has no interactive transactions) changes nothing.
 *
 * Verified against prod before writing:
 *   - all 1,120 conversationUser rows have EXACTLY one ':' in `_id`
 *   - all 985 userConversation rows have exactly one ':'; of the 562 that also
 *     carry a legacy `data.id`, the derived conversationId equals it in 562/562
 *     cases — zero conflicts. The other 423 have no `id` field to check against.
 *   - all 7 messageReaction rows have exactly one ':'
 *
 * `created`/`updated` are deliberately untouched: this restores the shape the
 * row should always have had, it is not a semantic edit, and bumping `updated`
 * would churn every client's sync cursor for 2,112 rows.
 *
 * # Deliberately NOT repaired
 *
 * `messageReaction.conversationId`. It is optional in the schema (so it raises
 * no drift) and cannot be derived reliably: `message._id` has three historical
 * shapes in this database (0, 1 and 2 colons) and the join back to a message
 * resolves for only 1 of the 7 rows. The fixed writer populates it going forward.
 */
export const repairIdOnlyFields: D1Migration = {
  name: "001_repair_id_only_fields",
  async up(exec: SqliteExec): Promise<void> {
    // conversationUser._id = "<conversationId>:<userId>"
    await exec.run(
      `UPDATE "conversationUser"
          SET data = json_set(
                data,
                '$.conversationId', substr(_id, 1, instr(_id, ':') - 1),
                '$.userId',         substr(_id, instr(_id, ':') + 1)
              )
        WHERE instr(_id, ':') > 1
          AND (json_extract(data, '$.conversationId') IS NULL
            OR json_extract(data, '$.userId') IS NULL)`,
    );

    // userConversation._id = "<userPrivateId>:<conversationId>" — note the
    // order is REVERSED relative to conversationUser. The conversationId half
    // may itself contain '+' (DM ids are `<a>+<b>`), which is why this splits on
    // the first ':' rather than parsing either side.
    await exec.run(
      `UPDATE "userConversation"
          SET data = json_set(
                data,
                '$.userPrivateId',  substr(_id, 1, instr(_id, ':') - 1),
                '$.conversationId', substr(_id, instr(_id, ':') + 1)
              )
        WHERE instr(_id, ':') > 1
          AND (json_extract(data, '$.userPrivateId') IS NULL
            OR json_extract(data, '$.conversationId') IS NULL)`,
    );

    // messageReaction._id = "<messageId>:<userId>"
    await exec.run(
      `UPDATE "messageReaction"
          SET data = json_set(data, '$.userId', substr(_id, instr(_id, ':') + 1))
        WHERE instr(_id, ':') > 1
          AND json_extract(data, '$.userId') IS NULL`,
    );
  },
};

/** Every D1 migration this app ships, in run order. */
export const d1Migrations: readonly D1Migration[] = [repairIdOnlyFields];
