import React, { useCallback, useEffect, useState } from 'react';
import { Mail, Check, MessageSquarePlus, X, Users } from 'lucide-react';
import type { Avatar as AvatarT } from 'ugly-app/shared';
import { Avatar, type ConvRow } from '../lib/conversations';
import { isValidEmail, normalizeEmail } from '../../shared/email';

interface Contact { userId: string; name: string; avatar: AvatarT }

/** Result of resolving a typed address to a person (see the `emailLookup` op). */
interface EmailLookup {
  status: 'checking' | 'found' | 'invite' | 'invalid' | 'unknown';
  userId?: string;
  name?: string;
  avatarUrl?: string | null;
}

// Popups render in the router's portal, OUTSIDE <AppProvider>, so they can't
// use useApp()/useRouter() — deps are passed in by the opener instead.
interface PopupSocket {
  request: (name: string, input: Record<string, unknown>) => Promise<unknown>;
}

interface PopupOpener {
  openPopup: (
    content: React.ReactNode,
    opts?: { mode?: 'block' | 'transient' | 'contextMenu' },
  ) => { hide: () => void };
}

interface NewChatPopupProps {
  onClose: () => void;
  socket: PopupSocket;
  recent: ConvRow[];
  navigate: (conversationId: string) => void;
}

/** Open the merged new-chat (direct + group) popup with deps from the caller's scope. */
export function openNewChatPopup(
  router: PopupOpener,
  socket: PopupSocket,
  recent: ConvRow[],
  navigate: (conversationId: string) => void,
): void {
  const handle = router.openPopup(
    <NewChatPopup onClose={() => { handle.hide(); }} socket={socket} recent={recent} navigate={navigate} />,
    { mode: 'transient' },
  );
}

/**
 * New chat — start a 1:1 OR a group from the same modal. Add people by email as
 * chips: exactly one recipient → "Start chat" (conversationCreateDirect); two or
 * more → reveal an optional group name + "Create group · N" (groupCreate). Known
 * emails join immediately; unknown ones get an invite. Layout ported from
 * mockups/new-chat.html + new-group.html → app tokens.
 */
export function NewChatPopup({ onClose, socket, recent, navigate }: NewChatPopupProps): React.ReactElement {
  const [emails, setEmails] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [statusError, setStatusError] = useState(false);
  // People picker: contacts (people you share conversations with) + the set the
  // user has tapped to add. Clicking a person adds them as a recipient (vs the
  // old behavior of opening that chat). `recent` is no longer rendered here.
  void recent;
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    void socket
      .request('userContacts', {})
      .then((res) => {
        if (cancelled) return;
        setContacts(((res as { users?: Contact[] }).users ?? []));
      })
      .catch(() => undefined)
      .finally(() => { if (!cancelled) setContactsLoading(false); });
    return () => { cancelled = true; };
  }, [socket]);

  const toggle = useCallback((uid: string) => {
    setSelected((prev) => (prev.includes(uid) ? prev.filter((x) => x !== uid) : [...prev, uid]));
  }, []);

  const draftValid = isValidEmail(normalizeEmail(draft));

  // Who is behind each typed address. There is no directory to search, so email
  // is the only way to reach someone new — which is fine, but the tick used to
  // mean "this parses as an email" and NOTHING more, so a colleague and a
  // stranger looked identical and you learned which you'd typed only after
  // committing. Resolve it up front and say the person's name.
  const [lookups, setLookups] = useState<Record<string, EmailLookup>>({});
  const lookupEmail = useCallback(
    (e: string) => {
      if (!e || lookups[e]) return;
      setLookups((prev) => ({ ...prev, [e]: { status: 'checking' } }));
      void socket
        .request('emailLookup', { email: e })
        .then((res) => {
          setLookups((prev) => ({ ...prev, [e]: res as EmailLookup }));
        })
        .catch(() => {
          // Never block sending on a failed lookup — it's an aid, not a gate.
          setLookups((prev) => ({ ...prev, [e]: { status: 'unknown' } }));
        });
    },
    [socket, lookups],
  );

  // Debounce the draft so we don't fire a lookup per keystroke.
  useEffect(() => {
    const e = normalizeEmail(draft);
    if (!isValidEmail(e)) return undefined;
    const t = setTimeout(() => { lookupEmail(e); }, 450);
    return () => { clearTimeout(t); };
  }, [draft, lookupEmail]);

  const draftLookup = lookups[normalizeEmail(draft)];

  const addChip = useCallback((raw: string) => {
    const e = normalizeEmail(raw);
    if (!e) return false;
    if (!isValidEmail(e)) {
      setStatus(`"${raw.trim()}" is not a valid email`);
      setStatusError(true);
      return false;
    }
    setStatus(null);
    setStatusError(false);
    setEmails((prev) => (prev.includes(e) ? prev : [...prev, e]));
    setDraft('');
    return true;
  }, []);

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

  const go = useCallback(
    (conversationId: string) => {
      onClose();
      navigate(conversationId);
    },
    [navigate, onClose],
  );

  // Fold any half-typed valid email into the typed-email set.
  const allEmails = useCallback((): string[] => {
    const e = normalizeEmail(draft);
    return isValidEmail(e) ? [...new Set([...emails, e])] : emails;
  }, [draft, emails]);

  const submit = useCallback(async () => {
    if (busy) return;
    const ems = allEmails();
    if (selected.length + ems.length === 0) return;
    setBusy(true);
    setStatus(null);
    setStatusError(false);
    try {
      const res = (await socket.request('conversationStart', {
        userIds: selected,
        emails: ems,
        title: selected.length + ems.length >= 2 ? title.trim() || undefined : undefined,
      })) as { conversationId: string; invited: string[] };
      if (!res.conversationId && res.invited.length > 0) {
        // "Invite sent" alone read as success for a chat that doesn't exist:
        // the dialog stayed open with the chip still in the field and no thread
        // anywhere, so you couldn't tell whether to click again. Say what
        // happened, say what happens next, and clear the field.
        setStatus(
          `Invite emailed to ${res.invited[0]}. No chat opens until they join — you'll see it here then.`,
        );
        setStatusError(false);
        setEmails([]);
        setDraft('');
        setBusy(false);
      } else {
        go(res.conversationId);
      }
    } catch (err) {
      console.error('[new-chat] submit failed', err);
      // Prefer the server's own reason (e.g. "Couldn't look up that email address
      // right now") — a generic retry line hid a real, actionable outage.
      const msg = (err as Error | undefined)?.message;
      setStatus(msg && msg.length > 0 && !msg.startsWith('[') ? msg : 'Could not start the chat. Try again.');
      setStatusError(true);
      setBusy(false);
    }
  }, [busy, allEmails, selected, socket, title, go]);

  // The CTA reflects total recipients = picked people + typed emails.
  const count = selected.length + allEmails().length;
  const isGroup = count >= 2;
  const canSubmit = count >= 1 && !busy;
  // A single recipient who isn't on ugly.chat only gets an EMAIL — no chat opens
  // until they join. The button used to say "Start chat" here, promising a
  // thread that won't exist; say what actually happens.
  const soleEmail = count === 1 && selected.length === 0 ? allEmails()[0] : undefined;
  const soleInvite = !!soleEmail && lookups[soleEmail]?.status === 'invite';
  const contactById = new Map(contacts.map((c) => [c.userId, c]));

  return (
    <div style={modal}>
      <div style={modalHead}>
        <span style={modalTitle}>New message</span>
        <button type="button" aria-label="Close" onClick={onClose} style={closeBtn} data-id="close">
          <X size={16} />
        </button>
      </div>

      <div style={modalBody}>
        {/* Recipients — email chip/token input */}
        <div style={field}>
          <label style={fieldLabel}>To</label>
          <div style={tokens}>
            <Mail size={16} style={{ opacity: 0.5, flexShrink: 0, alignSelf: 'center' }} />
            {selected.map((uid) => (
              <span key={uid} style={{ ...chip, background: 'var(--app-primary)', color: '#fff', borderColor: 'var(--app-primary)' }}>
                {contactById.get(uid)?.name ?? uid.slice(0, 6)}
                <button type="button" aria-label="Remove" onClick={() => { toggle(uid); }} style={{ ...chipX, color: '#fff' }} data-id="remove">
                  <X size={11} />
                </button>
              </span>
            ))}
            {emails.map((e) => {
              // A resolved chip shows the PERSON; an unresolved one stays an
              // address and is visibly marked as an invite, so the two are never
              // the same shape on screen.
              const l = lookups[e];
              const found = l?.status === 'found';
              return (
                <span
                  key={e}
                  style={
                    found
                      ? { ...chip, background: 'var(--app-primary)', color: '#fff', borderColor: 'var(--app-primary)' }
                      : chip
                  }
                  title={found ? `${l.name ?? e} · already on ugly.chat` : e}
                >
                  {found ? l.name ?? e : e}
                  {l?.status === 'invite' ? <span style={inviteTag}>invite</span> : null}
                  <button type="button" aria-label={`Remove ${e}`} onClick={() => { removeChip(e); }} style={found ? { ...chipX, color: '#fff' } : chipX} data-id="button">
                    <X size={11} />
                  </button>
                </span>
              );
            })}
            <input
              value={draft}
              onChange={(ev) => {
                setDraft(ev.target.value);
                if (statusError) {
                  setStatus(null);
                  setStatusError(false);
                }
              }}
              onKeyDown={onKeyDown}
              onBlur={() => { if (draft.trim() && draftValid) addChip(draft); }}
              placeholder={emails.length === 0 && selected.length === 0 ? 'tap a person below, or type an email…' : 'add another…'}
              spellCheck={false}
              autoFocus
              style={{ ...inputEl, flex: '1 0 120px', minWidth: 120 }} data-id="input"
            />
            {/* The tick used to appear on valid SYNTAX alone — the same green
                for a colleague and for a stranger. It now means "resolved". */}
            {draftValid && draftLookup?.status === 'found' ? (
              <Check size={16} style={{ color: 'var(--app-success)', flexShrink: 0, alignSelf: 'center' }} />
            ) : null}
          </div>
          {draftValid && draftLookup ? (
            <div style={hint} data-id="email-lookup">
              {draftLookup.status === 'checking' ? (
                'Checking…'
              ) : draftLookup.status === 'found' ? (
                <>
                  <b>{draftLookup.name}</b> is on ugly.chat — this opens a chat with them.
                </>
              ) : draftLookup.status === 'invite' ? (
                <>Not on ugly.chat — we&rsquo;ll <b>email them an invite</b>. No chat opens until they join.</>
              ) : (
                "Couldn't check this address right now — you can still send."
              )}
            </div>
          ) : null}
          <div style={hint}>
            Tap someone below, or type an email. One person starts a 1:1; two or more makes a group.
          </div>
        </div>

        {/* Optional group name — only once it's a group */}
        {isGroup ? (
          <div style={field}>
            <label style={fieldLabel}>Group name — optional</label>
            <div style={inputRow}>
              <Users size={16} style={{ opacity: 0.5, flexShrink: 0 }} />
              <input
                value={title}
                onChange={(e) => { setTitle(e.target.value); }}
                placeholder="ship-crew, prod-incidents, …"
                spellCheck={false}
                style={inputEl} data-id="ship-crew-prod-incidents"
              />
            </div>
            <div style={hint}>
              Everyone you add sees the history <b>from the moment they join</b> — nothing before.
            </div>
          </div>
        ) : null}

        {/* People you've chatted with — tap to add as a recipient. Fixed height
            reserves space so the modal doesn't jump while contacts load. */}
        <div style={field}>
          {/* NOT a directory — ugly.bot exposes no user search, so this can only
              ever be people you already share a thread with. Labelling it
              "People" made it read as a roster of everyone: a real colleague was
              missing from it and the user concluded he wasn't on the app. */}
          <label style={fieldLabel}>Recent — people you&rsquo;ve chatted with</label>
          <div style={contactsBox}>
            {contactsLoading ? (
              <div style={contactsMsg}>Loading…</div>
            ) : contacts.length === 0 ? (
              <div style={contactsMsg}>No contacts yet — invite someone by email above.</div>
            ) : (
              contacts.map((c) => {
                const on = selected.includes(c.userId);
                return (
                  <button
                    key={c.userId}
                    type="button"
                    className="uc-row"
                    onClick={() => { toggle(c.userId); }}
                    style={{ ...memberRow, background: on ? 'rgba(var(--app-primary-rgb), 0.10)' : 'transparent' }} data-id="button-2"
                  >
                    <Avatar image={c.avatar.image.uri} seed={c.userId} label={c.name} size={38} />
                    <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                      <div style={memberName}>{c.name}</div>
                    </div>
                    {on ? <Check size={18} style={{ color: 'var(--app-primary)', flexShrink: 0 }} /> : null}
                  </button>
                );
              })
            )}
          </div>
        </div>

        {status ? (
          <div style={{ fontSize: 13, fontWeight: 600, color: statusError ? 'var(--app-error)' : 'var(--app-primary)' }}>
            {status}
          </div>
        ) : null}
      </div>

      <div style={modalFoot}>
        <button type="button" onClick={onClose} style={ghostBtn} data-id="cancel">
          Cancel
        </button>
        <button type="button" disabled={!canSubmit} onClick={() => void submit()} style={ctaBtn(!canSubmit)} data-id="button-3">
          {isGroup ? (
            <>Create group · {count}</>
          ) : soleInvite ? (
            <>
              <Mail size={16} /> Send invite
            </>
          ) : (
            <>
              <MessageSquarePlus size={16} /> Start chat
            </>
          )}
        </button>
      </div>
    </div>
  );
}

// ── Modal styling (centered card on desktop / sheet on mobile via the popup
// layer). Ported from mockups/new-chat.html + new-group.html → app tokens. ──
const modal: React.CSSProperties = {
  width: 'min(440px, 92vw)',
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
  maxHeight: '60vh',
  overflowY: 'auto',
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
const tokens: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 6,
  padding: '6px 10px',
  minHeight: 44,
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
// Marks a chip that will send an invite rather than open a chat.
const inviteTag: React.CSSProperties = {
  fontFamily: 'var(--app-font-mono)',
  fontSize: 8.5,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  padding: '2px 4px',
  background: 'var(--app-foreground-10)',
  color: 'var(--app-foreground-muted)',
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
void memberSub;
// Fixed-height contacts list — reserves vertical space so the modal doesn't jump
// while the contacts request resolves.
const contactsBox: React.CSSProperties = {
  minHeight: 168,
  maxHeight: 240,
  overflowY: 'auto',
  border: '1px solid var(--app-border)',
  borderRadius: 10,
  background: 'var(--app-tertiary)',
  padding: 4,
};
const contactsMsg: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: 160,
  fontSize: 13,
  color: 'var(--app-foreground)',
  opacity: 0.5,
  textAlign: 'center',
  padding: '0 16px',
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
