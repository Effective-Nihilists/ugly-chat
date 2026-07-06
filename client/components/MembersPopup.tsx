import React, { useCallback, useEffect, useState } from 'react';
import { Crown, LogOut, Trash2, UserMinus, UserPlus } from 'lucide-react';
import type { Avatar as AvatarT } from 'ugly-app/shared';
import { Avatar } from '../lib/conversations';

// Popups render in the router's portal, OUTSIDE <AppProvider>, so they can't
// use useApp()/useRouter() — deps are passed in by the opener.
interface Member {
  userId: string;
  role: string;
  name: string;
  avatar: AvatarT;
  isBot: boolean;
}

interface Contact {
  userId: string;
  name: string;
  avatar: AvatarT;
}

interface PopupSocket {
  request: (name: string, input: Record<string, unknown>) => Promise<unknown>;
}

interface PopupOpener {
  openPopup: (
    content: React.ReactNode,
    opts?: { mode?: 'block' | 'transient' | 'contextMenu' },
  ) => { hide: () => void };
}

interface MembersPopupProps {
  onClose: () => void;
  socket: PopupSocket;
  userId: string;
  conversationId: string;
  onLeft: () => void;
}

export function openMembersPopup(
  router: PopupOpener,
  socket: PopupSocket,
  userId: string,
  conversationId: string,
  onLeft: () => void,
): void {
  const handle = router.openPopup(
    <MembersPopup
      onClose={() => { handle.hide(); }}
      socket={socket}
      userId={userId}
      conversationId={conversationId}
      onLeft={onLeft}
    />,
    { mode: 'transient' },
  );
}

export function MembersPopup({
  onClose,
  socket,
  userId,
  conversationId,
  onLeft,
}: MembersPopupProps): React.ReactElement {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [adding, setAdding] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactsLoaded, setContactsLoaded] = useState(false);
  const [contactQuery, setContactQuery] = useState('');

  const load = useCallback(async () => {
    try {
      const res = (await socket.request('conversationMembers', { conversationId })) as {
        members?: Member[];
      };
      setMembers(res.members ?? []);
    } catch (err) {
      console.error('[Members] load failed', err);
    } finally {
      setLoading(false);
    }
  }, [socket, conversationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const myRole = members.find((m) => m.userId === userId)?.role;
  const isOwner = myRole === 'owner';
  const ownerCount = members.filter((m) => m.role === 'owner').length;

  const act = useCallback(
    async (name: string, input: Record<string, unknown>, key: string) => {
      setBusy(key);
      try {
        await socket.request(name, input);
        await load();
      } catch (err) {
        console.error(`[Members] ${name} failed`, err);
      } finally {
        setBusy(null);
      }
    },
    [socket, load],
  );

  const openAdd = useCallback(async () => {
    setAdding(true);
    if (contactsLoaded) return;
    try {
      const res = (await socket.request('userContacts', {})) as { users?: Contact[] };
      setContacts(res.users ?? []);
    } catch (err) {
      console.error('[Members] contacts load failed', err);
    } finally {
      setContactsLoaded(true);
    }
  }, [socket, contactsLoaded]);

  const addMember = useCallback(
    async (uid: string) => {
      setBusy(`add-${uid}`);
      try {
        await socket.request('conversationMemberAdd', { conversationId, userId: uid });
        await load(); // refresh the roster so the new member appears + drops from candidates
      } catch (err) {
        console.error('[Members] add failed', err);
      } finally {
        setBusy(null);
      }
    },
    [socket, conversationId, load],
  );

  const leave = useCallback(async () => {
    setBusy('leave');
    try {
      await socket.request('conversationMemberRemove', { conversationId, userId });
      onClose();
      onLeft();
    } catch (err) {
      console.error('[Members] leave failed', err);
      setBusy(null);
    }
  }, [socket, conversationId, userId, onClose, onLeft]);

  // Leaving is blocked only when you're the sole owner of a multi-member group
  // (matches the engine's last-owner guard).
  const soleOwnerOfGroup = isOwner && ownerCount === 1 && members.length > 1;

  const deleteConversation = useCallback(async () => {
    setBusy('delete');
    try {
      await socket.request('conversationDelete', { conversationId });
      onClose();
      onLeft();
    } catch (err) {
      console.error('[Members] delete failed', err);
      setBusy(null);
    }
  }, [socket, conversationId, onClose, onLeft]);

  return (
    <div
      style={{
        width: 'min(440px, 92vw)',
        maxHeight: '80vh',
        background: 'var(--app-main)',
        borderRadius: 16,
        border: '1px solid var(--app-border)',
        padding: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {adding ? (
          <button type="button" onClick={() => { setAdding(false); }} aria-label="Back" style={{ border: 'none', background: 'transparent', fontSize: 22, lineHeight: 1, cursor: 'pointer', color: 'var(--app-foreground)', padding: 0 }}>
            ‹
          </button>
        ) : null}
        <span style={{ fontFamily: 'var(--app-font-heading)', fontWeight: 800, fontSize: 18, color: 'var(--app-foreground)' }}>
          {adding ? 'Add members' : `Members${members.length ? ` · ${members.length}` : ''}`}
        </span>
      </div>

      {adding ? (
        <AddMemberList
          contacts={contacts}
          memberIds={new Set(members.map((m) => m.userId))}
          loaded={contactsLoaded}
          query={contactQuery}
          onQuery={setContactQuery}
          busy={busy}
          onAdd={(uid) => void addMember(uid)}
        />
      ) : (
        <>
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflowY: 'auto', gap: 2 }}>
        {loading ? (
          <Hint text="Loading…" />
        ) : members.length === 0 ? (
          <Hint text="No members." />
        ) : (
          members.map((m) => {
            const self = m.userId === userId;
            return (
              <div key={m.userId} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '8px 4px' }}>
                <Avatar image={m.avatar.image.uri} seed={m.userId} label={m.name} size={38} />
                <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--app-foreground)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {m.name}{self ? ' (you)' : ''}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--app-foreground)', opacity: 0.5, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    {m.role === 'owner' ? <Crown size={11} /> : null}
                    {m.isBot ? 'Bot' : m.role}
                  </span>
                </span>
                {/* Owner controls for other (non-bot) members. */}
                {isOwner && !self && !m.isBot ? (
                  <>
                    <button
                      type="button"
                      title={m.role === 'owner' ? 'Demote to member' : 'Make owner'}
                      disabled={busy !== null}
                      onClick={() =>
                        void act(
                          'conversationMemberRole',
                          { conversationId, userId: m.userId, role: m.role === 'owner' ? 'member' : 'owner' },
                          `role-${m.userId}`,
                        )
                      }
                      style={iconBtn(m.role === 'owner')}
                    >
                      <Crown size={15} />
                    </button>
                    <button
                      type="button"
                      title="Remove from group"
                      disabled={busy !== null}
                      onClick={() =>
                        void act('conversationMemberRemove', { conversationId, userId: m.userId }, `rm-${m.userId}`)
                      }
                      style={iconBtn(false)}
                    >
                      <UserMinus size={15} />
                    </button>
                  </>
                ) : null}
              </div>
            );
          })
        )}
      </div>

      {/* Any member can invite from their contacts (engine allows add on
          public/private groups; restricted groups will reject non-owners). */}
      <button
        type="button"
        onClick={() => void openAdd()}
        disabled={loading}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 7, alignSelf: 'flex-start', height: 34, padding: '0 12px', borderRadius: 9, border: '1px solid var(--app-primary)', background: 'transparent', color: 'var(--app-primary)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
      >
        <UserPlus size={15} /> Add members
      </button>

      {/* Owner-only destructive delete (distinct from leaving). Two-step confirm. */}
      {isOwner ? (
        confirmDelete ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 10, background: 'rgba(var(--app-error-rgb, 220,38,38), 0.08)', border: '1px solid var(--app-error)' }}>
            <span style={{ flex: 1, fontSize: 13, color: 'var(--app-error)' }}>Delete this conversation for everyone?</span>
            <button
              type="button"
              onClick={() => { setConfirmDelete(false); }}
              disabled={busy !== null}
              style={{ fontSize: 13, fontWeight: 600, padding: '5px 10px', borderRadius: 8, border: '1px solid var(--app-border)', background: 'transparent', color: 'var(--app-foreground)', cursor: 'pointer' }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void deleteConversation()}
              disabled={busy !== null}
              style={{ fontSize: 13, fontWeight: 700, padding: '5px 12px', borderRadius: 8, border: 'none', background: 'var(--app-error)', color: '#fff', cursor: 'pointer' }}
            >
              {busy === 'delete' ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => { setConfirmDelete(true); }}
            disabled={busy !== null}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 7, alignSelf: 'flex-start', height: 34, padding: '0 12px', borderRadius: 9, border: '1px solid var(--app-error)', background: 'transparent', color: 'var(--app-error)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
          >
            <Trash2 size={14} /> Delete conversation
          </button>
        )
      ) : null}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 4 }}>
        <button
          type="button"
          onClick={() => void leave()}
          disabled={busy !== null || soleOwnerOfGroup}
          title={soleOwnerOfGroup ? 'Promote another owner before leaving' : 'Leave conversation'}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 7,
            height: 38,
            padding: '0 14px',
            borderRadius: 10,
            border: '1px solid var(--app-border)',
            background: 'transparent',
            color: soleOwnerOfGroup ? 'var(--app-foreground)' : 'var(--app-error)',
            opacity: soleOwnerOfGroup ? 0.4 : 1,
            fontSize: 14,
            fontWeight: 600,
            cursor: soleOwnerOfGroup ? 'not-allowed' : 'pointer',
          }}
        >
          <LogOut size={15} /> Leave
        </button>
        <button type="button" onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--app-foreground)', opacity: 0.55, fontSize: 13, cursor: 'pointer' }}>
          Close
        </button>
      </div>
        </>
      )}
    </div>
  );
}

// The contact picker shown in "add members" mode.
function AddMemberList(props: {
  contacts: Contact[];
  memberIds: Set<string>;
  loaded: boolean;
  query: string;
  onQuery: (q: string) => void;
  busy: string | null;
  onAdd: (userId: string) => void;
}): React.ReactElement {
  const ql = props.query.trim().toLowerCase();
  const candidates = props.contacts
    .filter((c) => !props.memberIds.has(c.userId))
    .filter((c) => !ql || c.name.toLowerCase().includes(ql));
  return (
    <>
      <input
        value={props.query}
        onChange={(e) => { props.onQuery(e.target.value); }}
        placeholder="Search your contacts…"
        autoFocus
        style={{ height: 40, padding: '0 12px', borderRadius: 10, border: '1px solid var(--app-border)', background: 'var(--app-main)', outline: 'none', fontSize: 14, color: 'var(--app-foreground)' }}
      />
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflowY: 'auto', gap: 2 }}>
        {!props.loaded ? (
          <Hint text="Loading…" />
        ) : candidates.length === 0 ? (
          <Hint text={props.contacts.length === 0 ? 'No contacts yet — chat with people first.' : 'Everyone you know is already here.'} />
        ) : (
          candidates.map((c) => {
            const adding = props.busy === `add-${c.userId}`;
            return (
              <button
                key={c.userId}
                type="button"
                disabled={props.busy !== null}
                onClick={() => { props.onAdd(c.userId); }}
                className="uc-row"
                style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '8px 4px', width: '100%', border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left', font: 'inherit' }}
              >
                <Avatar image={c.avatar.image.uri} seed={c.userId} label={c.name} size={38} />
                <span style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 600, color: 'var(--app-foreground)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {c.name}
                </span>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--app-primary)' }}>{adding ? '…' : '+ Add'}</span>
              </button>
            );
          })
        )}
      </div>
    </>
  );
}

function iconBtn(active: boolean): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 30,
    height: 30,
    flexShrink: 0,
    borderRadius: 8,
    border: '1px solid var(--app-border)',
    background: active ? 'var(--app-secondary)' : 'transparent',
    color: 'var(--app-foreground)',
    cursor: 'pointer',
  };
}

function Hint({ text }: { text: string }): React.ReactElement {
  return <div style={{ padding: '24px 8px', textAlign: 'center', fontSize: 14, color: 'var(--app-foreground)', opacity: 0.45 }}>{text}</div>;
}
