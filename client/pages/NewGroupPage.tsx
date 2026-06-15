import React, { useCallback, useState } from 'react';
import { X, Users, Camera } from 'lucide-react';
import { useApp } from 'ugly-app/client';
import { useRouter } from '../router';
import { isValidEmail, normalizeEmail } from '../../shared/email';
import { newChatStyles as S } from './NewChatPage';

// Create a group by adding email addresses as chips. Known addresses join;
// unknown ones get an invite. Layout ported from mockups/new-group.html
// (group avatar + name, email token/chip input, member preview).
export default function NewGroupPage(): React.ReactElement {
  const { socket } = useApp();
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [emails, setEmails] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const addChip = useCallback(
    (raw: string) => {
      const e = normalizeEmail(raw);
      if (!e) return;
      if (!isValidEmail(e)) { setStatus(`"${raw.trim()}" is not a valid email`); return; }
      setStatus(null);
      setEmails((prev) => (prev.includes(e) ? prev : [...prev, e]));
      setDraft('');
    },
    [],
  );

  const removeChip = useCallback((e: string) => {
    setEmails((prev) => prev.filter((x) => x !== e));
  }, []);

  const onKeyDown = useCallback(
    (ev: React.KeyboardEvent<HTMLInputElement>) => {
      if (ev.key === 'Enter' || ev.key === ',') {
        ev.preventDefault();
        addChip(draft);
      } else if (ev.key === 'Backspace' && draft === '' && emails.length > 0) {
        setEmails((prev) => prev.slice(0, -1));
      }
    },
    [addChip, draft, emails.length],
  );

  const create = useCallback(async () => {
    if (busy) return;
    // Fold any half-typed valid email into the chips before creating.
    const all = isValidEmail(normalizeEmail(draft))
      ? [...new Set([...emails, normalizeEmail(draft)])]
      : emails;
    setBusy(true);
    setStatus(null);
    try {
      const res = (await socket.request('groupCreate', {
        title: title.trim() || undefined,
        emails: all,
      })) as { conversationId: string; invited: string[] };
      router.push('chat/:conversationId', { conversationId: res.conversationId });
    } catch (err) {
      console.error('[new-group] create failed', err);
      setStatus('Could not create the group. Try again.');
      setBusy(false);
    }
  }, [busy, draft, emails, title, socket, router]);

  const count = emails.length + 1; // +1 for the creator (you)

  return (
    <div style={S.page}>
      <div style={S.modal}>
        <div style={S.modalHead}>
          <span style={S.modalTitle}>New group</span>
          <button type="button" aria-label="Close" onClick={() => router.push('chat', {})} style={S.closeBtn}>
            <X size={16} />
          </button>
        </div>

        <div style={S.modalBody}>
          {/* Identity: square group avatar + optional name */}
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
            <div style={groupAvatar}>
              <Users size={22} style={{ opacity: 0.5 }} />
              <span style={camBadge}><Camera size={11} /></span>
            </div>
            <div style={{ ...S.field, flex: 1 }}>
              <label style={S.fieldLabel}>Group name — optional</label>
              <div style={S.inputRow}>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="ship-crew, prod-incidents, …"
                  spellCheck={false}
                  style={S.inputEl}
                />
              </div>
            </div>
          </div>

          {/* Email chip input */}
          <div style={S.field}>
            <label style={S.fieldLabel}>Add people by email</label>
            <div style={tokens}>
              {emails.map((e) => (
                <span key={e} style={chip}>
                  {e}
                  <button type="button" aria-label={`Remove ${e}`} onClick={() => removeChip(e)} style={chipX}>
                    <X size={11} />
                  </button>
                </span>
              ))}
              <input
                value={draft}
                onChange={(ev) => setDraft(ev.target.value)}
                onKeyDown={onKeyDown}
                onBlur={() => { if (draft.trim()) addChip(draft); }}
                placeholder="add email…"
                spellCheck={false}
                style={{ ...S.inputEl, flex: '1 0 120px', minWidth: 120 }}
              />
            </div>
            <div style={S.hint}>
              Everyone you add sees the history <b>from the moment they join</b> — nothing before.
              Not on ugly.chat? They get an invite.
            </div>
          </div>

          {status ? <div style={{ fontSize: 13, color: 'var(--app-error)', fontWeight: 600 }}>{status}</div> : null}

          {/* Member preview */}
          <div style={S.field}>
            <label style={S.fieldLabel}>Members · {count}</label>
            <div>
              <div style={S.memberRow}>
                <Avatar2 label="You" />
                <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                  <div style={S.memberName}>You</div>
                </div>
                <span style={roleAdmin}>admin</span>
              </div>
              {emails.map((e) => (
                <div key={e} style={S.memberRow}>
                  <Avatar2 label={e} />
                  <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                    <div style={S.memberSub}>{e}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={S.modalFoot}>
          <button type="button" onClick={() => router.push('chat', {})} style={S.ghostBtn}>
            Cancel
          </button>
          <button type="button" disabled={busy} onClick={() => void create()} style={S.ctaBtn(busy)}>
            Create group · {count}
          </button>
        </div>
      </div>
    </div>
  );
}

function Avatar2({ label }: { label: string }): React.ReactElement {
  const initial = (label.trim()[0] ?? '#').toUpperCase();
  return (
    <div
      aria-hidden
      style={{
        width: 38,
        height: 38,
        borderRadius: '50%',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--app-tertiary)',
        color: 'var(--app-foreground-muted)',
        border: '1px solid var(--app-border)',
        fontSize: 15,
        fontWeight: 600,
      }}
    >
      {initial}
    </div>
  );
}

const groupAvatar: React.CSSProperties = {
  position: 'relative',
  width: 56,
  height: 56,
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'var(--app-tertiary)',
  border: '1px solid var(--app-border)',
  color: 'var(--app-foreground)',
};
const camBadge: React.CSSProperties = {
  position: 'absolute',
  right: -4,
  bottom: -4,
  width: 20,
  height: 20,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'var(--app-primary)',
  color: '#fff',
  border: '1px solid var(--app-main)',
};
const tokens: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 6,
  padding: 6,
  minHeight: 44,
  border: '1px solid var(--app-border)',
  background: 'var(--app-tertiary)',
};
const chip: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  padding: '4px 6px 4px 9px',
  background: 'var(--app-main)',
  border: '1px solid var(--app-border)',
  fontSize: 13,
  color: 'var(--app-foreground)',
};
const chipX: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: 'none',
  background: 'transparent',
  color: 'var(--app-foreground)',
  opacity: 0.6,
  cursor: 'pointer',
  padding: 0,
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
};
