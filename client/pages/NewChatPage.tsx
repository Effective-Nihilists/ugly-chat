import React, { useCallback, useState } from 'react';
import { Mail, Check, MessageSquarePlus, X } from 'lucide-react';
import { useApp } from 'ugly-app/client';
import { useRouter } from '../router';
import { useConversations } from '../lib/conversations';
import { Avatar } from '../lib/conversations';
import { isValidEmail, normalizeEmail } from '../../shared/email';

// Start a 1:1 chat by email — no usernames, no friend requests. A known email
// opens (or reuses) the DM immediately; an unknown email gets an invite.
// Layout ported from mockups/new-chat.html (modal · field · Recent list).
export default function NewChatPage(): React.ReactElement {
  const { socket } = useApp();
  const router = useRouter();
  const { conversations } = useConversations();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const valid = isValidEmail(email);

  const start = useCallback(
    async (raw: string) => {
      const e = normalizeEmail(raw);
      if (!isValidEmail(e) || busy) return;
      setBusy(true);
      setStatus(null);
      try {
        const res = (await socket.request('conversationCreateDirect', { email: e })) as {
          conversationId: string;
          invited: boolean;
        };
        if (res.invited) {
          setStatus(`Invite sent to ${e}`);
          setBusy(false);
        } else {
          router.push('chat/:conversationId', { conversationId: res.conversationId });
        }
      } catch (err) {
        console.error('[new-chat] start failed', err);
        setStatus('Could not start the chat. Try again.');
        setBusy(false);
      }
    },
    [busy, socket, router],
  );

  // "Recent" — the caller's existing direct conversations (sidebar list).
  const recent = conversations.filter((c) => c.type !== 'group').slice(0, 8);

  return (
    <div style={page}>
      <div style={modal}>
        <div style={modalHead}>
          <span style={modalTitle}>New message</span>
          <button type="button" aria-label="Close" onClick={() => router.push('chat', {})} style={closeBtn}>
            <X size={16} />
          </button>
        </div>

        <div style={modalBody}>
          <div style={field}>
            <label style={fieldLabel}>To</label>
            <div style={inputRow}>
              <Mail size={17} style={{ opacity: 0.5, flexShrink: 0 }} />
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void start(email); }}
                placeholder="name@email.com"
                spellCheck={false}
                autoFocus
                style={inputEl}
              />
              {valid ? <Check size={17} style={{ color: 'var(--app-success)', flexShrink: 0 }} /> : null}
            </div>
            <div style={hint}>
              Enter an email. We start the chat now — and <b>send an invite</b> if they're not on
              ugly.chat yet. No usernames, no friend requests.
            </div>
          </div>

          {recent.length > 0 ? (
            <div style={field}>
              <label style={fieldLabel}>Recent</label>
              <div>
                {recent.map((c) => (
                  <button
                    key={c.conversationId}
                    type="button"
                    className="uc-row"
                    onClick={() => router.push('chat/:conversationId', { conversationId: c.conversationId })}
                    style={memberRow}
                  >
                    <Avatar image={c.image} seed={c.conversationId} label={c.title} size={38} />
                    <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                      <div style={memberName}>{c.title || 'Conversation'}</div>
                      {c.preview ? <div style={memberSub}>{c.preview}</div> : null}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {status ? <div style={statusLine}>{status}</div> : null}
        </div>

        <div style={modalFoot}>
          <button type="button" onClick={() => router.push('chat', {})} style={ghostBtn}>
            Cancel
          </button>
          <button type="button" disabled={!valid || busy} onClick={() => void start(email)} style={ctaBtn(!valid || busy)}>
            <MessageSquarePlus size={16} /> Start chat
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Shared modal styling (ported from brand.css → app tokens) ──────────────
const page: React.CSSProperties = {
  height: '100%',
  overflowY: 'auto',
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'flex-start',
  background: 'var(--app-main)',
  padding: '24px 16px',
};
const modal: React.CSSProperties = {
  width: 'min(440px, 100%)',
  background: 'var(--app-main)',
  border: '1px solid var(--app-border)',
  display: 'flex',
  flexDirection: 'column',
};
const modalHead: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '12px 14px',
  borderBottom: '1px solid var(--app-border)',
};
const modalTitle: React.CSSProperties = {
  fontFamily: 'var(--app-font-heading)',
  fontWeight: 800,
  fontSize: 16,
  color: 'var(--app-foreground)',
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
const modalBody: React.CSSProperties = {
  padding: 14,
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
};
const field: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6 };
const fieldLabel: React.CSSProperties = {
  fontFamily: 'var(--app-font-mono)',
  fontSize: 10.5,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.14em',
  color: 'var(--app-foreground-muted)',
};
const inputRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '0 12px',
  height: 44,
  border: '1px solid var(--app-border)',
  background: 'var(--app-tertiary)',
};
const inputEl: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  border: 'none',
  background: 'transparent',
  outline: 'none',
  fontSize: 15,
  color: 'var(--app-foreground)',
};
const hint: React.CSSProperties = { fontSize: 12.5, lineHeight: 1.45, color: 'var(--app-foreground)', opacity: 0.55 };
const memberRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  width: '100%',
  padding: '8px 6px',
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  font: 'inherit',
};
const memberName: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: 'var(--app-foreground)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};
const memberSub: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--app-foreground)',
  opacity: 0.5,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};
const statusLine: React.CSSProperties = {
  fontSize: 13,
  color: 'var(--app-primary)',
  fontWeight: 600,
};
const modalFoot: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: 8,
  padding: '12px 14px',
  borderTop: '1px solid var(--app-border)',
};
const ghostBtn: React.CSSProperties = {
  padding: '9px 16px',
  border: '1px solid var(--app-border)',
  background: 'var(--app-main)',
  color: 'var(--app-foreground)',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
};
const ctaBtn = (disabled: boolean): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '9px 18px',
  border: 'none',
  background: 'var(--app-primary)',
  color: '#fff',
  fontSize: 14,
  fontWeight: 700,
  cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? 0.5 : 1,
});

export const newChatStyles = {
  page, modal, modalHead, modalTitle, closeBtn, modalBody, field, fieldLabel,
  inputRow, inputEl, hint, memberRow, memberName, memberSub, modalFoot, ghostBtn, ctaBtn,
};
