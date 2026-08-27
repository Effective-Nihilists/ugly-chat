import React, { useCallback, useEffect, useState } from "react";
import { useApp, crossOriginProps } from "ugly-app/client";

// One row of the sidebar / chat-home conversation list (mirrors the
// `conversationListMine` handler output).
export interface ConvRow {
  conversationId: string;
  title: string;
  image: unknown;
  type: string;
  preview: string;
  unread: number;
  pinned: boolean;
  lastActivity: number;
}

/**
 * Live list of the current user's conversations. Refetches the denormalized
 * list whenever membership changes (trackDocs on `conversationUser` by userId)
 * or the open thread fires a `uglychat:activity` event (new message / read).
 */
export function useConversations(): {
  conversations: ConvRow[];
  loading: boolean;
  refetch: () => void;
} {
  const { socket, userId } = useApp();
  const [conversations, setConversations] = useState<ConvRow[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(() => {
    void socket
      .request("conversationListMine", {})
      .then((res) => {
        setConversations(
          (res as { conversations?: ConvRow[] }).conversations ?? [],
        );
        setLoading(false);
      })
      .catch((err: unknown) => {
        console.error("[conversations] list failed", err);
        setLoading(false);
      });
  }, [socket]);

  useEffect(() => {
    refetch();
    const unsub = socket.trackDocs(
      "conversationUser",
      { keys: { userId } },
      () => {
        refetch();
      },
    );
    const onActivity = (): void => {
      refetch();
    };
    window.addEventListener("uglychat:activity", onActivity);
    return () => {
      unsub();
      window.removeEventListener("uglychat:activity", onActivity);
    };
  }, [socket, userId, refetch]);

  return { conversations, loading, refetch };
}

/** Notify the conversation list that activity happened (new message / read). */
export function pingConversationActivity(): void {
  window.dispatchEvent(new Event("uglychat:activity"));
}

/**
 * Delete a conversation, with an automatic fallback to *leaving* it. `conversationDelete`
 * is owner-only (DM participants are both owners; group members are not), so for a
 * non-owner the server rejects and we remove just the current user via
 * `conversationMemberRemove`. Either way the thread leaves the caller's list — the
 * `conversationUser` trackDocs subscription refetches the sidebar automatically.
 */
export async function deleteOrLeaveConversation(
  socket: {
    request: (name: string, input: Record<string, unknown>) => Promise<unknown>;
  },
  conversationId: string,
  userId: string,
): Promise<void> {
  try {
    await socket.request("conversationDelete", { conversationId });
  } catch (err) {
    // Already gone — the caller's goal is met, so there is nothing to leave.
    if (isAlreadyGone(err)) return;
    // Non-owner → leave instead.
    try {
      await socket.request("conversationMemberRemove", {
        conversationId,
        userId,
      });
    } catch (leaveErr) {
      // `conversationDelete` reads the caller's `conversationUser` row to check
      // ownership, so a conversation that is ALREADY gone fails the ownership
      // check and lands here, where the framework answers `errorDoesNotExist`.
      // Prod reported that to the user as "Ugly Chat could not complete that."
      // (`[browser-action] remove failed errorDoesNotExist`, 2026-08-20 and
      // 2026-08-22). Removing an already-removed chat is a success — deleting
      // from two tabs, or retrying after a dropped socket, must not error.
      if (isAlreadyGone(leaveErr)) return;
      throw leaveErr;
    }
  }
}

/** The framework's `APIError('errorDoesNotExist')`, however it reaches us —
 *  a real Error, a bare string, or a plain `{ message }` off the wire. Only a
 *  string `message` is read: stringifying an arbitrary object yields
 *  "[object Object]", which can never match and would hide the real shape. */
function isAlreadyGone(err: unknown): boolean {
  if (err instanceof Error) return err.message.includes("errorDoesNotExist");
  if (typeof err === "string") return err.includes("errorDoesNotExist");
  const message = (err as { message?: unknown } | null | undefined)?.message;
  return typeof message === "string" && message.includes("errorDoesNotExist");
}

export function resolveImageUrl(image: unknown): string | null {
  if (!image) return null;
  if (typeof image === "string") return image;
  if (typeof image === "object") {
    const o = image as Record<string, unknown>;
    const uri = (o.uri ?? o.url ?? o.src) as string | undefined;
    return typeof uri === "string" ? uri : null;
  }
  return null;
}

// Avatars are neutral gray (brand: no rainbow, no orange bot badge). Identity
// comes from the initial + the name beside it, not color.
export function avatarColor(_seed: string): string {
  return "var(--app-tertiary)";
}
function initial(s: string): string {
  const t = s.trim();
  return t ? t.charAt(0).toUpperCase() : "#";
}

/**
 * Square avatar — the real image when there is one, otherwise a colored
 * initial derived from the label/seed. (We used to fall back to a single
 * hardcoded blob.ugly.bot image, which showed a random stranger's face for
 * every avatar-less user — e.g. the DM couple chat header and sidebar.)
 *
 * A URL that is PRESENT but dead falls back to the same initial plate. One
 * user's avatar blob went missing and every render of it logged
 * `[ugly.ux] image: failed to load "https://blob.ugly.bot/user/…" for "img"`
 * — six days of them across 2026-08-20..26 — while the reader saw a broken
 * image icon. Handling only a MISSING url covered half the ways artwork can be
 * absent; a dangling reference is the other half, and neither should ever
 * render a broken <img>.
 */
export function Avatar(props: {
  image?: unknown;
  seed: string;
  label?: string;
  size?: number;
}): React.ReactElement {
  const size = props.size ?? 42;
  const [failed, setFailed] = React.useState(false);
  const url = resolveImageUrl(props.image);
  React.useEffect(() => {
    setFailed(false);
  }, [url]);
  if (url && !failed) {
    return (
      <img
        {...crossOriginProps(url)}
        src={url}
        width={size}
        height={size}
        alt=""
        onError={() => {
          setFailed(true);
        }}
        style={{
          width: size,
          height: size,
          borderRadius: 0,
          border: "1px solid var(--app-border)",
          objectFit: "cover",
          flexShrink: 0,
          display: "block",
        }}
      />
    );
  }
  return (
    <div
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: 0,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: avatarColor(props.seed),
        color: "var(--app-foreground-muted)",
        border: "1px solid var(--app-border)",
        fontSize: Math.round(size * 0.45),
        fontWeight: 600,
        lineHeight: 1,
        userSelect: "none",
      }}
    >
      {initial(props.label?.length ? props.label : props.seed)}
    </div>
  );
}
