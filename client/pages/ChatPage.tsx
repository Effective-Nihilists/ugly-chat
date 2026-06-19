import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ThumbsUp, ThumbsDown, Heart, Laugh, HelpCircle, AlertTriangle, Trash2, Video, Paperclip, X, FileText, MoreVertical, Eraser, Pencil, Users, Volume2, VolumeX, Pin, Settings, Check, Palette, Copy } from 'lucide-react';
import { useApp, uploadBlob, promoteBlob, downscaleImage, useSafeAreaInsets } from 'ugly-app/client';
import { MdastViewer } from 'ugly-app/markdown/client';
import { ConversationInput } from '../components/ConversationInput';
import { VirtualMessageList } from '../components/VirtualMessageList';
import { createPortal } from 'react-dom';
import { extractImages, ChatImage, ImageZoomViewer } from '../components/ChatMedia';
import { nextSelectedId } from '../lib/messageSelection';
import type { ChatMessage, ChatUser, ChatTypingEntry } from 'ugly-app/conversation/shared';
import type { DBObject } from 'ugly-app/shared';
import { type VideoCallHandle } from '../components/VideoCall';
import { CallLayout } from '../components/CallLayout';
import { openMembersPopup } from '../components/MembersPopup';
import { VoiceProvider, useVoice } from '../components/VoiceProvider';
import { useRouter } from '../router';
import { Avatar, pingConversationActivity, deleteOrLeaveConversation } from '../lib/conversations';
import { modelLabel, BOT_MODELS, BOT_MODES, IMAGE_MODELS, IMAGE_SIZES } from '../lib/bots';
import { UGLY_BOT_ID } from '../../shared/bots';
import type { MsgTelemetry } from '../../shared/telemetry';
import { formatTokens, formatCost } from '../../shared/telemetry';
import { TelemetryStrip } from '../components/TelemetryStrip';
import { HumanTelemetryStrip } from '../components/HumanTelemetryStrip';
import { openThemeMenu } from '../components/ThemeMenu';
import { type StatMsg, replyLatencyMs } from '../../shared/humanStats';
import { formatDuration } from '../../shared/duration';

// Open a markdown link. MdastViewer's default link handler calls
// `global.open(...)` for non-mention links, which throws in the browser
// (`global` is undefined) — so links silently do nothing. Passing our own
// `openUri` overrides that with a real `window.open`.
function openLink(uri: string): Promise<void> {
  if (typeof window !== 'undefined') window.open(uri, '_blank', 'noopener');
  return Promise.resolve();
}

interface LinkPreview {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
}

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
  linkPreviews?: LinkPreview[];
  edited?: number | null;
  systemType?: string;
  systemParam?: string;
  telemetry?: MsgTelemetry;
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
  type?: string;
  typing?: ChatTypingEntry[];
  bots?: Record<string, unknown>;
  pinnedMessageId?: string | null;
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

// Messages fetched on open. More than a screenful so the thread fills + scrolls,
// but far below the old flat 200 so first paint stays fast on long conversations.
const INITIAL_MSG_LIMIT = 75;
const LOAD_MORE_STEP = 100;

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => (typeof window === 'undefined' ? false : window.innerWidth < 820));
  useEffect(() => {
    const f = (): void => setNarrow(window.innerWidth < 820);
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, []);
  return narrow;
}

// Short HH:MM clock for a message timestamp (peer name-row + own footer).
function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

// One full thread row (mock parity): own = right-aligned gradient bubble with a
// `delivered · HH:MM` footer and no avatar/name; peer = left-aligned square
// avatar (first of a run) + name header + tertiary bubble. Markdown, telemetry
// receipt, reactions, buttons, hover actions and editing are preserved.
function MessageBody(props: {
  msg: ChatMessage;
  isOwn: boolean;
  sender: ChatUser;
  firstOfRun: boolean;
  stacked: boolean;
  daySep: string | null;
  onReact: (messageId: string, reaction: string) => void;
  onDelete: (messageId: string) => void;
  onEdit: (messageId: string, markdown: string) => Promise<void>;
  onPin: (messageId: string) => void;
  pinned: boolean;
  onButton: (prompt: string) => void;
  onOpenImage: (src: string, alt: string) => void;
  isSelected: boolean;
  onSelect: (id: string) => void;
  // Human DM receipt props (only provided when !hasBot && statsOn)
  humanIdx?: number;
  humanSorted?: StatMsg[];
  humanMeId?: string;
  humanStatsOn?: boolean;
  humanSeen?: boolean;
}): React.ReactElement {
  const { msg, isOwn, sender, firstOfRun, stacked, daySep, onReact, onDelete, onEdit, onPin, pinned, onButton,
    onOpenImage, isSelected, onSelect, humanIdx, humanSorted, humanMeId, humanStatsOn, humanSeen } = props;
  const voice = useVoice();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const reactions = msg.reactionCount
    ? Object.entries(msg.reactionCount).filter(([, n]) => n > 0)
    : [];
  const buttons = (((msg as { buttons?: unknown[] }).buttons ?? [])
    .map(normalizeButton)
    .filter(Boolean)) as { text: string; prompt: string | null; uri: string | null }[];
  const text = msg.markdown ?? msg.text ?? '';
  const hasText = text.trim().length > 0;
  // Split image attachments out of the markdown so we can size/place them with
  // the edge-to-edge / centered rules (the leftover text renders as usual).
  const { images, text: bodyText } = extractImages(text);
  const hasImages = images.length > 0;
  const hasBody = bodyText.trim().length > 0;
  // Image-dominant (no text, or just a short caption) → edge-to-edge; a message
  // with substantial text keeps images at a modest centered size.
  const edgeToEdge = hasImages && bodyText.length <= 140;
  const mediaBubble = edgeToEdge;
  const startEdit = (): void => {
    setDraft(text);
    setEditing(true);
  };
  const saveEdit = async (): Promise<void> => {
    const next = draft.trim();
    if (!next || next === text.trim()) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onEdit(msg.id, next);
      setEditing(false);
    } catch {
      /* keep the editor open on failure so the draft isn't lost */
    } finally {
      setSaving(false);
    }
  };
  const isError = msg.color === 'error';
  return (
    <>
      {daySep ? (
        <div className="uc-daysep"><span>{daySep}</span></div>
      ) : null}
      <div className={`uc-msg${isOwn ? ' me' : ''}`}>
        {/* Square avatar — peers only, on the first message of a run. */}
        {!isOwn && firstOfRun ? (
          <div className="uc-avatar-slot">
            <Avatar image={sender.avatarUrl} seed={sender.id} label={sender.name} size={30} />
          </div>
        ) : !isOwn ? (
          <div className="uc-avatar-slot" style={{ width: 30 }} />
        ) : null}
        <div
          className="uc-msgcol"
          onClick={(e) => { e.stopPropagation(); onSelect(msg.id); }}
          style={{ position: 'relative' }}
        >
          {/* Peer sender name + timestamp, first of a run only. */}
          {!isOwn && firstOfRun ? (
            <div className="uc-metarow">
              <span className={`sender${sender.isBot ? ' bot' : ''}`}>{sender.name}</span>
              {isSelected ? <span className="t">{clock(msg.created)}</span> : null}
            </div>
          ) : null}
          {hasText ? (
          <div
            className={`uc-bubble ${isOwn ? 'own' : 'peer'}${stacked ? ' stack' : ''}${isError ? ' err' : ''}${mediaBubble ? ' media' : ''}${isSelected ? ' selected' : ''}`}
          >
        {editing ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 260 }}>
            <textarea
              autoFocus
              value={draft}
              disabled={saving}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setEditing(false);
                } else if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void saveEdit();
                }
              }}
              rows={Math.min(8, Math.max(1, draft.split('\n').length))}
              style={{
                resize: 'vertical',
                width: '100%',
                font: 'inherit',
                fontSize: 14,
                lineHeight: '20px',
                color: 'var(--app-foreground)',
                background: 'var(--app-main)',
                border: '1px solid var(--app-border)',
                borderRadius: 6,
                padding: '6px 8px',
                outline: 'none',
              }}
            />
            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setEditing(false)}
                disabled={saving}
                style={{ fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--app-border)', background: 'transparent', color: 'var(--app-foreground)', cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void saveEdit()}
                disabled={saving || !draft.trim()}
                style={{ fontSize: 12, fontWeight: 700, padding: '4px 12px', borderRadius: 6, border: 'none', background: 'var(--app-primary)', color: '#fff', cursor: 'pointer', opacity: saving || !draft.trim() ? 0.6 : 1 }}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        ) : (
          <>
            {edgeToEdge ? (
              <div className="uc-media">
                {images.map((im, i) => (
                  <ChatImage key={`${im.url}-${i}`} src={im.url} alt={im.alt} edgeToEdge onOpen={onOpenImage} isSelected={isSelected} />
                ))}
              </div>
            ) : null}
            {hasBody ? (
              <div className={mediaBubble ? 'uc-cap' : undefined}>
                <MdastViewer markdown={bodyText} width={520} openUri={openLink} />
                {(msg as { edited?: unknown }).edited ? (
                  <span style={{ fontSize: 11, opacity: 0.5, marginLeft: 6 }}>(edited)</span>
                ) : null}
              </div>
            ) : null}
            {hasImages && !edgeToEdge ? (
              <div className="uc-media uc-media-centered">
                {images.map((im, i) => (
                  <ChatImage key={`${im.url}-${i}`} src={im.url} alt={im.alt} edgeToEdge={false} onOpen={onOpenImage} isSelected={isSelected} />
                ))}
              </div>
            ) : null}
          </>
        )}
      </div>
      ) : null}

      {((msg as { linkPreviews?: LinkPreview[] }).linkPreviews ?? []).map((lp, i) => (
        <a
          key={`${lp.url}-${i}`}
          href={lp.url}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'block',
            maxWidth: 320,
            border: '1px solid var(--app-border)',
            borderRadius: 10,
            overflow: 'hidden',
            background: 'var(--app-main)',
            textDecoration: 'none',
            color: 'var(--app-foreground)',
          }}
        >
          {lp.image ? (
            <img
              src={lp.image}
              alt=""
              style={{ width: '100%', maxHeight: 168, objectFit: 'cover', display: 'block' }}
            />
          ) : null}
          <div style={{ padding: '8px 11px' }}>
            {lp.siteName ? (
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', opacity: 0.55 }}>
                {lp.siteName}
              </div>
            ) : null}
            <div style={{ fontSize: 14, fontWeight: 600, lineHeight: '18px', marginTop: 2 }}>
              {lp.title ?? lp.url}
            </div>
            {lp.description ? (
              <div style={{ fontSize: 12, opacity: 0.65, marginTop: 3, lineHeight: '16px', maxHeight: 32, overflow: 'hidden' }}>
                {lp.description}
              </div>
            ) : null}
          </div>
        </a>
      ))}

      {buttons.length > 0 ? (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', maxWidth: 520 }}>
          {buttons.map((b, i) => (
            <button
              key={`${b.text}-${i}`}
              type="button"
              className="uc-msgbtn"
              onClick={(e) => {
                e.stopPropagation();
                if (b.uri) window.open(b.uri, '_blank', 'noopener');
                else if (b.prompt) onButton(b.prompt);
              }}
              style={{
                fontFamily: 'var(--app-font-mono)',
                fontSize: 11.5,
                fontWeight: 600,
                letterSpacing: '0.04em',
                padding: '7px 13px',
                borderRadius: 0,
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

      {isSelected && (msg as { telemetry?: MsgTelemetry }).telemetry ? (
        <div className="uc-receipt" style={{ padding: '0 4px' }}>
          <b>{modelLabel((msg as { telemetry?: MsgTelemetry }).telemetry!.model) || 'model'}</b>
          <span className="dot">·</span>
          {((msg as { telemetry?: MsgTelemetry }).telemetry!.latencyMs / 1000).toFixed(1)}s
          <span className="dot">·</span>
          ↑{formatTokens((msg as { telemetry?: MsgTelemetry }).telemetry!.inputTokens)} ↓{formatTokens((msg as { telemetry?: MsgTelemetry }).telemetry!.outputTokens)} tok
          <span className="dot">·</span>
          <span className="cost">{formatCost((msg as { telemetry?: MsgTelemetry }).telemetry!.costUsd)}</span>
        </div>
      ) : null}

      {/* Own-message footer (delivered · HH:MM) — bot chats and any non-stats
          DM. Human-DM stats render their own richer footer below instead. */}
      {isSelected && isOwn && !humanStatsOn && hasText ? (
        <div className="uc-receipt" style={{ padding: '0 4px', color: 'var(--app-foreground-muted)' }}>
          <span>delivered</span><span className="dot">·</span>{clock(msg.created)}
        </div>
      ) : null}

      {/* Human DM per-message receipt (no bot, stats enabled) */}
      {isSelected && humanStatsOn && humanSorted && humanIdx != null && humanMeId != null ? (
        <div className="uc-receipt" style={{ padding: '0 4px', color: 'var(--app-foreground-muted)' }}>
          {(() => {
            const lat = replyLatencyMs(humanSorted, humanIdx, humanMeId);
            if (!isOwn && lat != null) {
              return lat > 3_600_000
                ? <span className="cost">left you on read · {formatDuration(lat)}</span>
                : <span>replied in {formatDuration(lat)}{lat < 30_000 ? ' · personal best' : ''}</span>;
            }
            // Count consecutive run of own messages ending at this index
            let runLen = 0;
            for (let i = humanIdx; i >= 0; i--) {
              const m = humanSorted[i];
              if (m && m.userId === humanMeId) runLen++;
              else break;
            }
            return (
              <span>
                {humanSeen ? 'seen' : 'delivered'}
                {runLen > 1 ? <><span className="dot">·</span>{`double-texted ×${runLen}`}</> : null}
              </span>
            );
          })()}
        </div>
      ) : null}

      {reactions.length > 0 ? (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {reactions.map(([r, n]) => {
            const Icon = REACTION_ICON[r];
            return (
              <span key={r} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: 'var(--app-font-mono)', fontSize: 10, background: 'var(--app-tertiary)', border: '1px solid var(--app-border)', borderRadius: 0, padding: '2px 8px', color: 'var(--app-foreground-muted)' }}>
                {Icon ? <Icon size={12} /> : r} {n}
              </span>
            );
          })}
        </div>
      ) : null}

      {isSelected ? (
        <div
          onClick={(e) => e.stopPropagation()}
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
          {voice.enabled && hasBody && !isOwn ? (
            <button
              title={voice.playingId === msg.id ? 'Stop' : 'Read aloud'}
              onClick={() =>
                voice.playingId === msg.id ? voice.stop() : voice.speak(msg.id, bodyText)
              }
              style={{ display: 'inline-flex', alignItems: 'center', lineHeight: 1, padding: '3px 4px', opacity: 0.6, color: 'var(--app-foreground)' }}
            >
              {voice.playingId === msg.id ? <VolumeX size={15} /> : <Volume2 size={15} />}
            </button>
          ) : null}
          {hasText ? (
            <button
              title={copied ? 'Copied' : 'Copy'}
              onClick={() => {
                void navigator.clipboard
                  ?.writeText(text)
                  .then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1200);
                  })
                  .catch(() => undefined);
              }}
              style={{ display: 'inline-flex', alignItems: 'center', lineHeight: 1, padding: '3px 4px', opacity: copied ? 1 : 0.6, color: copied ? 'var(--app-primary)' : 'var(--app-foreground)' }}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
          ) : null}
          {hasText ? (
            <button
              title={pinned ? 'Unpin' : 'Pin'}
              onClick={() => onPin(msg.id)}
              style={{ display: 'inline-flex', alignItems: 'center', lineHeight: 1, padding: '3px 4px', opacity: pinned ? 1 : 0.6, color: pinned ? 'var(--app-primary)' : 'var(--app-foreground)' }}
            >
              <Pin size={14} fill={pinned ? 'currentColor' : 'none'} />
            </button>
          ) : null}
          {isOwn && hasText ? (
            <button title="Edit" onClick={startEdit} style={{ display: 'inline-flex', alignItems: 'center', lineHeight: 1, padding: '3px 4px', opacity: 0.6, color: 'var(--app-foreground)' }}>
              <Pencil size={14} />
            </button>
          ) : null}
          {isOwn ? (
            <button title="Delete" onClick={() => onDelete(msg.id)} style={{ display: 'inline-flex', alignItems: 'center', lineHeight: 1, padding: '3px 4px', opacity: 0.6, color: 'var(--app-foreground)' }}>
              <Trash2 size={14} />
            </button>
          ) : null}
        </div>
      ) : null}
        </div>
      </div>
    </>
  );
}

// One-line preview of a pinned message (markdown/whitespace collapsed).
function pinnedPreview(d: MessageDoc): string {
  const raw = (d.text ?? d.markdown ?? '').replace(/[#*_`>~]/g, '').replace(/\s+/g, ' ').trim();
  return raw.length > 140 ? `${raw.slice(0, 140)}…` : raw || 'Pinned message';
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
    ...(d.linkPreviews ? { linkPreviews: d.linkPreviews } : {}),
    ...(d.edited ? { edited: true } : {}),
    ...(d.systemType ? { systemType: d.systemType, systemParam: d.systemParam } : {}),
    ...(d.telemetry ? { telemetry: d.telemetry } : {}),
  } as ChatMessage;
}

export default function ChatPage({ conversationId }: { conversationId?: string }): React.ReactElement {
  const { socket, userId, uglyBotSocket } = useApp();
  const router = useRouter();
  const narrow = useNarrow();
  // Keyboard-inclusive bottom inset (home-indicator when closed, keyboard height
  // when open). The page declares interactive-widget=overlays-content so the
  // webview never resizes/scrolls for the keyboard — the composer's bottom
  // padding grows by this instead, and ChatView's flex layout shrinks the
  // message area above it so the latest message stays visible.
  const safeArea = useSafeAreaInsets();

  const roomId = conversationId ?? 'demo-room';

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // Initial message window — kept small for a fast first paint. Long
  // conversations (hundreds–thousands of messages) made the old flat 200-message
  // load ship ~700KB+ over the socket and parse 200 markdown bodies on mount.
  // The user pulls older history in on demand via ChatView's "Load more".
  const [msgLimit, setMsgLimit] = useState(INITIAL_MSG_LIMIT);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [ready, setReady] = useState(false);
  const [title, setTitle] = useState('Conversation');
  const [convImage, setConvImage] = useState<unknown>(null);
  const [profiles, setProfiles] = useState<Record<string, ChatUser>>({});
  const videoRef = useRef<VideoCallHandle>(null);
  // When a call is active the immersive stage takes over the conversation area
  // and the chat thread + composer are hidden behind it (mock parity).
  const [callActive, setCallActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastTypingSent = useRef(0);
  const typingStopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track when the user opened this conversation (for the session-duration cell).
  const openedAtRef = useRef(Date.now());
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  // Bot-chat extras: the conversation's bot id (if any), its starter buttons
  // (shown persistently above the composer), and the header "⋯" menu state.
  const [botId, setBotId] = useState<string | null>(null);
  const [botButtons, setBotButtons] = useState<{ label: string; prompt: string }[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDeleteConv, setConfirmDeleteConv] = useState(false);
  // Tap-to-select: the single message whose metadata + action menu are revealed.
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const selectMessage = useCallback((id: string) => {
    // Don't hijack a click that is really a text drag-selection (desktop copy).
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && sel.toString().length > 0) return;
    setSelectedMessageId((cur) => nextSelectedId(cur, id));
  }, []);
  // Per-conversation bot config (the ⋯ menu): mode + text model + image model/size.
  const [botModel, setBotModel] = useState<string | null>(null);
  const [botMode, setBotMode] = useState<string>('chat');
  const [botImageModel, setBotImageModel] = useState<string>('flux_1_dev');
  const [botImageSize, setBotImageSize] = useState<string>('square');
  const [typing, setTyping] = useState<ChatTypingEntry[]>([]);
  const [convType, setConvType] = useState<string>('group');
  const [pinnedMessageId, setPinnedMessageId] = useState<string | null>(null);
  const [pinnedMessage, setPinnedMessage] = useState<MessageDoc | null>(null);
  const [readers, setReaders] = useState<{ userId: string; viewed: number }[]>([]);
  // Fullscreen image viewer (rendered via a body portal so position:fixed is
  // viewport-relative — the router popup positioner is a transformed ancestor,
  // which would otherwise collapse a fixed overlay to 0×0).
  const [zoomImg, setZoomImg] = useState<{ src: string; alt: string } | null>(null);
  const openImage = useCallback((src: string, alt: string) => setZoomImg({ src, alt }), []);
  const [, forceTick] = useState(0);

  useEffect(() => {
    openedAtRef.current = Date.now();
    setReady(false);
    setMessages([]);
    setMsgLimit(INITIAL_MSG_LIMIT);
    setHasMoreMessages(false);
    setBotId(null); // re-derived by the dedicated effect below
    setBotModel(null);
    setBotButtons([]);
    setMenuOpen(false);
    setTyping([]);
    setPinnedMessageId(null);
    setPinnedMessage(null);
    setReaders([]);
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
        } else if (!cancelled) {
          // DM with no title → show the other participant's name (ugly.bot
          // parity). Direct conversations are keyed by the two user ids joined
          // with ':' (framework native) or legacy '+'. Either way, a 2-part id
          // containing our own userId is a DM.
          const sep = roomId.includes(':') ? ':' : roomId.includes('+') ? '+' : '';
          const parts = sep ? roomId.split(sep).filter(Boolean) : [];
          const other = parts.length === 2 ? parts.find((p) => p !== userId) : undefined;
          if (other) {
            const res = (await socket.request('profilesGet', { userIds: [other] })) as {
              profiles?: { name: string; avatar?: { image?: { uri?: string } } }[];
            };
            const p = res.profiles?.[0];
            if (p?.name && !cancelled) setTitle(p.name);
            // Use the partner's avatar in the header (the DM has no conv image).
            const partnerImg = p?.avatar?.image?.uri;
            if (partnerImg && !cancelled) setConvImage((img: unknown) => img ?? partnerImg);
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
          setTyping(((doc as { typing?: ChatTypingEntry[] }).typing ?? []));
          if (typeof doc.type === 'string') setConvType(doc.type);
          setPinnedMessageId((doc.pinnedMessageId as string | null | undefined) ?? null);
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
      // Messages are tracked in their own effect below (so "Load more" can grow
      // the window without re-running this conversation setup).
      setReady(true);
    })();
    return () => {
      cancelled = true;
      unsubConv?.();
      unsubUserConv?.();
    };
  }, [socket, userId, roomId]);

  // Message subscription — isolated from the conversation setup above so that
  // "Load more" (which grows msgLimit) re-subscribes ONLY the message window.
  // We fetch the newest `msgLimit` (created: -1) and re-sort ascending for
  // display; `hasMore` is true while we're getting a full window (older history
  // likely remains). Marking-read + read-state refresh ride along on each batch.
  useEffect(() => {
    const unsub = socket.trackDocs<MessageDoc>(
      'message',
      { keys: { conversationId: roomId }, sort: { created: -1 }, limit: msgLimit },
      (docs) => {
        const list = (Array.isArray(docs) ? docs : [])
          .filter((d) => !d.deleted)
          .map(toChatMessage)
          .sort((a, b) => a.created - b.created);
        setMessages(list);
        setHasMoreMessages(list.length >= msgLimit);
        pingConversationActivity();
        // Viewing the conversation clears its unread (on open + as messages
        // arrive while it's focused). Skipped for background tabs.
        if (typeof document === 'undefined' || document.visibilityState === 'visible') {
          void socket
            .request('conversationMarkRead', { conversationId: roomId })
            .then(() => pingConversationActivity())
            .catch(() => undefined);
          // Refresh the simple per-user last-read timestamps (for "Seen").
          void socket
            .request('conversationReadState', { conversationId: roomId })
            .then((r) => setReaders((r as { readers?: { userId: string; viewed: number }[] }).readers ?? []))
            .catch(() => undefined);
        }
      },
    );
    return () => unsub();
  }, [socket, roomId, msgLimit]);

  // Resolve participant profiles (real names + avatars). Also resolve membership
  // system-message targets (`systemParam`) so we can name them.
  useEffect(() => {
    const ids = messages.flatMap((m) => [
      m.userId,
      (m as { systemParam?: string }).systemParam ?? '',
    ]);
    const unknown = [...new Set(ids)].filter((id) => id && id !== 'global' && !profiles[id]);
    if (unknown.length === 0) return;
    void socket
      .request('profilesGet', { userIds: unknown })
      .then((res) => {
        const list = (res as { profiles?: { id: string; name: string; avatar?: { uri?: string | null; image?: { uri?: string }; background?: { uri?: string } | null }; isBot: boolean }[] }).profiles ?? [];
        setProfiles((prev) => {
          const next = { ...prev };
          for (const p of list) {
            // Framework ChatUser needs URLs; extract them from the avatar object
            // only here, at the render boundary. The call tiles need the 2D
            // image (avatarUrl), the 3D model (avatarGlbUrl), and the backdrop
            // (backgroundUrl) for the camera-off avatar view.
            const img = p.avatar?.image?.uri;
            const glb = p.avatar?.uri;
            const bg = p.avatar?.background?.uri;
            next[p.id] = {
              id: p.id,
              name: p.name,
              isBot: p.isBot,
              ...(img ? { avatarUrl: img } : {}),
              ...(glb ? { avatarGlbUrl: glb } : {}),
              ...(bg ? { backgroundUrl: bg } : {}),
            };
          }
          return next;
        });
      })
      .catch((err: unknown) => console.error('[ChatPage] profilesGet failed', err));
  }, [messages, profiles, socket, userId]);

  // Derive the conversation's bot id (drives the ⋯ menu + starter buttons).
  // Covered cases: a `bc-<botId>-<userId>` custom-bot room, the canonical Ugly
  // Bot DM (`<UGLY_BOT_ID>+<userId>`), or any resolved participant flagged
  // isBot (other migrated bots). Runs whenever profiles resolve.
  useEffect(() => {
    if (botId) return;
    if (roomId.startsWith('bc-') && roomId.endsWith(`-${userId}`)) {
      setBotId(roomId.slice(3, roomId.length - userId.length - 1));
      return;
    }
    if (roomId.includes('+')) {
      const other = roomId.split('+').filter(Boolean).find((p) => p !== userId);
      if (other === UGLY_BOT_ID) {
        setBotId(other);
        return;
      }
    }
    const botP = Object.values(profiles).find((p) => p.id !== userId && p.isBot);
    if (botP) setBotId(botP.id);
  }, [roomId, userId, profiles, botId]);

  // Load the bot's starter buttons (shown above the composer) + its model
  // (shown as the header subtitle, e.g. "DeepSeek v4 pro · online").
  useEffect(() => {
    if (!botId) {
      setBotButtons([]);
      setBotModel(null);
      return;
    }
    let cancelled = false;
    void socket
      .request('botGet', { botId })
      .then((doc) => {
        if (cancelled) return;
        const d = doc as { buttons?: { label: string; prompt: string }[]; model?: string } | null;
        setBotButtons((d?.buttons ?? []).filter((b) => b.label && b.prompt));
        const defaultModel = d?.model ?? null;
        // Per-conversation override (set via the ⋯ → Model picker) wins over the
        // bot's default; falls back to the default when none is set.
        void socket
          .getDoc('conversation', roomId)
          .then((cdoc) => {
            if (cancelled) return;
            type Cfg = { model?: string; mode?: string; imageModel?: string; imageSize?: string };
            const bots = (cdoc as { bots?: Record<string, Cfg> } | null)?.bots ?? {};
            const cfg = (botId && bots[botId]) || {};
            setBotModel(cfg.model || defaultModel);
            setBotMode(cfg.mode || 'chat');
            setBotImageModel(cfg.imageModel || 'flux_1_dev');
            setBotImageSize(cfg.imageSize || 'square');
          })
          .catch(() => { if (!cancelled) setBotModel(defaultModel); });
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [socket, botId, roomId]);

  // Set the bot's per-conversation config (⋯ menu). Optimistic; persists via
  // conversationSetBotModel (which patches any provided field).
  const setBotConfig = (patch: { model?: string; mode?: string; imageModel?: string; imageSize?: string }): void => {
    if (!botId) return;
    void socket
      .request('conversationSetBotModel', { conversationId: roomId, botId, ...patch })
      .catch(() => undefined);
  };
  const pickBotModel = (model: string): void => { setBotModel(model); setMenuOpen(false); setBotConfig({ model }); };
  const pickBotMode = (mode: string): void => { setBotMode(mode); setBotConfig({ mode }); };
  const pickImageModel = (imageModel: string): void => { setBotImageModel(imageModel); setBotConfig({ imageModel }); };
  const pickImageSize = (imageSize: string): void => { setBotImageSize(imageSize); setBotConfig({ imageSize }); };
  // Modes available for this bot: the built-in Ugly Bot gets the personas
  // (Honest/Lie); every bot gets Chat + Image.
  const isUglyBot = botId === UGLY_BOT_ID;
  const availableModes = BOT_MODES.filter((m) => isUglyBot || !m.persona || m.id === 'chat');

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

  const handleEdit = useCallback(
    async (messageId: string, markdown: string): Promise<void> => {
      await socket
        .request('conversationMessageEdit', {
          conversationId: roomId,
          messageId: splitId(messageId),
          markdown,
        })
        .catch((err: unknown) => {
          console.error('[ChatPage] edit failed', err);
          throw err;
        });
    },
    [socket, roomId],
  );

  // Resolve the pinned message doc for the banner (it may be outside the loaded
  // window, so fetch it directly by id rather than searching `messages`).
  useEffect(() => {
    if (!pinnedMessageId) {
      setPinnedMessage(null);
      return;
    }
    let cancelled = false;
    void socket
      .getDoc('message', pinnedMessageId)
      .then((d) => {
        if (!cancelled) setPinnedMessage((d as MessageDoc | null) ?? null);
      })
      .catch(() => {
        if (!cancelled) setPinnedMessage(null);
      });
    return () => {
      cancelled = true;
    };
  }, [socket, pinnedMessageId]);

  const handlePin = useCallback(
    (messageId: string) => {
      const next = pinnedMessageId === messageId ? null : messageId;
      void socket
        .request('conversationPinMessage', { conversationId: roomId, messageId: next })
        .catch((err: unknown) => console.error('[ChatPage] pin failed', err));
    },
    [socket, roomId, pinnedMessageId],
  );

  const handleClear = useCallback(() => {
    setMenuOpen(false);
    void socket
      .request('conversationClear', { conversationId: roomId })
      .then(() => pingConversationActivity())
      .catch((err: unknown) => console.error('[ChatPage] clear failed', err));
  }, [socket, roomId]);

  // Delete (owner) or leave (non-owner) the conversation, then return home.
  const handleDeleteConversation = useCallback(() => {
    setConfirmDeleteConv(false);
    setMenuOpen(false);
    void deleteOrLeaveConversation(socket, roomId, userId)
      .then(() => router.push('', {}))
      .catch((err: unknown) => console.error('[ChatPage] delete failed', err));
  }, [socket, roomId, userId, router]);

  // Typing indicator. The composer fires `onType` on every edit; we throttle
  // "start" pings to one / 3s, and after 4s of silence send a "stop" so the
  // bubble clears even if the user never sends. (A sent message clears it
  // server-side via the engine.)
  const signalTyping = useCallback(() => {
    const now = Date.now();
    if (now - lastTypingSent.current > 3000) {
      lastTypingSent.current = now;
      void socket
        .request('conversationSetTyping', { conversationId: roomId, start: now })
        .catch(() => undefined);
    }
    if (typingStopTimer.current) clearTimeout(typingStopTimer.current);
    typingStopTimer.current = setTimeout(() => {
      lastTypingSent.current = 0;
      void socket
        .request('conversationSetTyping', { conversationId: roomId, start: null })
        .catch(() => undefined);
    }, 4000);
  }, [socket, roomId]);

  // Clear our typing flag when leaving the conversation.
  useEffect(() => {
    return () => {
      if (typingStopTimer.current) clearTimeout(typingStopTimer.current);
      lastTypingSent.current = 0;
    };
  }, [roomId]);

  // Typing entries have a fixed `start`; re-render every 2s (only while someone
  // is typing) so stale ones (>6s) drop out of `typingEntries` below.
  const someoneElseTyping = typing.some((e) => e.userId !== userId);
  useEffect(() => {
    if (!someoneElseTyping) return;
    const t = setInterval(() => forceTick((x) => x + 1), 2000);
    return () => clearInterval(t);
  }, [someoneElseTyping]);

  // Computed inline (not memoized) so the 2s forceTick re-render re-evaluates
  // freshness and stale entries drop out.
  const typingEntries = typing.filter(
    (e) => e.userId !== userId && Date.now() - e.start < 6000,
  );

  // Scroll/pin behaviour (initial pin, follow-on-send, re-pin on keyboard +
  // late content, scroll-up paging, prepend restoration) is owned by
  // VirtualMessageList below.

  // DM ids are `{a}+{b}` / `{a}:{b}` containing self; everything else that's a
  // group gets the member-management UI (the ⋯ → Members panel).
  const isDm = (() => {
    const sep = roomId.includes(':') ? ':' : roomId.includes('+') ? '+' : '';
    if (!sep) return false;
    const parts = roomId.split(sep).filter(Boolean);
    return parts.length === 2 && parts.includes(userId);
  })();
  const canManageMembers = convType === 'group' && !isDm && roomId !== 'demo-room';

  // Human DM telemetry: derive StatMsg array (sorted by created, bot messages excluded)
  // and related flags once, shared between the strip and per-message receipts.
  const hasBot = botId !== null;

  // Read the "Response-time stats" toggle persisted by ChatSettingsPage (Plan 03).
  // Default ON unless the value is exactly '0'.
  const statsOn = useMemo(() => {
    if (typeof localStorage === 'undefined') return true;
    return localStorage.getItem(`uc-conv-${roomId}-responseStats`) !== '0';
  }, [roomId]);

  // Build a sorted StatMsg array (non-bot, non-deleted) for the reducers.
  const statMsgs: StatMsg[] = useMemo(
    () =>
      messages
        .filter((m) => !(m as { isBot?: boolean }).isBot)
        .map((m) => ({ userId: m.userId, created: m.created }))
        .sort((a, b) => a.created - b.created),
    [messages],
  );

  // Left-on-read proxy (v1, no schema change):
  // Count my messages where the other reader's `viewed` timestamp is at least 1h
  // later than my message's `created`, AND the reader sent nothing after that
  // message for >1h. Since we only have one viewed timestamp per reader (not
  // per-message), we use the simpler proxy: count runs where I sent a message,
  // then the other side's next message arrived >1h later (or hasn't arrived yet).
  // This is computed from statMsgs directly (pure derivation from real timestamps).
  const leftOnReadCount = useMemo((): number => {
    if (hasBot || statMsgs.length === 0) return 0;
    const ONE_HOUR = 3_600_000;
    let count = 0;
    for (let i = 0; i < statMsgs.length; i++) {
      const m = statMsgs[i];
      if (!m || m.userId !== userId) continue;
      // Find the next message from the other side after this one.
      const nextReply = statMsgs.slice(i + 1).find((x) => x.userId !== userId);
      if (nextReply) {
        if (nextReply.created - m.created > ONE_HOUR) count++;
      }
      // If no reply follows at all and >1h has elapsed since the message, count it.
      else if (Date.now() - m.created > ONE_HOUR) count++;
    }
    return count;
  }, [hasBot, statMsgs, userId]);

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
      const sysType = (msg as { systemType?: string }).systemType;
      if (sysType) {
        const param = (msg as { systemParam?: string }).systemParam ?? '';
        const name = profiles[param]?.name ?? param.slice(0, 8) ?? 'Someone';
        const text =
          sysType === 'memberAdd'
            ? `${name} joined`
            : sysType === 'memberLeave'
              ? `${name} left`
              : sysType === 'memberRemove'
                ? `${name} was removed`
                : '';
        if (!text) return null;
        return (
          <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--app-foreground)', opacity: 0.55, padding: '6px 14px' }}>
            {text}
          </div>
        );
      }
      const idx = messages.findIndex((m) => m.id === msg.id);
      const prev = idx > 0 ? messages[idx - 1] : undefined;
      const next = idx >= 0 && idx < messages.length - 1 ? messages[idx + 1] : undefined;
      const sameDay = (a: number, b: number): boolean => {
        const da = new Date(a), db = new Date(b);
        return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
      };
      // Day separator at the top of the thread and on each calendar-day boundary.
      const daySep =
        !prev || !sameDay(prev.created, msg.created)
          ? sameDay(msg.created, Date.now())
            ? `today · ${new Date(msg.created).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
            : new Date(msg.created).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
          : null;
      // A run = consecutive same-sender messages (no day break between them).
      const samePrev = !!prev && prev.userId === msg.userId && sameDay(prev.created, msg.created) && !(prev as { systemType?: string }).systemType;
      const sameNext = !!next && next.userId === msg.userId && sameDay(next.created, msg.created) && !(next as { systemType?: string }).systemType;
      const firstOfRun = !samePrev || daySep != null;
      const stacked = samePrev || sameNext;
      // For human DM receipts: find this message's position in the StatMsg array
      // (which is filtered to non-bot messages, same ordering as messages).
      const humanIdx = !hasBot && statsOn
        ? statMsgs.findIndex((s) => s.created === msg.created && s.userId === msg.userId)
        : -1;
      // "seen" = at least one other reader has a viewed timestamp >= this message's created.
      const humanSeen = readers.some((r) => r.userId !== userId && r.viewed >= msg.created);
      return (
        <MessageBody
          msg={msg}
          isOwn={msg.userId === userId}
          sender={getUser(msg.userId)}
          firstOfRun={firstOfRun}
          stacked={stacked}
          daySep={daySep}
          onReact={handleReact}
          onDelete={handleDelete}
          onEdit={handleEdit}
          onPin={handlePin}
          pinned={pinnedMessageId === msg.id}
          onButton={(prompt) => handleSend(prompt)}
          onOpenImage={openImage}
          isSelected={selectedMessageId === msg.id}
          onSelect={selectMessage}
          {...(humanIdx >= 0 ? { humanIdx } : {})}
          {...(!hasBot && statsOn ? { humanSorted: statMsgs, humanMeId: userId, humanStatsOn: true as const } : {})}
          {...(humanSeen ? { humanSeen: true as const } : {})}
        />
      );
    },
    [messages, userId, handleReact, handleDelete, handleEdit, handlePin, pinnedMessageId, handleSend, profiles,
      hasBot, statsOn, statMsgs, readers, getUser, openImage, selectedMessageId, selectMessage],
  );

  // Header subtitle model: the bot's configured model, else the model named on
  // the most recent telemetry receipt (covers bots whose doc we couldn't read).
  const headerModel = useMemo(() => {
    if (botModel) return modelLabel(botModel);
    for (let i = messages.length - 1; i >= 0; i--) {
      const t = (messages[i] as { telemetry?: MsgTelemetry }).telemetry;
      if (t?.model) return modelLabel(t.model);
    }
    return '';
  }, [botModel, messages]);

  // ⋯-menu picker row (label + check). Reused for mode / model / image rows.
  const menuLabelStyle: React.CSSProperties = { padding: '8px 14px 4px', fontSize: 11, fontWeight: 700, color: 'var(--app-foreground-muted)', textTransform: 'uppercase', letterSpacing: 0.5 };
  const pickRow = (key: string, label: string, selected: boolean, onClick: () => void): React.ReactNode => (
    <button
      key={key}
      type="button"
      className="uc-menuitem"
      onClick={onClick}
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 9, width: '100%', padding: '9px 14px', border: 'none', background: 'transparent', color: 'var(--app-foreground)', cursor: 'pointer', fontSize: 13, fontWeight: 600, textAlign: 'left' }}
    >
      <span>{label}</span>
      {selected ? <Check size={15} style={{ color: 'var(--app-primary)', flexShrink: 0 }} /> : null}
    </button>
  );

  const body = (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--app-main)',
      }}
    >
      {/* Conversation header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderBottom: '1px solid var(--app-border)', flexShrink: 0, background: 'transparent' }}>
        {narrow ? (
          <button
            type="button"
            onClick={() => router.push('', {})}
            aria-label="Back"
            style={{ border: 'none', background: 'transparent', fontSize: 22, lineHeight: 1, cursor: 'pointer', color: 'var(--app-foreground)', padding: '0 4px 0 0' }}
          >
            ‹
          </button>
        ) : null}
        <Avatar image={convImage} seed={roomId} label={title} size={30} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--app-foreground)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
          {/* Subtitle row — ALWAYS rendered with a reserved height so the async
              bot-id / model resolution never grows or shrinks the header (which
              caused a visible layout shift). Bots show their model once resolved;
              humans show nothing (no fabricated "online" presence). */}
          <div className="uc-receipt" style={{ marginTop: 1, height: 14, lineHeight: '14px', overflow: 'hidden' }}>
            {headerModel ? <b>{headerModel}</b> : null}
          </div>
        </div>
        {/* Theme picker — mobile only (desktop has it in the sidebar header). */}
        {narrow ? (
          <button
            type="button"
            onClick={() => openThemeMenu(router)}
            aria-label="Theme"
            title="Theme"
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: '50%', border: 'none', background: 'transparent', color: 'var(--app-foreground)', cursor: 'pointer', flexShrink: 0 }}
          >
            <Palette size={18} />
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => videoRef.current?.start()}
          aria-label="Start video call"
          title="Start video call"
          style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: '50%', border: 'none', background: 'transparent', color: 'var(--app-foreground)', cursor: 'pointer', flexShrink: 0 }}
        >
          <Video size={19} />
        </button>
        {/* Group info / settings */}
        {canManageMembers ? (
          <button
            type="button"
            onClick={() => router.push('settings/:conversationId', { conversationId: roomId })}
            aria-label="Group info"
            title="Group info"
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: '50%', border: 'none', background: 'transparent', color: 'var(--app-foreground)', cursor: 'pointer', flexShrink: 0 }}
          >
            <Settings size={18} />
          </button>
        ) : null}
        {/* Overflow menu — group chats manage members; bot chats can be wiped;
            every real conversation can be deleted (DMs included). */}
        {botId || canManageMembers || roomId !== 'demo-room' ? (
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <button
              type="button"
              onClick={() => { setMenuOpen((o) => !o); setConfirmDeleteConv(false); }}
              aria-label="More"
              title="More"
              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: '50%', border: 'none', background: 'transparent', color: 'var(--app-foreground)', cursor: 'pointer' }}
            >
              <MoreVertical size={19} />
            </button>
            {menuOpen ? (
              <>
                <div onClick={() => { setMenuOpen(false); setConfirmDeleteConv(false); }} style={{ position: 'fixed', inset: 0, zIndex: 20 }} />
                <div style={{ position: 'absolute', top: 38, right: 0, zIndex: 21, background: 'var(--app-main)', border: '1px solid var(--app-border)', borderRadius: 10, boxShadow: 'var(--app-shadow-button-default)', minWidth: 200, overflow: 'hidden', maxHeight: 360, overflowY: 'auto' }}>
                  {botId ? (
                    <div style={{ borderBottom: '1px solid var(--app-border)' }}>
                      <div style={menuLabelStyle}>Mode</div>
                      {availableModes.map((m) => pickRow(`mode-${m.id}`, m.label, botMode === m.id, () => pickBotMode(m.id)))}
                      {botMode === 'image' ? (
                        <>
                          <div style={menuLabelStyle}>Image model</div>
                          {IMAGE_MODELS.map((m) => pickRow(`im-${m.id}`, m.label, botImageModel === m.id, () => pickImageModel(m.id)))}
                          <div style={menuLabelStyle}>Image size</div>
                          {IMAGE_SIZES.map((m) => pickRow(`is-${m.id}`, m.label, botImageSize === m.id, () => pickImageSize(m.id)))}
                        </>
                      ) : (
                        <>
                          <div style={menuLabelStyle}>Model</div>
                          {BOT_MODELS.map((m) => pickRow(`tm-${m.id}`, (m.label.split('—')[0] ?? m.id).trim(), (botModel ?? BOT_MODELS[0]?.id) === m.id, () => pickBotModel(m.id)))}
                        </>
                      )}
                    </div>
                  ) : null}
                  {canManageMembers ? (
                    <button
                      type="button"
                      className="uc-menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        openMembersPopup(router, socket, userId, roomId, () => router.push('', {}));
                      }}
                      style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '11px 14px', border: 'none', background: 'transparent', color: 'var(--app-foreground)', cursor: 'pointer', fontSize: 14, fontWeight: 600, textAlign: 'left' }}
                    >
                      <Users size={16} /> Members
                    </button>
                  ) : null}
                  {botId ? (
                    <button
                      type="button"
                      className="uc-menuitem"
                      onClick={handleClear}
                      style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '11px 14px', border: 'none', background: 'transparent', color: 'var(--app-error)', cursor: 'pointer', fontSize: 14, fontWeight: 600, textAlign: 'left' }}
                    >
                      <Eraser size={16} /> Clear chat
                    </button>
                  ) : null}
                  {/* Delete conversation — owner deletes for everyone, non-owners
                      leave. Two-step inline confirm (no modal). */}
                  {roomId !== 'demo-room' ? (
                    confirmDeleteConv ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderTop: '1px solid var(--app-border)', background: 'rgba(var(--app-error-rgb, 220,38,38), 0.08)' }}>
                        <span style={{ flex: 1, fontSize: 13, color: 'var(--app-error)' }}>Delete this conversation?</span>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteConv(false)}
                          style={{ fontSize: 13, fontWeight: 600, padding: '5px 10px', borderRadius: 8, border: '1px solid var(--app-border)', background: 'transparent', color: 'var(--app-foreground)', cursor: 'pointer' }}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={handleDeleteConversation}
                          style={{ fontSize: 13, fontWeight: 700, padding: '5px 12px', borderRadius: 8, border: 'none', background: 'var(--app-error)', color: '#fff', cursor: 'pointer' }}
                        >
                          Delete
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="uc-menuitem"
                        onClick={() => setConfirmDeleteConv(true)}
                        style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '11px 14px', border: 'none', background: 'transparent', color: 'var(--app-error)', cursor: 'pointer', fontSize: 14, fontWeight: 600, textAlign: 'left' }}
                      >
                        <Trash2 size={16} /> Delete conversation
                      </button>
                    )
                  ) : null}
                </div>
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Pinned message banner */}
      {pinnedMessage ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 14px', borderBottom: '1px solid var(--app-border)', background: 'rgba(var(--app-primary-rgb), 0.07)', flexShrink: 0 }}>
          <Pin size={14} style={{ color: 'var(--app-primary)', flexShrink: 0 }} fill="currentColor" />
          <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--app-primary)' }}>Pinned</span>
            <span style={{ fontSize: 13, color: 'var(--app-foreground)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {pinnedPreview(pinnedMessage)}
            </span>
          </span>
          <button
            type="button"
            title="Unpin"
            aria-label="Unpin"
            onClick={() => handlePin(pinnedMessage._id)}
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, flexShrink: 0, borderRadius: 8, border: 'none', background: 'transparent', color: 'var(--app-foreground)', opacity: 0.6, cursor: 'pointer' }}
          >
            <X size={15} />
          </button>
        </div>
      ) : null}

      {/* Session telemetry strip — shown only for bot conversations */}
      {botId ? (() => {
        const tel = messages
          .filter((m) => !!(m as { telemetry?: MsgTelemetry }).telemetry)
          .map((m) => (m as { telemetry?: MsgTelemetry }).telemetry!);
        return tel.length > 0 ? (
          <TelemetryStrip telemetry={tel} openedAt={openedAtRef.current} />
        ) : null;
      })() : null}

      {/* Response-time totals strip — human DMs only, gated by settings toggle */}
      {!hasBot && statsOn && statMsgs.length > 1 ? (
        <HumanTelemetryStrip msgs={statMsgs} meId={userId} leftOnRead={leftOnReadCount} />
      ) : null}

      <CallLayout
        ref={videoRef}
        conversationId={roomId}
        meId={userId}
        socket={socket}
        uglyBotSocket={uglyBotSocket}
        profiles={profiles}
        botModel={headerModel}
        autoJoinBotId={botId}
        onActiveChange={setCallActive}
      />

      {/* Full-width scroll area (like ugly.bot) so the chat scrollbar sits at the
          pane's right edge, not at a centered column's edge. Hidden while a call
          is active — the immersive call stage takes over the conversation area. */}
      <div
        className="uc-chat-scroll"
        style={{
          flex: 1,
          minHeight: 0,
          width: '100%',
          display: callActive ? 'none' : 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Typing overlay — pinned at the TOP of the chat area so it never
            shifts the message list (the framework's in-flow indicator is
            suppressed via typingEntries={[]}). */}
        {typingEntries.length > 0 ? (
          <div className="uc-typing-overlay">
            {typingEntries.map((e) => getUser(e.userId).name).join(', ')} typing…
          </div>
        ) : null}
        <VirtualMessageList
          key={roomId}
          messages={messages}
          currentUserId={userId}
          renderItem={renderMessage}
          hasMore={hasMoreMessages}
          onLoadMore={() => setMsgLimit((l) => l + LOAD_MORE_STEP)}
          onUserScroll={() => setSelectedMessageId(null)}
          onBackgroundClick={() => setSelectedMessageId(null)}
          bottom={
          <div
            className="uc-composer"
            style={{
              paddingLeft: 16,
              paddingRight: 16,
              paddingBottom: Math.max(16, safeArea.bottom),
              // Ride up smoothly with the keyboard (matches the iOS curve).
              transition: 'padding-bottom 0.25s cubic-bezier(0.38, 0.7, 0.125, 1)',
            }}
          >
            {botButtons.length > 0 ? (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                {botButtons.map((b, i) => (
                  <button
                    key={`${b.label}-${i}`}
                    type="button"
                    className="uc-msgbtn"
                    onClick={() => handleSend(b.prompt)}
                    style={{ fontFamily: 'var(--app-font-mono)', fontSize: 11.5, fontWeight: 600, letterSpacing: '0.04em', padding: '7px 13px', borderRadius: 0, border: '1.5px solid var(--app-primary)', background: 'transparent', color: 'var(--app-primary)', cursor: 'pointer' }}
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
            <div style={{ border: '1px solid var(--app-primary)', borderRadius: 0, background: 'var(--app-main)' }}>
              <ConversationInput
                placeholder="/ slash · @ mention · ↩ send · ⇧↩ new line"
                autoFocus
                onSend={handleSendWithAttachments}
                onType={signalTyping}
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
          </div>
          }
        />
      </div>
      {zoomImg && typeof document !== 'undefined'
        ? createPortal(
            <ImageZoomViewer src={zoomImg.src} alt={zoomImg.alt} onClose={() => setZoomImg(null)} />,
            document.body,
          )
        : null}
    </div>
  );

  // Provide one shared TTS instance (ugly.bot WebSocket) to the message bubbles
  // when an ugly.bot socket is available; otherwise the speaker affordance is
  // hidden (VoiceProvider not mounted → useVoice().enabled === false).
  return uglyBotSocket ? (
    <VoiceProvider socket={uglyBotSocket}>{body}</VoiceProvider>
  ) : (
    body
  );
}
