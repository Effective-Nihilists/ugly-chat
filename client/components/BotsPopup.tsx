import React, { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, MessageSquare, Bot as BotIcon, X } from 'lucide-react';
import type { AppSocket } from 'ugly-app/client';
import type { AppRegistry } from '../../shared/api';
import { startBotChat, type BotDoc } from '../lib/bots';

// Popups render in the router's portal, OUTSIDE <AppProvider>, so they can't
// use useApp()/useRouter() — deps are passed in by the opener instead. We pass
// the real typed socket (not a narrowed PopupSocket) so startBotChat reuses it.
type Socket = AppSocket<AppRegistry>;

interface PopupOpener {
  openPopup: (
    content: React.ReactNode,
    opts?: { mode?: 'block' | 'transient' | 'contextMenu' },
  ) => { hide: () => void };
}

interface BotsPopupProps {
  onClose: () => void;
  socket: Socket;
  userId: string;
  /** Open the create/edit bot PAGE (closes the popup first). */
  editBot: (botId: string) => void;
  /** Navigate to a conversation (closes the popup first). */
  navigate: (conversationId: string) => void;
}

/** Open the "My bots" popup with deps captured from the caller's (in-context) scope. */
export function openBotsPopup(
  router: PopupOpener,
  socket: Socket,
  userId: string,
  editBot: (botId: string) => void,
  navigate: (conversationId: string) => void,
): void {
  const handle = router.openPopup(
    <BotsPopup
      onClose={() => handle.hide()}
      socket={socket}
      userId={userId}
      editBot={editBot}
      navigate={navigate}
    />,
    { mode: 'transient' },
  );
}

/**
 * "My bots" — list, create, edit, delete, and start a chat with a custom bot.
 * Same actions as the old page; create/edit close the popup and open the bot
 * editor PAGE (`bot/:botId`), chat closes the popup and navigates in.
 */
export function BotsPopup({ onClose, socket, userId, editBot, navigate }: BotsPopupProps): React.ReactElement {
  const [bots, setBots] = useState<BotDoc[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const refetch = (): void => {
      void socket
        .request('botListMine', {})
        .then((res) => {
          setBots(((res as { bots?: BotDoc[] }).bots ?? []) as BotDoc[]);
          setLoading(false);
        })
        .catch(() => setLoading(false));
    };
    refetch();
    const unsub = socket.trackDocs('bot', { keys: { ownerId: userId } }, () => refetch());
    return () => unsub?.();
  }, [socket, userId]);

  const remove = (botId: string): void => {
    void socket.request('botDelete', { botId }).catch((err: unknown) => console.error('[Bots] delete failed', err));
  };

  return (
    <div style={modal}>
      <div style={modalHead}>
        <span style={modalTitle}>My bots</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button type="button" onClick={() => editBot('new')} style={primaryBtn}>
            <Plus size={16} /> New bot
          </button>
          <button type="button" aria-label="Close" onClick={onClose} style={closeBtn}>
            <X size={16} />
          </button>
        </div>
      </div>

      <div style={modalBody}>
        {loading ? (
          <Hint text="Loading…" />
        ) : bots.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 16px', color: 'var(--app-foreground)' }}>
            <BotIcon size={40} style={{ opacity: 0.4 }} />
            <p style={{ opacity: 0.6, marginTop: 12, fontSize: 14 }}>
              No bots yet. Create one to define a persona, model, greeting, and starter buttons.
            </p>
            <button type="button" onClick={() => editBot('new')} style={{ ...primaryBtn, margin: '8px auto 0' }}>
              <Plus size={16} /> New bot
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {bots.map((b) => (
              <div
                key={b._id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: 12,
                  borderRadius: 14,
                  border: '1px solid var(--app-border)',
                  background: 'var(--app-tertiary)',
                }}
              >
                {b.avatarUrl ? (
                  <img src={b.avatarUrl} alt="" style={{ width: 48, height: 48, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                ) : (
                  <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--app-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <BotIcon size={22} style={{ opacity: 0.6 }} />
                  </div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--app-foreground)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.name}</div>
                  <div style={{ fontSize: 13, color: 'var(--app-foreground)', opacity: 0.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.model ?? ''}</div>
                </div>
                <button
                  type="button"
                  title="Chat"
                  onClick={() => void startBotChat(socket, userId, b, (cid) => navigate(cid))}
                  style={iconBtn}
                >
                  <MessageSquare size={18} />
                </button>
                <button type="button" title="Edit" onClick={() => editBot(b._id)} style={iconBtn}>
                  <Pencil size={18} />
                </button>
                <button type="button" title="Delete" onClick={() => remove(b._id)} style={{ ...iconBtn, color: 'var(--app-error)' }}>
                  <Trash2 size={18} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Hint({ text }: { text: string }): React.ReactElement {
  return <div style={{ padding: '40px 8px', textAlign: 'center', fontSize: 14, color: 'var(--app-foreground)', opacity: 0.45 }}>{text}</div>;
}

const modal: React.CSSProperties = {
  width: 'min(560px, 92vw)',
  background: 'var(--app-main)',
  border: '1px solid var(--app-border)',
  borderRadius: 16,
  display: 'flex',
  flexDirection: 'column',
  boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
  overflow: 'hidden',
};
const modalHead: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  padding: '12px 14px',
  borderBottom: '1px solid var(--app-border)',
};
const modalTitle: React.CSSProperties = {
  fontFamily: 'var(--app-font-heading)',
  fontWeight: 800,
  fontSize: 18,
  color: 'var(--app-foreground)',
};
const modalBody: React.CSSProperties = {
  padding: 14,
  maxHeight: '64vh',
  overflowY: 'auto',
};
const closeBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 30,
  height: 30,
  border: 'none',
  background: 'transparent',
  color: 'var(--app-foreground)',
  cursor: 'pointer',
};
const iconBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 38, height: 38,
  borderRadius: 10, border: '1px solid var(--app-border)', background: 'var(--app-main)',
  color: 'var(--app-foreground)', cursor: 'pointer', flexShrink: 0,
};
const primaryBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 14px', borderRadius: 11,
  border: 'none', background: 'var(--app-primary)', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
};
