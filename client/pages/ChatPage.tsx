import React, { useCallback, useEffect, useRef, useState } from 'react';
import { PageLayout, useApp } from 'ugly-app/client';
import { ChatView, ChatMarkdownContent, ChatTextInput } from 'ugly-app/conversation/client';
import type { ChatMessage, ChatUser } from 'ugly-app/conversation/shared';
import type { DBObject } from 'ugly-app/shared';
import { VideoCall } from '../components/VideoCall';

// A single shared demo room so two browsers land in the same conversation for
// side-by-side comparison. Real conversation routing comes later.
const ROOM_ID = 'demo-room';

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

const REACTION_EMOJI: Record<string, string> = {
  thumbsUp: '👍', thumbsDown: '👎', question: '❓', heart: '❤️',
  exclamation: '❗', tearsOfJoy: '😂',
};

const toMs = (v: unknown): number =>
  typeof v === 'number' ? v : v ? new Date(v as string).getTime() : Date.now();

const splitId = (docId: string): string => {
  const i = docId.indexOf(':');
  return i === -1 ? docId : docId.slice(i + 1);
};

// ugly.bot's six reactions, in picker order.
const REACTIONS = ['thumbsUp', 'thumbsDown', 'heart', 'tearsOfJoy', 'question', 'exclamation'] as const;

// One message bubble + its hover action bar (react / delete) + reaction chips.
// Lives outside renderMessage so it can use hover state.
function MessageBody(props: {
  msg: ChatMessage;
  isOwn: boolean;
  rTL: number;
  rBL: number;
  onReact: (messageId: string, reaction: string) => void;
  onDelete: (messageId: string) => void;
}): React.ReactElement {
  const { msg, isOwn, rTL, rBL, onReact, onDelete } = props;
  const [hover, setHover] = useState(false);
  const reactions = msg.reactionCount
    ? Object.entries(msg.reactionCount).filter(([, n]) => n > 0)
    : [];
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4, width: 'fit-content', maxWidth: '100%' }}
    >
      <div
        style={{
          maxWidth: '100%',
          background: isOwn ? 'var(--app-secondary)' : 'var(--app-tertiary)',
          color: 'var(--app-foreground)',
          padding: '5px 9px',
          borderRadius: 4,
          borderTopLeftRadius: rTL,
          borderBottomLeftRadius: rBL,
          fontSize: 15,
          lineHeight: '21px',
          wordBreak: 'break-word',
        }}
      >
        <ChatMarkdownContent markdown={msg.markdown ?? msg.text ?? ''} width={520} />
      </div>

      {reactions.length > 0 ? (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {reactions.map(([r, n]) => (
            <span key={r} style={{ fontSize: 12, background: 'var(--app-secondary)', border: '1px solid var(--app-border)', borderRadius: 10, padding: '1px 7px' }}>
              {REACTION_EMOJI[r] ?? r} {n}
            </span>
          ))}
        </div>
      ) : null}

      {hover ? (
        <div
          style={{
            position: 'absolute',
            top: -15,
            right: -4,
            display: 'flex',
            gap: 1,
            background: 'var(--app-main)',
            border: '1px solid var(--app-border)',
            borderRadius: 8,
            padding: '2px 4px',
            boxShadow: 'var(--app-shadow-button-default)',
            zIndex: 2,
          }}
        >
          {REACTIONS.map((r) => (
            <button key={r} title={r} onClick={() => onReact(msg.id, r)} style={{ fontSize: 14, lineHeight: 1, padding: '2px 3px' }}>
              {REACTION_EMOJI[r]}
            </button>
          ))}
          {isOwn ? (
            <button title="Delete" onClick={() => onDelete(msg.id)} style={{ fontSize: 13, lineHeight: 1, padding: '2px 4px', opacity: 0.7 }}>🗑</button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

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

  useEffect(() => {
    let unsub: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      try {
        const existing = await socket.getDoc('conversation', ROOM_ID);
        if (!existing) {
          await socket.request('conversationCreate', {
            id: ROOM_ID, type: 'group', title: 'Demo Room', mode: 'public', ownerIds: [userId],
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
          setMessages(
            (Array.isArray(docs) ? docs : [])
              .filter((d) => !d.deleted)
              .map(toChatMessage)
              .sort((a, b) => a.created - b.created),
          );
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
      const isBot = id.startsWith('bot-');
      const u: ChatUser = {
        id,
        name: id === userId ? 'You' : isBot ? id.replace('bot-', '').replace(/^./, (c) => c.toUpperCase()) : id.slice(0, 8),
        isBot,
      };
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
          message: { markdown: text, text, ...(parentMessageId ? { parentMessageId } : {}) },
        })
        .catch((err: unknown) => console.error('[ChatPage] send failed', err));
    },
    [socket],
  );

  const handleDelete = useCallback(
    (messageId: string) => {
      void socket
        .request('conversationMessageDelete', { conversationId: ROOM_ID, messageId: splitId(messageId) })
        .catch((err: unknown) => console.error('[ChatPage] delete failed', err));
    },
    [socket],
  );

  const handleReact = useCallback(
    (messageId: string, reaction: string) => {
      void socket
        .request('conversationMessageReact', { conversationId: ROOM_ID, messageId: splitId(messageId), reaction })
        .catch((err: unknown) => console.error('[ChatPage] react failed', err));
    },
    [socket],
  );

  // The framework's ChatMessageBubble draws the avatar + name + time + grouping;
  // renderMessage replaces only the bubble BODY. Style it like ugly.bot: 4px
  // bubbles (own=secondary / others=tertiary) with flat left corners between
  // consecutive same-sender messages, plus reaction chips.
  const renderMessage = useCallback(
    (msg: ChatMessage): React.ReactNode => {
      const idx = messages.findIndex((m) => m.id === msg.id);
      const prev = idx > 0 ? messages[idx - 1] : undefined;
      const next = idx >= 0 && idx < messages.length - 1 ? messages[idx + 1] : undefined;
      return (
        <MessageBody
          msg={msg}
          isOwn={msg.userId === userId}
          rTL={!prev || prev.userId !== msg.userId ? 4 : 0}
          rBL={!next || next.userId !== msg.userId ? 4 : 0}
          onReact={handleReact}
          onDelete={handleDelete}
        />
      );
    },
    [messages, userId, handleReact, handleDelete],
  );

  return (
    <PageLayout>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--app-main)' }}>
        {/* Conversation header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid var(--app-border)', flexShrink: 0 }}>
          <div style={{ width: 30, height: 30, borderRadius: 9, background: 'var(--app-gradient-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>💬</div>
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
            <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--app-foreground)' }}>Demo Room</span>
            <span style={{ fontSize: 11, color: 'var(--app-foreground-muted)' }}>
              {ready ? `${messages.length} message${messages.length === 1 ? '' : 's'}` : 'Connecting…'}
            </span>
          </div>
        </div>

        <VideoCall conversationId={ROOM_ID} />

        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <ChatView
            messages={messages}
            userId={userId}
            onSend={handleSend}
            onDelete={handleDelete}
            onReact={(id, reaction) => handleReact(id, reaction)}
            getUser={getUser}
            renderMessage={renderMessage}
          >
            <ChatTextInput placeholder="Message Demo Room…" autoFocus />
          </ChatView>
        </div>
      </div>
    </PageLayout>
  );
}
