import React, { useCallback, useEffect, useState } from 'react';
import { Flame, MessageSquarePlus, Search } from 'lucide-react';
import { useApp } from 'ugly-app/client';
import { useRouter } from '../router';
import { Avatar, useConversations, type ConvRow } from '../lib/conversations';
import { openNewChatPopup } from '../components/NewChatPopup';
import { UGLY_BOT_USER_ID } from '../../shared/bots';

// Every user gets a 1:1 conversation with the canonical Ugly Bot. Same id shape
// as the migrated DMs (`<botId>+<userId>`), so existing users already have it.
const uglyBotChatId = (userId: string): string => `${UGLY_BOT_USER_ID}+${userId}`;

// Chat-home directory pane (the main column beside the sidebar), styled after
// ugly.bot/chatHome: centered "Chat" title, big search, Featured gradient
// cards, the conversation list, and a floating "Create Chat" button.
export default function ChatHomePage(): React.ReactElement {
  const { socket, userId } = useApp();
  const router = useRouter();
  const { conversations, loading, refetch } = useConversations();
  const [q, setQ] = useState('');

  // Every user gets a conversation with Ugly Bot — create it once if missing
  // (existing users already have the migrated DM at the same id). The server
  // seeds Ugly Bot's greeting on create.
  useEffect(() => {
    void (async () => {
      try {
        const id = uglyBotChatId(userId);
        const existing = await socket.getDoc('conversation', id);
        if (!existing) {
          await socket.request('conversationCreate', {
            id,
            type: 'group',
            title: 'Ugly Bot',
            mode: 'public',
            ownerIds: [userId],
          });
          refetch();
        }
      } catch (err) {
        console.error('[ChatHome] ensure Ugly Bot chat failed', err);
      }
    })();
  }, [socket, userId, refetch]);

  const open = useCallback(
    (conversationId: string) => router.push('chat/:conversationId', { conversationId }),
    [router],
  );

  const startBotChat = useCallback(async () => {
    const id = uglyBotChatId(userId);
    try {
      const existing = await socket.getDoc('conversation', id);
      if (!existing) {
        await socket.request('conversationCreate', {
          id,
          type: 'group',
          title: 'Ugly Bot',
          mode: 'public',
          ownerIds: [userId],
        });
      }
      open(id);
    } catch (err) {
      console.error('[ChatHome] start bot chat failed', err);
    }
  }, [socket, userId, open]);

  const filtered = q.trim()
    ? conversations.filter((c) => (c.title || '').toLowerCase().includes(q.trim().toLowerCase()))
    : conversations;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--app-main)' }}>
      {/* Top bar */}
      <div
        style={{
          height: 52,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderBottom: '1px solid var(--app-border)',
        }}
      >
        <span style={{ fontFamily: 'var(--app-font-heading)', fontWeight: 800, fontSize: 17, color: 'var(--app-foreground)' }}>
          Chat
        </span>
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        <div style={{ maxWidth: 900, margin: '0 auto', padding: '16px 16px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Big search */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '0 14px',
              height: 48,
              borderRadius: 16,
              border: '2px solid var(--app-primary)',
              background: 'var(--app-main)',
            }}
          >
            <SearchIcon />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search"
              style={{ flex: 1, border: 'none', background: 'transparent', outline: 'none', fontSize: 16, color: 'var(--app-foreground)' }}
            />
          </div>

          {/* Featured */}
          {!q.trim() ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <span style={{ fontFamily: 'var(--app-font-heading)', fontWeight: 700, fontSize: 17, color: 'var(--app-foreground)' }}>
                Featured
              </span>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <FeaturedCard
                  gradient="linear-gradient(135deg, #ff6b35 0%, #f72585 50%, #7209b7 100%)"
                  icon={Flame}
                  title="Get Roasted"
                  subtitle="Chat with Ugly Bot live"
                  onClick={() => void startBotChat()}
                />
                <FeaturedCard
                  gradient="linear-gradient(135deg, #00c6fb 0%, #005bea 50%, #6a11cb 100%)"
                  icon={MessageSquarePlus}
                  title="New Group Chat"
                  subtitle="Start a conversation"
                  onClick={() => openNewChatPopup(router, socket, userId, open)}
                />
              </div>
            </div>
          ) : null}

          {/* Conversation list */}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {/* The box above filters conversation TITLES; this jumps to a
                full-text search across all message bodies. */}
            {q.trim().length >= 2 ? (
              <button
                type="button"
                className="uc-row"
                onClick={() => router.push('search', { q: q.trim() })}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  width: '100%',
                  padding: '10px 8px',
                  border: 'none',
                  borderBottom: '1px solid var(--app-border)',
                  background: 'transparent',
                  cursor: 'pointer',
                  textAlign: 'left',
                  font: 'inherit',
                  color: 'var(--app-primary)',
                  fontWeight: 600,
                }}
              >
                <Search size={18} />
                Search all messages for “{q.trim()}”
              </button>
            ) : null}
            {loading && conversations.length === 0 ? (
              <Hint text="Loading…" />
            ) : filtered.length === 0 ? (
              <Hint text={q ? 'No matches' : 'No conversations yet — start one above'} />
            ) : (
              filtered.map((c) => <HomeRow key={c.conversationId} row={c} onClick={() => open(c.conversationId)} />)
            )}
          </div>
        </div>
      </div>

      {/* Create Chat */}
      <div style={{ flexShrink: 0, padding: 12, borderTop: '1px solid var(--app-border)', display: 'flex', justifyContent: 'center' }}>
        <button
          type="button"
          onClick={() => openNewChatPopup(router, socket, userId, open)}
          style={{
            padding: '10px 22px',
            borderRadius: 12,
            border: 'none',
            background: 'var(--app-primary)',
            color: '#fff',
            fontSize: 15,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Create Chat
        </button>
      </div>
    </div>
  );
}

function HomeRow({ row, onClick }: { row: ConvRow; onClick: () => void }): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className="uc-row"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        width: '100%',
        padding: '10px 8px',
        border: 'none',
        background: 'transparent',
        cursor: 'pointer',
        textAlign: 'left',
        font: 'inherit',
      }}
    >
      <Avatar image={row.image} seed={row.conversationId} label={row.title} size={46} />
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--app-foreground)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {row.title || 'Conversation'}
        </span>
        {row.preview ? (
          <span style={{ fontSize: 13, color: 'var(--app-foreground)', opacity: 0.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {row.preview}
          </span>
        ) : null}
      </span>
      {row.unread > 0 ? (
        <span style={{ minWidth: 20, height: 20, padding: '0 6px', borderRadius: 999, background: 'var(--app-primary)', color: '#fff', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {row.unread > 99 ? '99+' : row.unread}
        </span>
      ) : null}
    </button>
  );
}

function FeaturedCard(props: {
  gradient: string;
  icon: React.ComponentType<{ size?: number; color?: string }>;
  title: string;
  subtitle: string;
  onClick: () => void;
}): React.ReactElement {
  const Icon = props.icon;
  return (
    <button
      type="button"
      onClick={props.onClick}
      className="uc-featured"
      style={{
        flex: '1 1 240px',
        minWidth: 220,
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: 16,
        borderRadius: 16,
        border: 'none',
        cursor: 'pointer',
        textAlign: 'left',
        background: props.gradient,
      }}
    >
      <span
        style={{
          width: 48,
          height: 48,
          borderRadius: 24,
          background: 'rgba(255,255,255,0.2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <Icon size={24} color="#fff" />
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontFamily: 'var(--app-font-heading)', fontWeight: 800, fontSize: 17, color: '#fff' }}>{props.title}</span>
        <span style={{ fontSize: 13, color: '#fff', opacity: 0.9 }}>{props.subtitle}</span>
      </span>
    </button>
  );
}

function Hint({ text }: { text: string }): React.ReactElement {
  return <div style={{ padding: '32px 8px', textAlign: 'center', fontSize: 14, color: 'var(--app-foreground)', opacity: 0.45 }}>{text}</div>;
}

function SearchIcon(): React.ReactElement {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="var(--app-primary)" strokeWidth={2} style={{ flexShrink: 0 }}>
      <circle cx={11} cy={11} r={7} />
      <line x1={21} y1={21} x2={16.65} y2={16.65} />
    </svg>
  );
}
