import React, { useCallback, useState } from 'react';
import { Plus, PanelLeft, PanelLeftClose, Bot, Palette, UserCog } from 'lucide-react';
import { useApp } from 'ugly-app/client';
import { useRouter } from '../router';
import { useConversations, deleteOrLeaveConversation } from '../lib/conversations';
import { Avatar } from '../lib/conversations';
import { ConversationListBody } from './ConversationListBody';
import { openNewChatPopup } from './NewChatPopup';
import { openBotsPopup } from './BotsPopup';
import { openThemeMenu } from './ThemeMenu';
import { openUglyBotSettings } from '../lib/uglyBot';

// Matches ugly.bot's SidebarInternal: collapsed = 72px (avatar-only), expanded =
// resizable 250–400px persisted to localStorage 'leftSidebarWidth'; the
// collapsed/expanded state persists to 'leftSidebarExpanded'.
const COLLAPSED_WIDTH = 72;
const MIN_WIDTH = 250;
const MAX_WIDTH = 400;
// Below this the wordmark can't fit beside the header icon cluster, so hide it.
const LOGO_MIN_WIDTH = 300;

function loadNum(key: string, def: number): number {
  if (typeof window === 'undefined') return def;
  const n = Number(window.localStorage.getItem(key));
  return Number.isFinite(n) && n > 0 ? n : def;
}
function loadBool(key: string, def: boolean): boolean {
  if (typeof window === 'undefined') return def;
  const v = window.localStorage.getItem(key);
  return v === null ? def : v === '1';
}
function save(key: string, value: string): void {
  if (typeof window !== 'undefined') window.localStorage.setItem(key, value);
}

export function Sidebar(): React.ReactElement {
  const router = useRouter();
  const { socket, userId } = useApp();
  const { conversations, loading } = useConversations();
  const [q, setQ] = useState('');
  const [expanded, setExpandedState] = useState(() => loadBool('leftSidebarExpanded', true));
  const [width, setWidth] = useState(() => Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, loadNum('leftSidebarWidth', 300))));

  const activeId =
    router.current.routeName === ':conversationId'
      ? (router.current.params as { conversationId: string }).conversationId
      : null;

  const setExpanded = useCallback((v: boolean) => {
    setExpandedState(v);
    save('leftSidebarExpanded', v ? '1' : '0');
  }, []);

  const navigate = useCallback(
    (conversationId: string) => router.push(':conversationId', { conversationId }),
    [router],
  );

  // New chat + Bots are now transient popups (no full-page route). The popup
  // content renders OUTSIDE AppProvider, so we hand it the deps it needs.
  const openNew = useCallback(() => {
    const recent = conversations.filter((c) => c.type !== 'group').slice(0, 8);
    openNewChatPopup(router, socket, recent, navigate);
  }, [router, socket, conversations, navigate]);

  const openBots = useCallback(() => {
    openBotsPopup(router, socket, userId, (botId) => router.push('bot/:botId', { botId }), navigate);
  }, [router, socket, userId, navigate]);

  const openTheme = useCallback(() => openThemeMenu(router), [router]);

  // Pin/unpin a conversation. The userConversation trackDocs subscription
  // (keyed by userId) picks up the visibility change and refetches the list,
  // which re-sorts pinned-first — so no manual refetch needed.
  const togglePin = useCallback(
    (conversationId: string, pinned: boolean) => {
      void socket
        .request('conversationSetPinned', { conversationId, pinned })
        .catch((err: unknown) => console.error('[sidebar] pin failed', err));
    },
    [socket],
  );

  // Delete (or leave, for non-owners) a conversation. The userConversation
  // trackDocs subscription picks up the removed list row and refetches, so the
  // row disappears on its own — no manual refetch.
  const removeConversation = useCallback(
    (conversationId: string) => {
      void deleteOrLeaveConversation(socket, conversationId, userId).catch((err: unknown) =>
        console.error('[sidebar] delete failed', err),
      );
    },
    [socket, userId],
  );

  // Drag the right edge to resize (clamped 250–400, persisted).
  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const onMove = (ev: MouseEvent) => {
      const w = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, ev.clientX));
      setWidth(w);
      save('leftSidebarWidth', String(w));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  const filtered = q.trim()
    ? conversations.filter((c) => (c.title || '').toLowerCase().includes(q.trim().toLowerCase()))
    : conversations;

  // ── Collapsed (icon rail) ────────────────────────────────────────────────
  if (!expanded) {
    return (
      <aside style={{ ...railStyle, width: COLLAPSED_WIDTH }}>
        <div style={{ height: 52, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <button type="button" title="Expand" onClick={() => setExpanded(true)} className="uc-iconbtn" style={{ ...iconBtnStyle, border: 'none', background: 'transparent' }}>
            <PanelLeft size={20} />
          </button>
        </div>
        <button type="button" title="New chat" onClick={openNew} className="uc-iconbtn" style={{ ...iconBtnStyle, alignSelf: 'center', marginBottom: 6 }}>
          <Plus size={20} />
        </button>
        <button type="button" title="User settings" onClick={openUglyBotSettings} className="uc-iconbtn" style={{ ...iconBtnStyle, alignSelf: 'center', marginBottom: 6 }}>
          <UserCog size={20} />
        </button>
        <button type="button" title="Bots" onClick={openBots} className="uc-iconbtn" style={{ ...iconBtnStyle, alignSelf: 'center', marginBottom: 6 }}>
          <Bot size={20} />
        </button>
        <button type="button" title="Theme" onClick={openTheme} className="uc-iconbtn" style={{ ...iconBtnStyle, alignSelf: 'center', marginBottom: 6 }}>
          <Palette size={18} />
        </button>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '2px 0 16px' }}>
          {filtered.map((c) => (
            <button
              key={c.conversationId}
              type="button"
              title={c.title || 'Conversation'}
              onClick={() => router.push(':conversationId', { conversationId: c.conversationId })}
              className="uc-row"
              style={{ border: 'none', background: 'transparent', padding: 3, borderRadius: '50%', cursor: 'pointer', outline: c.conversationId === activeId ? '2px solid var(--app-primary)' : 'none' }}
            >
              <Avatar image={c.image} seed={c.conversationId} label={c.title} size={42} />
            </button>
          ))}
        </div>
      </aside>
    );
  }

  // ── Expanded ─────────────────────────────────────────────────────────────
  return (
    <aside style={{ ...railStyle, width, position: 'relative' }}>
      {/* Header / wordmark + collapse toggle */}
      <div style={{ height: 52, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px 0 8px' }}>
        <button type="button" title="Collapse" onClick={() => setExpanded(false)} className="uc-iconbtn" style={{ ...iconBtnStyle, border: 'none', background: 'transparent' }}>
          <PanelLeftClose size={20} />
        </button>
        {/* Wordmark doubles as a flex spacer that keeps the icon cluster
            right-aligned. Below ~300px the logo can't fit beside the icons, so
            hide its text (the empty button stays as the spacer) to avoid the
            wordmark overlapping the icon buttons in a narrow sidebar. */}
        <button type="button" onClick={() => router.push('', {})} style={{ flex: 1, minWidth: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}>
          {width >= LOGO_MIN_WIDTH ? (
            <>
              <span style={{ fontFamily: 'var(--app-font-heading)', fontWeight: 800, fontSize: 19, letterSpacing: '-0.03em', color: 'var(--app-foreground)', lineHeight: 1, whiteSpace: 'nowrap' }}>
                ugly<span style={{ color: 'var(--app-primary)' }}>.</span>chat
              </span>
              <span style={{ fontFamily: 'var(--app-font-mono)', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.16em', color: 'var(--app-foreground-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>
                your keys · your data · no filter
              </span>
            </>
          ) : null}
        </button>

        {/* Right-aligned icon cluster: Bots · Theme */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
          <button type="button" title="User settings" onClick={openUglyBotSettings} className="uc-iconbtn" style={smallIconBtn}>
            <UserCog size={18} />
          </button>
          <button type="button" title="Bots" onClick={openBots} className="uc-iconbtn" style={smallIconBtn}>
            <Bot size={18} />
          </button>
          <button type="button" title="Theme" onClick={openTheme} className="uc-iconbtn" style={smallIconBtn}>
            <Palette size={18} />
          </button>
        </div>
      </div>

      {/* Search + create */}
      <div style={{ padding: '2px 10px 8px', display: 'flex', gap: 8, alignItems: 'center' }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px', height: 38, borderRadius: 0, border: '1px solid var(--app-border)', background: 'var(--app-tertiary)' }}>
          <SearchIcon />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search"
            style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', outline: 'none', fontSize: 14, color: 'var(--app-foreground)' }}
          />
        </div>
        <button type="button" title="New chat" onClick={openNew} className="uc-iconbtn" style={iconBtnStyle}>
          <Plus size={20} />
        </button>
      </div>

      {/* Conversation list — pinned grouped above direct (shared body). */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '2px 0 16px' }}>
        <ConversationListBody
          conversations={conversations}
          filtered={filtered}
          loading={loading}
          searching={Boolean(q)}
          activeId={activeId}
          onSelect={navigate}
          onTogglePin={togglePin}
          onDelete={removeConversation}
        />
      </div>

      {/* Resize handle (right edge) */}
      <div
        onMouseDown={startResize}
        title="Drag to resize"
        style={{ position: 'absolute', top: 0, right: -3, bottom: 0, width: 6, cursor: 'col-resize', zIndex: 2 }}
      />
    </aside>
  );
}

const railStyle: React.CSSProperties = {
  flexShrink: 0,
  height: '100%',
  boxSizing: 'border-box',
  // Clear the home-indicator so the footer (Feedback) + last conversation aren't
  // cut off (the shell only insets top + sides).
  paddingBottom: 'env(safe-area-inset-bottom)',
  background: 'var(--app-sidebar)',
  borderRight: '1px solid var(--app-border)',
  display: 'flex',
  flexDirection: 'column',
};

const iconBtnStyle: React.CSSProperties = {
  width: 38,
  height: 38,
  flexShrink: 0,
  borderRadius: 12,
  border: '1px solid var(--app-border)',
  background: 'var(--app-main)',
  color: 'var(--app-foreground)',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

// Compact icon button for the header cluster (Bots · Theme · Feedback).
const smallIconBtn: React.CSSProperties = {
  width: 32,
  height: 32,
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

function SearchIcon(): React.ReactElement {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{ opacity: 0.45, flexShrink: 0 }}>
      <circle cx={11} cy={11} r={7} />
      <line x1={21} y1={21} x2={16.65} y2={16.65} />
    </svg>
  );
}
