import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from 'ugly-app/client';

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
export function useConversations(): { conversations: ConvRow[]; loading: boolean; refetch: () => void } {
  const { socket, userId } = useApp();
  const [conversations, setConversations] = useState<ConvRow[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(() => {
    void socket
      .request('conversationListMine', {})
      .then((res) => {
        setConversations((res as { conversations?: ConvRow[] }).conversations ?? []);
        setLoading(false);
      })
      .catch((err: unknown) => {
        console.error('[conversations] list failed', err);
        setLoading(false);
      });
  }, [socket]);

  useEffect(() => {
    refetch();
    const unsub = socket.trackDocs('conversationUser', { keys: { userId } }, () => refetch());
    const onActivity = (): void => refetch();
    window.addEventListener('uglychat:activity', onActivity);
    return () => {
      unsub?.();
      window.removeEventListener('uglychat:activity', onActivity);
    };
  }, [socket, userId, refetch]);

  return { conversations, loading, refetch };
}

/** Notify the conversation list that activity happened (new message / read). */
export function pingConversationActivity(): void {
  window.dispatchEvent(new Event('uglychat:activity'));
}

export function resolveImageUrl(image: unknown): string | null {
  if (!image) return null;
  if (typeof image === 'string') return image;
  if (typeof image === 'object') {
    const o = image as Record<string, unknown>;
    const uri = (o['uri'] ?? o['url'] ?? o['src']) as string | undefined;
    return typeof uri === 'string' ? uri : null;
  }
  return null;
}

// Avatars are neutral gray (brand: no rainbow, no orange bot badge). Identity
// comes from the initial + the name beside it, not color.
export function avatarColor(_seed: string): string {
  return 'var(--app-tertiary)';
}
function initial(s: string): string {
  const t = s.trim();
  return t ? t.charAt(0).toUpperCase() : '#';
}

/**
 * Square avatar — the real image when there is one, otherwise a colored
 * initial derived from the label/seed. (We used to fall back to a single
 * hardcoded blob.ugly.bot image, which showed a random stranger's face for
 * every avatar-less user — e.g. the DM couple chat header and sidebar.)
 */
export function Avatar(props: { image?: unknown; seed: string; label?: string; size?: number }): React.ReactElement {
  const size = props.size ?? 42;
  const url = resolveImageUrl(props.image);
  if (url) {
    return (
      <img
        src={url}
        width={size}
        height={size}
        alt=""
        style={{ width: size, height: size, borderRadius: 0, border: '1px solid var(--app-border)', objectFit: 'cover', flexShrink: 0, display: 'block' }}
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
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: avatarColor(props.seed),
        color: 'var(--app-foreground-muted)',
        border: '1px solid var(--app-border)',
        fontSize: Math.round(size * 0.45),
        fontWeight: 600,
        lineHeight: 1,
        userSelect: 'none',
      }}
    >
      {initial(props.label || props.seed)}
    </div>
  );
}

