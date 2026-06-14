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

const AVATAR_COLORS = ['#ff5500', '#e0457a', '#7209b7', '#005bea', '#00897b', '#f4511e', '#3949ab', '#00acc1'];
export function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length] ?? '#ff5500';
}
function initial(s: string): string {
  const t = s.trim();
  return t ? t.charAt(0).toUpperCase() : '#';
}

// ugly.bot's UserAvatar falls back to `defaultAvatar.image` (a generic rendered
// avatar) for any null image — groups without an image, users without an
// avatar — never a colored initial. Match that so the sidebar looks the same.
const DEFAULT_AVATAR_URL =
  'https://blob.ugly.bot/debug/user/ZHK_QVWdFU6rd_-w_EZzf/ZrqxZIhgWqDA4q5awdGkj.webp';

/** Circular avatar — resolves to the image, then ugly.bot's default avatar. */
export function Avatar(props: { image?: unknown; seed: string; label?: string; size?: number }): React.ReactElement {
  const size = props.size ?? 42;
  const url = resolveImageUrl(props.image) ?? DEFAULT_AVATAR_URL;
  return (
    <img
      src={url}
      width={size}
      height={size}
      alt=""
      style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, display: 'block' }}
    />
  );
}

