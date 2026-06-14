import React, { useCallback, useState } from 'react';
import { Flame, MessageSquarePlus, Users } from 'lucide-react';

// The popup renders in the router's popup portal, which is OUTSIDE <AppProvider>,
// so it can't use useApp()/useRouter(). Deps are passed in by the opener instead.
interface PopupSocket {
  request: (name: 'conversationCreate', input: Record<string, unknown>) => Promise<unknown>;
  getDoc: (collection: 'conversation', id: string) => Promise<unknown>;
}

interface NewChatPopupProps {
  onClose: () => void;
  socket: PopupSocket;
  userId: string;
  navigate: (conversationId: string) => void;
}

interface PopupOpener {
  openPopup: (content: React.ReactNode, opts?: { mode?: 'block' | 'transient' | 'contextMenu' }) => { hide: () => void };
}

/** Open the new-chat popup with deps captured from the caller's (in-context) scope. */
export function openNewChatPopup(router: PopupOpener, socket: PopupSocket, userId: string, navigate: (id: string) => void): void {
  const handle = router.openPopup(
    <NewChatPopup onClose={() => handle.hide()} socket={socket} userId={userId} navigate={navigate} />,
    { mode: 'transient' },
  );
}

/**
 * New-chat configuration popup (ugly.bot opens a flow rather than creating
 * silently). Name a group, or start a 1:1 with Ugly Bot, then navigate in.
 */
export function NewChatPopup({ onClose, socket, userId, navigate }: NewChatPopupProps): React.ReactElement {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const go = useCallback(
    (conversationId: string) => {
      onClose();
      navigate(conversationId);
    },
    [navigate, onClose],
  );

  const createGroup = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const id = `g-${userId}-${Date.now().toString(36)}`;
      await socket.request('conversationCreate', {
        id,
        type: 'group',
        title: name.trim() || 'New Chat',
        mode: 'public',
        ownerIds: [userId],
      });
      go(id);
    } catch (err) {
      console.error('[NewChat] create group failed', err);
      setBusy(false);
    }
  }, [busy, name, socket, userId, go]);

  const startBotChat = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const id = `ugly-${userId}`;
      const existing = await socket.getDoc('conversation', id);
      if (!existing) {
        await socket.request('conversationCreate', {
          id,
          type: 'group',
          title: 'Ugly Bot',
          mode: 'public',
          ownerIds: [userId],
          bots: { 'bot-ugly': {} },
        });
      }
      go(id);
    } catch (err) {
      console.error('[NewChat] start bot chat failed', err);
      setBusy(false);
    }
  }, [busy, socket, userId, go]);

  return (
    <div
      style={{
        width: 'min(440px, 92vw)',
        background: 'var(--app-main)',
        borderRadius: 16,
        border: '1px solid var(--app-border)',
        padding: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
      }}
    >
      <span style={{ fontFamily: 'var(--app-font-heading)', fontWeight: 800, fontSize: 18, color: 'var(--app-foreground)' }}>
        New chat
      </span>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px', height: 44, borderRadius: 12, border: '2px solid var(--app-foreground-20)', background: 'rgba(var(--app-tertiary-rgb), 0.5)' }}>
        <Users size={18} style={{ opacity: 0.5, flexShrink: 0 }} />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void createGroup(); }}
          placeholder="Name your group chat…"
          autoFocus
          style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', outline: 'none', fontSize: 15, color: 'var(--app-foreground)' }}
        />
      </div>

      <button
        type="button"
        onClick={() => void createGroup()}
        disabled={busy}
        style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, height: 44, borderRadius: 12, border: 'none', background: 'var(--app-primary)', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}
      >
        <MessageSquarePlus size={18} /> Create group chat
      </button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1, height: 1, background: 'var(--app-border)' }} />
        <span style={{ fontSize: 12, color: 'var(--app-foreground)', opacity: 0.5 }}>or</span>
        <div style={{ flex: 1, height: 1, background: 'var(--app-border)' }} />
      </div>

      <button
        type="button"
        onClick={() => void startBotChat()}
        disabled={busy}
        className="uc-footbtn"
        style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, height: 44, borderRadius: 12, border: '1px solid var(--app-border)', background: 'var(--app-main)', color: 'var(--app-foreground)', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}
      >
        <Flame size={18} /> Chat with Ugly Bot
      </button>

      <button type="button" onClick={onClose} style={{ alignSelf: 'center', marginTop: 2, background: 'transparent', border: 'none', color: 'var(--app-foreground)', opacity: 0.55, fontSize: 13, cursor: 'pointer' }}>
        Cancel
      </button>
    </div>
  );
}
