import React, { useCallback, useState } from 'react';
import { Plus, PanelLeft, PanelLeftClose, Bot } from 'lucide-react';
import { useApp } from 'ugly-app/client';
import { useRouter } from '../router';
import { useConversations } from '../lib/conversations';
import { Avatar } from '../lib/conversations';
import { ConversationRow } from './ConversationRow';
import { ThemePicker } from './ThemePicker';

// Matches ugly.bot's SidebarInternal: collapsed = 72px (avatar-only), expanded =
// resizable 250–400px persisted to localStorage 'leftSidebarWidth'; the
// collapsed/expanded state persists to 'leftSidebarExpanded'.
const COLLAPSED_WIDTH = 72;
const MIN_WIDTH = 250;
const MAX_WIDTH = 400;

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
  const { socket } = useApp();
  const { conversations, loading } = useConversations();
  const [q, setQ] = useState('');
  const [expanded, setExpandedState] = useState(() => loadBool('leftSidebarExpanded', true));
  const [width, setWidth] = useState(() => Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, loadNum('leftSidebarWidth', 300))));

  const activeId =
    router.current.routeName === 'chat/:conversationId'
      ? (router.current.params as { conversationId: string }).conversationId
      : null;

  const setExpanded = useCallback((v: boolean) => {
    setExpandedState(v);
    save('leftSidebarExpanded', v ? '1' : '0');
  }, []);

  const openNew = useCallback(() => {
    router.push('new', {});
  }, [router]);

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

  // Group pinned conversations at the top under a // PINNED header; the rest
  // fall under // DIRECT. We don't reliably know which rows are bots from the
  // list payload, so we don't invent a // BOTS section.
  const pinned = filtered.filter((c) => c.pinned);
  const rest = filtered.filter((c) => !c.pinned);

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
        <button type="button" title="Bots" onClick={() => router.push('bots', {})} className="uc-iconbtn" style={{ ...iconBtnStyle, alignSelf: 'center', marginBottom: 6 }}>
          <Bot size={20} />
        </button>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '2px 0 16px' }}>
          {filtered.map((c) => (
            <button
              key={c.conversationId}
              type="button"
              title={c.title || 'Conversation'}
              onClick={() => router.push('chat/:conversationId', { conversationId: c.conversationId })}
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
        <button type="button" onClick={() => router.push('chat', {})} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}>
          <span style={{ fontFamily: 'var(--app-font-heading)', fontWeight: 800, fontSize: 19, letterSpacing: '-0.03em', color: 'var(--app-foreground)', lineHeight: 1, whiteSpace: 'nowrap' }}>
            ugly<span style={{ color: 'var(--app-primary)' }}>.</span>chat
          </span>
          <span style={{ fontFamily: 'var(--app-font-mono)', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.16em', color: 'var(--app-foreground-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>
            your keys · your data · no filter
          </span>
        </button>
      </div>

      {/* Search + create */}
      <div style={{ padding: '2px 10px 8px', display: 'flex', gap: 8, alignItems: 'center' }}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px', height: 38, borderRadius: 0, border: '1px solid var(--app-border)', background: 'var(--app-tertiary)' }}>
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

      {/* Conversation list */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '2px 0 16px' }}>
        {loading && conversations.length === 0 ? (
          <EmptyHint text="Loading…" />
        ) : filtered.length === 0 ? (
          <EmptyHint text={q ? 'No matches' : 'No conversations yet'} />
        ) : (
          <>
            {pinned.length > 0 ? (
              <>
                <SectionLabel text="pinned" />
                {pinned.map((c) => (
                  <ConversationRow
                    key={c.conversationId}
                    row={c}
                    selected={c.conversationId === activeId}
                    onClick={() => router.push('chat/:conversationId', { conversationId: c.conversationId })}
                    onTogglePin={() => togglePin(c.conversationId, !c.pinned)}
                  />
                ))}
              </>
            ) : null}
            {rest.length > 0 ? (
              <>
                <SectionLabel text="direct" />
                {rest.map((c) => (
                  <ConversationRow
                    key={c.conversationId}
                    row={c}
                    selected={c.conversationId === activeId}
                    onClick={() => router.push('chat/:conversationId', { conversationId: c.conversationId })}
                    onTogglePin={() => togglePin(c.conversationId, !c.pinned)}
                  />
                ))}
              </>
            ) : null}
          </>
        )}
      </div>

      {/* Theme picker */}
      <ThemePicker />

      {/* Footer */}
      <div style={{ padding: 10, display: 'flex', gap: 8, borderTop: '1px solid var(--app-border)', flexShrink: 0 }}>
        <button type="button" className="uc-footbtn" style={footBtnStyle} onClick={() => router.push('bots', {})}>
          Bots
        </button>
        <button type="button" className="uc-footbtn" style={footBtnStyle} onClick={() => document.querySelector<HTMLElement>('[data-id="feedback-button"]')?.click()}>
          Feedback
        </button>
        <button type="button" className="uc-footbtn" style={footBtnStyle} onClick={() => router.push('settings', {})}>
          Settings
        </button>
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

const footBtnStyle: React.CSSProperties = {
  flex: 1,
  height: 36,
  borderRadius: 0,
  border: '1px solid var(--app-border)',
  background: 'var(--app-main)',
  color: 'var(--app-foreground)',
  fontSize: 11,
  fontWeight: 600,
  fontFamily: 'var(--app-font-mono)',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.06em',
  cursor: 'pointer',
};

function SectionLabel({ text }: { text: string }): React.ReactElement {
  return (
    <div className="uc-mono-label" style={{ padding: '12px 14px 4px' }}>
      <span style={{ color: 'var(--app-primary)' }}>//</span> {text}
    </div>
  );
}

function EmptyHint({ text }: { text: string }): React.ReactElement {
  return (
    <div style={{ padding: '24px 14px', textAlign: 'center', fontSize: 13, color: 'var(--app-foreground)', opacity: 0.45 }}>
      {text}
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
