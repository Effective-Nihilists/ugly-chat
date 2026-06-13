import React, { useCallback, useEffect, useRef, useState } from 'react';
import { PageLayout, Text, useApp } from 'ugly-app/client';
import {
  ChatView,
  ChatMarkdownContent,
  ChatMarkdownInput,
} from 'ugly-app/conversation/client';
import type { ChatMessage, ChatUser } from 'ugly-app/conversation/shared';
import type { DBObject } from 'ugly-app/shared';
import { VideoCall } from '../components/VideoCall';

// A single shared demo room so two browsers (or ugly.bot vs ugly.chat) land in
// the same conversation for side-by-side comparison. Real routing comes later.
const ROOM_ID = 'demo-room';

// DB message docs are flattened: `{ _id: "<conversationId>:<messageId>", ... }`.
interface MessageDoc extends DBObject {
  conversationId: string;
  userId: string;
  text?: string | null;
  markdown?: string | null;
  isBot?: boolean;
  deleted?: boolean;
  reactionCount?: Record<string, number>;
  reactionUsers?: Record<string, string[]>;
  parentMessageId?: string | null;
}

// created/updated arrive as number | string | Date over the wire.
const toMs = (v: unknown): number =>
  typeof v === 'number' ? v : v ? new Date(v as string).getTime() : Date.now();

// messageId is the part after the first ':' in the doc _id.
const splitId = (docId: string): { conversationId: string; messageId: string } => {
  const i = docId.indexOf(':');
  return i === -1
    ? { conversationId: ROOM_ID, messageId: docId }
    : { conversationId: docId.slice(0, i), messageId: docId.slice(i + 1) };
};

function toChatMessage(d: MessageDoc): ChatMessage {
  return {
    id: d._id,
    conversationId: d.conversationId,
    userId: d.userId,
    text: d.text ?? null,
    markdown: d.markdown ?? null,
    created: toMs(d.created),
    updated: toMs(d.updated),
    parentMessageId: d.parentMessageId ?? null,
    ...(d.reactionCount ? { reactionCount: d.reactionCount } : {}),
    ...(d.reactionUsers ? { reactionUsers: d.reactionUsers } : {}),
  };
}

export default function ChatPage(): React.ReactElement {
  const { socket, userId } = useApp();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [ready, setReady] = useState(false);
  const usersRef = useRef<Record<string, ChatUser>>({});

  // Ensure the demo room exists, then subscribe to its messages live.
  useEffect(() => {
    let unsub: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      try {
        const existing = await socket.getDoc('conversation', ROOM_ID);
        if (!existing) {
          await socket.request('conversationCreate', {
            id: ROOM_ID,
            type: 'group',
            title: 'ugly.chat demo room',
            mode: 'public',
            ownerIds: [userId],
          });
        }
      } catch (err) {
        console.error('[ChatPage] ensure room failed', err);
      }
      if (cancelled) return;
      unsub = socket.trackDocs<MessageDoc>(
        'message',
        { keys: { conversationId: ROOM_ID }, sort: { created: 1 }, limit: 200 },
        (docs) => {
          const list = (Array.isArray(docs) ? docs : [])
            .filter((d) => !d.deleted)
            .map(toChatMessage)
            .sort((a, b) => a.created - b.created);
          setMessages(list);
        },
      );
      setReady(true);
    })();
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [socket, userId]);

  const getUser = useCallback(
    (id: string): ChatUser => {
      const cached = usersRef.current[id];
      if (cached) return cached;
      const u: ChatUser = { id, name: id === userId ? 'You' : id.slice(0, 8) };
      usersRef.current[id] = u;
      return u;
    },
    [userId],
  );

  const handleSend = useCallback(
    (text: string, parentMessageId?: string | null) => {
      void socket
        .request('conversationMessageCreate', {
          conversationId: ROOM_ID,
          message: {
            markdown: text,
            text,
            ...(parentMessageId ? { parentMessageId } : {}),
          },
        })
        .catch((err: unknown) => console.error('[ChatPage] send failed', err));
    },
    [socket],
  );

  const handleDelete = useCallback(
    (messageId: string) => {
      const { messageId: mid } = splitId(messageId);
      void socket
        .request('conversationMessageDelete', { conversationId: ROOM_ID, messageId: mid })
        .catch((err: unknown) => console.error('[ChatPage] delete failed', err));
    },
    [socket],
  );

  const handleReact = useCallback(
    (messageId: string, reaction: string) => {
      const { messageId: mid } = splitId(messageId);
      void socket
        .request('conversationMessageReact', {
          conversationId: ROOM_ID,
          messageId: mid,
          reaction,
        })
        .catch((err: unknown) => console.error('[ChatPage] react failed', err));
    },
    [socket],
  );

  return (
    <PageLayout header={<Text weight="bold">ugly.chat</Text>}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          border: '1px solid var(--app-border, #ddd)',
          borderRadius: 12,
          overflow: 'hidden',
        }}
      >
        {!ready && (
          <Text size="sm" style={{ padding: 12, opacity: 0.5 }}>
            Connecting…
          </Text>
        )}
        <VideoCall conversationId={ROOM_ID} />
        <ChatView
          messages={messages}
          userId={userId}
          onSend={handleSend}
          onDelete={handleDelete}
          onReact={(id, reaction) => handleReact(id, reaction)}
          getUser={getUser}
          renderContent={(msg, width) => (
            <ChatMarkdownContent markdown={msg.markdown ?? msg.text ?? ''} width={width} />
          )}
        >
          <ChatMarkdownInput placeholder="Message ugly.chat…" autoFocus />
        </ChatView>
      </div>
    </PageLayout>
  );
}
