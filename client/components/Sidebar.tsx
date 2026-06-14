import React, { useCallback, useState } from 'react';
import { Plus, PanelLeft, PanelLeftClose, Bot } from 'lucide-react';
import { useApp } from 'ugly-app/client';
import { useRouter } from '../router';
import { useConversations } from '../lib/conversations';
import { Avatar } from '../lib/conversations';
import { ConversationRow } from './ConversationRow';
import { openNewChatPopup } from './NewChatPopup';

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
  const { socket, userId } = useApp();
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
    openNewChatPopup(router, socket, userId, (id) => router.push('chat/:conversationId', { conversationId: id }));
  }, [router, socket, userId]);

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
        <button type="button" onClick={() => router.push('chat', {})} style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, background: 'transparent', border: 'none', cursor: 'pointer' }}>
          <img src="/icon.png" width={24} height={24} alt="" style={{ borderRadius: 7 }} />
          <span style={{ fontFamily: 'var(--app-font-heading)', fontWeight: 800, fontSize: 17, color: 'var(--app-foreground)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            Ugly Chat
          </span>
        </button>
      </div>

      {/* Search + create */}
      <div style={{ padding: '2px 10px 8px', display: 'flex', gap: 8, alignItems: 'center' }}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px', height: 38, borderRadius: 16, border: '2px solid var(--app-foreground-20)', background: 'rgba(var(--app-tertiary-rgb), 0.5)' }}>
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
          filtered.map((c) => (
            <ConversationRow
              key={c.conversationId}
              row={c}
              selected={c.conversationId === activeId}
              onClick={() => router.push('chat/:conversationId', { conversationId: c.conversationId })}
            />
          ))
        )}
      </div>

      {/* Footer */}
      <div style={{ padding: 10, display: 'flex', gap: 8, borderTop: '1px solid var(--app-border)', flexShrink: 0 }}>
        <button type="button" className="uc-footbtn" style={footBtnStyle} onClick={() => router.push('bots', {})}>
          Bots
        </button>
        <button type="button" className="uc-footbtn" style={footBtnStyle} onClick={() => document.querySelector<HTMLElement>('[data-id="feedback-button"]')?.click()}>
          Feedback
        </button>
        <button type="button" className="uc-footbtn" style={footBtnStyle} onClick={() => router.push('chat', {})}>
          All Chats
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
  borderRadius: 8,
  border: '1px solid var(--app-border)',
  background: 'var(--app-main)',
  color: 'var(--app-foreground)',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
};

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
