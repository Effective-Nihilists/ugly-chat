import React, { useCallback, useEffect, useState } from 'react';
import {
  X, Users, Mail, Plus, BellOff, AlignLeft, Check, BarChart3,
  Pin, Image as ImageIcon, Download, Trash2, LogOut, ChevronRight,
} from 'lucide-react';
import { useApp } from 'ugly-app/client';
import { useRouter } from '../router';
import { Avatar } from '../lib/conversations';
import { isValidEmail, normalizeEmail } from '../../shared/email';
import { modalStyles as S } from '../lib/modalStyles';

interface Member {
  userId: string;
  role: string;
  name: string;
  avatarUrl: string | null;
  isBot: boolean;
}

// Per-conversation client toggles persisted to localStorage (no server schema
// yet) — key shape `uc-conv-<id>-<setting>`.
type ToggleKey = 'mute' | 'readReceipts' | 'showTyping' | 'responseStats';
const TOGGLE_DEFAULTS: Record<ToggleKey, boolean> = {
  mute: false,
  readReceipts: true,
  showTyping: true,
  responseStats: true,
};
function loadToggle(conversationId: string, key: ToggleKey): boolean {
  if (typeof window === 'undefined') return TOGGLE_DEFAULTS[key];
  const v = window.localStorage.getItem(`uc-conv-${conversationId}-${key}`);
  return v === null ? TOGGLE_DEFAULTS[key] : v === '1';
}
function saveToggle(conversationId: string, key: ToggleKey, value: boolean): void {
  if (typeof window !== 'undefined') window.localStorage.setItem(`uc-conv-${conversationId}-${key}`, value ? '1' : '0');
}

export default function ChatSettingsPage({ conversationId }: { conversationId?: string }): React.ReactElement {
  const { socket, userId } = useApp();
  const router = useRouter();
  const id = conversationId ?? '';
  const [members, setMembers] = useState<Member[]>([]);
  const [title, setTitle] = useState('Conversation');
  const [addEmail, setAddEmail] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  const [toggles, setToggles] = useState<Record<ToggleKey, boolean>>(() => ({
    mute: loadToggle(id, 'mute'),
    readReceipts: loadToggle(id, 'readReceipts'),
    showTyping: loadToggle(id, 'showTyping'),
    responseStats: loadToggle(id, 'responseStats'),
  }));

  const refetchMembers = useCallback(() => {
    if (!id) return;
    void socket
      .request('conversationMembers', { conversationId: id })
      .then((res) => setMembers((res as { members?: Member[] }).members ?? []))
      .catch((err: unknown) => console.error('[settings] members failed', err));
  }, [socket, id]);

  useEffect(() => {
    refetchMembers();
    if (!id) return;
    void socket
      .getDoc('userConversation', `${userId}:${id}`)
      .then((uc) => {
        const t = (uc as { title?: string } | null)?.title;
        if (t) setTitle(t);
      })
      .catch(() => undefined);
  }, [refetchMembers, socket, userId, id]);

  const self = members.find((m) => m.userId === userId);
  const isOwner = self?.role === 'owner';

  const setToggle = useCallback(
    (key: ToggleKey) => {
      setToggles((prev) => {
        const next = { ...prev, [key]: !prev[key] };
        saveToggle(id, key, next[key]);
        return next;
      });
    },
    [id],
  );

  const addByEmail = useCallback(async () => {
    const e = normalizeEmail(addEmail);
    if (!isValidEmail(e) || !id) { setStatus('Enter a valid email'); return; }
    setStatus(null);
    try {
      const r = (await socket.request('resolveEmail', { email: e })) as
        | { status: 'found'; userId: string; name: string }
        | { status: 'invite'; email: string };
      if (r.status === 'found') {
        await socket.request('conversationMemberAdd', { conversationId: id, userId: r.userId, role: 'member' });
        setStatus(`Added ${r.name}`);
        refetchMembers();
      } else {
        // No server endpoint to send a bare invite for an existing group, so a
        // re-create isn't right here — surface that the address isn't on yet.
        setStatus(`No ugly.chat account for ${e} — they'll be invited when added via a new group.`);
      }
      setAddEmail('');
    } catch (err) {
      console.error('[settings] add by email failed', err);
      setStatus('Could not add that person.');
    }
  }, [addEmail, id, socket, refetchMembers]);

  const clearHistory = useCallback(() => {
    if (!id) return;
    void socket
      .request('conversationClear', { conversationId: id })
      .then(() => router.push('chat/:conversationId', { conversationId: id }))
      .catch((err: unknown) => { console.error('[settings] clear failed', err); setStatus('Could not clear history.'); });
  }, [id, socket, router]);

  const leaveGroup = useCallback(() => {
    if (!id) return;
    void socket
      .request('conversationMemberRemove', { conversationId: id, userId })
      .then(() => router.push('chat', {}))
      .catch((err: unknown) => { console.error('[settings] leave failed', err); setStatus('Could not leave the group.'); });
  }, [id, socket, userId, router]);

  return (
    <div style={S.page}>
      <div style={S.modal}>
        <div style={S.modalHead}>
          <span style={S.modalTitle}>Group info</span>
          <button
            type="button"
            aria-label="Close"
            onClick={() => (id ? router.push('chat/:conversationId', { conversationId: id }) : router.push('chat', {}))}
            style={S.closeBtn}
          >
            <X size={16} />
          </button>
        </div>

        <div style={S.modalBody}>
          {/* Identity */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '4px 0 8px' }}>
            <div style={idAvatar}><Users size={26} style={{ opacity: 0.5 }} /></div>
            <div style={{ fontFamily: 'var(--app-font-heading)', fontWeight: 800, fontSize: 21, letterSpacing: '-0.02em', color: 'var(--app-foreground)' }}>
              {title}
            </div>
            <div className="uc-receipt"><b>{members.length} members</b></div>
          </div>

          {/* Members + add by email */}
          <div style={S.field}>
            <div style={secLabel}>
              <span>Members · {members.length}</span>
            </div>
            <div style={{ ...tokensRow, marginBottom: 4 }}>
              <Mail size={16} style={{ color: 'var(--app-foreground-muted)', flexShrink: 0 }} />
              <input
                value={addEmail}
                onChange={(e) => setAddEmail(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void addByEmail(); }}
                placeholder="invite someone — name@email.com"
                spellCheck={false}
                style={S.inputEl}
              />
              <button type="button" aria-label="Add by email" onClick={() => void addByEmail()} style={addBtn}>
                <Plus size={13} /> add
              </button>
            </div>
            {status ? <div style={{ fontSize: 12.5, color: 'var(--app-primary)', fontWeight: 600 }}>{status}</div> : null}
            <div>
              {members.map((m) => (
                <div key={m.userId} style={S.memberRow}>
                  <Avatar image={m.avatarUrl} seed={m.userId} label={m.name} size={38} />
                  <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                    <div style={S.memberName}>
                      {m.name}{m.userId === userId ? ' (you)' : ''}
                    </div>
                  </div>
                  <span style={m.role === 'owner' ? roleAdmin : roleMember}>
                    {m.isBot ? 'bot' : m.role === 'owner' ? 'admin' : 'member'}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Notifications & privacy */}
          <div style={S.field}>
            <div style={secLabel}><span>Notifications &amp; privacy</span></div>
            <div>
              <SettingRow
                icon={<BellOff size={18} />}
                title="Mute notifications"
                desc="No pings. The unread count still tells the truth."
                on={toggles.mute}
                onToggle={() => setToggle('mute')}
              />
              <SettingRow
                icon={<AlignLeft size={18} />}
                title="Show typing"
                desc="Others see the three dots while you type."
                on={toggles.showTyping}
                onToggle={() => setToggle('showTyping')}
              />
              <SettingRow
                icon={<Check size={18} />}
                title="Read receipts"
                desc='They see "seen". You see theirs.'
                on={toggles.readReceipts}
                onToggle={() => setToggle('readReceipts')}
              />
              <SettingRow
                icon={<BarChart3 size={18} />}
                title="Response-time stats"
                desc="The slightly rude dashboard: avg reply, left-on-read, your share %."
                on={toggles.responseStats}
                onToggle={() => setToggle('responseStats')}
              />
            </div>
          </div>

          {/* Conversation */}
          <div style={S.field}>
            <div style={secLabel}><span>Conversation</span></div>
            <div>
              <LinkRow icon={<Pin size={18} />} title="Pinned message" />
              <LinkRow icon={<ImageIcon size={18} />} title="Shared media & files" />
              <LinkRow icon={<Download size={18} />} title="Export transcript" desc="Plain markdown. Your words, your file." />
            </div>
          </div>

          {/* Danger zone */}
          <div style={S.field}>
            <div style={secLabel}><span>Danger zone</span></div>
            <div>
              <DangerRow icon={<Trash2 size={18} />} title="Clear my history" desc="Wipes it for you. Everyone else keeps theirs." onClick={clearHistory} />
              {!isOwner ? (
                <DangerRow icon={<LogOut size={18} />} title="Leave group" onClick={leaveGroup} />
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SettingRow(props: { icon: React.ReactNode; title: string; desc?: string; on: boolean; onToggle: () => void }): React.ReactElement {
  return (
    <div style={srow}>
      <span style={{ color: 'var(--app-foreground)', display: 'inline-flex', flexShrink: 0 }}>{props.icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={srowTitle}>{props.title}</div>
        {props.desc ? <div style={srowDesc}>{props.desc}</div> : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={props.on}
        aria-label={props.title}
        onClick={props.onToggle}
        style={switchTrack(props.on)}
      >
        <span style={switchKnob(props.on)} />
      </button>
    </div>
  );
}

function LinkRow(props: { icon: React.ReactNode; title: string; desc?: string }): React.ReactElement {
  return (
    <div style={srow}>
      <span style={{ color: 'var(--app-foreground)', display: 'inline-flex', flexShrink: 0 }}>{props.icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={srowTitle}>{props.title}</div>
        {props.desc ? <div style={srowDesc}>{props.desc}</div> : null}
      </div>
      <ChevronRight size={16} style={{ color: 'var(--app-foreground-muted)', flexShrink: 0 }} />
    </div>
  );
}

function DangerRow(props: { icon: React.ReactNode; title: string; desc?: string; onClick: () => void }): React.ReactElement {
  return (
    <button type="button" onClick={props.onClick} style={{ ...srow, width: '100%', textAlign: 'left', border: 'none', borderBottom: '1px solid var(--app-border)', background: 'transparent', cursor: 'pointer', color: 'var(--app-error)' }}>
      <span style={{ display: 'inline-flex', flexShrink: 0 }}>{props.icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ ...srowTitle, color: 'var(--app-error)' }}>{props.title}</div>
        {props.desc ? <div style={srowDesc}>{props.desc}</div> : null}
      </div>
    </button>
  );
}

const idAvatar: React.CSSProperties = {
  width: 64,
  height: 64,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'var(--app-tertiary)',
  border: '1px solid var(--app-border)',
  color: 'var(--app-foreground)',
};
const secLabel: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  fontFamily: 'var(--app-font-mono)',
  fontSize: 10.5,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.14em',
  color: 'var(--app-foreground-muted)',
};
const tokensRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '0 10px',
  height: 42,
  border: '1px solid var(--app-border)',
  background: 'var(--app-tertiary)',
};
const addBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  flexShrink: 0,
  padding: '5px 9px',
  border: '1px solid var(--app-border)',
  background: 'var(--app-main)',
  color: 'var(--app-foreground)',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
};
const roleAdmin: React.CSSProperties = {
  fontFamily: 'var(--app-font-mono)',
  fontSize: 10,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: 'var(--app-primary)',
  border: '1px solid var(--app-primary)',
  padding: '2px 7px',
  flexShrink: 0,
};
const roleMember: React.CSSProperties = {
  fontFamily: 'var(--app-font-mono)',
  fontSize: 10,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: 'var(--app-foreground-muted)',
  border: '1px solid var(--app-border)',
  padding: '2px 7px',
  flexShrink: 0,
};
const srow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '11px 4px',
  borderBottom: '1px solid var(--app-border)',
};
const srowTitle: React.CSSProperties = { fontSize: 14, fontWeight: 600, color: 'var(--app-foreground)' };
const srowDesc: React.CSSProperties = { fontSize: 12, color: 'var(--app-foreground)', opacity: 0.5, marginTop: 1 };
const switchTrack = (on: boolean): React.CSSProperties => ({
  position: 'relative',
  width: 38,
  height: 22,
  flexShrink: 0,
  borderRadius: 999,
  border: 'none',
  background: on ? 'var(--app-primary)' : 'var(--app-foreground-20)',
  cursor: 'pointer',
  padding: 0,
  transition: 'background-color 0.15s ease',
});
const switchKnob = (on: boolean): React.CSSProperties => ({
  position: 'absolute',
  top: 2,
  left: on ? 18 : 2,
  width: 18,
  height: 18,
  borderRadius: '50%',
  background: '#fff',
  transition: 'left 0.15s ease',
});
