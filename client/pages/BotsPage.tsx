import React, { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, MessageSquare, ArrowLeft, Bot as BotIcon } from 'lucide-react';
import { useApp } from 'ugly-app/client';
import { useRouter } from '../router';
import { startBotChat, type BotDoc } from '../lib/bots';

// "My bots" — list, create, edit, delete, and start a chat with a custom bot.
export default function BotsPage(): React.ReactElement {
  const { socket, userId } = useApp();
  const router = useRouter();
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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto', background: 'var(--app-main)' }}>
      <div style={{ maxWidth: 640, margin: '0 auto', width: '100%', padding: '20px 18px 60px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
          <button type="button" onClick={() => router.push('chat', {})} aria-label="Back" style={iconBtn}>
            <ArrowLeft size={20} />
          </button>
          <h1 style={{ fontFamily: 'var(--app-font-heading)', fontWeight: 800, fontSize: 24, margin: 0, flex: 1, color: 'var(--app-foreground)' }}>
            My bots
          </h1>
          <button type="button" onClick={() => router.push('bot/:botId', { botId: 'new' })} style={primaryBtn}>
            <Plus size={18} /> New bot
          </button>
        </div>

        {loading ? (
          <Hint text="Loading…" />
        ) : bots.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 16px', color: 'var(--app-foreground)' }}>
            <BotIcon size={40} style={{ opacity: 0.4 }} />
            <p style={{ opacity: 0.6, marginTop: 12 }}>No bots yet. Create one to define a persona, model, greeting, and starter buttons.</p>
            <button type="button" onClick={() => router.push('bot/:botId', { botId: 'new' })} style={{ ...primaryBtn, margin: '8px auto 0' }}>
              <Plus size={18} /> New bot
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {bots.map((b) => (
              <div key={b._id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14, border: '1px solid var(--app-border)', background: 'var(--app-tertiary)' }}>
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
                <button type="button" title="Chat" onClick={() => void startBotChat(socket, userId, b, (cid) => router.push('chat/:conversationId', { conversationId: cid }))} style={iconBtn}>
                  <MessageSquare size={18} />
                </button>
                <button type="button" title="Edit" onClick={() => router.push('bot/:botId', { botId: b._id })} style={iconBtn}>
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

const iconBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 38, height: 38,
  borderRadius: 10, border: '1px solid var(--app-border)', background: 'var(--app-main)',
  color: 'var(--app-foreground)', cursor: 'pointer', flexShrink: 0,
};
const primaryBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 16px', borderRadius: 11,
  border: 'none', background: 'var(--app-primary)', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
};
