import { describe, expect, it, vi } from "vitest";
import {
  appMessageCreate,
  classifyTransientD1Error,
  isValidClientMessageId,
  MESSAGE_CREATE_ATTEMPTS,
  type AppMessageCreateDeps,
} from "../../server/appMessageCreate";

/**
 * Production evidence (ugly-chat build 1792688750567, 2026-11-03 08:01:22 UTC):
 *
 *   D1_ERROR: D1 DB is overloaded. Requests queued for too long.
 *
 * logged bare (no app / conversation / caller), and in the same second
 * ugly-love's hourly cron logged
 *
 *   [love] challenge card post failed [chatHub] /app/message/create 500
 *
 * The route must ride out a short D1 burst, never post the same message twice
 * across retries (ours or the caller's), and log a surviving failure with
 * context and a retryable status.
 */
const OVERLOAD = new Error(
  "D1_ERROR: D1 DB is overloaded. Requests queued for too long.",
);

function harness(opts: {
  createFailures?: Error[];
  stored?: Map<string, Record<string, unknown>>;
  commitBeforeFailing?: boolean;
}) {
  const stored = opts.stored ?? new Map<string, Record<string, unknown>>();
  const failures = [...(opts.createFailures ?? [])];
  const sleeps: number[] = [];
  const logs: { msg: string; ctx: Record<string, unknown> }[] = [];
  const createMessage = vi.fn(
    async (
      input: { conversationId: string; message: Record<string, unknown> },
      _asUserId: string,
    ) => {
      const doc = {
        ...input.message,
        _id: `${input.conversationId}:${String(input.message.id)}`,
      };
      const failure = failures.shift();
      if (failure) {
        // "maybe-run": the write landed, then the connection died.
        if (opts.commitBeforeFailing) stored.set(doc._id, doc);
        throw failure;
      }
      stored.set(doc._id, doc);
      return doc;
    },
  );
  const deps: AppMessageCreateDeps = {
    getConversation: async (id) =>
      id === "c1" ? { _id: "c1", appId: "love" } : null,
    canAccess: async (conv) => conv.appId === "love",
    getMessage: async (docId) => stored.get(docId) ?? null,
    createMessage,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    random: () => 0,
    log: (msg, ctx) => logs.push({ msg, ctx }),
  };
  return { deps, stored, createMessage, sleeps, logs };
}

const input = (message: Record<string, unknown> = {}) => ({
  appId: "love",
  conversationId: "c1",
  asUserId: "bot-love-coach",
  message: { markdown: "Daily Challenge", ...message },
});

describe("classifyTransientD1Error", () => {
  it("treats the prod overload as not-run", () => {
    expect(classifyTransientD1Error(OVERLOAD)).toBe("not-run");
    expect(
      classifyTransientD1Error(new Error("Requests queued for too long")),
    ).toBe("not-run");
  });
  it("treats a dropped connection as maybe-run", () => {
    expect(
      classifyTransientD1Error(new Error("D1_ERROR: Network connection lost.")),
    ).toBe("maybe-run");
  });
  it("leaves SQL errors alone", () => {
    expect(
      classifyTransientD1Error(new Error("D1_ERROR: UNIQUE constraint failed")),
    ).toBeNull();
  });
});

describe("appMessageCreate", () => {
  it("creates the message under the caller's id", async () => {
    const h = harness({});
    const r = await appMessageCreate(
      input({ id: "challenge-a:b+daily+2026-11-03" }),
      h.deps,
    );
    expect(r.kind).toBe("created");
    expect([...h.stored.keys()]).toEqual(["c1:challenge-a:b+daily+2026-11-03"]);
  });

  it("rides out a D1 overload burst with backoff and posts once", async () => {
    const h = harness({ createFailures: [OVERLOAD, OVERLOAD] });
    const r = await appMessageCreate(input({ id: "m1" }), h.deps);
    expect(r.kind).toBe("created");
    expect(h.createMessage).toHaveBeenCalledTimes(MESSAGE_CREATE_ATTEMPTS);
    expect(h.sleeps).toEqual([750, 1500]);
    expect(h.stored.size).toBe(1);
    expect(h.logs).toEqual([]);
  });

  it("does not duplicate when a maybe-run failure actually committed", async () => {
    const h = harness({
      createFailures: [new Error("D1_ERROR: Network connection lost.")],
      commitBeforeFailing: true,
    });
    const r = await appMessageCreate(input(), h.deps); // no client id
    expect(r.kind).toBe("existing");
    expect(h.createMessage).toHaveBeenCalledTimes(1);
    expect(h.stored.size).toBe(1);
  });

  it("returns the stored message when a caller retries the same id", async () => {
    const h = harness({});
    await appMessageCreate(input({ id: "m1" }), h.deps);
    const again = await appMessageCreate(input({ id: "m1" }), h.deps);
    expect(again.kind).toBe("existing");
    expect(h.createMessage).toHaveBeenCalledTimes(1);
    expect(h.stored.size).toBe(1);
  });

  it("gives up with a retryable 'unavailable' and logs context, not a bare D1 line", async () => {
    const h = harness({ createFailures: Array(9).fill(OVERLOAD) as Error[] });
    const r = await appMessageCreate(input({ id: "m1" }), h.deps);
    expect(r.kind).toBe("unavailable");
    expect(h.createMessage).toHaveBeenCalledTimes(MESSAGE_CREATE_ATTEMPTS);
    expect(h.logs).toHaveLength(1);
    expect(h.logs[0]!.msg).toBe("[appApi] /app/message/create failed");
    expect(h.logs[0]!.ctx).toMatchObject({
      appId: "love",
      conversationId: "c1",
      asUserId: "bot-love-coach",
      messageId: "m1",
      attempt: MESSAGE_CREATE_ATTEMPTS,
      d1Transient: "not-run",
      error: OVERLOAD.message,
    });
  });

  it("does not retry a non-transient error, but still logs it with context", async () => {
    const boom = new Error("D1_ERROR: no such column: foo");
    const h = harness({ createFailures: [boom] });
    await expect(appMessageCreate(input({ id: "m1" }), h.deps)).rejects.toBe(
      boom,
    );
    expect(h.createMessage).toHaveBeenCalledTimes(1);
    expect(h.logs[0]!.ctx).toMatchObject({
      conversationId: "c1",
      d1Transient: null,
    });
  });

  it("rejects a malformed client id and maps missing/forbidden conversations", async () => {
    const h = harness({});
    expect(
      (await appMessageCreate(input({ id: "has space" }), h.deps)).kind,
    ).toBe("badRequest");
    expect(
      (await appMessageCreate({ ...input(), conversationId: "nope" }, h.deps))
        .kind,
    ).toBe("notFound");
    expect(
      (
        await appMessageCreate(
          { ...input(), appId: "other" },
          {
            ...h.deps,
            canAccess: async () => false,
          },
        )
      ).kind,
    ).toBe("forbidden");
  });

  it("accepts the ids love mints", () => {
    expect(isValidClientMessageId("challenge-a:b+daily+2026-11-03")).toBe(true);
    expect(isValidClientMessageId("V1StGXR8_Z5jdHi6B-myT")).toBe(true);
    expect(isValidClientMessageId("a/b")).toBe(false);
    expect(isValidClientMessageId("")).toBe(false);
  });
});
