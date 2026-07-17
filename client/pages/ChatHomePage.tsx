import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Bot, Palette, UserCog } from 'lucide-react';
import { useApp } from 'ugly-app/client';
import { useRouter } from '../router';
import { useConversations } from '../lib/conversations';
import { openNewChatPopup } from '../components/NewChatPopup';
import { openBotsPopup } from '../components/BotsPopup';
import { startBotChat } from '../lib/bots';
import { UGLY_BOT_ID } from '../../shared/bots';
import { openThemeMenu } from '../components/ThemeMenu';
import { openUglyBotSettings } from '../lib/uglyBot';
import { ConversationListBody } from '../components/ConversationListBody';

// True when the viewport is narrow enough that AppShell hides the sidebar
// (<820px). Mirrors ChatPage's useNarrow.
function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => (typeof window === 'undefined' ? false : window.innerWidth < 820));
  useEffect(() => {
    const f = (): void => { setNarrow(window.innerWidth < 820); };
    window.addEventListener('resize', f);
    return () => { window.removeEventListener('resize', f); };
  }, []);
  return narrow;
}

// Chat-home main pane (the column beside the sidebar; on mobile it's the whole
// view). On desktop, with no thread selected, we show the mock's empty hero.
// On mobile the sidebar is hidden, so this pane stands in for it: we render the
// full conversation LIST (search + new-chat + grouped rows) instead.
export default function ChatHomePage(): React.ReactElement {
  const router = useRouter();
  const { socket, userId } = useApp();
  const { conversations, loading } = useConversations();
  const narrow = useNarrow();

  const navigate = useCallback(
    (conversationId: string) => { router.push(':conversationId', { conversationId }); },
    [router],
  );

  const openNew = useCallback(() => {
    const recent = conversations.filter((c) => c.type !== 'group').slice(0, 8);
    openNewChatPopup(router, socket, recent, navigate);
  }, [router, socket, conversations, navigate]);

  // Primary first-run action: drop straight into a chat with the built-in AI.
  // "New conversation" (people) dead-ended newcomers on an empty contacts list.
  const chatWithAI = useCallback(() => {
    void startBotChat(socket, userId, { _id: UGLY_BOT_ID, ownerId: '', name: 'Ugly Bot' }, navigate);
  }, [socket, userId, navigate]);

  const openBots = useCallback(() => {
    openBotsPopup(router, socket, userId, (botId) => { router.push('bot/:botId', { botId }); }, navigate);
  }, [router, socket, userId, navigate]);

  const openTheme = useCallback(() => { openThemeMenu(router); }, [router]);

  const iconCluster = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
      <button type="button" title="User settings" onClick={openUglyBotSettings} className="uc-iconbtn" style={topIconBtn} data-id="button">
        <UserCog size={18} />
      </button>
      <button type="button" title="Bots" onClick={openBots} className="uc-iconbtn" style={topIconBtn} data-id="button-2">
        <Bot size={18} />
      </button>
      <button type="button" title="Theme" onClick={openTheme} className="uc-iconbtn" style={topIconBtn} data-id="button-3">
        <Palette size={18} />
      </button>
    </div>
  );

  // ── Mobile: full-page conversation list (the sidebar is hidden here) ──────
  if (narrow) return <MobileHome
    conversations={conversations}
    loading={loading}
    navigate={navigate}
    openNew={openNew}
    chatWithAI={chatWithAI}
    iconCluster={iconCluster}
  />;

  // ── Desktop: empty hero (the sidebar already shows the list) ──────────────
  return (
    <div
      style={{
        position: 'relative',
        display: 'grid',
        placeItems: 'center',
        height: '100%',
        overflow: 'hidden',
        background: 'var(--app-main)',
      }}
    >
      {/* The sidebar already carries the icon cluster on desktop, so the empty
          hero doesn't repeat it (it read as a redundant, confusing second trio). */}

      {/* Faint 64px grid, radial-masked toward the top-center. */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage:
            'linear-gradient(var(--app-border) 1px, transparent 1px), linear-gradient(90deg, var(--app-border) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
          WebkitMaskImage: 'radial-gradient(circle at 50% 30%, #000 0%, transparent 75%)',
          maskImage: 'radial-gradient(circle at 50% 30%, #000 0%, transparent 75%)',
          opacity: 0.5,
          pointerEvents: 'none',
        }}
      />

      <div style={{ position: 'relative', textAlign: 'center', maxWidth: 440, padding: 30 }}>
        <h1
          style={{
            margin: 0,
            fontFamily: 'var(--app-font-heading)',
            fontWeight: 800,
            fontSize: 44,
            lineHeight: 0.96,
            letterSpacing: '-0.04em',
            color: 'var(--app-foreground)',
          }}
        >
          Pick a thread.
          <br />
          <span style={{ color: 'var(--app-foreground-muted)' }}>Or start one.</span>
        </h1>

        <p
          style={{
            margin: '18px auto 26px',
            maxWidth: 360,
            fontSize: 15,
            lineHeight: 1.55,
            color: 'var(--app-foreground-muted)',
          }}
        >
          We won&apos;t autocomplete your feelings, invent a friend who isn&apos;t there, or tell you the message sent
          when it didn&apos;t.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <button
            type="button"
            onClick={chatWithAI}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 10,
              padding: '13px 22px',
              border: 'none',
              cursor: 'pointer',
              background: 'var(--app-primary)',
              color: 'var(--app-on-primary)',
              fontFamily: 'var(--app-font-heading)',
              fontWeight: 800,
              fontSize: 13,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
            }} data-id="chat-with-ai"
          >
            <Bot size={16} />
            Chat with Ugly Bot
          </button>
          <button
            type="button"
            onClick={openNew}
            style={{
              border: 'none', background: 'transparent', cursor: 'pointer',
              fontFamily: 'var(--app-font-mono)', fontSize: 11, letterSpacing: '0.06em',
              textTransform: 'uppercase', color: 'var(--app-foreground-muted)',
            }} data-id="new-conversation"
          >
            or message a person
          </button>
        </div>

        <div
          style={{
            marginTop: 26,
            fontFamily: 'var(--app-font-mono)',
            fontSize: 10.5,
            letterSpacing: '0.02em',
            color: 'var(--app-foreground-muted)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 7,
            whiteSpace: 'nowrap',
          }}
        >
          <span>open models</span>
          <span style={{ color: 'var(--app-border)' }}>·</span>
          <span style={{ color: 'var(--app-primary)' }}>$0.00/mo</span>
        </div>
      </div>
    </div>
  );
}

// Mobile home: wordmark + icon cluster header, a search box + new-chat button,
// and the grouped conversation list (reusing the same body as the sidebar),
// plus a floating new-chat button.
function MobileHome({
  conversations,
  loading,
  navigate,
  openNew,
  chatWithAI,
  iconCluster,
}: {
  conversations: ReturnType<typeof useConversations>['conversations'];
  loading: boolean;
  navigate: (conversationId: string) => void;
  openNew: () => void;
  chatWithAI: () => void;
  iconCluster: React.ReactElement;
}): React.ReactElement {
  const [q, setQ] = useState('');
  const filtered = q.trim()
    ? conversations.filter((c) => (c.title || '').toLowerCase().includes(q.trim().toLowerCase()))
    : conversations;
  const showHero = !loading && !q.trim() && conversations.length === 0;

  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', height: '100%', boxSizing: 'border-box', paddingBottom: 'env(safe-area-inset-bottom)', background: 'var(--app-sidebar)' }}>
      {/* Header: wordmark + icon cluster */}
      <div style={{ height: 52, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px' }}>
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontFamily: 'var(--app-font-heading)', fontWeight: 800, fontSize: 19, letterSpacing: '-0.03em', color: 'var(--app-foreground)', lineHeight: 1, whiteSpace: 'nowrap' }}>
            ugly<span style={{ color: 'var(--app-primary)' }}>.</span>chat
          </span>
          <span style={{ fontFamily: 'var(--app-font-mono)', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.16em', color: 'var(--app-foreground-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>
            your keys · your data · no filter
          </span>
        </span>
        {iconCluster}
      </div>

      {/* Search + new-chat */}
      <div style={{ padding: '2px 12px 8px', display: 'flex', gap: 8, alignItems: 'center' }}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px', height: 38, borderRadius: 0, border: '1px solid var(--app-border)', background: 'var(--app-tertiary)' }}>
          <SearchIcon />
          <input
            value={q}
            onChange={(e) => { setQ(e.target.value); }}
            placeholder="Search"
            style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', outline: 'none', fontSize: 14, color: 'var(--app-foreground)' }} data-id="search"
          />
        </div>
        <button type="button" title="New chat" onClick={openNew} className="uc-iconbtn" style={squareIconBtn} data-id="button-4">
          <Plus size={20} />
        </button>
      </div>

      {/* Conversation list — or, on a fresh account, a hero that points at the AI
          instead of a bare "No conversations yet" list. */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: showHero ? '0' : '2px 0 80px' }}>
        {showHero ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', height: '100%', padding: '0 32px 60px', gap: 16 }}>
            <h1 style={{ margin: 0, fontFamily: 'var(--app-font-heading)', fontWeight: 800, fontSize: 30, lineHeight: 1, letterSpacing: '-0.03em', color: 'var(--app-foreground)' }}>
              Start chatting.
            </h1>
            <p style={{ margin: 0, maxWidth: 300, fontSize: 14, lineHeight: 1.5, color: 'var(--app-foreground-muted)' }}>
              Talk to the AI on your own key, build your own bots, or message a real person.
            </p>
            <button
              type="button"
              onClick={chatWithAI}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 9, marginTop: 4, padding: '13px 22px', border: 'none', cursor: 'pointer', background: 'var(--app-primary)', color: 'var(--app-on-primary)', fontFamily: 'var(--app-font-heading)', fontWeight: 800, fontSize: 13, letterSpacing: '0.12em', textTransform: 'uppercase' }} data-id="chat-with-ai"
            >
              <Bot size={16} /> Chat with Ugly Bot
            </button>
            <button
              type="button"
              onClick={openNew}
              style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'var(--app-font-mono)', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--app-foreground-muted)' }} data-id="new-conversation"
            >
              or message a person
            </button>
          </div>
        ) : (
          <ConversationListBody
            conversations={conversations}
            filtered={filtered}
            loading={loading}
            searching={Boolean(q)}
            activeId={null}
            onSelect={navigate}
          />
        )}
      </div>

      {/* Floating new-chat button */}
      <button
        type="button"
        title="New chat"
        aria-label="New chat"
        onClick={openNew}
        style={{
          position: 'absolute',
          right: 18,
          bottom: 18,
          width: 52,
          height: 52,
          borderRadius: 0,
          border: 'none',
          background: 'var(--app-primary)',
          color: 'var(--app-on-primary)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: 'var(--app-shadow-button-default)',
          zIndex: 2,
        }} data-id="new-chat"
      >
        <Plus size={24} />
      </button>
    </div>
  );
}

function SearchIcon(): React.ReactElement {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{ opacity: 0.45, flexShrink: 0 }}>
      <circle cx={11} cy={11} r={7} />
      <line x1={21} y1={21} x2={16.65} y2={16.65} />
    </svg>
  );
}

const topIconBtn: React.CSSProperties = {
  width: 34,
  height: 34,
  flexShrink: 0,
  borderRadius: 8,
  border: 'none',
  background: 'transparent',
  color: 'var(--app-foreground-muted)',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

// Square new-chat button matching the sidebar's chrome.
const squareIconBtn: React.CSSProperties = {
  width: 38,
  height: 38,
  flexShrink: 0,
  borderRadius: 0,
  border: '1px solid var(--app-border)',
  background: 'var(--app-main)',
  color: 'var(--app-foreground)',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};
