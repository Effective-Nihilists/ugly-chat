/**
 * Core of `POST /app/message/create` (cross-app message post), split out of
 * appApi.ts so the retry + idempotency contract is unit-testable.
 *
 * Prod 2026-11-03 08:01:22 UTC (build 1792688750567): at the top of the hour
 * D1 rejected a write with `D1_ERROR: D1 DB is overloaded. Requests queued for
 * too long.` The framework's per-statement retry (ugly-app's wrapD1WithRetry,
 * ~1 s of backoff) was not enough to ride out the burst, the route threw, and
 * the only trace was that bare line, with no app, conversation or caller. In
 * the same second ugly-love's hourly cron logged `challenge card post failed
 * ... /app/message/create 500`.
 *
 * Three things here:
 *  1. Idempotency. Every post gets a message id BEFORE any D1 work: the
 *     caller's `message.id` when it supplies one, else a fresh nanoid. The
 *     engine stores the message at `<conversationId>:<id>` (an upsert), and
 *     every attempt first checks that key, so neither our own retry nor a
 *     caller's retry of a 5xx that actually committed can post twice.
 *  2. A request-level bounded retry on transient D1 failures, with seconds of
 *     backoff (the burst outlasts the statement-level retry). Because of (1),
 *     the whole operation is safe to repeat, so both the "not run" class
 *     (overloaded / queued too long / starting up) and the "maybe run" class
 *     (connection lost / object reset) are retried.
 *  3. Context. A failure that survives the retry is logged with app,
 *     conversation, author, message id, attempt count and D1 class, and a
 *     transient one returns 503 + Retry-After so the caller retries with the
 *     same id instead of seeing an opaque 500.
 *
 * ugly-app has `withD1Retry` / `classifyTransientD1Error` in
 * src/server/adapter/workers/d1Retry.ts, but (as of 0.1.1084) does not export
 * them from any package entry point, so the classifier below mirrors its
 * pattern list.
 */
import { nanoid } from "nanoid";

export type TransientD1Kind = "not-run" | "maybe-run";

// Mirrors ugly-app d1Retry.ts NOT_RUN_PATTERNS / MAYBE_RUN_PATTERNS.
const NOT_RUN_PATTERNS = [
  /\boverloaded\b/i,
  /queued for too long/i,
  /internal error while starting up d1/i,
  /cannot resolve d1 db due to transient issue/i,
];
const MAYBE_RUN_PATTERNS = [
  /network connection lost/i,
  /caused object to be reset/i,
  /reset because its code was updated/i,
  /\binternal error\b/i,
];

function errorText(err: unknown): string {
  if (err instanceof Error) {
    const cause: unknown = err.cause;
    return [
      err.message,
      cause instanceof Error
        ? cause.message
        : typeof cause === "string"
          ? cause
          : "",
    ].join(" ");
  }
  if (typeof err === "string") return err;
  return "";
}

export function classifyTransientD1Error(err: unknown): TransientD1Kind | null {
  const text = errorText(err);
  if (!text) return null;
  if (NOT_RUN_PATTERNS.some((re) => re.test(text))) return "not-run";
  if (MAYBE_RUN_PATTERNS.some((re) => re.test(text))) return "maybe-run";
  return null;
}

/** Client-supplied message ids: what love and other apps mint (nanoids,
 *  `challenge-<couple>+daily+<date>`). No whitespace, slashes or quotes. */
const CLIENT_MESSAGE_ID = /^[A-Za-z0-9_\-+:.]{1,200}$/;

export function isValidClientMessageId(id: unknown): id is string {
  return typeof id === "string" && CLIENT_MESSAGE_ID.test(id);
}

/** 3 attempts, 750 ms then 1.5 s (+ up to 25 % jitter): long enough to clear a
 *  top-of-hour D1 queue, short enough to answer inside a caller's 15 s timeout. */
export const MESSAGE_CREATE_ATTEMPTS = 3;
export const MESSAGE_CREATE_BASE_MS = 750;

export interface AppMessageCreateDeps {
  getConversation: (id: string) => Promise<Record<string, unknown> | null>;
  canAccess: (conv: Record<string, unknown>) => Promise<boolean>;
  getMessage: (docId: string) => Promise<Record<string, unknown> | null>;
  createMessage: (
    input: { conversationId: string; message: Record<string, unknown> },
    asUserId: string,
  ) => Promise<unknown>;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  log?: (msg: string, ctx: Record<string, unknown>) => void;
}

export interface AppMessageCreateInput {
  appId: string;
  conversationId: string;
  asUserId: string;
  message: Record<string, unknown>;
}

export type AppMessageCreateResult =
  | { kind: "created"; message: unknown }
  | { kind: "existing"; message: unknown }
  | { kind: "notFound" }
  | { kind: "forbidden" }
  | { kind: "badRequest"; error: string }
  | { kind: "unavailable"; error: string; retryAfterSec: number };

export async function appMessageCreate(
  input: AppMessageCreateInput,
  deps: AppMessageCreateDeps,
): Promise<AppMessageCreateResult> {
  const sleep =
    deps.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const random = deps.random ?? Math.random;
  const log =
    deps.log ??
    ((msg: string, ctx: Record<string, unknown>) => {
      console.error(msg, ctx);
    });

  const { appId, conversationId, asUserId } = input;
  const suppliedId = input.message.id;
  if (suppliedId !== undefined && !isValidClientMessageId(suppliedId)) {
    return {
      kind: "badRequest",
      error: "message.id must be 1-200 chars of [A-Za-z0-9_-+:.]",
    };
  }
  const messageId = suppliedId ?? nanoid();
  const docId = `${conversationId}:${messageId}`;

  const attempt = async (): Promise<AppMessageCreateResult> => {
    const conv = await deps.getConversation(conversationId);
    if (!conv) return { kind: "notFound" };
    if (!(await deps.canAccess(conv))) return { kind: "forbidden" };
    const existing = await deps.getMessage(docId);
    if (existing) return { kind: "existing", message: existing };
    const message = await deps.createMessage(
      { conversationId, message: { ...input.message, id: messageId } },
      asUserId,
    );
    return { kind: "created", message };
  };

  for (let i = 1; ; i++) {
    try {
      return await attempt();
    } catch (err) {
      const d1 = classifyTransientD1Error(err);
      const ctx = {
        appId,
        conversationId,
        asUserId,
        messageId,
        clientSuppliedId: suppliedId !== undefined,
        attempt: i,
        maxAttempts: MESSAGE_CREATE_ATTEMPTS,
        d1Transient: d1,
        error: err instanceof Error ? err.message : String(err),
      };
      if (d1 && i < MESSAGE_CREATE_ATTEMPTS) {
        const base = MESSAGE_CREATE_BASE_MS * 2 ** (i - 1);
        await sleep(Math.round(base * (1 + 0.25 * random())));
        continue;
      }
      log("[appApi] /app/message/create failed", ctx);
      if (d1) {
        return {
          kind: "unavailable",
          error: "chat storage overloaded, retry with the same message.id",
          retryAfterSec: 2,
        };
      }
      throw err;
    }
  }
}
