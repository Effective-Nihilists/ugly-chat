import { beforeEach, describe, expect, it } from "vitest";
import {
  makeBetterSqliteExec,
  runD1Migrations,
  type SqliteExec,
} from "ugly-app/server";
import { repairIdOnlyFields } from "../../../server/migrations-d1/001_repair_id_only_fields";
import { dropNullOptionalFields } from "../../../server/migrations-d1/002_drop_null_optional_fields";
import { d1Migrations } from "../../../server/migrations-d1";
import { ConversationUserSchema } from "../../../shared/collections";

let exec: SqliteExec;

/** The three tables the migration touches, in the D1 doc-store shape. */
async function createTables(e: SqliteExec): Promise<void> {
  for (const t of ["conversationUser", "userConversation", "messageReaction"]) {
    await e.run(
      `CREATE TABLE "${t}" (
        _id TEXT PRIMARY KEY, data TEXT NOT NULL,
        created INTEGER NOT NULL, updated INTEGER NOT NULL, version INTEGER NOT NULL
      )`,
    );
  }
}
async function insert(
  table: string,
  _id: string,
  data: Record<string, unknown>,
  ts = 1719632647756,
): Promise<void> {
  await exec.run(
    `INSERT INTO "${table}" (_id, data, created, updated, version) VALUES (?, ?, ?, ?, 1)`,
    [_id, JSON.stringify(data), ts, ts],
  );
}
async function dataOf(
  table: string,
  id: string,
): Promise<Record<string, unknown>> {
  const rows = await exec.all<{ data: string }>(
    `SELECT data FROM "${table}" WHERE _id = ?`,
    [id],
  );
  return JSON.parse(rows[0]!.data) as Record<string, unknown>;
}

beforeEach(async () => {
  exec = await makeBetterSqliteExec(":memory:");
  await createTables(exec);
});

describe("001_repair_id_only_fields", () => {
  // Verbatim shapes pulled from ugly-chat prod before writing the migration.
  it("restores conversationId + userId on an imported conversationUser row", async () => {
    await insert(
      "conversationUser",
      "-HzZ6MdQ6EHWU16JS97AM:2lhIP1Yy-PjC4p-xfTAFy",
      {
        role: "owner",
        image: null,
        _created_num: 1719632647756,
        messageStyle: null,
      },
    );
    await repairIdOnlyFields.up(exec);
    const d = await dataOf(
      "conversationUser",
      "-HzZ6MdQ6EHWU16JS97AM:2lhIP1Yy-PjC4p-xfTAFy",
    );
    expect(d.conversationId).toBe("-HzZ6MdQ6EHWU16JS97AM");
    expect(d.userId).toBe("2lhIP1Yy-PjC4p-xfTAFy");
    // Existing fields survive untouched.
    expect(d.role).toBe("owner");
    expect(d._created_num).toBe(1719632647756);
  });

  // userConversation reverses the halves AND its conversationId contains '+'
  // (DM ids are `<a>+<b>`), so a naive "split on every separator" is wrong.
  it("restores userConversation with reversed halves and a + in the conversationId", async () => {
    const id =
      "05lERi2ZvMV8DX9hj0NoJJCUFi42:oJQGgZRdGYQe5kOIfKYiq+05lERi2ZvMV8DX9hj0NoJJCUFi42";
    await insert("userConversation", id, {
      id: "oJQGgZRdGYQe5kOIfKYiq+05lERi2ZvMV8DX9hj0NoJJCUFi42",
      type: "bot",
      hidden: false,
    });
    await repairIdOnlyFields.up(exec);
    const d = await dataOf("userConversation", id);
    expect(d.userPrivateId).toBe("05lERi2ZvMV8DX9hj0NoJJCUFi42");
    expect(d.conversationId).toBe(
      "oJQGgZRdGYQe5kOIfKYiq+05lERi2ZvMV8DX9hj0NoJJCUFi42",
    );
    // Matches the legacy `id` the row already carried — the cross-check that
    // held for 562/562 prod rows.
    expect(d.conversationId).toBe(d.id);
  });

  it("restores userId on a messageReaction row", async () => {
    await insert(
      "messageReaction",
      "4mfAQvUE6RY_E0PVHOJSj:1AOVA8bnlsNzzHElpC8Fc8GbNca2",
      {
        reaction: "thumbsUp",
        messageId: "4mfAQvUE6RY_E0PVHOJSj",
      },
    );
    await repairIdOnlyFields.up(exec);
    const d = await dataOf(
      "messageReaction",
      "4mfAQvUE6RY_E0PVHOJSj:1AOVA8bnlsNzzHElpC8Fc8GbNca2",
    );
    expect(d.userId).toBe("1AOVA8bnlsNzzHElpC8Fc8GbNca2");
    expect(d.messageId).toBe("4mfAQvUE6RY_E0PVHOJSj");
    // conversationId is deliberately left alone — see the migration's docs.
    expect(d.conversationId).toBeUndefined();
  });

  it("leaves already-correct rows completely alone", async () => {
    await insert("conversationUser", "convX:userY", {
      conversationId: "convX",
      userId: "userY",
      role: "member",
    });
    await repairIdOnlyFields.up(exec);
    expect(await dataOf("conversationUser", "convX:userY")).toEqual({
      conversationId: "convX",
      userId: "userY",
      role: "member",
    });
  });

  // D1 cannot roll a failed migration back, so re-running must converge.
  it("is idempotent", async () => {
    await insert("conversationUser", "c1:u1", { role: "owner" });
    await repairIdOnlyFields.up(exec);
    const first = await dataOf("conversationUser", "c1:u1");
    await repairIdOnlyFields.up(exec);
    expect(await dataOf("conversationUser", "c1:u1")).toEqual(first);
  });

  it("never touches created/updated", async () => {
    await insert("conversationUser", "c1:u1", { role: "owner" }, 1719632647756);
    await repairIdOnlyFields.up(exec);
    const rows = await exec.all<{ created: number; updated: number }>(
      'SELECT created, updated FROM "conversationUser" WHERE _id = ?',
      ["c1:u1"],
    );
    expect(rows[0]).toEqual({ created: 1719632647756, updated: 1719632647756 });
  });

  it("skips a row with no colon rather than corrupting it", async () => {
    await insert("conversationUser", "nocolon", { role: "owner" });
    await repairIdOnlyFields.up(exec);
    expect(await dataOf("conversationUser", "nocolon")).toEqual({
      role: "owner",
    });
  });

  it("runs (once) through the framework runner and records itself", async () => {
    await insert("conversationUser", "c1:u1", { role: "owner" });
    const first = await runD1Migrations(exec, d1Migrations);
    expect(first.applied).toEqual([
      "001_repair_id_only_fields",
      "002_drop_null_optional_fields",
    ]);
    const second = await runD1Migrations(exec, d1Migrations);
    expect(second.applied).toEqual([]);
    expect(second.skipped).toEqual([
      "001_repair_id_only_fields",
      "002_drop_null_optional_fields",
    ]);
    expect((await dataOf("conversationUser", "c1:u1")).userId).toBe("u1");
  });
});

/**
 * Production evidence (ugly-chat, every build): reading a `conversationUser`
 * whose blob holds `isBot: null` throws
 *
 *   [schema-drift] db.read:conversationUser: isBot: Invalid input:
 *     expected boolean, received null
 *
 * because zod's `.optional()` accepts `undefined`, not `null`. The rows are the
 * monolith import's (the same blobs that carry `image: null`). A throw on that
 * read takes the whole membership path with it, so the null has to go.
 */
describe("002_drop_null_optional_fields", () => {
  it("removes a null isBot without touching the row's real values", async () => {
    await insert("conversationUser", "c1:u1", {
      conversationId: "c1",
      userId: "u1",
      isBot: null,
      role: "owner",
      image: null,
    });
    await dropNullOptionalFields.up(exec);
    expect(await dataOf("conversationUser", "c1:u1")).toEqual({
      conversationId: "c1",
      userId: "u1",
      role: "owner",
      // Untouched: `image` is not in the schema's field list, and `.catchall`
      // already accepts a null there.
      image: null,
    });
  });

  it("removes a null role and a null params too", async () => {
    await insert("conversationUser", "c1:u2", {
      conversationId: "c1",
      userId: "u2",
      role: null,
      params: null,
    });
    await dropNullOptionalFields.up(exec);
    expect(await dataOf("conversationUser", "c1:u2")).toEqual({
      conversationId: "c1",
      userId: "u2",
    });
  });

  it("leaves a real false/empty value alone — false is not null", async () => {
    await insert("conversationUser", "c1:u3", {
      conversationId: "c1",
      userId: "u3",
      isBot: false,
      role: "",
      params: {},
    });
    await dropNullOptionalFields.up(exec);
    expect(await dataOf("conversationUser", "c1:u3")).toEqual({
      conversationId: "c1",
      userId: "u3",
      isBot: false,
      role: "",
      params: {},
    });
  });

  it("is idempotent, and leaves created/updated where they were", async () => {
    await insert(
      "conversationUser",
      "c1:u4",
      { conversationId: "c1", userId: "u4", isBot: null },
      1719632647756,
    );
    await dropNullOptionalFields.up(exec);
    await dropNullOptionalFields.up(exec);
    expect(await dataOf("conversationUser", "c1:u4")).toEqual({
      conversationId: "c1",
      userId: "u4",
    });
    const rows = await exec.all<{ created: number; updated: number }>(
      'SELECT created, updated FROM "conversationUser" WHERE _id = ?',
      ["c1:u4"],
    );
    expect(rows[0]).toEqual({ created: 1719632647756, updated: 1719632647756 });
  });

  it("leaves a row that a read already accepts exactly as it was", async () => {
    await insert("conversationUser", "c1:u5", {
      conversationId: "c1",
      userId: "u5",
      isBot: true,
    });
    await dropNullOptionalFields.up(exec);
    expect(await dataOf("conversationUser", "c1:u5")).toEqual({
      conversationId: "c1",
      userId: "u5",
      isBot: true,
    });
  });
});

/** The repaired shape must be what the schema actually accepts. */
describe("ConversationUserSchema vs the rows in the table", () => {
  it("accepts the repaired row, and no longer throws on a null", () => {
    expect(
      ConversationUserSchema.safeParse({ conversationId: "c1", userId: "u1" })
        .success,
    ).toBe(true);
    // Tolerated rather than fatal: a null that re-appears must not take the
    // request down again.
    expect(
      ConversationUserSchema.safeParse({
        conversationId: "c1",
        userId: "u1",
        isBot: null,
      }).success,
    ).toBe(true);
  });
});
