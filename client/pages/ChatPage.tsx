import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ThumbsUp, ThumbsDown, Heart, Laugh, HelpCircle, AlertTriangle, Trash2, Video, Paperclip, X, FileText, MoreVertical, Eraser } from 'lucide-react';
import { useApp, uploadBlob, promoteBlob, downscaleImage } from 'ugly-app/client';
import { ChatView, ChatMarkdownContent } from 'ugly-app/conversation/client';
import { ConversationInput } from '../components/ConversationInput';
import type { ChatMessage, ChatUser } from 'ugly-app/conversation/shared';
import type { DBObject } from 'ugly-app/shared';
import { VideoCall, type VideoCallHandle } from '../components/VideoCall';
import { useRouter } from '../router';
import { Avatar, pingConversationActivity } from '../lib/conversations';
import { UGLY_BOT_USER_ID } from '../../shared/bots';

interface MessageDoc extends DBObject {
  conversationId: string;
  userId: string;
  text?: string | null;
  markdown?: string | null;
  isBot?: boolean;
  deleted?: boolean;
  color?: string;
  reactionCount?: Record<string, number>;
  reactionUsers?: Record<string, string[]>;
  parentMessageId?: string | null;
  buttons?: unknown[];
}

// A tappable message button: a custom-bot starter ({label, prompt}) or a generic
// conversation button ({type, text, uri}). Tapping a prompt button sends it.
interface MsgButton {
  label?: string;
  text?: string;
  prompt?: string;
  uri?: string;
  type?: string;
}
function normalizeButton(b: unknown): { text: string; prompt: string | null; uri: string | null } | null {
  if (!b || typeof b !== 'object') return null;
  const o = b as MsgButton;
  const text = (o.label ?? o.text ?? '').trim();
  if (!text) return null;
  return { text, prompt: (o.prompt ?? o.text ?? o.label ?? null), uri: o.uri ?? null };
}

interface ConversationDoc extends DBObject {
  title?: string;
  image?: unknown;
  bots?: Record<string, unknown>;
}

// A file the user has attached to the composer but not yet sent. It's uploaded
// to the temp bucket immediately (so `key` fills in); `preview` is a local
// object URL shown right away. On send each staged blob is promoted to a
// permanent public URL and referenced in the message markdown.
interface PendingAttachment {
  id: string;
  key: string; // temp key, empty until the upload resolves
  preview: string; // URL.createObjectURL(file)
  name: string;
  type: string;
  uploading: boolean;
}

// ugly.bot uses lucide icons, never emoji.
const REACTION_ICON: Record<string, React.ComponentType<{ size?: number }>> = {
  thumbsUp: ThumbsUp, thumbsDown: ThumbsDown, heart: Heart,
  tearsOfJoy: Laugh, question: HelpCircle, exclamation: AlertTriangle,
};

const toMs = (v: unknown): number =>
  typeof v === 'number' ? v : v ? new Date(v as string).getTime() : Date.now();

const splitId = (docId: string): string => {
  const i = docId.indexOf(':');
  return i === -1 ? docId : docId.slice(i + 1);
};

// ugly.bot's six reactions, in picker order.
const REACTIONS = ['thumbsUp', 'thumbsDown', 'heart', 'tearsOfJoy', 'question', 'exclamation'] as const;

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => (typeof window === 'undefined' ? false : window.innerWidth < 820));
  useEffect(() => {
    const f = (): void => setNarrow(window.innerWidth < 820);
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, []);
  return narrow;
}

// One message bubble + its hover action bar (react / delete) + reaction chips.
function MessageBody(props: {
  msg: ChatMessage;
  isOwn: boolean;
  rTL: number;
  rBL: number;
  hasBg: boolean;
  onReact: (messageId: string, reaction: string) => void;
  onDelete: (messageId: string) => void;
  onButton: (prompt: string) => void;
}): React.ReactElement {
  const { msg, isOwn, rTL, rBL, hasBg, onReact, onDelete, onButton } = props;
  const [hover, setHover] = useState(false);
  const reactions = msg.reactionCount
    ? Object.entries(msg.reactionCount).filter(([, n]) => n > 0)
    : [];
  const buttons = (((msg as { buttons?: unknown[] }).buttons ?? [])
    .map(normalizeButton)
    .filter(Boolean)) as { text: string; prompt: string | null; uri: string | null }[];
  const text = msg.markdown ?? msg.text ?? '';
  const hasText = text.trim().length > 0;
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4, width: 'fit-content', maxWidth: '100%' }}
    >
      {hasText ? (
      <div
        style={{
          maxWidth: '100%',
          background:
            msg.color === 'error'
              ? 'var(--app-error)'
              : hasBg
                ? 'var(--app-main)'
                : isOwn
                  ? 'var(--app-secondary)'
                  : 'var(--app-tertiary)',
          color: msg.color === 'error' ? '#fff' : 'var(--app-foreground)',
          padding: '3px 8px',
          borderRadius: 4,
          borderTopLeftRadius: rTL,
          borderBottomLeftRadius: rBL,
          fontSize: 14,
          lineHeight: '20px',
          wordBreak: 'break-word',
        }}
      >
        <ChatMarkdownContent markdown={text} width={520} />
      </div>
      ) : null}

      {buttons.length > 0 ? (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', maxWidth: 520 }}>
          {buttons.map((b, i) => (
            <button
              key={`${b.text}-${i}`}
              type="button"
              className="uc-msgbtn"
              onClick={() => {
                if (b.uri) window.open(b.uri, '_blank', 'noopener');
                else if (b.prompt) onButton(b.prompt);
              }}
              style={{
                fontSize: 13,
                fontWeight: 600,
                padding: '7px 13px',
                borderRadius: 16,
                border: '1.5px solid var(--app-primary)',
                background: 'transparent',
                color: 'var(--app-primary)',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              {b.text}
            </button>
          ))}
        </div>
      ) : null}

      {reactions.length > 0 ? (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {reactions.map(([r, n]) => {
            const Icon = REACTION_ICON[r];
            return (
              <span key={r} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 12, background: 'var(--app-secondary)', border: '1px solid var(--app-border)', borderRadius: 10, padding: '1px 7px' }}>
                {Icon ? <Icon size={12} /> : r} {n}
              </span>
            );
          })}
        </div>
      ) : null}

      {hover ? (
        <div
          style={{
            position: 'absolute',
            // Sit clear above the bubble so it doesn't cover the message text.
            top: -34,
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
          {REACTIONS.map((r) => {
            const Icon = REACTION_ICON[r];
            return (
              <button key={r} title={r} onClick={() => onReact(msg.id, r)} style={{ display: 'inline-flex', alignItems: 'center', lineHeight: 1, padding: '3px 4px', color: 'var(--app-foreground)' }}>
                {Icon ? <Icon size={15} /> : null}
              </button>
            );
          })}
          {isOwn ? (
            <button title="Delete" onClick={() => onDelete(msg.id)} style={{ display: 'inline-flex', alignItems: 'center', lineHeight: 1, padding: '3px 4px', opacity: 0.6, color: 'var(--app-foreground)' }}>
              <Trash2 size={14} />
            </button>
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
    ...(d.color ? { color: d.color as NonNullable<ChatMessage['color']> } : {}),
    ...(d.reactionCount ? { reactionCount: d.reactionCount } : {}),
    ...(d.reactionUsers ? { reactionUsers: d.reactionUsers } : {}),
    ...(d.buttons ? { buttons: d.buttons } : {}),
  } as ChatMessage;
}

export default function ChatPage({ conversationId }: { conversationId?: string }): React.ReactElement {
  const { socket, userId } = useApp();
  const router = useRouter();
  const narrow = useNarrow();
  const roomId = conversationId ?? 'demo-room';

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [ready, setReady] = useState(false);
  const [title, setTitle] = useState('Conversation');
  const [convImage, setConvImage] = useState<unknown>(null);
  const [bgUrl, setBgUrl] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<Record<string, ChatUser>>({});
  const videoRef = useRef<VideoCallHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  // Bot-chat extras: the conversation's bot id (if any), its starter buttons
  // (shown persistently above the composer), and the header "⋯" menu state.
  const [botId, setBotId] = useState<string | null>(null);
  const [botButtons, setBotButtons] = useState<{ label: string; prompt: string }[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setReady(false);
    setMessages([]);
    setBgUrl(null);
    setBotId(null); // re-derived by the dedicated effect below
    setBotButtons([]);
    setMenuOpen(false);
    let unsubMsg: (() => void) | undefined;
    let unsubConv: (() => void) | undefined;
    let unsubUserConv: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      try {
        // ONLY the shared Demo Room is auto-created/joined. Real conversations
        // (migrated history, DMs, groups) already exist and the user is already
        // a member — creating/joining them would overwrite their conversation doc
        // and denormalized userConversation row. Never touch them here.
        if (roomId === 'demo-room') {
          const existing = await socket.getDoc('conversation', roomId);
          if (!existing) {
            await socket.request('conversationCreate', {
              id: roomId, type: 'group', title: 'Demo Room', mode: 'public', ownerIds: [userId],
            });
          }
          await socket.request('conversationJoin', { conversationId: roomId }).catch(() => undefined);
        }
        // Authoritative title from the denormalized per-user row (same source as
        // the sidebar) — a direct read so the header is correct on first paint.
        const uc = (await socket.getDoc('userConversation', `${userId}:${roomId}`)) as ConversationDoc | null;
        if (!cancelled && uc?.title) {
          setTitle(uc.title);
        } else if (!cancelled && roomId.includes('+')) {
          // DM with no title → show the other participant's name (ugly.bot parity).
          const other = roomId.split('+').filter(Boolean).find((p) => p !== userId);
          if (other) {
            const res = (await socket.request('profilesGet', { userIds: [other] })) as { profiles?: { name: string }[] };
            const nm = res.profiles?.[0]?.name;
            if (nm && !cancelled) setTitle(nm);
          }
        }
      } catch (err) {
        console.error('[ChatPage] ensure room failed', err);
      }
      if (cancelled) return;
      unsubConv = socket.trackDoc<ConversationDoc>('conversation', roomId, (doc) => {
        if (doc) {
          if (doc.title) setTitle(doc.title);
          setConvImage((img: unknown) => doc.image ?? img);
          // First custom bot member → drives the "⋯ Clear chat" menu + the
          // persistent starter buttons above the composer.
          const ids = Object.keys((doc.bots as Record<string, unknown> | undefined) ?? {});
          const firstBot = ids.find((b) => b.startsWith('bot-')) ?? null;
          setBotId((cur) => cur ?? firstBot);
        }
      });
      // The denormalized userConversation row carries the authoritative sidebar
      // title/image (same source the conversation list uses) — prefer it so the
      // header always matches the list even if the conversation doc lags.
      unsubUserConv = socket.trackDoc<ConversationDoc>('userConversation', `${userId}:${roomId}`, (doc) => {
        if (doc) {
          if (doc.title) setTitle(doc.title);
          setConvImage((img: unknown) => doc.image ?? img);
        }
      });
      // Subscribe to the NEWEST 200 (created: -1), not the oldest. With
      // `created: 1` the window was the oldest 200 messages, so on any
      // conversation with >200 messages a freshly-sent message fell outside the
      // window and trackDocs never delivered it — the composer cleared but the
      // message never rendered. We re-sort ascending for display below.
      unsubMsg = socket.trackDocs<MessageDoc>(
        'message',
        { keys: { conversationId: roomId }, sort: { created: -1 }, limit: 200 },
        (docs) => {
          setMessages(
            (Array.isArray(docs) ? docs : [])
              .filter((d) => !d.deleted)
              .map(toChatMessage)
              .sort((a, b) => a.created - b.created),
          );
          pingConversationActivity();
        },
      );
      setReady(true);
    })();
    return () => {
      cancelled = true;
      unsubMsg?.();
      unsubConv?.();
      unsubUserConv?.();
    };
  }, [socket, userId, roomId]);

  // Resolve participant profiles (real names + avatars + conversation bg).
  useEffect(() => {
    const unknown = [...new Set(messages.map((m) => m.userId))].filter((id) => id && !profiles[id]);
    if (unknown.length === 0) return;
    void socket
      .request('profilesGet', { userIds: unknown })
      .then((res) => {
        const list = (res as { profiles?: { id: string; name: string; avatarUrl: string | null; isBot: boolean; backgroundUrl?: string | null }[] }).profiles ?? [];
        setProfiles((prev) => {
          const next = { ...prev };
          for (const p of list) {
            next[p.id] = {
              id: p.id,
              name: p.name,
              isBot: p.isBot,
              ...(p.avatarUrl ? { avatarUrl: p.avatarUrl } : {}),
            };
          }
          return next;
        });
        // The conversation background is the other participant's (the bot's)
        // avatar background — ugly.bot themes each conversation this way.
        const bg = list.find((p) => p.id !== userId && p.backgroundUrl)?.backgroundUrl;
        if (bg) setBgUrl(bg);
      })
      .catch((err: unknown) => console.error('[ChatPage] profilesGet failed', err));
  }, [messages, profiles, socket, userId]);

  // Derive the conversation's bot id (drives the ⋯ menu + starter buttons).
  // Covered cases: a `bc-<botId>-<userId>` custom-bot room, the canonical Ugly
  // Bot DM (`<UGLY_BOT_USER_ID>+<userId>`), or any resolved participant flagged
  // isBot (other migrated bots). Runs whenever profiles resolve.
  useEffect(() => {
    if (botId) return;
    if (roomId.startsWith('bc-') && roomId.endsWith(`-${userId}`)) {
      setBotId(roomId.slice(3, roomId.length - userId.length - 1));
      return;
    }
    if (roomId.includes('+')) {
      const other = roomId.split('+').filter(Boolean).find((p) => p !== userId);
      if (other === UGLY_BOT_USER_ID) {
        setBotId(other);
        return;
      }
    }
    const botP = Object.values(profiles).find((p) => p.id !== userId && p.isBot);
    if (botP) setBotId(botP.id);
  }, [roomId, userId, profiles, botId]);

  // Load the bot's starter buttons (shown persistently above the composer).
  useEffect(() => {
    if (!botId) {
      setBotButtons([]);
      return;
    }
    let cancelled = false;
    void socket
      .request('botGet', { botId })
      .then((doc) => {
        if (cancelled) return;
        const btns = (doc as { buttons?: { label: string; prompt: string }[] } | null)?.buttons ?? [];
        setBotButtons(btns.filter((b) => b.label && b.prompt));
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [socket, botId]);

  // Drop staged (unsent) attachments when switching conversations.
  useEffect(() => {
    return () => {
      setPending((p) => {
        p.forEach((x) => URL.revokeObjectURL(x.preview));
        return [];
      });
    };
  }, [roomId]);

  const getUser = useCallback(
    (id: string): ChatUser =>
      profiles[id] ?? {
        id,
        name: id.startsWith('bot-') ? 'Bot' : id.slice(0, 8),
        isBot: id.startsWith('bot-'),
      },
    [profiles, userId],
  );

  const handleSend = useCallback(
    (text: string, parentMessageId?: string | null) => {
      void socket
        .request('conversationMessageCreate', {
          conversationId: roomId,
          message: { markdown: text, text, ...(parentMessageId ? { parentMessageId } : {}) },
        })
        .then(() => pingConversationActivity())
        .catch((err: unknown) => console.error('[ChatPage] send failed', err));
    },
    [socket, roomId],
  );

  // Stage picked files: instant local preview + temp-bucket upload in the
  // background. Image-only messages are allowed (allowEmpty on the composer).
  const onFiles = useCallback((files: FileList | null) => {
    if (!files) return;
    const MAX_BYTES = 25 * 1024 * 1024; // 25 MB — well under the 100 MB Worker limit
    for (const file of Array.from(files)) {
      if (file.size > MAX_BYTES) {
        console.warn('[ChatPage] file too large, skipped:', file.name, file.size);
        continue;
      }
      const preview = URL.createObjectURL(file);
      const id = `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`;
      setPending((p) => [...p, { id, key: '', preview, name: file.name, type: file.type, uploading: true }]);
      void (async () => {
        try {
          const processed = file.type.startsWith('image/') ? await downscaleImage(file, 1600) : file;
          const { key } = await uploadBlob(processed, { name: file.name });
          setPending((p) => p.map((x) => (x.id === id ? { ...x, key, uploading: false } : x)));
        } catch (err) {
          console.error('[ChatPage] upload failed', err);
          URL.revokeObjectURL(preview);
          setPending((p) => p.filter((x) => x.id !== id));
        }
      })();
    }
  }, []);

  const removePending = useCallback((id: string) => {
    setPending((p) => {
      const hit = p.find((x) => x.id === id);
      if (hit) URL.revokeObjectURL(hit.preview);
      return p.filter((x) => x.id !== id);
    });
  }, []);

  // Composer send: promote any staged blobs to permanent URLs, fold them into
  // the message markdown (images inline, other files as links), then send.
  const handleSendWithAttachments = useCallback(
    (text: string) => {
      const ready = pending.filter((p) => p.key);
      if (ready.length === 0) {
        handleSend(text);
        return;
      }
      setPending([]);
      void (async () => {
        const parts = text.trim() ? [text.trim()] : [];
        for (const att of ready) {
          try {
            const url = await promoteBlob(socket, att.key);
            parts.push(att.type.startsWith('image/') ? `![${att.name}](${url})` : `[${att.name}](${url})`);
          } catch (err) {
            console.error('[ChatPage] promote failed', err);
          } finally {
            URL.revokeObjectURL(att.preview);
          }
        }
        const markdown = parts.join('\n\n');
        if (markdown.trim()) handleSend(markdown);
      })();
    },
    [pending, socket, handleSend],
  );

  const handleDelete = useCallback(
    (messageId: string) => {
      void socket
        .request('conversationMessageDelete', { conversationId: roomId, messageId: splitId(messageId) })
        .catch((err: unknown) => console.error('[ChatPage] delete failed', err));
    },
    [socket, roomId],
  );

  const handleReact = useCallback(
    (messageId: string, reaction: string) => {
      void socket
        .request('conversationMessageReact', { conversationId: roomId, messageId: splitId(messageId), reaction })
        .catch((err: unknown) => console.error('[ChatPage] react failed', err));
    },
    [socket, roomId],
  );

  const handleClear = useCallback(() => {
    setMenuOpen(false);
    void socket
      .request('conversationClear', { conversationId: roomId })
      .then(() => pingConversationActivity())
      .catch((err: unknown) => console.error('[ChatPage] clear failed', err));
  }, [socket, roomId]);

  // @mention candidates = the conversation's resolved participants.
  const mentionSearch = useCallback(
    async (q: string): Promise<{ id: string; name: string }[]> => {
      const ql = q.toLowerCase();
      return Object.values(profiles)
        .filter((p) => p.name && p.id !== userId && p.name.toLowerCase().includes(ql))
        .slice(0, 8)
        .map((p) => ({ id: p.id, name: p.name }));
    },
    [profiles, userId],
  );

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
          hasBg={!!bgUrl}
          onReact={handleReact}
          onDelete={handleDelete}
          onButton={(prompt) => handleSend(prompt)}
        />
      );
    },
    [messages, userId, handleReact, handleDelete, bgUrl, handleSend],
  );

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: bgUrl
          ? `linear-gradient(var(--app-main-rgb-overlay, rgba(255,255,255,0)), var(--app-main-rgb-overlay, rgba(255,255,255,0))), url(${JSON.stringify(bgUrl)}) center / cover no-repeat`
          : 'var(--app-main)',
      }}
    >
      {/* Conversation header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderBottom: bgUrl ? 'none' : '1px solid var(--app-border)', flexShrink: 0, background: bgUrl ? 'rgba(var(--app-main-rgb), 0.55)' : 'transparent', backdropFilter: bgUrl ? 'blur(6px)' : undefined }}>
        {narrow ? (
          <button
            type="button"
            onClick={() => router.push('chat', {})}
            aria-label="Back"
            style={{ border: 'none', background: 'transparent', fontSize: 22, lineHeight: 1, cursor: 'pointer', color: 'var(--app-foreground)', padding: '0 4px 0 0' }}
          >
            ‹
          </button>
        ) : null}
        <Avatar image={convImage} seed={roomId} label={title} size={30} />
        <span style={{ flex: 1, minWidth: 0, fontWeight: 700, fontSize: 15, color: 'var(--app-foreground)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</span>
        <button
          type="button"
          onClick={() => videoRef.current?.start()}
          aria-label="Start video call"
          title="Start video call"
          style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: '50%', border: 'none', background: 'transparent', color: 'var(--app-foreground)', cursor: 'pointer', flexShrink: 0 }}
        >
          <Video size={19} />
        </button>
        {/* Overflow menu — bot chats can be wiped clean. */}
        {botId ? (
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              aria-label="More"
              title="More"
              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: '50%', border: 'none', background: 'transparent', color: 'var(--app-foreground)', cursor: 'pointer' }}
            >
              <MoreVertical size={19} />
            </button>
            {menuOpen ? (
              <>
                <div onClick={() => setMenuOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 20 }} />
                <div style={{ position: 'absolute', top: 38, right: 0, zIndex: 21, background: 'var(--app-main)', border: '1px solid var(--app-border)', borderRadius: 10, boxShadow: 'var(--app-shadow-button-default)', minWidth: 168, overflow: 'hidden' }}>
                  <button
                    type="button"
                    className="uc-menuitem"
                    onClick={handleClear}
                    style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '11px 14px', border: 'none', background: 'transparent', color: 'var(--app-error)', cursor: 'pointer', fontSize: 14, fontWeight: 600, textAlign: 'left' }}
                  >
                    <Eraser size={16} /> Clear chat
                  </button>
                </div>
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      <VideoCall ref={videoRef} conversationId={roomId} />

      {/* Full-width scroll area (like ugly.bot) so the chat scrollbar sits at the
          pane's right edge, not at a centered column's edge. */}
      <div className="uc-chat-scroll" style={{ flex: 1, minHeight: 0, width: '100%', display: 'flex', flexDirection: 'column' }}>
        <ChatView
          messages={messages}
          userId={userId}
          onSend={handleSend}
          onDelete={handleDelete}
          onReact={(id, reaction) => handleReact(id, reaction)}
          getUser={getUser}
          renderMessage={renderMessage}
          onImageBackground={!!bgUrl}
        >
          <div className="uc-composer" style={{ padding: '8px 16px 16px' }}>
            {botButtons.length > 0 ? (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                {botButtons.map((b, i) => (
                  <button
                    key={`${b.label}-${i}`}
                    type="button"
                    className="uc-msgbtn"
                    onClick={() => handleSend(b.prompt)}
                    style={{ fontSize: 13, fontWeight: 600, padding: '7px 13px', borderRadius: 16, border: '1.5px solid var(--app-primary)', background: 'transparent', color: 'var(--app-primary)', cursor: 'pointer' }}
                  >
                    {b.label}
                  </button>
                ))}
              </div>
            ) : null}
            {pending.length > 0 ? (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                {pending.map((p) => (
                  <div key={p.id} style={{ position: 'relative', width: 60, height: 60 }}>
                    {p.type.startsWith('image/') ? (
                      <img src={p.preview} alt={p.name} style={{ width: 60, height: 60, objectFit: 'cover', borderRadius: 10, opacity: p.uploading ? 0.45 : 1, border: '1px solid var(--app-border)' }} />
                    ) : (
                      <div style={{ width: 60, height: 60, borderRadius: 10, border: '1px solid var(--app-border)', background: 'var(--app-tertiary)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, fontSize: 9, padding: 4, textAlign: 'center', color: 'var(--app-foreground)', opacity: p.uploading ? 0.45 : 1, overflow: 'hidden' }}>
                        <FileText size={20} style={{ opacity: 0.7, flexShrink: 0 }} />
                        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>{p.name}</span>
                      </div>
                    )}
                    {p.uploading ? (
                      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <div className="uc-spin" style={{ width: 18, height: 18, border: '2px solid rgba(255,255,255,0.5)', borderTopColor: '#fff', borderRadius: '50%' }} />
                      </div>
                    ) : null}
                    <button type="button" onClick={() => removePending(p.id)} aria-label="Remove" style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: '50%', border: 'none', background: 'var(--app-foreground)', color: 'var(--app-main)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => {
                onFiles(e.target.files);
                e.target.value = '';
              }}
            />
            <ConversationInput
              placeholder={`Message ${title}…`}
              autoFocus
              onSend={handleSendWithAttachments}
              allowEmpty={pending.some((p) => p.key)}
              mentionSearch={mentionSearch}
              rightActions={
                <button
                  type="button"
                  title="Attach image"
                  onClick={() => fileInputRef.current?.click()}
                  style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, flexShrink: 0, borderRadius: '50%', border: 'none', background: 'transparent', color: 'var(--app-foreground)', cursor: 'pointer' }}
                >
                  <Paperclip size={18} />
                </button>
              }
            />
          </div>
        </ChatView>
      </div>
    </div>
  );
}
